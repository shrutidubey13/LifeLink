/**
 * Tamper-evident audit log, role-scoped:
 * citizen → own history (/wallet/audit), organization → own activity
 * (/organization/audit), admin → system-wide (/admin/audit).
 */
import { useState } from 'react';
import {
  ShieldCheck,
  RotateCcw,
  CheckCircle2,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Filter,
} from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { EVENT_STYLES, fieldLabel } from '../lib/catalog';
import { formatDateTime } from '../lib/format';
import { useAction, useRequest } from '../lib/hooks';
import type { AuditEntry, AuditEventType } from '../lib/types';
import { KeyValueDisplay } from '../components/ClaimsEditor';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  ErrorBlock,
  InlineError,
  PageHeader,
  SkeletonList,
  TruncatedHash,
  useToast,
} from '../components/ui';
import { useTitle } from '../lib/useTitle';

const FILTERS: { value: AuditEventType | 'ALL'; label: string }[] = [
  { value: 'ALL', label: 'All events' },
  { value: 'CREDENTIAL_ISSUED', label: 'Issued' },
  { value: 'DOCUMENT_SUBMITTED', label: 'Submitted' },
  { value: 'DOCUMENT_APPROVED', label: 'Approved' },
  { value: 'CREDENTIAL_REVOKED', label: 'Revoked' },
  { value: 'CONSENT_APPROVED', label: 'Consent' },
  { value: 'CREDENTIAL_VERIFIED', label: 'Granted' },
  { value: 'VERIFICATION_FAILED', label: 'Denied' },
];

export function AuditTab() {
  useTitle('Audit Log');
  const { user } = useAuth();
  const { toast } = useToast();

  const loader = () => {
    if (user?.kind === 'admin') return api.adminAudit(200);
    if (user?.kind === 'organization' || user?.kind === 'issuer') return api.orgAudit(200);
    return api.walletAudit(200);
  };

  const audit = useRequest(loader, `audit-${user?.kind}-${user?.id}`);
  const verifyChain = useAction(api.adminAuditVerify);
  const [filter, setFilter] = useState<AuditEventType | 'ALL'>('ALL');
  const [verifyResult, setVerifyResult] = useState<{
    valid: boolean;
    length: number;
    reason: string | null;
    brokenAtEntry: number | null;
  } | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);

  async function runVerify() {
    if (user?.kind !== 'admin') return;
    const result = await verifyChain.run();
    if (result) {
      setVerifyResult({
        valid: result.valid,
        length: result.length,
        reason: result.reason,
        brokenAtEntry: result.brokenAtEntry,
      });
      if (result.valid) {
        toast.success(`Hash chain verified intact (${result.length} entries)!`);
      } else {
        toast.error(`Hash chain broken at entry #${result.brokenAtEntry}!`);
      }
    }
  }

  const data = audit.data;
  const entries = (data?.entries ?? []).filter(
    (entry) => filter === 'ALL' || entry.eventType === filter,
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit Log"
        subtitle="Cryptographically verified, tamper-evident log of all identity activities."
        badge={
          data && (
            <Badge tone={data.chain.valid ? 'trusted' : 'danger'} size="md">
              {data.chain.valid ? 'Chain Intact' : 'Chain Tampered'}
            </Badge>
          )
        }
        actions={
          <Button
            variant="secondary"
            size="sm"
            icon={<RotateCcw className="h-3.5 w-3.5" />}
            onClick={() => audit.reload()}
          >
            Refresh Log
          </Button>
        }
      />

      {audit.loading && !data && <SkeletonList count={3} />}
      {audit.error && <ErrorBlock message={audit.error} onRetry={audit.reload} />}

      {data && (
        <>
          {/* Hash Chain Integrity Card */}
          <Card>
            <CardHeader>
              <div>
                <CardTitle className="flex items-center gap-2">
                  <ShieldCheck className="h-5 w-5 text-blue-600" />
                  <span>Hash Chain Integrity</span>
                </CardTitle>
                <CardDescription>{data.chain.rule}</CardDescription>
              </div>
              {user?.kind === 'admin' && (
                <Button
                  variant="secondary"
                  size="sm"
                  loading={verifyChain.pending}
                  onClick={() => void runVerify()}
                >
                  Verify Cryptographic Chain
                </Button>
              )}
            </CardHeader>
            <CardContent>
              <div
                className={`rounded-2xl border p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
                  data.chain.valid
                    ? 'border-emerald-200 bg-emerald-50/80 text-emerald-900'
                    : 'border-rose-200 bg-rose-50/80 text-rose-900'
                }`}
              >
                <div className="flex items-start gap-3">
                  {data.chain.valid ? (
                    <CheckCircle2 className="h-6 w-6 text-emerald-600 shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle className="h-6 w-6 text-rose-600 shrink-0 mt-0.5" />
                  )}
                  <div>
                    <p className="text-base font-bold">
                      {data.chain.valid
                        ? 'Cryptographic Hash Chain Intact'
                        : `Chain Broken at Entry #${data.chain.brokenAtEntry ?? '?'}`}
                    </p>
                    <p className="mt-0.5 text-xs opacity-90">
                      {data.chain.length} entr{data.chain.length === 1 ? 'y' : 'ies'} recomputed from genesis.
                    </p>
                    {data.chain.headHash && (
                      <div className="mt-2 flex items-center gap-2 text-xs">
                        <span className="font-semibold opacity-75">Head Hash:</span>
                        <TruncatedHash value={data.chain.headHash} start={12} end={8} />
                      </div>
                    )}
                    {!data.chain.valid && data.chain.reason && (
                      <p className="mt-1 text-xs text-rose-800 font-semibold">{data.chain.reason}</p>
                    )}
                  </div>
                </div>

                <Badge tone={data.chain.valid ? 'granted' : 'denied'} size="md">
                  {data.chain.valid ? 'Tamper-Evident ✓' : 'Tampered ✕'}
                </Badge>
              </div>

              {verifyResult && (
                <div className="mt-3 rounded-xl bg-slate-50 p-3 text-xs text-slate-700 border border-slate-200">
                  <span className="font-semibold">Independent verification:</span> {verifyResult.length} entries checked ·{' '}
                  {verifyResult.valid ? 'All hashes verified' : `Broken at #${verifyResult.brokenAtEntry}`}
                  {verifyResult.reason ? ` — ${verifyResult.reason}` : ''}
                </div>
              )}
              <InlineError error={verifyChain.error} />

              <p className="mt-3 text-xs text-slate-500 leading-relaxed">
                GitLink uses a deterministic hash chain where each event records{' '}
                <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-700">
                  hash = SHA-256(prev_hash + payload)
                </code>
                . Any retroactive mutation or truncation immediately breaks all downstream hashes.
              </p>
            </CardContent>
          </Card>

          {/* Events Section */}
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4 text-slate-500" />
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Filter Events ({entries.length} of {data.total})
                </span>
              </div>
            </div>

            {/* Filter pills */}
            <div className="flex flex-wrap gap-1.5">
              {FILTERS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setFilter(option.value)}
                  className={`rounded-full px-3 py-1 text-xs font-semibold transition-all ${
                    filter === option.value
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'border border-slate-300 bg-white text-slate-600 hover:border-slate-400 hover:text-slate-900'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>

            {entries.length === 0 ? (
              <EmptyState
                icon={<ShieldCheck className="h-6 w-6" />}
                title="No events found"
                description={`No events matched the filter "${filter}".`}
              />
            ) : (
              <ol className="space-y-2.5">
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
  const style = EVENT_STYLES[entry.eventType] ?? {
    label: entry.eventType,
    className: 'bg-slate-100 text-slate-700',
  };
  const payload = typeof entry.payload === 'string' ? entry.payload : entry.payload;

  return (
    <li
      className={`rounded-2xl border bg-white transition-shadow shadow-2xs ${
        broken ? 'border-rose-400 ring-2 ring-rose-100' : 'border-slate-200 hover:border-slate-300'
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-start gap-3.5 p-4 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded-2xl"
      >
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-slate-100 font-mono text-xs font-bold text-slate-700 border border-slate-200/60">
          {entry.id}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${style.className}`}>
              {style.label}
            </span>
            {broken && <Badge tone="danger">TAMPERED</Badge>}
            <span className="text-xs text-slate-400 ml-auto">
              {formatDateTime(entry.createdAt)}
            </span>
          </div>

          <p className="mt-1.5 truncate text-sm font-semibold text-slate-800">
            {summarise(entry)}
          </p>

          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-500">
            <div className="flex items-center gap-1 font-mono text-[11px]">
              <span>prev:</span>
              <TruncatedHash value={entry.prevHash} start={8} end={6} />
            </div>
            <div className="flex items-center gap-1 font-mono text-[11px]">
              <span>hash:</span>
              <TruncatedHash value={entry.hash} start={8} end={6} />
            </div>
          </div>
        </div>

        <span className="mt-1 text-slate-400 shrink-0" aria-hidden="true">
          {expanded ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-slate-100 p-4 bg-slate-50/50 rounded-b-2xl space-y-3">
          <div className="grid gap-2 text-xs text-slate-600 sm:grid-cols-2">
            <div className="space-y-1">
              <span className="font-semibold text-slate-700">Previous Hash (SHA-256):</span>
              <div className="break-all font-mono text-[11px] bg-white p-2 rounded-lg border border-slate-200">
                {entry.prevHash}
              </div>
            </div>
            <div className="space-y-1">
              <span className="font-semibold text-slate-700">Current Hash (SHA-256):</span>
              <div className="break-all font-mono text-[11px] bg-white p-2 rounded-lg border border-slate-200">
                {entry.hash}
              </div>
            </div>
          </div>

          <div>
            <span className="font-semibold text-xs text-slate-700 block mb-1.5">
              Event Details:
            </span>
            <KeyValueDisplay
              data={typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : { detail: String(payload) }}
              emptyMessage="No payload details"
            />
          </div>
        </div>
      )}

    </li>
  );
}

function summarise(entry: AuditEntry): string {
  const payload = entry.payload;
  if (typeof payload !== 'object' || payload === null) return String(payload);
  const parts: string[] = [];
  if (typeof payload.issuerName === 'string') parts.push(payload.issuerName);
  if (typeof payload.organizationName === 'string') parts.push(payload.organizationName);
  if (typeof payload.typeLabel === 'string') parts.push(payload.typeLabel);
  else if (typeof payload.type === 'string') parts.push(payload.type);
  if (typeof payload.credentialType === 'string') parts.push(payload.credentialType);
  if (typeof payload.documentType === 'string') parts.push(payload.documentType);
  if (typeof payload.documentName === 'string') parts.push(payload.documentName);
  if (typeof payload.purpose === 'string') parts.push(`“${payload.purpose}”`);
  if (typeof payload.change === 'string') parts.push(`→ ${payload.change}`);
  if (Array.isArray(payload.sharedFields) && payload.sharedFields.length > 0) {
    parts.push(`shared: ${payload.sharedFields.map((f) => fieldLabel(String(f))).join(', ')}`);
  }
  if (Array.isArray(payload.deniedBecause) && payload.deniedBecause.length > 0) {
    parts.push(`failed: ${payload.deniedBecause.join(', ')}`);
  }
  if (Array.isArray(payload.revealedFields) && payload.revealedFields.length > 0) {
    parts.push(`revealed: ${payload.revealedFields.map((f) => fieldLabel(String(f))).join(', ')}`);
  }
  if (typeof payload.reason === 'string') parts.push(`— ${payload.reason}`);
  if (typeof payload.durationMs === 'number') parts.push(`in ${payload.durationMs} ms`);
  return parts.length > 0 ? parts.join(' · ') : entry.eventType;
}
