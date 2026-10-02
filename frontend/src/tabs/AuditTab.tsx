/**
 * Tab 4 — the tamper-evident audit log.
 *
 * Every issue, revoke, consent, consent-end and verification is appended to a
 * hash chain. This tab recomputes the chain on demand and shows whether it is
 * intact, or exactly which entry was tampered with.
 */
import { useState } from 'react';
import { api } from '../lib/api';
import { EVENT_STYLES, fieldLabel } from '../lib/catalog';
import { formatDateTime, prettyJson, shortHash } from '../lib/format';
import { useAction, useRequest } from '../lib/hooks';
import type { AuditEntry, AuditEventType } from '../lib/types';
import { Badge, Card, ErrorBlock, InlineError, LoadingBlock, SectionTitle, Spinner } from '../components/ui';

const FILTERS: { value: AuditEventType | 'ALL'; label: string }[] = [
  { value: 'ALL', label: 'All events' },
  { value: 'ISSUER_CREDENTIAL_ISSUED', label: 'Issued' },
  { value: 'ISSUER_CREDENTIAL_REVOKED', label: 'Revoked' },
  { value: 'CONSENT_GRANTED', label: 'Consent' },
  { value: 'CONSENT_REVOKED', label: 'Consent ended' },
  { value: 'VERIFICATION_GRANTED', label: 'Granted' },
  { value: 'VERIFICATION_DENIED', label: 'Denied' },
];

export function AuditTab() {
  const audit = useRequest(() => api.audit(200), 'audit');
  const verifyChain = useAction(api.auditVerify);
  const [filter, setFilter] = useState<AuditEventType | 'ALL'>('ALL');
  const [verifyResult, setVerifyResult] = useState<{ valid: boolean; length: number; reason: string | null; brokenAtEntry: number | null } | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);

  async function runVerify() {
    const result = await verifyChain.run();
    if (result) {
      setVerifyResult({
        valid: result.valid,
        length: result.length,
        reason: result.reason,
        brokenAtEntry: result.brokenAtEntry,
      });
    }
  }

  // A local alias keeps TypeScript's null-narrowing alive inside the JSX below.
  const data = audit.data;

  const entries = (data?.entries ?? []).filter(
    (entry) => filter === 'ALL' || entry.eventType === filter,
  );

  return (
    <div className="space-y-4">
      {audit.loading && <LoadingBlock label="Reading the audit log…" />}
      {audit.error && <ErrorBlock message={audit.error} onRetry={audit.reload} />}

      {data && (
        <>
          {/* Chain health */}
          <Card
            title="Hash chain integrity"
            subtitle={data.chain.rule}
            actions={
              <button type="button" className="btn-secondary" onClick={() => void runVerify()} disabled={verifyChain.pending}>
                {verifyChain.pending ? <Spinner /> : null}
                Re-verify chain
              </button>
            }
          >
            <div
              className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4 ${
                data.chain.valid
                  ? 'border-emerald-200 bg-emerald-50'
                  : 'border-rose-300 bg-rose-50'
              }`}
            >
              <div>
                <p
                  className={`text-lg font-bold ${
                    data.chain.valid ? 'text-emerald-800' : 'text-rose-800'
                  }`}
                >
                  {data.chain.valid
                    ? '✓ Hash chain intact'
                    : `✕ Chain broken at entry #${data.chain.brokenAtEntry ?? '?'}`}
                </p>
                <p className="mt-0.5 text-sm text-slate-600">
                  {data.chain.length} entr{data.chain.length === 1 ? 'y' : 'ies'} recomputed
                  {data.chain.headHash ? ` · head ${shortHash(data.chain.headHash, 10, 6)}` : ''}
                </p>
                {!data.chain.valid && data.chain.reason && (
                  <p className="mt-1 text-xs text-rose-700">{data.chain.reason}</p>
                )}
              </div>
              <Badge tone={data.chain.valid ? 'granted' : 'denied'}>
                {data.chain.valid ? 'Tamper-evident ✓' : 'Tampered ✕'}
              </Badge>
            </div>

            {verifyResult && (
              <p className="mt-2 text-xs text-slate-600">
                Independent check: {verifyResult.length} entries ·{' '}
                {verifyResult.valid ? 'all hashes recomputed correctly' : `broken at #${verifyResult.brokenAtEntry}`}
                {verifyResult.reason ? ` — ${verifyResult.reason}` : ''}
              </p>
            )}
            <InlineError error={verifyChain.error} />

            <p className="mt-3 text-xs text-slate-500">
              No blockchain is involved. Each entry stores{' '}
              <code className="rounded bg-slate-100 px-1">hash = SHA-256(prev_hash + payload)</code> and the
              payload as text, so anyone can recompute the whole chain. Editing or deleting a single entry
              breaks every hash after it.
            </p>
          </Card>

          {/* Filters */}
          <div>
            <SectionTitle hint={`${entries.length} shown / ${data.total} total`}>Events</SectionTitle>
            <div className="mb-3 flex flex-wrap gap-1.5">
              {FILTERS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setFilter(option.value)}
                  className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                    filter === option.value
                      ? 'bg-slate-800 text-white'
                      : 'border border-slate-300 bg-white text-slate-600 hover:border-slate-400'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>

            {entries.length === 0 ? (
              <Card>
                <p className="text-sm text-slate-600">No events of this type yet.</p>
              </Card>
            ) : (
              <ol className="space-y-2">
                {entries.map((entry) => (
                  <AuditRow
                    key={entry.id}
                    entry={entry}
                    broken={data.chain.brokenAtId === entry.id}
                    expanded={expanded === entry.id}
                    onToggle={() => setExpanded(expanded === entry.id ? null : entry.id)}
                  />
                ))}
              </ol>
            )}

            <button type="button" className="btn-secondary mt-3" onClick={audit.reload} disabled={audit.loading}>
              Refresh log
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function AuditRow({
  entry,
  broken,
  expanded,
  onToggle,
}: {
  entry: AuditEntry;
  broken: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const style = EVENT_STYLES[entry.eventType] ?? { label: entry.eventType, className: 'bg-slate-100 text-slate-600' };
  const payload = typeof entry.payload === 'string' ? entry.payload : entry.payload;

  return (
    <li
      className={`rounded-xl border bg-white ${
        broken ? 'border-rose-400 ring-2 ring-rose-100' : 'border-slate-200'
      }`}
    >
      <button type="button" onClick={onToggle} className="flex w-full items-start gap-3 p-3 text-left">
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-slate-100 font-mono text-[11px] font-bold text-slate-600">
          {entry.id}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className={`pill ${style.className}`}>{style.label}</span>
            {broken && <span className="pill bg-rose-600 text-white">TAMPERED</span>}
          </span>
          <span className="mt-1 block truncate text-sm text-slate-700">{summarise(entry)}</span>
          <span className="mt-1 block font-mono text-[10px] text-slate-400">
            {formatDateTime(entry.createdAt)} · prev {shortHash(entry.prevHash)} · hash {shortHash(entry.hash)}
          </span>
        </span>
        <span aria-hidden="true" className="mt-1 text-slate-400">
          {expanded ? '▾' : '▸'}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-slate-100 p-3">
          <div className="mb-2 grid gap-2 text-[11px] text-slate-600 sm:grid-cols-2">
            <p className="break-all">
              <span className="font-semibold text-slate-700">prev_hash:</span> {entry.prevHash}
            </p>
            <p className="break-all">
              <span className="font-semibold text-slate-700">hash:</span> {entry.hash}
            </p>
          </div>
          <pre className="max-h-64 overflow-auto rounded-lg bg-slate-900 p-3 font-mono text-[10px] leading-relaxed text-slate-100">
            {prettyJson(payload)}
          </pre>
        </div>
      )}
    </li>
  );
}

/** One line describing an audit entry, without dumping the whole payload. */
function summarise(entry: AuditEntry): string {
  const payload = entry.payload;
  if (typeof payload !== 'object' || payload === null) return String(payload);

  const parts: string[] = [];
  if (typeof payload.issuerName === 'string') parts.push(payload.issuerName);
  if (typeof payload.typeLabel === 'string') parts.push(payload.typeLabel);
  else if (typeof payload.type === 'string') parts.push(payload.type);
  if (typeof payload.purpose === 'string') parts.push(`“${payload.purpose}”`);
  if (typeof payload.verifierDid === 'string') parts.push(payload.verifierDid);
  if (typeof payload.change === 'string') parts.push(`→ ${payload.change}`);
  if (Array.isArray(payload.sharedFields) && payload.sharedFields.length > 0) {
    parts.push(`shared: ${payload.sharedFields.map((f) => fieldLabel(String(f))).join(', ')}`);
  }
  if (Array.isArray(payload.hiddenFields) && payload.hiddenFields.length > 0) {
    parts.push(`kept private: ${payload.hiddenFields.length} field(s)`);
  }
  if (Array.isArray(payload.deniedBecause) && payload.deniedBecause.length > 0) {
    parts.push(`failed: ${payload.deniedBecause.join(', ')}`);
  }
  if (typeof payload.revealedFields === 'string') parts.push(`revealed: ${payload.revealedFields}`);
  if (Array.isArray(payload.revealedFields) && payload.revealedFields.length > 0) {
    parts.push(`revealed: ${payload.revealedFields.map((f) => fieldLabel(String(f))).join(', ')}`);
  }
  if (typeof payload.reason === 'string') parts.push(`— ${payload.reason}`);
  if (typeof payload.durationMs === 'number') parts.push(`in ${payload.durationMs} ms`);

  return parts.length > 0 ? parts.join(' · ') : entry.eventType;
}
