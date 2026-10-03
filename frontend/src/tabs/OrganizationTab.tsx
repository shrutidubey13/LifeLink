/**
 * Organization dashboard (unified issuer + verifier role).
 *
 * - Document Verification Requests: review citizen uploads, approve (issues a
 *   signed credential into the wallet) or reject with reason.
 * - Issue Credential: direct issuance to a citizen (Flow A).
 * - Issued Credentials + revoke.
 * - Verification Requests: create presentation requests, see history, verify
 *   presentations (9 real checks).
 */
import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { EXAMPLE_CLAIMS, ISSUER_TYPES, exampleClaimsFor, fieldLabel, formatValue } from '../lib/catalog';
import { formatDate, formatDateTime, prettyJson, relativeTime } from '../lib/format';
import { useAction, useRequest } from '../lib/hooks';
import { decodePresentation } from '../lib/sdjwt';
import type { CheckId, CheckResult, DocumentRequest, VerifyResponse } from '../lib/types';
import { Badge, Card, DidTag, ErrorBlock, Field, InlineError, LoadingBlock, SectionTitle, Select, Spinner, StatusBadge } from '../components/ui';

export function OrganizationTab() {
  const profile = useRequest(() => api.organizationProfile(), 'org-profile');
  const docs = useRequest(() => api.orgDocuments(), 'org-docs');
  const issued = useRequest(() => api.issuerCredentials(), 'org-issued');
  const requests = useRequest(() => api.orgRequests(), 'org-requests');

  return (
    <div className="space-y-4">
      {profile.loading && <LoadingBlock label="Loading organization…" />}
      {profile.error && <ErrorBlock message={profile.error} onRetry={profile.reload} />}

      {profile.data && (
        <Card title={`${profile.data.organization.name} — organization dashboard`} subtitle={`${profile.data.organization.orgType ?? 'Organization'} · ${profile.data.organization.status} · can issue: ${profile.data.organization.canIssue ? 'yes' : 'no'} · can verify: ${profile.data.organization.canVerify ? 'yes' : 'no'}`}>
          <div className="flex flex-wrap items-center gap-1.5">
            <DidTag did={profile.data.organization.did} />
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-xl font-bold">{profile.data.stats.credentialsIssued}</p>
              <p className="text-[11px] uppercase tracking-wide text-slate-500">Issued</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-xl font-bold">{profile.data.stats.documentsPending}</p>
              <p className="text-[11px] uppercase tracking-wide text-slate-500">Pending docs</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-xl font-bold">{profile.data.stats.documentsTotal}</p>
              <p className="text-[11px] uppercase tracking-wide text-slate-500">Total docs</p>
            </div>
          </div>
        </Card>
      )}

      <DocumentQueue onChanged={() => { docs.reload(); issued.reload(); profile.reload(); }} docs={docs} />
      <IssueCredentialCard onIssued={() => { issued.reload(); profile.reload(); }} />
      <IssuedList issued={issued} onChanged={() => { issued.reload(); profile.reload(); }} />
      <OrgVerifier requests={requests} />
    </div>
  );
}

function DocumentQueue({ onChanged, docs }: { onChanged: () => void; docs: { data: { documents: DocumentRequest[] } | null; loading: boolean; error: string | null; reload: () => void } }) {
  const [reviewing, setReviewing] = useState<DocumentRequest | null>(null);
  return (
    <div>
      <SectionTitle hint={docs.data ? `${docs.data.documents.filter((d) => d.status === 'PENDING').length} pending` : undefined}>
        Document verification requests
      </SectionTitle>
      {docs.loading && <LoadingBlock label="Loading requests…" />}
      {docs.error && <ErrorBlock message={docs.error} onRetry={docs.reload} />}
      {docs.data && docs.data.documents.length === 0 && (
        <Card><p className="text-sm text-slate-600">No verification requests yet. Citizens send documents here via “Add Document for Verification”.</p></Card>
      )}
      <div className="space-y-2">
        {(docs.data?.documents ?? []).map((d) => (
          <Card key={d.id} className="p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-900">{d.documentName} <span className="font-normal text-slate-500">({d.documentType})</span></p>
                <p className="text-xs text-slate-500">From {d.citizen?.name ?? `#${d.citizenId}`} · “{d.purpose}” · {relativeTime(d.createdAt)}</p>
                <p className="font-mono text-[11px] text-slate-400">ref: {d.documentRef.slice(0, 80)}</p>
                {d.status === 'REJECTED' && d.rejectionReason && <p className="text-xs text-rose-700">Rejected: {d.rejectionReason}</p>}
                {d.status === 'APPROVED' && <p className="text-xs text-emerald-700">Approved → credential #{d.credentialId}</p>}
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={d.status === 'PENDING' ? 'info' : d.status === 'APPROVED' ? 'granted' : 'denied'}>{d.status}</Badge>
                {d.status === 'PENDING' && (
                  <button type="button" className="btn-secondary" onClick={() => setReviewing(d)}>Review</button>
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>
      {reviewing && <ReviewModal doc={reviewing} onClose={() => setReviewing(null)} onDone={() => { setReviewing(null); onChanged(); }} />}
    </div>
  );
}

function ReviewModal({ doc, onClose, onDone }: { doc: DocumentRequest; onClose: () => void; onDone: () => void }) {
  const [claimsText, setClaimsText] = useState('{}');
  const [rejectReason, setRejectReason] = useState('');
  const [mode, setMode] = useState<'approve' | 'reject'>('approve');
  const approve = useAction(api.approveDocument);
  const reject = useAction(api.rejectDocument);
  const [detail, setDetail] = useState<DocumentRequest | null>(doc);
  const [suggested, setSuggested] = useState('');

  useEffect(() => {
    api.orgDocument(doc.id).then((r) => {
      setDetail(r.document);
      setSuggested(r.suggestedCredentialType);
      setClaimsText(prettyJson(exampleClaimsFor(r.suggestedCredentialType)));
    }).catch(() => undefined);
  }, [doc.id]);

  async function handleApprove() {
    let claims: Record<string, unknown>;
    try {
      claims = JSON.parse(claimsText) as Record<string, unknown>;
    } catch {
      return;
    }
    const result = await approve.run(doc.id, { claims });
    if (result) onDone();
  }

  async function handleReject() {
    if (rejectReason.trim().length < 3) return;
    const result = await reject.run(doc.id, rejectReason.trim());
    if (result) onDone();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 sm:items-center sm:p-4" role="dialog" aria-modal="true" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl bg-white p-4 shadow-2xl sm:rounded-2xl sm:p-5">
        <h2 className="text-base font-bold">Review: {doc.documentName}</h2>
        <p className="text-xs text-slate-500">From {detail?.citizen?.name} · {doc.documentType} → {suggested || '…'} · “{doc.purpose}”</p>
        <div className="mt-2 rounded-lg bg-slate-50 p-3 font-mono text-[11px]">ref: {doc.documentRef}</div>
        <div className="mt-3 flex gap-2">
          <button type="button" className={mode === 'approve' ? 'btn-primary' : 'btn-secondary'} onClick={() => setMode('approve')}>Approve + issue</button>
          <button type="button" className={mode === 'reject' ? 'btn-primary' : 'btn-secondary'} onClick={() => setMode('reject')}>Reject</button>
        </div>
        {mode === 'approve' ? (
          <div className="mt-3">
            <Field label={`Structured claims (${suggested || 'credential'})`} hint="Validated against the schema before signing. Unknown fields are rejected.">
              <textarea className="input h-44 font-mono text-xs" value={claimsText} onChange={(e) => setClaimsText(e.target.value)} spellCheck={false} />
            </Field>
            <InlineError error={approve.error} />
            <div className="mt-3 flex gap-2">
              <button type="button" className="btn-primary" disabled={approve.pending} onClick={() => void handleApprove()}>{approve.pending ? <Spinner /> : null} Approve & sign</button>
              <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            </div>
          </div>
        ) : (
          <div className="mt-3">
            <Field label="Rejection reason">
              <input className="input" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="e.g. Document is illegible" maxLength={500} />
            </Field>
            <InlineError error={reject.error} />
            <div className="mt-3 flex gap-2">
              <button type="button" className="btn-danger" disabled={reject.pending || rejectReason.trim().length < 3} onClick={() => void handleReject()}>Reject request</button>
              <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function IssueCredentialCard({ onIssued }: { onIssued: () => void }) {
  const citizens = useRequest(() => api.citizens(), 'citizens');
  const [citizenId, setCitizenId] = useState<number | ''>('');
  const [type, setType] = useState('DegreeCredential');
  const [claimsText, setClaimsText] = useState(() => prettyJson(EXAMPLE_CLAIMS.DegreeCredential));
  const [flash, setFlash] = useState<string | null>(null);
  const issue = useAction(api.issueCredential);

  useEffect(() => {
    if ((citizens.data?.citizens.length ?? 0) > 0 && citizenId === '') setCitizenId(citizens.data!.citizens[0].id);
  }, [citizens.data, citizenId]);
  useEffect(() => { setClaimsText(prettyJson(exampleClaimsFor(type))); }, [type]);

  const parsed = useMemo(() => {
    try {
      const v = JSON.parse(claimsText) as Record<string, unknown>;
      return { value: v, error: null as string | null };
    } catch (e) {
      return { value: null, error: e instanceof Error ? e.message : 'Invalid JSON' };
    }
  }, [claimsText]);

  async function handleIssue() {
    if (!parsed.value || citizenId === '') return;
    setFlash(null);
    const result = await issue.run({ citizenId: Number(citizenId), type, claims: parsed.value });
    if (result) {
      setFlash(result.message);
      onIssued();
    }
  }

  return (
    <Card title="Issue credential (direct)" subtitle="Select a citizen, enter structured data, sign with Ed25519. Validated against the schema before signing.">
      {citizens.loading && <LoadingBlock label="Loading citizens…" />}
      {citizens.error && <ErrorBlock message={citizens.error} onRetry={citizens.reload} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Citizen" htmlFor="org-citizen">
          <Select id="org-citizen" value={citizenId} onChange={setCitizenId} disabled={issue.pending}>
            {(citizens.data?.citizens ?? []).map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
          </Select>
        </Field>
        <Field label="Credential type" htmlFor="org-type">
          <select id="org-type" className="input" value={type} onChange={(e) => setType(e.target.value)} disabled={issue.pending}>
            {ISSUER_TYPES.map((t) => (<option key={t} value={t}>{t}</option>))}
          </select>
        </Field>
      </div>
      <div className="mt-3">
        <Field label="Claims (JSON)" htmlFor="org-claims">
          <textarea id="org-claims" className="input h-44 font-mono text-xs" value={claimsText} onChange={(e) => setClaimsText(e.target.value)} spellCheck={false} disabled={issue.pending} />
        </Field>
        <InlineError error={parsed.error} />
        <InlineError error={issue.error} />
        {flash && <p className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{flash}</p>}
        <button type="button" className="btn-primary mt-3" disabled={issue.pending || !parsed.value || citizenId === ''} onClick={() => void handleIssue()}>
          {issue.pending ? (<><Spinner /> Signing…</>) : `Issue ${type.replace(/Credential$/, '')}`}
        </button>
      </div>
    </Card>
  );
}

function IssuedList({ issued, onChanged }: { issued: { data: { credentials: { id: number; typeLabel: string; type: string; citizen: { name: string }; issuedAt: string; expiresAt: string; status: string; statusIndex: number; claims: Record<string, unknown> }[] } | null; loading: boolean; error: string | null; reload: () => void }; onChanged: () => void }) {
  const revoke = useAction(api.revokeCredential);
  const [flash, setFlash] = useState<string | null>(null);
  const rows = issued.data?.credentials ?? [];
  return (
    <div>
      <SectionTitle hint={`${rows.length} issued`}>Issued credentials</SectionTitle>
      {issued.loading && <LoadingBlock />}
      {issued.error && <ErrorBlock message={issued.error} onRetry={issued.reload} />}
      {flash && <p className="mb-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{flash}</p>}
      <div className="space-y-2">
        {rows.map((c) => (
          <Card key={c.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold">{c.typeLabel}</h3>
                  <StatusBadge status={c.status} />
                </div>
                <p className="text-xs text-slate-500">For {c.citizen.name} · issued {formatDate(c.issuedAt)} · bit #{c.statusIndex}</p>
              </div>
              <button type="button" className="btn-danger" disabled={revoke.pending || c.status === 'revoked'} onClick={() => void (async () => {
                const r = await revoke.run(c.id);
                if (r) { setFlash(r.message); onChanged(); }
              })()}>{c.status === 'revoked' ? 'Revoked' : 'Revoke'}</button>
            </div>
            <dl className="mt-2 grid sm:grid-cols-2 gap-x-6">
              {Object.entries(c.claims).map(([k, v]) => (
                <div key={k} className="flex justify-between border-b border-slate-100 py-1 text-xs">
                  <dt className="text-slate-500">{fieldLabel(k)}</dt>
                  <dd className="font-semibold">{formatValue(v)}</dd>
                </div>
              ))}
            </dl>
          </Card>
        ))}
      </div>
      <InlineError error={revoke.error} />
    </div>
  );
}

const HEADLINE: CheckId[] = ['issuer_trusted', 'signature_valid', 'not_revoked', 'consent_valid'];

function OrgVerifier({ requests }: { requests: { data: { requests: { id: number; citizen: { name: string }; credentialTypeLabel: string; requestedFields: string[]; purpose: string; usable: boolean; used: boolean; consent: { status?: string } | null; presentation?: string | null; nonce: string; createdAt: string }[] } | null; reload: () => void } }) {
  const citizens = useRequest(() => api.citizens(), 'citizens-for-verify');
  const [citizenId, setCitizenId] = useState<number | ''>('');
  const [credentialType, setCredentialType] = useState('DegreeCredential');
  const [fieldsText, setFieldsText] = useState('degree, university, graduationYear');
  const [purpose, setPurpose] = useState('Credential Verification');
  const [presentation, setPresentation] = useState('');
  const [result, setResult] = useState<VerifyResponse | null>(null);
  const create = useAction(api.createOrgRequest);
  const verify = useAction(api.orgVerify);

  const preview = useMemo(() => (presentation ? decodePresentation(presentation) : null), [presentation]);

  async function handleCreate() {
    if (citizenId === '') return;
    const fields = fieldsText.split(',').map((s) => s.trim()).filter(Boolean);
    const res = await create.run({ citizenId: Number(citizenId), credentialType, requestedFields: fields, purpose });
    if (res) requests.reload();
  }

  async function handleVerify() {
    if (!presentation.trim()) return;
    const res = await verify.run(presentation.trim());
    setResult(res);
    if (res) requests.reload();
  }

  const list = requests.data?.requests ?? [];

  return (
    <div className="space-y-3">
      <SectionTitle>Verification requests (as verifier)</SectionTitle>
      <Card title="Create verification request" subtitle="Nonce + audience + requested claims + purpose. Citizen approves with selective disclosure.">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Citizen" htmlFor="v-citizen">
            <Select id="v-citizen" value={citizenId} onChange={setCitizenId}>
              {(citizens.data?.citizens ?? []).map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
            </Select>
          </Field>
          <Field label="Credential type" htmlFor="v-type">
            <select id="v-type" className="input" value={credentialType} onChange={(e) => setCredentialType(e.target.value)}>
              {ISSUER_TYPES.map((t) => (<option key={t} value={t}>{t}</option>))}
            </select>
          </Field>
          <Field label="Requested fields (comma separated)" htmlFor="v-fields">
            <input id="v-fields" className="input font-mono text-xs" value={fieldsText} onChange={(e) => setFieldsText(e.target.value)} />
          </Field>
          <Field label="Purpose" htmlFor="v-purpose">
            <input id="v-purpose" className="input" value={purpose} onChange={(e) => setPurpose(e.target.value)} maxLength={300} />
          </Field>
        </div>
        <InlineError error={create.error} />
        <button type="button" className="btn-primary mt-3" disabled={create.pending || citizenId === ''} onClick={() => void handleCreate()}>
          {create.pending ? <Spinner /> : null} Send request
        </button>
      </Card>

      <div className="space-y-2">
        {list.map((r) => (
          <Card key={r.id} className="p-3">
            <div className="flex justify-between gap-2">
              <div>
                <p className="text-sm font-semibold">#{r.id} {r.citizen.name} · {r.credentialTypeLabel}</p>
                <p className="text-xs text-slate-500">“{r.purpose}” · fields: {r.requestedFields.join(', ')} · {r.usable ? 'usable' : r.used ? 'used' : 'expired'} · consent: {r.consent?.status ?? '—'}</p>
                <p className="font-mono text-[10px] text-slate-400">nonce {r.nonce.slice(0, 12)}… · {formatDateTime(r.createdAt)}</p>
              </div>
              {r.presentation && (
                <button type="button" className="btn-secondary" onClick={() => { setPresentation(r.presentation!); setResult(null); }}>Load presentation</button>
              )}
            </div>
          </Card>
        ))}
      </div>

      <Card title="Verify a presentation" subtitle="Runs all 9 checks: signature, trust, schema, digests, holder, nonce, audience, revocation, consent.">
        <Field label="Presentation (SD-JWT+KB)" htmlFor="org-pres">
          <textarea id="org-pres" className="input h-28 font-mono text-[11px]" value={presentation} onChange={(e) => setPresentation(e.target.value)} spellCheck={false} placeholder="<jwt>~<disclosure>~…<kb-jwt>" />
        </Field>
        {preview && <p className="mt-1 text-xs text-slate-500">{preview.disclosures.length} disclosure(s) in preview.</p>}
        <InlineError error={verify.error} />
        <button type="button" className="btn-primary mt-3" disabled={verify.pending || !presentation.trim()} onClick={() => void handleVerify()}>
          {verify.pending ? <Spinner /> : null} Verify now
        </button>
      </Card>

      {result && <OrgVerifyResult result={result} />}
    </div>
  );
}

function OrgVerifyResult({ result }: { result: VerifyResponse }) {
  const granted = result.result === 'granted';
  const byId = new Map<CheckId, CheckResult>(result.checks.map((c) => [c.id, c]));
  return (
    <div className="space-y-3">
      <div className={`rounded-2xl border p-5 ${granted ? 'border-emerald-300 bg-emerald-50' : 'border-rose-300 bg-rose-50'}`}>
        <h2 className={`text-2xl font-bold ${granted ? 'text-emerald-800' : 'text-rose-800'}`}>{granted ? '✓ Credential Verified' : '✕ Verification Failed'}</h2>
        <p className="mt-1 text-sm">{granted ? `${result.revealedFields.length} field(s) disclosed — nothing else.` : 'No personal data revealed. See failing checks.'}</p>
        <p className="mt-1 text-xs">Verified {formatDateTime(result.verifiedAt)}</p>
      </div>
      <Card title="Checks (each one really ran)">
        <div className="grid gap-2 sm:grid-cols-2">
          {HEADLINE.map((id) => {
            const c = byId.get(id);
            if (!c) return null;
            return (
              <div key={id} className={`rounded-xl border p-3 ${c.passed ? 'border-emerald-200 bg-emerald-50/50' : 'border-rose-200 bg-rose-50/50'}`}>
                <p className="text-sm font-semibold">{c.passed ? '✓' : '✕'} {c.label}</p>
                <p className="text-xs text-slate-600">{c.detail}</p>
              </div>
            );
          })}
        </div>
        <details className="mt-2">
          <summary className="cursor-pointer text-xs font-semibold text-slate-500">All {result.checks.length} checks</summary>
          <ul className="mt-1 space-y-1">
            {result.checks.map((c) => (
              <li key={c.id} className={`text-xs ${c.passed ? 'text-emerald-700' : 'text-rose-700'}`}>{c.passed ? '✓' : '✕'} {c.id}: {c.detail}</li>
            ))}
          </ul>
        </details>
      </Card>
      <Card title={granted ? 'Disclosed (only approved fields)' : 'Disclosed'}>
        {granted && Object.keys(result.revealed).length > 0 ? (
          <dl>{Object.entries(result.revealed).map(([k, v]) => (
            <div key={k} className="flex justify-between border-b border-slate-100 py-1 text-sm"><dt className="text-slate-500">{fieldLabel(k)}</dt><dd className="font-semibold">{formatValue(v)}</dd></div>
          ))}</dl>
        ) : <p className="text-sm text-slate-500">{granted ? 'No claims.' : 'Nothing revealed.'}</p>}
        {granted && result.withheldFields.length > 0 && (
          <p className="mt-2 text-xs text-slate-500">Kept private: {result.withheldFields.map(fieldLabel).join(', ')}</p>
        )}
      </Card>
    </div>
  );
}
