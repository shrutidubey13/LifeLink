/**
 * Login + authorization for citizens and verifiers.
 *
 * Design, in one paragraph:
 *   Citizens and verifiers each have an email + bcrypt password hash. Logging
 *   in (or registering) returns a short-lived JWT (HS256, signed with the
 *   server secret) that says { kind: "citizen" | "verifier", sub: <id> }.
 *   Protected routes demand that token and check the caller only touches
 *   their OWN records — a citizen can never read another citizen's wallet,
 *   and a verifier can never spend another verifier's consent.
 *
 * What this is NOT: a full identity system. There is no email verification,
 * no password reset, and no refresh-token rotation. Those are listed as
 * future work in the README. Good enough for a hackathon demo, honest about
 * what it is.
 */
import type { NextFunction, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';
import { HttpError, config } from './config';

export type AccountKind = 'citizen' | 'verifier';

/** What a verified login token carries. `sub` is the citizen/verifier id. */
export interface AuthContext {
  kind: AccountKind;
  id: number;
  email: string;
}

const JWT_ALG = 'HS256';
const BCRYPT_ROUNDS = 10;

function secretKey(): Uint8Array {
  return new TextEncoder().encode(config.authJwtSecret);
}

function normalizeEmail(email: unknown): string {
  if (typeof email !== 'string') {
    throw new HttpError(400, '"email" is required');
  }
  const cleaned = email.trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(cleaned)) {
    throw new HttpError(400, `"${email.trim()}" is not a valid email address`);
  }
  if (cleaned.length > 320) {
    throw new HttpError(400, '"email" is too long');
  }
  return cleaned;
}

function checkPasswordRules(password: unknown): string {
  if (typeof password !== 'string' || password.length < 8) {
    throw new HttpError(400, '"password" must be at least 8 characters long');
  }
  if (password.length > 128) {
    throw new HttpError(400, '"password" must be at most 128 characters');
  }
  return password;
}

export const authValidation = { normalizeEmail, checkPasswordRules };

/** bcrypt hash for storage. Never store or log the plaintext. */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

/** Compare a login attempt against the stored hash. */
export async function checkPassword(password: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(password, hash);
  } catch {
    return false;
  }
}

/** Mint a session token after a successful login or registration. */
export async function signToken(kind: AccountKind, id: number, email: string): Promise<string> {
  return new SignJWT({ kind, email })
    .setProtectedHeader({ alg: JWT_ALG })
    .setSubject(String(id))
    .setIssuedAt()
    .setExpirationTime(`${config.authTokenTtlSeconds}s`)
    .sign(secretKey());
}

/** Verify a session token. Throws HttpError(401) when it is bad or expired. */
export async function verifyToken(token: string): Promise<AuthContext> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: [JWT_ALG] });
    const kind = payload.kind as string;
    const id = Number(payload.sub);
    const email = payload.email as string;
    if ((kind !== 'citizen' && kind !== 'verifier') || !Number.isInteger(id) || id <= 0) {
      throw new Error('bad claims');
    }
    return { kind, id, email: typeof email === 'string' ? email : '' };
  } catch {
    throw new HttpError(401, 'Your session is invalid or has expired. Please log in again.');
  }
}

/** Read req.auth inside a protected handler (always set by the middleware). */
export function getAuth(req: Request): AuthContext {
  const auth = (req as Request & { auth?: AuthContext }).auth;
  if (!auth) {
    throw new HttpError(401, 'Login required. Send "Authorization: Bearer <token>".');
  }
  return auth;
}

/**
 * Express middleware: require a valid login of one of the allowed kinds.
 * Usage:  router.get('/wallet/...', requireAuth('citizen'), route(...))
 */
export function requireAuth(...allowed: AccountKind[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const header = req.headers.authorization ?? '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) {
      next(
        new HttpError(
          401,
          'Login required. Send your session token as "Authorization: Bearer <token>".',
        ),
      );
      return;
    }
    verifyToken(token)
      .then((auth) => {
        if (!allowed.includes(auth.kind)) {
          next(
            new HttpError(
              403,
              `This endpoint is for ${allowed.join(' or ')} accounts, but your session is a ${auth.kind} session.`,
            ),
          );
          return;
        }
        (req as Request & { auth: AuthContext }).auth = auth;
        next();
      })
      .catch(next);
  };
}

/** Shorthands so route definitions read naturally. */
export const requireCitizen = requireAuth('citizen');
export const requireVerifier = requireAuth('verifier');
