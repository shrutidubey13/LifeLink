/**
 * Login session for the whole app.
 *
 * The token lives in localStorage so a refresh keeps you logged in. On boot we
 * call GET /auth/me to prove the token is still valid — if the server rejects
 * it (expired, forged, account deleted) we drop it and show the login screen.
 * Any 401 during normal use also logs out everywhere at once (see api.ts).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, getStoredToken, storeToken, UNAUTHORIZED_EVENT } from './api';
import type { AccountKind, SessionUser } from './types';

interface AuthState {
  /** null while we are still checking the stored token on boot. */
  user: SessionUser | null;
  ready: boolean;
  login: (kind: AccountKind, email: string, password: string) => Promise<string | null>;
  register: (kind: AccountKind, name: string, email: string, password: string) => Promise<string | null>;
  logout: () => void;
  /** Last login/register error, for the form to display. */
  error: string | null;
  pending: boolean;
}

const AuthContext = createContext<AuthState | null>(null);

/** The demo can stash a share here so the verifier portal auto-fills after an account switch. */
const LAST_SHARE_KEY = 'lifelink_last_share';

export function stashShare(payload: { presentation: string }): void {
  try {
    localStorage.setItem(LAST_SHARE_KEY, JSON.stringify(payload));
  } catch {
    /* ignore */
  }
}

export function takeStashedShare(): { presentation: string } | null {
  try {
    const raw = localStorage.getItem(LAST_SHARE_KEY);
    if (!raw) return null;
    localStorage.removeItem(LAST_SHARE_KEY);
    const parsed = JSON.parse(raw) as { presentation: string };
    if (typeof parsed.presentation === 'string') return parsed;
    return null;
  } catch {
    return null;
  }
}

function toUser(
  kind: AccountKind,
  profile: { id: number; name: string; email?: string | null; did?: string },
): SessionUser {
  return { kind, id: profile.id, name: profile.name, email: profile.email ?? null, did: profile.did ?? '' };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const logout = useCallback(() => {
    storeToken(null);
    setUser(null);
    setError(null);
  }, []);

  // Validate the stored token once, on boot.
  useEffect(() => {
    const token = getStoredToken();
    if (!token) {
      setReady(true);
      return;
    }
    api
      .me()
      .then((me) => {
        if (me.kind === 'citizen' && me.citizen) setUser(toUser('citizen', me.citizen));
        else if ((me.kind === 'organization' || me.kind === 'issuer') && (me.organization ?? me.issuer)) {
          const org = me.organization ?? me.issuer!;
          setUser(toUser('organization', org));
        } else if (me.kind === 'verifier' && me.verifier) setUser(toUser('verifier', me.verifier));
        else if (me.kind === 'admin' && me.admin)
          setUser({ kind: 'admin', id: me.admin.id, name: me.admin.name, email: me.admin.email, did: '' });
        else logout();
      })
      .catch(() => logout())
      .finally(() => setReady(true));
  }, [logout]);

  // A 401 anywhere in the app means the session died — log out.
  useEffect(() => {
    const onUnauthorized = () => logout();
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, [logout]);

  const login = useCallback(async (kind: AccountKind, email: string, password: string) => {
    setPending(true);
    setError(null);
    try {
      if (kind === 'citizen') {
        const session = await api.citizenLogin(email, password);
        storeToken(session.token);
        setUser(toUser('citizen', session.citizen));
      } else if (kind === 'organization' || kind === 'issuer') {
        let session;
        try {
          session = await api.organizationLogin(email, password);
        } catch {
          session = await api.issuerLogin(email, password);
        }
        storeToken(session.token);
        setUser(toUser('organization', session.organization ?? session.issuer!));
      } else if (kind === 'verifier') {
        const session = await api.verifierLogin(email, password);
        storeToken(session.token);
        setUser(toUser('verifier', session.verifier));
      } else {
        const session = await api.adminLogin(email, password);
        storeToken(session.token);
        setUser({ kind: 'admin', id: session.admin.id, name: session.admin.name, email: session.admin.email, did: '' });
      }
      return null;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      return message;
    } finally {
      setPending(false);
    }
  }, []);

  const register = useCallback(async (kind: AccountKind, name: string, email: string, password: string) => {
    setPending(true);
    setError(null);
    try {
      if (kind === 'citizen') {
        const session = await api.citizenRegister(name, email, password);
        storeToken(session.token);
        setUser(toUser('citizen', session.citizen));
      } else if (kind === 'verifier') {
        const session = await api.verifierRegister(name, email, password);
        storeToken(session.token);
        setUser(toUser('verifier', session.verifier));
      } else {
        throw new Error(
          kind === 'admin'
            ? 'Admin accounts cannot self-register. Ask an existing admin.'
            : 'Organization accounts are created by an admin. Log in instead.',
        );
      }
      return null;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      return message;
    } finally {
      setPending(false);
    }
  }, []);

  const value = useMemo<AuthState>(
    () => ({ user, ready, login, register, logout, error, pending }),
    [user, ready, login, register, logout, error, pending],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
