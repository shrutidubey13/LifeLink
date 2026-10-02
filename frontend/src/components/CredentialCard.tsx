/** One credential in the wallet: what it proves, who vouched for it, and a Share button. */
import { stageForType, fieldLabel, formatValue } from '../lib/catalog';
import { formatDate } from '../lib/format';
import type { Credential } from '../lib/types';
import { Badge, DidTag, StatusBadge } from './ui';

export function CredentialCard({
  credential,
  onShare,
}: {
  credential: Credential;
  onShare: (credential: Credential) => void;
}) {
  const stage = stageForType(credential.type);
  const shareable = credential.status === 'valid';

  return (
    <article className="card flex flex-col">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {stage && <span aria-hidden="true">{stage.icon}</span>}
            <h3 className="truncate text-sm font-bold text-slate-900">
              {credential.typeLabel}
            </h3>
            <StatusBadge status={credential.status} />
          </div>
          <p className="mt-1 truncate text-sm text-slate-600">
            Issued by <span className="font-medium text-slate-800">{credential.issuer.name}</span>
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {credential.issuer.trusted ? (
              <Badge tone="trusted" title="This issuer is in the trust registry">
                Trusted issuer
              </Badge>
            ) : (
              <Badge tone="untrusted" title="Verifiers will refuse credentials from this issuer">
                Untrusted issuer
              </Badge>
            )}
            <DidTag did={credential.issuer.did} />
          </div>
        </div>
      </div>

      {/* Every claim is individually shareable — this list is what the citizen
          will be able to tick in the consent screen. */}
      <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
        {Object.entries(credential.claims).map(([key, value]) => (
          <div
            key={key}
            className="flex items-baseline justify-between gap-2 border-b border-slate-100 py-1 last:border-0"
          >
            <dt className="text-xs text-slate-500">{fieldLabel(key)}</dt>
            <dd className="truncate text-xs font-semibold text-slate-800" title={formatValue(value)}>
              {formatValue(value)}
            </dd>
          </div>
        ))}
      </dl>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
        <p className="text-[11px] text-slate-400">
          Issued {formatDate(credential.issuedAt)} · expires {formatDate(credential.expiresAt)} ·
          status list bit #{credential.statusIndex}
        </p>
        <button
          type="button"
          className="btn-primary"
          onClick={() => onShare(credential)}
          disabled={!shareable}
          title={shareable ? 'Choose who sees which fields' : `This credential is ${credential.status}`}
        >
          {shareable ? 'Share…' : `Cannot share (${credential.status})`}
        </button>
      </div>
    </article>
  );
}
