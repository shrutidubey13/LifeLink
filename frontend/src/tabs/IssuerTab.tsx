/**
 * Tab 2 — the issuer portal.
 *
 * Stands in for a university / employer / hospital system. It signs credentials
 * as SD-JWTs, where every claim becomes an individually shareable disclosure,
 * and it can revoke them (which flips a bit in the issuer's status list).
 *
 * The trust registry is shown here too, so you can watch "Fake College" go from
 * denied to granted the moment you trust it.
 */
import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { ISSUER_TYPES, exampleClaimsFor, fieldLabel, formatValue } from '../lib/catalog';
import { useAction, useRequest } from '../lib/hooks';
import { formatDate, prettyJson } from '../lib/format';
import type { Citizen, Issuer } from '../lib/types';
import {
  Badge,
  Card,
  ErrorBlock,
  Field,
  InlineError,
  LoadingBlock,
  SectionTitle,
  Select,
  Spinner,
  StatusBadge,
} from '../components/ui';

export function IssuerTab({ citizens }: { citizens: Citizen[] }) {
  const issuers = useRequest(() => api.issuers(), 'issuers');
  const [issuerId, setIssuerId] = useState<number | ''>('');
  const [citizenId, setCitizenId] = useState<number | ''>('');
  const [type, setType] = useState<string>('DegreeCredential');
  const [claimsText, setClaimsText] = useState(() => prettyJson(exampleClaimsFor('DegreeCredential')));
  const [expiresInDays, setExpiresInDays] = useState(365);
  const [flash, setFlash] = useState<string | null>(null);

  const issue = useAction(api.issueCredential);
  const revoke = useAction(api.revokeCredential);
  const trust = useAction(async (id: number, shouldTrust: boolean) =>
    shouldTrust ? api.trustIssuer(id) : api.untrustIssuer(id),
  );

  const issued = useRequest(
    () => (issuerId === '' ? Promise.resolve(null) : api.issuerCredentials(Number(issuerId))),
    `issued-${issuerId}`,
  );

  // Default the form once the actors have loaded.
  useEffect(() => {
    if (citizens.length > 0 && citizenId === '') setCitizenId(citizens[0].id);
  }, [citizens, citizenId]);

  const issuerList = issuers.data?.issuers ?? [];
  useEffect(() => {
    if (issuerList.length > 0 && issuerId === '') {
      setIssuerId(issuerList.find((i) => i.trusted)?.id ?? issuerList[0].id);
    }
  }, [issuerList, issuerId]);

  // Picking a type pre-fills the example claims (the citizen can edit them).
  useEffect(() => {
    setClaimsText(prettyJson(exampleClaimsFor(type)));
  }, [type]);

  const selectedIssuer: Issuer | undefined = issuerList.find((i) => i.id === issuerId);

  const parsedClaims = useMemo<{ value: Record<string, unknown> | null; error: string | null }>(() => {
    try {
      const parsed: unknown = JSON.parse(claimsText);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return { value: null, error: 'Claims must be a JSON object, e.g. { "degree": "B.Tech" }' };
      }
      if (Object.keys(parsed as Record<string, unknown>).length === 0) {
        return { value: null, error: 'Add at least one claim.' };
      }
      return { value: parsed as Record<string, unknown>, error: null };
    } catch (err) {
      return { value: null, error: err instanceof Error ? `Invalid JSON: ${err.message}` : 'Invalid JSON' };
    }
  }, [claimsText]);

  async function handleIssue() {
    if (!parsedClaims.value || issuerId === '' || citizenId === '') return;
    const result = await issue.run({
      issuerId: Number(issuerId),
      citizenId: Number(citizenId),
      type,
      claims: parsedClaims.value,
      expiresInDays,
    });
    if (result) {
      setFlash(result.message);
      issued.reload();
    }
  }

  async function handleRevoke(id: number) {
    const result = await revoke.run(id, 'Revoked from the issuer portal');
    if (result) {
      setFlash(result.message);
      issued.reload();
    }
  }

  async function handleTrust(issuer: Issuer) {
    const result = await trust.run(issuer.id, !issuer.trusted);
    if (result) issuers.reload();
  }

  return (
    <div className="space-y-4">
      {issuers.loading && <LoadingBlock label="Loading the trust registry…" />}
      {issuers.error && <ErrorBlock message={issuers.error} onRetry={issuers.reload} />}

      <Card
        title="Issue a credential"
        subtitle="This is what a university, employer, hospital or bank would do. Every claim you write becomes an individually shareable disclosure."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Issuer" htmlFor="issuer-pick">
            <Select id="issuer-pick" value={issuerId} onChange={setIssuerId} disabled={issue.pending}>
              {issuerList.map((issuer) => (
                <option key={issuer.id} value={issuer.id}>
                  {issuer.name}
                  {issuer.trusted ? '' : '  (NOT in trust registry)'}
                </option>
              ))}
            </Select>
            {selectedIssuer && !selectedIssuer.trusted && (
              <p className="mt-1.5 text-xs text-rose-700">
                ⚠ Verifiers will refuse anything this issuer signs until it is trusted.
              </p>
            )}
          </Field>

          <Field label="Citizen (the wallet owner)" htmlFor="citizen-pick">
            <Select id="citizen-pick" value={citizenId} onChange={setCitizenId} disabled={issue.pending}>
              {citizens.map((citizen) => (
                <option key={citizen.id} value={citizen.id}>
                  {citizen.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Credential type" htmlFor="type-pick">
            <select
              id="type-pick"
              className="input"
              value={type}
              disabled={issue.pending}
              onChange={(event) => setType(event.target.value)}
            >
              {ISSUER_TYPES.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Valid for (days)" htmlFor="expiry">
            <input
              id="expiry"
              className="input"
              type="number"
              min={1}
              max={3650}
              value={expiresInDays}
              disabled={issue.pending}
              onChange={(event) => setExpiresInDays(Number(event.target.value))}
            />
          </Field>
        </div>

        <div className="mt-4">
          <Field
            label="Claims (JSON)"
            htmlFor="claims"
            hint="Each key here becomes one field the citizen can choose to share or hide."
          >
            <textarea
              id="claims"
              className="input h-48 font-mono text-xs"
              spellCheck={false}
              value={claimsText}
              disabled={issue.pending}
              onChange={(event) => setClaimsText(event.target.value)}
            />
          </Field>
          {parsedClaims.value && (
            <p className="mt-1 text-xs text-slate-500">
              {Object.keys(parsedClaims.value).length} claim(s):{' '}
              {Object.keys(parsedClaims.value)
                .map((key) => fieldLabel(key))
                .join(', ')}
            </p>
          )}
          {parsedClaims.error && <InlineError error={parsedClaims.error} />}
          <InlineError error={issue.error} />
        </div>

        {flash && (
          <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {flash}
          </p>
        )}

        <div className="mt-4">
          <button
            type="button"
            className="btn-primary"
            onClick={() => void handleIssue()}
            disabled={issue.pending || !!parsedClaims.error || issuerId === '' || citizenId === ''}
          >
            {issue.pending ? (
              <>
                <Spinner /> Signing with Ed25519…
              </>
            ) : (
              `Issue ${type.replace(/Credential$/, '')}`
            )}
          </button>
        </div>
      </Card>

      <div>
        <SectionTitle hint="Credentials signed by this issuer">Issued credentials</SectionTitle>
        {issued.loading && <LoadingBlock />}
        {issued.error && <ErrorBlock message={issued.error} onRetry={issued.reload} />}
        {issued.data && issued.data.credentials.length === 0 && (
          <Card>
            <p className="text-sm text-slate-600">This issuer has not issued anything yet.</p>
          </Card>
        )}
        {issued.data && issued.data.credentials.length > 0 && (
          <div className="space-y-3">
            {issued.data.credentials.map((credential) => (
              <Card key={credential.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-bold text-slate-900">{credential.typeLabel}</h3>
                      <StatusBadge status={credential.status} />
                      <Badge tone="neutral">#{credential.id}</Badge>
                    </div>
                    <p className="mt-1 text-sm text-slate-600">
                      For <span className="font-medium text-slate-800">{credential.citizen.name}</span> · issued{' '}
                      {formatDate(credential.issuedAt)} · expires {formatDate(credential.expiresAt)} · status
                      list bit #{credential.statusIndex}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="btn-danger"
                    onClick={() => void handleRevoke(credential.id)}
                    disabled={revoke.pending || credential.status === 'revoked'}
                  >
                    {revoke.pending ? <Spinner /> : null}
                    {credential.status === 'revoked' ? 'Revoked' : 'Revoke'}
                  </button>
                </div>

                <dl className="mt-3 grid grid-cols-1 gap-x-6 sm:grid-cols-2">
                  {Object.entries(credential.claims).map(([key, value]) => (
                    <div key={key} className="flex items-baseline justify-between gap-2 border-b border-slate-100 py-1">
                      <dt className="text-xs text-slate-500">{fieldLabel(key)}</dt>
                      <dd className="truncate text-xs font-semibold text-slate-800">{formatValue(value)}</dd>
                    </div>
                  ))}
                </dl>
              </Card>
            ))}
          </div>
        )}
        <InlineError error={revoke.error} />
        <InlineError error={trust.error} />
      </div>

      <div>
        <SectionTitle hint="The issuers table doubles as the trust registry">
          Trust registry
        </SectionTitle>
        <div className="space-y-2">
          {issuerList.map((issuer) => (
            <Card key={issuer.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-slate-900">{issuer.name}</span>
                  {issuer.trusted ? <Badge tone="trusted">Trusted</Badge> : <Badge tone="untrusted">Not trusted</Badge>}
                  {typeof issuer.credentialsIssued === 'number' && (
                    <Badge tone="neutral">{issuer.credentialsIssued} issued</Badge>
                  )}
                </div>
                <p className="mt-0.5 truncate font-mono text-[11px] text-slate-500">{issuer.did}</p>
              </div>
              <button
                type="button"
                className={issuer.trusted ? 'btn-danger' : 'btn-secondary'}
                onClick={() => void handleTrust(issuer)}
                disabled={trust.pending}
              >
                {issuer.trusted ? 'Remove from registry' : 'Add to registry'}
              </button>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
