/**
 * The citizen's wallet.
 *
 * Timeline, credential cards, the consent flow, sharing history, and "who
 * verified my records" — the citizen's own view of every verification ever run
 * against their credentials.
 */
import { useCallback, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { stashShare } from '../lib/auth';
import { fieldLabel, formatValue } from '../lib/catalog';
import { formatDateTime, relativeTime } from '../lib/format';
import { useAction, useRequest } from '../lib/hooks';
import type { Citizen, Consent, Credential, ShareResult, Verifier, VerificationRecord } from '../lib/types';
import { ConsentModal } from '../components/ConsentModal';
import { CredentialCard } from '../components/CredentialCard';
import { SharingHistory } from '../components/SharingHistory';
import { Timeline } from '../components/Timeline';
import { Badge, Card, EmptyState, ErrorBlock, InlineError, LoadingBlock, SectionTitle, Spinner } from '../components/ui';

export function WalletTab({ citizen }: { citizen: Citizen }) {
  const [sharing, setSharing] = useState<Credential | null>(null);
  const [lastShare, setLastShare] = useState<{ result: ShareResult; credential: Credential } | null>(null);
  const [endingId, setEndingId] = useState<number | null>(null);

  const wallet = useRequest(() => api.wallet(citizen.id), `wallet-${citizen.id}`);
  const verifiers = useRequest(() => api.verifiers(), 'verifiers');
  const consents = useRequest(() => api.consents(citizen.id), `consents-${citizen.id}`);
  const verifications = useRequest(() => api.verifications(citizen.id), `verifications-${citizen.id}`);
  const endConsent = useAction(api.endConsent);

  const reloadAll = useCallback(() => {
    wallet.reload();
    consents.reload();
    verifications.reload();
  }, [wallet, consents, verifications]);

  const claimsByCredential = useMemo(() => {
    const map: Record<number, Record<string, unknown>> = {};
    for (const credential of wallet.data?.credentials ?? []) {
      map[credential.id] = credential.claims;
    }
    return map;
  }, [wallet.data]);

  async function handleEnd(consent: Consent) {
    setEndingId(consent.id);
    const result = await endConsent.run(consent.id);
    setEndingId(null);
    if (result) reloadAll();
  }

  const verifierList: Verifier[] = verifiers.data?.verifiers ?? [];

  return (
    <div className="space-y-4">
      {wallet.loading && <LoadingBlock label="Opening your wallet…" />}
      {wallet.error && <ErrorBlock message={wallet.error} onRetry={wallet.reload} />}

      {wallet.data && (
        <>
          <Timeline credentials={wallet.data.credentials} />

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Credentials" value={wallet.data.summary.total} tone="slate" />
            <Stat label="Valid" value={wallet.data.summary.valid} tone="emerald" />
            <Stat label="Revoked" value={wallet.data.summary.revoked} tone="rose" />
            <Stat label="Expired" value={wallet.data.summary.expired} tone="amber" />
          </div>

          <div>
            <SectionTitle hint={`${wallet.data.credentials.length} in wallet`}>Credentials</SectionTitle>
            {wallet.data.credentials.length === 0 ? (
              <Card>
                <p className="text-sm text-slate-600">
                  This wallet is empty. Open the <strong>Issuer portal</strong> tab and have Demo
                  University issue a degree to get started.
                </p>
              </Card>
            ) : (
              <div className="grid gap-3 lg:grid-cols-2">
                {wallet.data.credentials.map((credential) => (
                  <CredentialCard
                    key={credential.id}
                    credential={credential}
                    onShare={(c) => {
                      setLastShare(null);
                      setSharing(c);
                    }}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Confirmation right after approving — "what exactly left my wallet?" */}
          {lastShare && (
            <Card className="border-emerald-200 bg-emerald-50/40">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-emerald-900">
                    Shared {Object.keys(lastShare.result.reveals).length} field(s) with{' '}
                    {lastShare.result.verifier.name}
                  </h2>
                  <p className="mt-0.5 text-sm text-emerald-800">
                    Consent #{lastShare.result.consent.id} · “{lastShare.result.consent.purpose}” · expires{' '}
                    {relativeTime(lastShare.result.consent.expiresAt)}
                  </p>
                </div>
                <Badge tone="trusted">Consent recorded</Badge>
              </div>

              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-emerald-200 bg-white p-3">
                  <p className="text-xs font-bold uppercase tracking-wide text-emerald-700">What they got</p>
                  <ul className="mt-1.5 space-y-1">
                    {Object.entries(lastShare.result.reveals).map(([key, value]) => (
                      <li key={key} className="text-sm text-slate-800">
                        <span className="text-slate-500">{fieldLabel(key)}:</span>{' '}
                        <span className="font-semibold">{formatValue(value)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-3">
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                    What stayed private
                  </p>
                  <ul className="mt-1.5 flex flex-wrap gap-1.5">
                    {lastShare.result.hidden.map((key) => (
                      <li key={key}>
                        <Badge tone="neutral">{fieldLabel(key)}</Badge>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              <details className="mt-3">
                <summary className="cursor-pointer text-xs font-semibold text-slate-600">
                  Show the raw presentation (this is all the verifier receives)
                </summary>
                <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-slate-900 p-3 font-mono text-[10px] leading-relaxed text-slate-100">
                  {lastShare.result.presentation}
                </pre>
              </details>

              <div className="mt-3 rounded-xl border border-indigo-200 bg-indigo-50 p-3">
                <p className="text-sm text-indigo-900">
                  <strong>Next step for the demo:</strong> log out, log in as{' '}
                  <strong>{lastShare.result.verifier.name}</strong> (verifier account), and the
                  verifier portal will already have consent #{lastShare.result.consent.id} filled in.
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => void navigator.clipboard?.writeText(lastShare.result.presentation).catch(() => undefined)}
                  >
                    Copy presentation
                  </button>
                  <button type="button" className="btn-secondary" onClick={() => setLastShare(null)}>
                    Done
                  </button>
                </div>
              </div>
            </Card>
          )}

          <div>
            <SectionTitle
              hint={consents.data ? `${consents.data.consents.length} total` : undefined}
            >
              Sharing history
            </SectionTitle>
            {consents.loading && <LoadingBlock label="Loading your sharing history…" />}
            {consents.error && <ErrorBlock message={consents.error} onRetry={consents.reload} />}
            <InlineError error={endConsent.error} />
            {consents.data && (
              <SharingHistory
                consents={consents.data.consents}
                claimsByCredential={claimsByCredential}
                onEnd={(consent) => void handleEnd(consent)}
                endingId={endingId}
              />
            )}
          </div>

          <div>
            <SectionTitle
              hint={
                verifications.data
                  ? `${verifications.data.summary.granted} granted · ${verifications.data.summary.denied} denied`
                  : undefined
              }
            >
              Who verified my records
            </SectionTitle>
            {verifications.loading && <LoadingBlock label="Loading verification history…" />}
            {verifications.error && <ErrorBlock message={verifications.error} onRetry={verifications.reload} />}
            {verifications.data && verifications.data.verifications.length === 0 && (
              <EmptyState
                title="Nobody has verified your records yet"
                body="Every time a verifier checks something you shared — granted or denied — it appears here, so you always know who looked at what."
              />
            )}
            {verifications.data && verifications.data.verifications.length > 0 && (
              <ul className="space-y-2">
                {verifications.data.verifications.map((record) => (
                  <VerificationRow key={record.eventId} record={record} />
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      {sharing && (
        <ConsentModal
          credential={sharing}
          verifiers={verifierList}
          citizenId={citizen.id}
          onClose={() => setSharing(null)}
          onApprove={(result) => {
            setSharing(null);
            setLastShare({ result, credential: sharing });
            // Stash for the verifier portal: after the demo switches accounts
            // it auto-fills, so nobody retypes a 2KB presentation.
            stashShare({
              verifierId: result.verifier.id,
              consentId: result.consent.id,
              presentation: result.presentation,
            });
            reloadAll();
          }}
        />
      )}

      {verifiers.loading && sharing && (
        <div className="sr-only" aria-live="polite">
          <Spinner /> loading verifiers
        </div>
      )}
    </div>
  );
}

/** One row of "who checked my records": verifier, credential, outcome, and why. */
function VerificationRow({ record }: { record: VerificationRecord }) {
  return (
    <li
      className={`rounded-xl border bg-white p-3 ${
        record.result === 'granted' ? 'border-emerald-200' : 'border-rose-200'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-900">
            {record.verifier.name}
            <span className="font-normal text-slate-500">
              {' '}checked your {record.credential?.typeLabel ?? 'credential'}
              {record.consentId ? ` · consent #${record.consentId}` : ''}
            </span>
          </p>
          {record.purpose && <p className="mt-0.5 text-xs text-slate-600">“{record.purpose}”</p>}
        </div>
        <Badge tone={record.result === 'granted' ? 'granted' : 'denied'}>
          {record.result === 'granted' ? '✓ Granted' : '✕ Denied'}
        </Badge>
      </div>

      {record.result === 'granted' ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {record.revealedFields.map((field) => (
            <Badge key={field} tone="info">
              {fieldLabel(field)}
            </Badge>
          ))}
          {record.revealedFields.length === 0 && (
            <span className="text-xs text-slate-400">No fields were revealed.</span>
          )}
        </div>
      ) : (
        <p className="mt-2 text-xs text-rose-700">
          Denied because: {record.deniedBecause.join(', ') || 'unknown reason'}. Nothing of yours was revealed.
        </p>
      )}

      <p className="mt-2 text-[11px] text-slate-400">
        {formatDateTime(record.createdAt)}
        {record.durationMs !== null ? ` · checked in ${record.durationMs} ms` : ''}
      </p>
    </li>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {  const tones: Record<string, string> = {
    slate: 'border-slate-200 bg-white text-slate-900',
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    rose: 'border-rose-200 bg-rose-50 text-rose-800',
    amber: 'border-amber-200 bg-amber-50 text-amber-800',
  };
  return (
    <div className={`rounded-xl border p-3 text-center ${tones[tone]}`}>
      <p className="text-xl font-bold leading-none">{value}</p>
      <p className="mt-1 text-[11px] uppercase tracking-wide opacity-70">{label}</p>
    </div>
  );
}
