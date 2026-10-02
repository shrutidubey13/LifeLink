/**
 * Tab 1 — the citizen's wallet.
 *
 * Timeline, credential cards, the consent flow, and the full sharing history.
 * This tab owns the data the other tabs reuse: after a successful share it hands
 * the verifier + consent + presentation to the verifier portal.
 */
import { useCallback, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { fieldLabel, formatValue } from '../lib/catalog';
import { relativeTime } from '../lib/format';
import { useAction, useRequest } from '../lib/hooks';
import type { Citizen, Consent, Credential, ShareResult, Verifier } from '../lib/types';
import { ConsentModal } from '../components/ConsentModal';
import { CredentialCard } from '../components/CredentialCard';
import { SharingHistory } from '../components/SharingHistory';
import { Timeline } from '../components/Timeline';
import { Badge, Card, ErrorBlock, InlineError, LoadingBlock, SectionTitle, Spinner } from '../components/ui';

export function WalletTab({
  citizen,
  onHandToVerifier,
}: {
  citizen: Citizen;
  onHandToVerifier: (result: ShareResult, credential: Credential) => void;
}) {
  const [sharing, setSharing] = useState<Credential | null>(null);
  const [lastShare, setLastShare] = useState<{ result: ShareResult; credential: Credential } | null>(null);
  const [endingId, setEndingId] = useState<number | null>(null);

  const wallet = useRequest(() => api.wallet(citizen.id), `wallet-${citizen.id}`);
  const verifiers = useRequest(() => api.verifiers(), 'verifiers');
  const consents = useRequest(() => api.consents(citizen.id), `consents-${citizen.id}`);
  const endConsent = useAction(api.endConsent);

  const reloadAll = useCallback(() => {
    wallet.reload();
    consents.reload();
  }, [wallet, consents]);

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

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => onHandToVerifier(lastShare.result, lastShare.credential)}
                >
                  Verify as {lastShare.result.verifier.name} →
                </button>
                <button type="button" className="btn-secondary" onClick={() => setLastShare(null)}>
                  Done
                </button>
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

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  const tones: Record<string, string> = {
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
