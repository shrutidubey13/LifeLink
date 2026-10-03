/**
 * Shared 9-check verification for ORGANIZATION callers.
 *
 * Mirrors POST /verifier/verify exactly (issuer trust → signature → schema →
 * disclosure digests → holder binding → nonce → audience → revocation →
 * consent), except the acting party is an ORGANIZATION (issuers table) via its
 * linked verifier row. The linked verifier shares the organization's DID, so
 * audience binding is sound.
 */
import { decodeJwt, type JWK } from 'jose';
import { query, queryOne } from './db';
import { appendAuditEvent } from './audit';
import { getStatusListRow, isRevoked } from './statusList';
import { claimKeys, claimsOf, splitCombined, verifyPresentation } from './sdjwt';
import { resolveDidKey } from './crypto';
import { loadRequestByNonce } from './openid4vp';
import { isCredentialType, validateClaims } from './schemas';
import type {
  CheckResult,
  CitizenRow,
  ConsentRow,
  CredentialRow,
  IssuerRow,
  VerifierRow,
} from './types';
import type { PresentationRequestRow } from './openid4vp';

function typeLabel(type: string): string {
  return type.replace(/Credential$/, '');
}

async function loadIssuerByDid(did: string): Promise<IssuerRow | null> {
  return queryOne<IssuerRow>('SELECT * FROM issuers WHERE did = $1', [did]);
}

async function loadCredentialByJwt(jwt: string): Promise<CredentialRow | null> {
  return queryOne<CredentialRow>('SELECT * FROM credentials WHERE jwt = $1', [jwt]);
}

async function loadConsentByRequest(requestId: number): Promise<ConsentRow | null> {
  return queryOne<ConsentRow>('SELECT * FROM consents WHERE presentation_request_id = $1', [requestId]);
}

function sdAlgName(verification: { payload: { _sd_alg?: unknown } }): string {
  return typeof verification.payload._sd_alg === 'string' ? verification.payload._sd_alg : 'sha-256';
}

export async function verifyOrganizationPresentation(args: {
  org: IssuerRow;
  linkedVerifier: VerifierRow;
  presentation: string;
}): Promise<Record<string, unknown>> {
  const { org, linkedVerifier, presentation } = args;
  const startedAt = Date.now();
  const verifier = linkedVerifier;

  let parsed: { jwt: string; kbJwt: string | null; disclosures: string[] } | null = null;
  let splitError: string | null = null;
  try {
    parsed = splitCombined(presentation);
  } catch (err) {
    splitError = err instanceof Error ? err.message : String(err);
  }

  const checks: CheckResult[] = [];
  const fail = (id: CheckResult['id'], label: string, detail: string): CheckResult => ({
    id,
    label,
    passed: false,
    detail,
  });
  const pass = (id: CheckResult['id'], label: string, detail: string): CheckResult => ({
    id,
    label,
    passed: true,
    detail,
  });

  let request: PresentationRequestRow | null = null;
  let kbNonce: string | null = null;
  if (parsed?.kbJwt) {
    try {
      const kb = decodeJwt(parsed.kbJwt) as { nonce?: unknown };
      kbNonce = typeof kb.nonce === 'string' ? kb.nonce : null;
    } catch {
      kbNonce = null;
    }
    if (kbNonce) {
      request = await loadRequestByNonce(kbNonce).catch(() => null);
    }
  }

  let issuer: IssuerRow | null = null;
  let credential: CredentialRow | null = null;
  let issuerDid: string | null = null;
  let credentialType = 'unknown';
  if (parsed) {
    try {
      const payload = decodeJwt(parsed.jwt) as { iss?: unknown; sub?: unknown; vct?: unknown };
      issuerDid = typeof payload.iss === 'string' ? payload.iss : null;
      credentialType = typeof payload.vct === 'string' ? payload.vct : 'unknown';
      if (issuerDid) issuer = await loadIssuerByDid(issuerDid);
      credential = await loadCredentialByJwt(parsed.jwt);
    } catch {
      /* crypto checks below report the parse failure */
    }
  }

  const issuerStatus = issuer ? (issuer.status ?? (issuer.trusted ? 'TRUSTED' : 'SUSPENDED')) : null;
  checks.push(
    issuer && issuerStatus === 'TRUSTED'
      ? pass('issuer_trusted', 'Issuer is TRUSTED in the trust registry', `${issuer.name} holds status TRUSTED.`)
      : fail(
          'issuer_trusted',
          'Issuer is TRUSTED in the trust registry',
          !issuer
            ? `No registered issuer with DID "${issuerDid ?? '(unreadable)'}".`
            : `${issuer.name} holds status ${issuerStatus}, not TRUSTED.`,
        ),
  );

  let verification: Awaited<ReturnType<typeof verifyPresentation>> | null = null;
  if (parsed && issuer) {
    try {
      verification = await verifyPresentation(presentation, issuer.public_jwk, {
        holderPublicJwk: undefined,
      });
    } catch (err) {
      splitError = err instanceof Error ? err.message : String(err);
    }
  }
  if (verification) {
    checks.push(
      verification.signatureValid
        ? pass(
            'signature_valid',
            'Issuer signature valid, credential not expired',
            `Ed25519 signature by ${issuer?.did} verified.`,
          )
        : fail(
            'signature_valid',
            'Issuer signature valid, credential not expired',
            verification.problems[0] ?? 'Signature verification failed.',
          ),
    );
  } else {
    checks.push(
      fail(
        'signature_valid',
        'Issuer signature valid, credential not expired',
        !parsed ? `Presentation could not be parsed: ${splitError ?? 'unknown error'}` : 'Skipped: issuer unknown.',
      ),
    );
  }

  if (credential && isCredentialType(credential.type)) {
    const fullClaims = claimsOf(credential.sd_jwt);
    const schemaCheck = validateClaims(credential.type, fullClaims);
    checks.push(
      schemaCheck.ok
        ? pass('schema_valid', 'Credential matches its schema', `${credential.type} schema valid.`)
        : fail(
            'schema_valid',
            'Credential matches its schema',
            `Stored claims violate schema: ${(schemaCheck.issues ?? []).join('; ')}`,
          ),
    );
  } else {
    checks.push(fail('schema_valid', 'Credential matches its schema', 'Skipped: credential unknown.'));
  }

  if (verification) {
    checks.push(
      verification.digestsValid
        ? pass(
            'disclosure_integrity',
            'Revealed fields match signed digests',
            `All ${verification.revealedKeys.length} shared field(s) recompute (RFC 9901, ${sdAlgName(verification)}).`,
          )
        : fail(
            'disclosure_integrity',
            'Revealed fields match signed digests',
            verification.problems.find((p) => !p.startsWith('KB:')) ?? 'Digest mismatch.',
          ),
    );
  } else {
    checks.push(fail('disclosure_integrity', 'Revealed fields match signed digests', 'Skipped.'));
  }

  let holderCitizen: CitizenRow | null = null;
  if (verification?.payload?.sub) {
    holderCitizen = await queryOne<CitizenRow>('SELECT * FROM citizens WHERE did = $1', [
      verification.payload.sub,
    ]);
  }
  if (verification && holderCitizen && parsed?.kbJwt) {
    let resolvedOk = false;
    try {
      const resolved = resolveDidKey(holderCitizen.did);
      resolvedOk = resolved.publicJwk.x === (holderCitizen.public_jwk as JWK).x;
    } catch {
      resolvedOk = false;
    }
    const kbCheck = await verifyPresentation(
      presentation,
      issuer?.public_jwk ?? { kty: 'OKP', crv: 'Ed25519', x: '' },
      {
        holderPublicJwk: holderCitizen.public_jwk,
        expectedNonce: request?.nonce,
        expectedAud: request?.aud,
      },
    );
    const kb = kbCheck.kb;
    const holderOk =
      kb.present && kb.signatureValid && kb.sdHashValid && kb.nonceValid && kb.audValid && kb.fresh && resolvedOk;
    checks.push(
      holderOk
        ? pass(
            'holder_binding',
            'Holder key binding valid (proof of possession)',
            `Wallet proved possession of holder key for ${holderCitizen.did}.`,
          )
        : fail(
            'holder_binding',
            'Holder key binding valid (proof of possession)',
            !resolvedOk ? 'Subject DID does not resolve to holder key on file.' : kb.problems.join(' '),
          ),
    );
  } else {
    checks.push(
      fail(
        'holder_binding',
        'Holder key binding valid (proof of possession)',
        !parsed?.kbJwt ? 'No Key Binding JWT attached.' : 'Skipped.',
      ),
    );
  }

  if (request && kbNonce) {
    const fresh = new Date(request.expires_at).getTime() > Date.now();
    // Organization owns the request via linked verifier OR matching aud.
    const owned = request.verifier_id === verifier.id || request.aud === org.did;
    checks.push(
      fresh && owned
        ? pass(
            'nonce_valid',
            'Nonce valid (fresh, single-use, replay-safe)',
            `Nonce answers request #${request.id}, unexpired, addressed to ${org.name}.`,
          )
        : fail(
            'nonce_valid',
            'Nonce valid (fresh, single-use, replay-safe)',
            !owned
              ? `Request #${request.id} belongs to another party.`
              : `Request #${request.id} expired.`,
          ),
    );
  } else {
    checks.push(
      fail(
        'nonce_valid',
        'Nonce valid (fresh, single-use, replay-safe)',
        !kbNonce ? 'No nonce in presentation.' : 'Nonce answers no known request.',
      ),
    );
  }

  if (request) {
    const audOk = request.aud === org.did || request.aud === verifier.did;
    checks.push(
      audOk
        ? pass(
            'audience_valid',
            'Audience valid (made for this organization)',
            `Audience "${request.aud}" matches ${org.name}.`,
          )
        : fail(
            'audience_valid',
            'Audience valid (made for this organization)',
            `Request audience "${request.aud}" is not ${org.did}.`,
          ),
    );
  } else {
    checks.push(fail('audience_valid', 'Audience valid (made for this organization)', 'Skipped.'));
  }

  if (credential && issuer) {
    const statusList = await getStatusListRow(issuer.id);
    const statusIndex = verification?.payload?.status?.idx ?? credential.status_index;
    const idxMatches = statusIndex === credential.status_index;
    const revokedByList = isRevoked(statusList.bits, statusIndex);
    const revoked = revokedByList || credential.revoked;
    checks.push(
      !revoked && idxMatches
        ? pass(
            'not_revoked',
            'Credential not revoked (status list bit is 0)',
            `Bit #${statusIndex} is 0 (valid).`,
          )
        : fail(
            'not_revoked',
            'Credential not revoked (status list bit is 0)',
            revoked ? `Bit #${statusIndex} is SET — revoked.` : 'Status index mismatch.',
          ),
    );
  } else {
    checks.push(fail('not_revoked', 'Credential not revoked (status list bit is 0)', 'Skipped.'));
  }

  const consent = request ? await loadConsentByRequest(request.id) : null;
  const revealedKeys = verification?.revealedKeys ?? [];
  const consentProblems: string[] = [];
  if (!consent) {
    consentProblems.push('No consent answers this request.');
  } else {
    if (consent.status !== 'APPROVED') consentProblems.push(`Consent is ${consent.status}.`);
    if (consent.revoked) consentProblems.push('Access ended by citizen.');
    if (new Date(consent.expires_at).getTime() <= Date.now()) consentProblems.push('Consent expired.');
    if (credential && consent.credential_id !== credential.id) {
      consentProblems.push('Consent covers a different credential.');
    }
    if (consent.verifier_id !== verifier.id) consentProblems.push('Consent granted to another party.');
    const notConsented = revealedKeys.filter((key) => !consent.fields.includes(key));
    if (notConsented.length > 0) consentProblems.push(`Shared without consent: ${notConsented.join(', ')}.`);
  }
  checks.push(
    consentProblems.length === 0 && consent
      ? pass(
          'consent_valid',
          'Consent valid, live, and covers every shared field',
          `Consent #${consent.id} covers ${revealedKeys.length} field(s).`,
        )
      : fail('consent_valid', 'Consent valid, live, and covers every shared field', consentProblems.join(' ')),
  );

  const granted = checks.every((c) => c.passed);
  const durationMs = Date.now() - startedAt;
  const citizenId = holderCitizen?.id ?? credential?.citizen_id ?? null;
  await appendAuditEvent({
    eventType: granted ? 'CREDENTIAL_VERIFIED' : 'VERIFICATION_FAILED',
    citizenId,
    verifierId: verifier.id,
    issuerId: org.id,
    credentialId: credential?.id ?? null,
    payload: {
      consentId: consent?.id ?? null,
      requestId: request?.id ?? null,
      purpose: consent?.purpose ?? request?.purpose ?? null,
      verifierDid: verifier.did,
      organizationId: org.id,
      organizationName: org.name,
      credentialType,
      issuerDid: issuer?.did ?? issuerDid,
      holderBound: true,
      kbPresent: parsed?.kbJwt != null,
      durationMs,
      checks: checks.map((c) => ({ id: c.id, passed: c.passed })),
      revealedFields: granted ? revealedKeys : [],
      deniedBecause: granted ? [] : checks.filter((c) => !c.passed).map((c) => c.id),
    },
  });

    const attachmentMeta =
      granted && consent?.share_attachment && credential?.attachment_id
        ? await queryOne<{ id: number; file_name: string; mime: string; size: number; sha256: string }>(
            'SELECT id, file_name, mime, size, sha256 FROM document_files WHERE id = $1',
            [credential.attachment_id],
          )
        : null;

    return {
      result: granted ? 'granted' : 'denied',
      revealed: granted && verification ? verification.revealed : {},
      revealedFields: granted ? revealedKeys : [],
      withheldFields:
        granted && credential
          ? claimKeys(credential.sd_jwt).filter((k) => !revealedKeys.includes(k))
          : [],
      checks,
      organization: { id: org.id, name: org.name, did: org.did },
      verifier: { id: verifier.id, name: verifier.name, did: verifier.did },
      request: request
        ? { id: request.id, purpose: request.purpose, requestedFields: request.requested_fields, nonce: request.nonce }
        : null,
      credential: credential
        ? { id: credential.id, type: credential.type, typeLabel: typeLabel(credential.type), attachmentId: credential.attachment_id ?? null }
        : null,
      attachment: attachmentMeta
        ? {
            id: attachmentMeta.id,
            name: attachmentMeta.file_name,
            mime: attachmentMeta.mime,
            size: attachmentMeta.size,
            sha256: attachmentMeta.sha256,
          }
        : null,
      verifiedAt: new Date().toISOString(),
    };
  }

