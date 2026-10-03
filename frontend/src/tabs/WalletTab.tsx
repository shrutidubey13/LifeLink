/**
 * The citizen's wallet: verified credentials, document verification requests,
 * incoming sharing requests (consent), sharing history, and verifications.
 */
import { useCallback, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { stashShare } from '../lib/auth';
import { DOCUMENT_TYPES, fieldLabel, formatValue } from '../lib/catalog';
import { formatDateTime, relativeTime } from '../lib/format';
import { useAction, useRequest } from '../lib/hooks';
import type { Citizen, Consent, Credential, DocumentRequest, PresentationRequest, ShareResult, VerificationRecord } from '../lib/types';
import { ConsentModal } from '../components/ConsentModal';
import { CredentialCard } from '../components/CredentialCard';
import { SharingHistory } from '../components/SharingHistory';
import { Timeline } from '../components/Timeline';
import { Badge, Card, EmptyState, ErrorBlock, InlineError, LoadingBlock, SectionTitle, Spinner } from '../components/ui';

export function WalletTab({ citizen }: { citizen: Citizen }) {
  const [sharing, setSharing] = useState<Credential | null>(null);
  const [lastShare, setLastShare] = useState<{ result: ShareResult; credential: Credential } | null>(null);
  const [endingId, setEndingId] = useState<number | null>(null);

  const wallet = useRequest(() => api.wallet(), `wallet-${citizen.id}`);
  const verifiers = useRequest(() => api.verifiers(), 'verifiers');
  const documents = useRequest(() => api.myDocuments(), `documents-${citizen.id}`);
  const incoming = useRequest(() => api.walletRequests(), `incoming-${citizen.id}`);
  const consents = useRequest(() => api.consents(), `consents-${citizen.id}`);
  const verifications = useRequest(() => api.verifications(), `verifications-${citizen.id}`);
  const endConsent = useAction(api.endConsent);

  const reloadAll = useCallback(() => {
    wallet.reload();
    documents.reload();
    incoming.reload();
    consents.reload();
    verifications.reload();
  }, [wallet, documents, incoming, consents, verifications]);

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
            <SectionTitle hint={`${wallet.data.credentials.length} in wallet`}>Verified credentials</SectionTitle>
            {wallet.data.credentials.length === 0 ? (
              <Card>
                <p className="text-sm text-slate-600">
                  This wallet is empty. Add a document below for verification, or ask your
                  university/employer to issue directly.
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
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-500">What stayed private</p>
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
                  className="btn-secondary"
                  onClick={() => void navigator.clipboard?.writeText(lastShare.result.presentation).catch(() => undefined)}
                >
                  Copy presentation
                </button>
                <button type="button" className="btn-secondary" onClick={() => setLastShare(null)}>
                  Done
                </button>
              </div>
            </Card>
          )}

          <AddDocumentCard onSubmitted={reloadAll} />

          <PendingDocuments
            documents={documents.data?.documents ?? []}
            loading={documents.loading}
            error={documents.error}
            onRetry={documents.reload}
          />

          <SharingRequests requests={incoming.data?.requests ?? []} loading={incoming.loading} error={incoming.error} onRetry={incoming.reload} onAnswered={reloadAll} credentials={wallet.data.credentials} />

          <div>
            <SectionTitle hint={consents.data ? `${consents.data.consents.length} total` : undefined}>
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
                body="Every time a verifier checks something you shared — granted or denied — it appears here."
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
          verifiers={verifiers.data?.verifiers ?? []}
          onClose={() => setSharing(null)}
          onApprove={(result) => {
            setSharing(null);
            setLastShare({ result, credential: sharing });
            stashShare({ presentation: result.presentation });
            reloadAll();
          }}
        />
      )}
    </div>
  );
}

function AddDocumentCard({ onSubmitted }: { onSubmitted: () => void }) {
  const [documentType, setDocumentType] = useState('Degree');
  const [documentName, setDocumentName] = useState('BCA_Degree.pdf');
  const [organizationId, setOrganizationId] = useState<number | ''>('');
  const [purpose, setPurpose] = useState('Credential Verification');
  const [done, setDone] = useState<string | null>(null);
  const orgs = useRequest(
    () => api.organizations(documentType),
    `eligible-orgs-${documentType}`,
  );
  const submit = useAction(api.submitDocument);

  const list = orgs.data?.organizations ?? [];
  const eligibleHint =
    DOCUMENT_TYPES.find((d) => d.value === documentType)?.hint ?? 'Choose a trusted organization';

  async function handleSubmit() {
    if (organizationId === '') return;
    setDone(null);
    // Demo stores metadata (file name + reference), not multi-MB uploads.
    const result = await submit.run({
      documentType,
      documentName: documentName.trim() || 'document.pdf',
      documentRef: `demo-upload:${documentName.trim() || 'document.pdf'}:${Date.now()}`,
      mimeType: 'application/pdf',
      organizationId: Number(organizationId),
      purpose: purpose.trim(),
    });
    if (result) {
      setDone(result.message);
      onSubmitted();
    }
  }

  return (
    <Card
      title="Add Document for Verification"
      subtitle="Upload an existing document, pick the issuing organization, and send it for review. It becomes a trusted credential ONLY after they approve and sign it."
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="doc-type">Document type</label>
          <select id="doc-type" className="input" value={documentType} onChange={(e) => { setDocumentType(e.target.value); setOrganizationId(''); }} disabled={submit.pending}>
            {DOCUMENT_TYPES.map((d) => (
              <option key={d.value} value={d.value}>{d.label}</option>
            ))}
          </select>
          <p className="mt-1 text-xs text-slate-500">{eligibleHint}</p>
        </div>
        <div>
          <label className="label" htmlFor="doc-name">Upload document</label>
          <input id="doc-name" className="input" value={documentName} disabled={submit.pending} onChange={(e) => setDocumentName(e.target.value)} placeholder="BCA_Degree.pdf" />
          <p className="mt-1 text-xs text-slate-500">Demo: file name is stored as the document reference.</p>
        </div>
        <div>
          <label className="label" htmlFor="doc-org">Select issuing organization</label>
          <select id="doc-org" className="input" value={organizationId} onChange={(e) => setOrganizationId(e.target.value === '' ? '' : Number(e.target.value))} disabled={submit.pending || orgs.loading}>
            <option value="">Choose organization…</option>
            {list.map((o) => (
              <option key={o.id} value={o.id}>{o.name} ({o.orgType ?? 'Organization'})</option>
            ))}
          </select>
          {orgs.loading && <p className="mt-1 text-xs text-slate-500">Loading trusted organizations…</p>}
          {orgs.error && <p className="mt-1 text-xs text-rose-600">{orgs.error}</p>}
        </div>
        <div>
          <label className="label" htmlFor="doc-purpose">Purpose / reason</label>
          <input id="doc-purpose" className="input" value={purpose} disabled={submit.pending} onChange={(e) => setPurpose(e.target.value)} maxLength={500} />
        </div>
      </div>
      <InlineError error={submit.error} />
      {done && <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{done}</p>}
      <div className="mt-4">
        <button type="button" className="btn-primary" disabled={submit.pending || organizationId === '' || purpose.trim().length < 3} onClick={() => void handleSubmit()}>
          {submit.pending ? (<><Spinner /> Sending…</>) : 'Send for Verification'}
        </button>
      </div>
    </Card>
  );
}

function PendingDocuments({ documents, loading, error, onRetry }: { documents: DocumentRequest[]; loading: boolean; error: string | null; onRetry: () => void }) {
  return (
    <div>
      <SectionTitle hint={`${documents.length} total`}>Pending verification</SectionTitle>
      {loading && <LoadingBlock label="Loading your documents…" />}
      {error && <ErrorBlock message={error} onRetry={onRetry} />}
      {!loading && !error && documents.length === 0 && (
        <EmptyState title="No documents submitted" body="Use “Add Document for Verification” to send your first document to an organization." />
      )}
      <ul className="space-y-2">
        {documents.map((d) => (
          <li key={d.id} className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-slate-900">{d.documentName}</p>
                <p className="text-xs text-slate-500">{d.documentType} → {d.organization?.name ?? `Org #${d.organizationId}`} · “{d.purpose}”</p>
              </div>
              <Badge tone={d.status === 'PENDING' ? 'info' : d.status === 'APPROVED' ? 'granted' : 'denied'}>
                {d.status === 'PENDING' ? 'Pending Verification' : d.status === 'APPROVED' ? `Approved → Credential #${d.credentialId}` : 'Rejected'}
              </Badge>
            </div>
            {d.status === 'REJECTED' && d.rejectionReason && (
              <p className="mt-1 text-xs text-rose-700">Reason: {d.rejectionReason}</p>
            )}
            <p className="mt-1 text-[11px] text-slate-400">{formatDateTime(d.createdAt)}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SharingRequests({ requests, loading, error, onRetry, onAnswered, credentials }: {
  requests: PresentationRequest[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onAnswered: () => void;
  credentials: Credential[];
}) {
  const [selected, setSelected] = useState<Record<number, { credentialId: number | ''; fields: string[] }>>({});
  const approve = useAction(api.approveRequest);
  const reject = useAction(api.rejectRequest);

  function toggle(requestId: number, field: string) {
    setSelected((prev) => {
      const cur = prev[requestId] ?? { credentialId: '', fields: [] };
      const fields = cur.fields.includes(field) ? cur.fields.filter((f) => f !== field) : [...cur.fields, field];
      return { ...prev, [requestId]: { ...cur, fields } };
    });
  }

  async function handleApprove(req: PresentationRequest) {
    const sel = selected[req.id];
    if (!sel || sel.credentialId === '' || sel.fields.length === 0) return;
    const result = await approve.run(req.id, { credentialId: Number(sel.credentialId), fields: sel.fields });
    if (result) {
      stashShare({ presentation: result.presentation });
      onAnswered();
    }
  }

  async function handleReject(req: PresentationRequest) {
    const result = await reject.run(req.id);
    if (result) onAnswered();
  }

  const pending = requests.filter((r) => r.usable && !r.consent?.hasPresentation && r.consent?.status !== 'REJECTED');

  return (
    <div>
      <SectionTitle hint={`${pending.length} awaiting decision`}>Sharing requests</SectionTitle>
      {loading && <LoadingBlock label="Loading sharing requests…" />}
      {error && <ErrorBlock message={error} onRetry={onRetry} />}
      {!loading && !error && pending.length === 0 && (
        <EmptyState title="No pending sharing requests" body="When an organization requests selected information, it appears here for ALLOW / DENY." />
      )}
      <div className="space-y-3">
        {pending.map((req) => {
          const matching = credentials.filter((c) => c.type === req.credentialType);
          const sel = selected[req.id] ?? { credentialId: matching[0]?.id ?? '', fields: [...req.requestedFields] };
          const chosenCred = credentials.find((c) => c.id === sel.credentialId);
          return (
            <Card key={req.id} title={`${req.verifier.name} wants to verify your ${req.credentialTypeLabel}`} subtitle={`Purpose: “${req.purpose}” · expires ${relativeTime(req.expiresAt)}`}>
              <p className="text-xs text-slate-500">Requested:</p>
              <div className="mt-1 space-y-1">
                {req.requestedFields.map((f) => (
                  <label key={f} className="flex items-center gap-2 text-sm text-slate-700">
                    <input type="checkbox" checked={sel.fields.includes(f)} onChange={() => toggle(req.id, f)} />
                    <span className="font-medium">{fieldLabel(f)}</span>
                    <span className="text-emerald-600">✓</span>
                  </label>
                ))}
              </div>
              {chosenCred && (
                <p className="mt-2 text-xs text-slate-500">
                  Not requested (stays private): {Object.keys(chosenCred.claims).filter((k) => !req.requestedFields.includes(k)).map(fieldLabel).join(', ') || '—'}
                </p>
              )}
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="label">Use credential</label>
                  <select className="input" value={sel.credentialId} onChange={(e) => setSelected((p) => ({ ...p, [req.id]: { credentialId: e.target.value === '' ? '' : Number(e.target.value), fields: sel.fields } }))}>
                    <option value="">Choose…</option>
                    {matching.map((c) => (
                      <option key={c.id} value={c.id}>#{c.id} {c.typeLabel} ({c.status})</option>
                    ))}
                  </select>
                </div>
              </div>
              <InlineError error={approve.error} />
              <InlineError error={reject.error} />
              <div className="mt-3 flex gap-2">
                <button type="button" className="btn-primary" disabled={approve.pending || sel.credentialId === '' || sel.fields.length === 0} onClick={() => void handleApprove(req)}>
                  {approve.pending ? <Spinner /> : null} ALLOW ({sel.fields.length} fields)
                </button>
                <button type="button" className="btn-secondary" disabled={reject.pending} onClick={() => void handleReject(req)}>DENY</button>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function VerificationRow({ record }: { record: VerificationRecord }) {
  return (
    <li className={`rounded-xl border bg-white p-3 ${record.result === 'granted' ? 'border-emerald-200' : 'border-rose-200'}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-900">
            {record.verifier.name}
            <span className="font-normal text-slate-500"> checked your {record.credential?.typeLabel ?? 'credential'}{record.consentId ? ` · consent #${record.consentId}` : ''}</span>
          </p>
          {record.purpose && <p className="mt-0.5 text-xs text-slate-600">“{record.purpose}”</p>}
        </div>
        <Badge tone={record.result === 'granted' ? 'granted' : 'denied'}>{record.result === 'granted' ? '✓ Granted' : '✕ Denied'}</Badge>
      </div>
      {record.result === 'granted' ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {record.revealedFields.map((field) => (
            <Badge key={field} tone="info">{fieldLabel(field)}</Badge>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-xs text-rose-700">Denied because: {record.deniedBecause.join(', ') || 'unknown reason'}.</p>
      )}
      <p className="mt-2 text-[11px] text-slate-400">{formatDateTime(record.createdAt)}</p>
    </li>
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
