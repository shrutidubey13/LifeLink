/** Sharing history: every consent this citizen has given, with an "End access" button. */
import { fieldLabel, formatValue, durationLabel, PURPOSE_SUGGESTIONS } from '../lib/catalog';
import { formatDateTime, relativeTime } from '../lib/format';
import type { Consent } from '../lib/types';
import { Badge, EmptyState, Spinner } from './ui';

const STATE_TONE: Record<Consent['state'], 'active' | 'expired' | 'ended'> = {
  pending: 'active',
  active: 'active',
  rejected: 'ended',
  expired: 'expired',
  ended: 'ended',
};

const STATE_TEXT: Record<Consent['state'], string> = {
  pending: 'Awaiting decision',
  active: 'Access is live',
  rejected: 'Denied',
  expired: 'Expired',
  ended: 'Ended early',
};

export function SharingHistory({
  consents,
  claimsByCredential,
  onEnd,
  endingId,
}: {
  consents: Consent[];
  claimsByCredential: Record<number, Record<string, unknown>>;
  onEnd: (consent: Consent) => void;
  endingId: number | null;
}) {
  if (consents.length === 0) {
    return (
      <EmptyState
        title="You have not shared anything yet"
        body="When you share a credential, it appears here so you can always see who has access — and end it."
      />
    );
  }

  return (
    <ul className="space-y-3">
      {consents.map((consent) => {
        const claims = consent.credentialId != null ? (claimsByCredential[consent.credentialId] ?? {}) : {};
        return (
          <li key={consent.id} className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900">
                  {consent.verifier?.name ?? 'Unknown verifier'}
                  <span className="font-normal text-slate-500"> · consent #{consent.id}</span>
                </p>
                <p className="mt-0.5 text-xs text-slate-600">“{consent.purpose}”</p>
              </div>
              <Badge tone={STATE_TONE[consent.state]}>{STATE_TEXT[consent.state]}</Badge>
            </div>

            <div className="mt-2 flex flex-wrap gap-1.5">
              {consent.fields.map((field) => (
                <Badge key={field} tone="info">
                  {fieldLabel(field)}
                  {claims[field] !== undefined ? `: ${formatValue(claims[field])}` : ''}
                </Badge>
              ))}
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2">
              <p className="text-[11px] text-slate-400">
                {consent.credentialTypeLabel ?? 'Credential'} · granted {formatDateTime(consent.createdAt)} ·
                {consent.state === 'active'
                  ? ` expires ${relativeTime(consent.expiresAt)} (${durationLabel(
                      guessDuration(consent.createdAt, consent.expiresAt),
                    )} window)`
                  : ` ended/expired ${relativeTime(consent.expiresAt)}`}
              </p>
              {consent.state === 'active' && (
                <button
                  type="button"
                  className="btn-danger"
                  onClick={() => onEnd(consent)}
                  disabled={endingId === consent.id}
                >
                  {endingId === consent.id ? <Spinner /> : null}
                  End access
                </button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Work out which duration option was used, purely for the label. */
function guessDuration(createdAt: string, expiresAt: string): string {
  const minutes = Math.round((new Date(expiresAt).getTime() - new Date(createdAt).getTime()) / 60000);
  if (minutes >= 24 * 60) return '1d';
  if (minutes >= 30) return '30m';
  return '5m';
}

export { PURPOSE_SUGGESTIONS };
