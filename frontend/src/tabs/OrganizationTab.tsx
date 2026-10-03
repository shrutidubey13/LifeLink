/**
 * Organization dashboard (unified issuer + verifier role).
 *
 * - Document Verification Requests: review student uploads, approve (issues a
 *   signed DocumentCredential into the wallet with attachment) or reject with reason.
 * - Issue Document: direct issuance to a student.
 * - Issued Documents + revoke (with confirmation dialog).
 * - Verification Requests: create presentation requests, see history, verify
 *   presentations (9 real cryptographic checks).
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Award,
  FileText,
  CheckCircle2,
  XCircle,
  Send,
  ShieldCheck,
  RotateCcw,
  Inbox,
  Paperclip,
} from 'lucide-react';
import { api } from '../lib/api';
import { fieldLabel, formatValue } from '../lib/catalog';
import { formatDate, formatDateTime, relativeTime } from '../lib/format';
import { useAction, useRequest } from '../lib/hooks';
import { decodePresentation } from '../lib/sdjwt';
import type { CheckId, CheckResult, DocumentRequest, VerifyResponse } from '../lib/types';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  EmptyState,
  ErrorBlock,
  Field,
  InlineError,
  Input,
  Modal,
  PageHeader,
  Select,
  SkeletonCard,
  SkeletonList,
  StatusBadge,
  TruncatedHash,
  useToast,
} from '../components/ui';
import { useTitle } from '../lib/useTitle';
import { FileViewer } from '../components/FileViewer';
import { ClaimsEditor, KeyValueDisplay } from '../components/ClaimsEditor';

export function OrganizationTab() {
  useTitle('Organization Dashboard');
  const profile = useRequest(() => api.organizationProfile(), 'org-profile');
  const docs = useRequest(() => api.orgDocuments(), 'org-docs');
  const issued = useRequest(() => api.issuerCredentials(), 'org-issued');
  const requests = useRequest(() => api.orgRequests(), 'org-requests');

  return (
    <div className="space-y-6">
      <PageHeader
        title={profile.data ? profile.data.organization.name : 'Organization Dashboard'}
        subtitle="Review document uploads, issue cryptographic documents, and verify presentations."
        badge={
          profile.data && (
            <Badge tone="trusted" size="md">
              {profile.data.organization.orgType ?? 'Organization'} · {profile.data.organization.status}
            </Badge>
          )
        }
        actions={
          <Button
            variant="secondary"
            size="sm"
            icon={<RotateCcw className="h-4 w-4" />}
            onClick={() => {
              profile.reload();
              docs.reload();
              issued.reload();
              requests.reload();
            }}
          >
            Refresh
          </Button>
        }
      />

      {profile.loading && !profile.data && <SkeletonCard lines={2} />}
      {profile.error && <ErrorBlock message={profile.error} onRetry={profile.reload} />}

      {profile.data && (
        <Card className="border-blue-100 bg-gradient-to-r from-blue-50/50 to-indigo-50/30">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200/60">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-slate-500 uppercase tracking-wider">
                Organization DID:
              </span>
              <TruncatedHash value={profile.data.organization.did} start={14} end={8} />
            </div>
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <span>Can issue: <strong>{profile.data.organization.canIssue ? 'Yes' : 'No'}</strong></span>
              <span>·</span>
              <span>Can verify: <strong>{profile.data.organization.canVerify ? 'Yes' : 'No'}</strong></span>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3 text-center">
            <div className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-2xs">
              <p className="text-2xl font-bold text-blue-700">{profile.data.stats.credentialsIssued}</p>
              <p className="text-sm font-semibold uppercase tracking-wider text-slate-500 mt-1">Documents Issued</p>
            </div>
            <div className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-2xs">
              <p className="text-2xl font-bold text-amber-600">{profile.data.stats.documentsPending}</p>
              <p className="text-sm font-semibold uppercase tracking-wider text-slate-500 mt-1">Pending Docs</p>
            </div>
            <div className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-2xs">
              <p className="text-2xl font-bold text-slate-800">{profile.data.stats.documentsTotal}</p>
              <p className="text-sm font-semibold uppercase tracking-wider text-slate-500 mt-1">Total Docs Submitted</p>
            </div>
          </div>
        </Card>
      )}

      {/* Document Queue */}
      <DocumentQueue
        onChanged={() => {
          docs.reload();
          issued.reload();
          profile.reload();
        }}
        docs={docs}
      />

      {/* Issue Document Directly */}
      <IssueDocumentCard
        onIssued={() => {
          issued.reload();
          profile.reload();
        }}
      />

      {/* Issued Documents List */}
      <IssuedList
        issued={issued}
        onChanged={() => {
          issued.reload();
          profile.reload();
        }}
      />

      {/* Verification Portal */}
      <OrgVerifier requests={requests} />
    </div>
  );
}

function DocumentQueue({
  onChanged,
  docs,
}: {
  onChanged: () => void;
  docs: {
    data: { documents: DocumentRequest[] } | null;
    loading: boolean;
    error: string | null;
    reload: () => void;
  };
}) {
  const [reviewing, setReviewing] = useState<DocumentRequest | null>(null);

  const pendingCount = docs.data?.documents.filter((d) => d.status === 'PENDING').length ?? 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
          <FileText className="h-5 w-5 text-blue-600" />
          <span>Document Verification Queue</span>
        </h2>
        {pendingCount > 0 && (
          <Badge tone="pending">{pendingCount} Pending Review</Badge>
        )}
      </div>

      {docs.loading && !docs.data && <SkeletonList count={2} />}
      {docs.error && <ErrorBlock message={docs.error} onRetry={docs.reload} />}

      {docs.data && docs.data.documents.length === 0 && (
        <EmptyState
          icon={<Inbox className="h-6 w-6" />}
          title="No verification requests"
          description="Students send documents here when requesting document issuance. None have been submitted yet."
        />
      )}

      <div className="space-y-3">
        {(docs.data?.documents ?? []).map((d) => (
          <Card key={d.id} className="p-4 sm:p-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-bold text-slate-900">{d.documentName}</h3>
                  <Badge
                    tone={
                      d.status === 'PENDING'
                        ? 'pending'
                        : d.status === 'APPROVED'
                        ? 'success'
                        : 'danger'
                    }
                  >
                    {d.status}
                  </Badge>
                </div>
                <p className="text-sm text-slate-500">
                  Student: <strong className="text-slate-700">{d.citizen?.name ?? `#${d.citizenId}`}</strong> · Purpose: “{d.purpose}” · {relativeTime(d.createdAt)}
                </p>
                {d.file && (
                  <p className="text-sm text-slate-600 flex items-center gap-1.5 mt-0.5">
                    <Paperclip className="h-3.5 w-3.5 text-blue-500" />
                    <span>Attached file: <strong>{d.file.name}</strong> ({(d.file.size / 1024).toFixed(1)} KB, {d.file.mime})</span>
                  </p>
                )}
                <div className="pt-1">
                  <TruncatedHash value={d.documentRef} start={20} end={10} />
                </div>
                {d.status === 'REJECTED' && d.rejectionReason && (
                  <p className="text-sm text-rose-700 bg-rose-50 p-2.5 rounded-lg border border-rose-200 mt-2">
                    <strong>Rejection reason:</strong> {d.rejectionReason}
                  </p>
                )}
                {d.status === 'APPROVED' && d.credentialId && (
                  <p className="text-sm text-emerald-700 font-medium mt-1">
                    ✓ Approved &amp; issued as Document #{d.credentialId}
                  </p>
                )}
              </div>

              {d.status === 'PENDING' && (
                <div className="shrink-0">
                  <Button
                    variant="primary"
                    size="md"
                    onClick={() => setReviewing(d)}
                  >
                    Review Document
                  </Button>
                </div>
              )}
            </div>
          </Card>
        ))}
      </div>

      {reviewing && (
        <ReviewModal
          doc={reviewing}
          onClose={() => setReviewing(null)}
          onDone={() => {
            setReviewing(null);
            onChanged();
          }}
        />
      )}
    </div>
  );
}

function ReviewModal({
  doc,
  onClose,
  onDone,
}: {
  doc: DocumentRequest;
  onClose: () => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [claims, setClaims] = useState<Record<string, unknown>>({
    documentName: doc.documentName,
    holderName: doc.citizen?.name ?? 'Student',
    issuedDate: new Date().toISOString().slice(0, 10),
    category: 'Official Record',
  });
  const [rejectReason, setRejectReason] = useState('');
  const [mode, setMode] = useState<'approve' | 'reject'>('approve');
  const approve = useAction(api.approveDocument);
  const reject = useAction(api.rejectDocument);
  const [detail, setDetail] = useState<DocumentRequest | null>(doc);

  useEffect(() => {
    api
      .orgDocument(doc.id)
      .then((r) => {
        setDetail(r.document);
        setClaims({
          documentName: r.document.documentName,
          holderName: r.document.citizen?.name ?? 'Student',
          issuedDate: new Date().toISOString().slice(0, 10),
          category: r.document.documentType || 'Official Record',
        });
      })
      .catch(() => undefined);
  }, [doc.id]);

  async function handleApprove() {
    if (!claims.documentName) {
      toast.error('Document Name is required.');
      return;
    }
    const result = await approve.run(doc.id, { claims });
    if (result) {
      toast.success(result.message || 'Document approved and issued successfully!');
      onDone();
    }
  }

  async function handleReject() {
    if (rejectReason.trim().length < 3) return;
    const result = await reject.run(doc.id, rejectReason.trim());
    if (result) {
      toast.success('Document request rejected.');
      onDone();
    }
  }

  const hasFile = Boolean(doc.fileId || detail?.fileId || doc.file);

  return (
    <Modal
      isOpen
      onClose={onClose}
      size={hasFile ? '2xl' : 'lg'}
      title={`Review: ${doc.documentName}`}
      description={`Submitted by ${detail?.citizen?.name ?? 'Student'}`}
    >
      <div className="space-y-4">
        <div className={hasFile ? 'grid grid-cols-1 lg:grid-cols-2 gap-5' : 'space-y-4'}>
          {hasFile && (
            <div className="flex flex-col space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
                  <Paperclip className="h-4 w-4 text-blue-600" />
                  Uploaded Document File
                </span>
                {doc.file && (
                  <span className="text-xs text-slate-500 font-mono">
                    {(doc.file.size / 1024).toFixed(1)} KB · {doc.file.mime}
                  </span>
                )}
              </div>
              <div className="h-[440px] rounded-xl border border-slate-200 overflow-hidden bg-slate-50">
                <FileViewer
                  url={api.documentFileUrl(doc.id)}
                  fileName={doc.file?.name || doc.documentName}
                  mimeType={doc.file?.mime}
                  fileSize={doc.file?.size}
                />
              </div>
            </div>
          )}

          <div className="space-y-4">
            <div className="rounded-xl bg-slate-50 p-3.5 border border-slate-200 text-sm">
              <p className="text-xs text-slate-500 uppercase tracking-wider font-semibold">Document Fingerprint</p>
              <div className="mt-1">
                <TruncatedHash value={doc.documentRef} start={24} end={14} />
              </div>
              <p className="mt-2 text-slate-600">
                <strong>Student Purpose:</strong> “{doc.purpose}”
              </p>
            </div>

            <div className="flex gap-2 border-b border-slate-200 pb-3">
              <Button
                variant={mode === 'approve' ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => setMode('approve')}
              >
                Approve &amp; Issue Document
              </Button>
              <Button
                variant={mode === 'reject' ? 'danger' : 'secondary'}
                size="sm"
                onClick={() => setMode('reject')}
              >
                Reject Request
              </Button>
            </div>

            {mode === 'approve' ? (
              <div className="space-y-3">
                <Field
                  label="Document Structured Fields"
                  hint="These fields are cryptographically signed with Ed25519."
                >
                  <ClaimsEditor
                    initialClaims={claims}
                    onChange={setClaims}
                    disabled={approve.pending}
                  />
                </Field>
                <InlineError error={approve.error} />
                <div className="flex justify-end gap-3 pt-2">
                  <Button variant="secondary" size="md" onClick={onClose}>
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    size="md"
                    loading={approve.pending}
                    onClick={() => void handleApprove()}
                  >
                    Approve &amp; Issue
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <Field label="Rejection Reason" hint="Provide a clear explanation for the student.">
                  <Input
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder="e.g. Document image is blurry or missing seal"
                    maxLength={500}
                  />
                </Field>
                <InlineError error={reject.error} />
                <div className="flex justify-end gap-3 pt-2">
                  <Button variant="secondary" size="md" onClick={onClose}>
                    Cancel
                  </Button>
                  <Button
                    variant="danger"
                    size="md"
                    loading={reject.pending}
                    disabled={rejectReason.trim().length < 3}
                    onClick={() => void handleReject()}
                  >
                    Reject Request
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function IssueDocumentCard({ onIssued }: { onIssued: () => void }) {
  const { toast } = useToast();
  const citizens = useRequest(() => api.citizens(), 'citizens');
  const [citizenId, setCitizenId] = useState<number | ''>('');
  const [documentName, setDocumentName] = useState('Bachelor of Computer Applications');
  const [claims, setClaims] = useState<Record<string, unknown>>({
    documentName: 'Bachelor of Computer Applications',
    holderName: '',
    issuedDate: new Date().toISOString().slice(0, 10),
    category: 'Degree Certificate',
  });
  const issue = useAction(api.issueCredential);

  useEffect(() => {
    if ((citizens.data?.citizens.length ?? 0) > 0 && citizenId === '') {
      setCitizenId(citizens.data!.citizens[0].id);
    }
  }, [citizens.data, citizenId]);

  const selectedCitizen = citizens.data?.citizens.find((c) => c.id === Number(citizenId));

  useEffect(() => {
    setClaims((prev) => ({
      ...prev,
      documentName,
      holderName: selectedCitizen?.name ?? 'Student',
    }));
  }, [documentName, selectedCitizen?.name]);

  async function handleIssue() {
    if (citizenId === '' || !documentName.trim()) return;
    const finalClaims = {
      ...claims,
      documentName: documentName.trim(),
      holderName: (claims.holderName as string) || selectedCitizen?.name || 'Student',
      issuedDate: (claims.issuedDate as string) || new Date().toISOString().slice(0, 10),
    };

    const result = await issue.run({
      citizenId: Number(citizenId),
      type: 'DocumentCredential',
      claims: finalClaims,
    });
    if (result) {
      toast.success(result.message || 'Document issued and signed successfully!');
      onIssued();
    }
  }

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <Award className="h-5 w-5 text-blue-600" />
            <span>Direct Document Issuance</span>
          </CardTitle>
          <CardDescription>
            Issue and sign a new W3C Verifiable Document directly for a student using Ed25519.
          </CardDescription>
        </div>
      </CardHeader>

      <CardContent>
        {citizens.loading && !citizens.data && <SkeletonCard lines={2} />}
        {citizens.error && <ErrorBlock message={citizens.error} onRetry={citizens.reload} />}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Student Recipient" htmlFor="org-citizen">
            <Select
              id="org-citizen"
              value={citizenId}
              onChange={setCitizenId}
              disabled={issue.pending}
            >
              {(citizens.data?.citizens ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.email ?? `ID #${c.id}`})
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Document Name" htmlFor="org-doc-name" hint="Type the official name of the document to issue.">
            <Input
              id="org-doc-name"
              placeholder="e.g. Bachelor of Technology, Employment Letter, Account Statement"
              value={documentName}
              onChange={(e) => setDocumentName(e.target.value)}
              disabled={issue.pending}
            />
          </Field>
        </div>

        <div className="mt-4">
          <Field
            label="Document Fields"
            hint="Add or edit the fields to include in this signed document."
          >
            <ClaimsEditor
              initialClaims={claims}
              onChange={setClaims}
              disabled={issue.pending}
            />
          </Field>
          <InlineError error={issue.error} />

          <div className="mt-4 flex justify-end">
            <Button
              variant="primary"
              size="md"
              loading={issue.pending}
              disabled={citizenId === '' || !documentName.trim()}
              onClick={() => void handleIssue()}
              icon={<Send className="h-4 w-4" />}
            >
              Issue Document
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function IssuedList({
  issued,
  onChanged,
}: {
  issued: {
    data: {
      credentials: {
        id: number;
        typeLabel: string;
        type: string;
        citizen: { name: string };
        issuedAt: string;
        expiresAt: string;
        status: string;
        statusIndex: number;
        claims: Record<string, unknown>;
      }[];
    } | null;
    loading: boolean;
    error: string | null;
    reload: () => void;
  };
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const revoke = useAction(api.revokeCredential);
  const [credentialToRevoke, setCredentialToRevoke] = useState<{ id: number; label: string } | null>(null);

  const rows = issued.data?.credentials ?? [];

  async function handleConfirmRevoke() {
    if (!credentialToRevoke) return;
    const res = await revoke.run(credentialToRevoke.id);
    if (res) {
      toast.success(res.message || 'Document revoked successfully.');
      setCredentialToRevoke(null);
      onChanged();
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
          <Award className="h-5 w-5 text-blue-600" />
          <span>Issued Documents</span>
        </h2>
        {rows.length > 0 && <Badge tone="neutral">{rows.length} Total</Badge>}
      </div>

      {issued.loading && !issued.data && <SkeletonList count={2} />}
      {issued.error && <ErrorBlock message={issued.error} onRetry={issued.reload} />}

      {issued.data && rows.length === 0 && (
        <EmptyState
          icon={<Award className="h-6 w-6" />}
          title="No documents issued"
          description="Documents you issue to students will be listed here with live status tracking."
        />
      )}

      <div className="space-y-3">
        {rows.map((c) => {
          const docName = String(c.claims?.documentName || c.typeLabel || 'Document');
          return (
            <Card key={c.id} className="p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-slate-900">{docName}</h3>
                    <StatusBadge status={c.status} />
                    <span className="text-xs font-mono text-slate-400">ID #{c.id}</span>
                  </div>
                  <p className="text-sm text-slate-500 mt-0.5">
                    Issued to <strong className="text-slate-700">{c.citizen.name}</strong> · {formatDate(c.issuedAt)} · Status Bit #{c.statusIndex}
                  </p>
                </div>

                {c.status !== 'revoked' && (
                  <Button
                    variant="danger-outline"
                    size="sm"
                    disabled={revoke.pending}
                    onClick={() => setCredentialToRevoke({ id: c.id, label: docName })}
                  >
                    Revoke Document
                  </Button>
                )}
              </div>

              <dl className="mt-3 grid sm:grid-cols-2 gap-x-6 gap-y-1 rounded-xl bg-slate-50 p-3 border border-slate-100">
                {Object.entries(c.claims).map(([k, v]) => (
                  <div key={k} className="flex justify-between border-b border-slate-200/50 py-1 text-sm last:border-0">
                    <dt className="text-slate-500">{fieldLabel(k)}</dt>
                    <dd className="font-semibold text-slate-800 break-all">{formatValue(v)}</dd>
                  </div>
                ))}
              </dl>
            </Card>
          );
        })}
      </div>

      <InlineError error={revoke.error} />

      {credentialToRevoke && (
        <ConfirmDialog
          isOpen
          title="Revoke Document?"
          description={`Are you sure you want to revoke this ${credentialToRevoke.label}? This sets its bit in the W3C Bitstring Status List to 1 (revoked) and cannot be undone.`}
          confirmLabel="Revoke Document"
          tone="danger"
          loading={revoke.pending}
          onClose={() => setCredentialToRevoke(null)}
          onConfirm={handleConfirmRevoke}
        />
      )}
    </div>
  );
}

const HEADLINE: CheckId[] = ['issuer_trusted', 'signature_valid', 'not_revoked', 'consent_valid'];

function OrgVerifier({
  requests,
}: {
  requests: {
    data: {
      requests: {
        id: number;
        citizen: { name: string };
        credentialTypeLabel: string;
        requestedFields: string[];
        purpose: string;
        usable: boolean;
        used: boolean;
        consent: { status?: string } | null;
        presentation?: string | null;
        nonce: string;
        createdAt: string;
      }[];
    } | null;
    reload: () => void;
  };
}) {
  const { toast } = useToast();
  const citizens = useRequest(() => api.citizens(), 'citizens-for-verify');
  const [citizenId, setCitizenId] = useState<number | ''>('');
  const [documentName, setDocumentName] = useState('Bachelor of Computer Applications');
  const [fieldsText, setFieldsText] = useState('documentName, holderName, issuedDate');
  const [purpose, setPurpose] = useState('Document Verification');
  const [presentation, setPresentation] = useState('');
  const [result, setResult] = useState<VerifyResponse | null>(null);
  const create = useAction(api.createOrgRequest);
  const verify = useAction(api.orgVerify);

  const preview = useMemo(() => (presentation ? decodePresentation(presentation) : null), [presentation]);

  async function handleCreate() {
    if (citizenId === '') return;
    const fields = fieldsText.split(',').map((s) => s.trim()).filter(Boolean);
    const res = await create.run({
      citizenId: Number(citizenId),
      credentialType: documentName.trim() || 'DocumentCredential',
      requestedFields: fields,
      purpose,
    });
    if (res) {
      toast.success('Verification request created and dispatched to student.');
      requests.reload();
    }
  }

  async function handleVerify() {
    if (!presentation.trim()) return;
    const res = await verify.run(presentation.trim());
    setResult(res);
    if (res) {
      if (res.result === 'granted') {
        toast.success('Presentation successfully verified with 9 cryptographic checks!');
      } else {
        toast.error('Presentation verification failed. Check audit results.');
      }
      requests.reload();
    }
  }

  const list = requests.data?.requests ?? [];

  return (
    <div className="space-y-4 pt-4 border-t border-slate-200">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-blue-600" />
          <span>Verifier Portal (Organization as Verifier)</span>
        </h2>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Create Verification Request</CardTitle>
          <CardDescription>
            Specify the requested document name and selective disclosure fields.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Student" htmlFor="v-citizen">
              <Select id="v-citizen" value={citizenId} onChange={setCitizenId}>
                {(citizens.data?.citizens ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Document Name" htmlFor="v-doc-name" hint="Name of the document requested.">
              <Input
                id="v-doc-name"
                value={documentName}
                onChange={(e) => setDocumentName(e.target.value)}
                placeholder="e.g. Bachelor of Computer Applications"
              />
            </Field>

            <Field label="Requested Fields (comma-separated)" htmlFor="v-fields">
              <Input
                id="v-fields"
                className="font-mono text-xs"
                value={fieldsText}
                onChange={(e) => setFieldsText(e.target.value)}
              />
            </Field>

            <Field label="Verification Purpose" htmlFor="v-purpose">
              <Input
                id="v-purpose"
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                maxLength={300}
              />
            </Field>
          </div>

          <InlineError error={create.error} />

          <div className="mt-4 flex justify-end">
            <Button
              variant="primary"
              size="md"
              loading={create.pending}
              disabled={citizenId === ''}
              onClick={() => void handleCreate()}
              icon={<Send className="h-4 w-4" />}
            >
              Send Request
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Requests History */}
      <div className="space-y-2">
        {list.map((r) => (
          <Card key={r.id} className="p-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <p className="text-base font-semibold text-slate-800">
                  Request #{r.id} · {r.citizen.name} · {r.credentialTypeLabel}
                </p>
                <p className="text-sm text-slate-500">
                  “{r.purpose}” · fields: {r.requestedFields.join(', ')} · status:{' '}
                  <span className="font-semibold text-slate-700">
                    {r.usable ? 'usable' : r.used ? 'used' : 'expired'}
                  </span>{' '}
                  · consent: {r.consent?.status ?? '—'}
                </p>
                <div className="mt-1 flex items-center gap-2">
                  <TruncatedHash value={r.nonce} start={10} end={4} />
                  <span className="text-xs text-slate-400">{formatDateTime(r.createdAt)}</span>
                </div>
              </div>
              {r.presentation && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setPresentation(r.presentation!);
                    setResult(null);
                  }}
                >
                  Load Presentation
                </Button>
              )}
            </div>
          </Card>
        ))}
      </div>

      {/* Verify Presentation Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-blue-600" />
            <span>Verify SD-JWT Presentation</span>
          </CardTitle>
          <CardDescription>
            Executes all 9 real cryptographic checks: signature, trust registry, schema, disclosures, holder binding, nonce, audience, revocation, and consent.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Field label="Presentation Token (SD-JWT+KB)" htmlFor="org-pres">
            <textarea
              id="org-pres"
              className="w-full rounded-xl border border-slate-300 bg-white p-3 font-mono text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 h-28"
              value={presentation}
              onChange={(e) => setPresentation(e.target.value)}
              spellCheck={false}
              placeholder="eyJhbGciOi...~WyJ...~eyJhbGciOi..."
            />
          </Field>
          {preview && (
            <p className="mt-1 text-sm text-blue-600 font-medium">
              ✓ Detected {preview.disclosures.length} selective disclosure(s) in preview token.
            </p>
          )}
          <InlineError error={verify.error} />
          <div className="mt-4 flex justify-end">
            <Button
              variant="primary"
              size="md"
              loading={verify.pending}
              disabled={!presentation.trim()}
              onClick={() => void handleVerify()}
              icon={<CheckCircle2 className="h-4 w-4" />}
            >
              Verify Cryptographically
            </Button>
          </div>
        </CardContent>
      </Card>

      {result && <OrgVerifyResult result={result} />}
    </div>
  );
}

function OrgVerifyResult({ result }: { result: VerifyResponse }) {
  const granted = result.result === 'granted';
  const byId = new Map<CheckId, CheckResult>(result.checks.map((c) => [c.id, c]));

  return (
    <div className="space-y-4 pt-2">
      <div
        className={`rounded-2xl border p-5 ${
          granted
            ? 'border-emerald-300 bg-emerald-50/80 text-emerald-900'
            : 'border-rose-300 bg-rose-50/80 text-rose-900'
        }`}
      >
        <div className="flex items-center gap-3">
          {granted ? (
            <CheckCircle2 className="h-7 w-7 text-emerald-600 shrink-0" />
          ) : (
            <XCircle className="h-7 w-7 text-rose-600 shrink-0" />
          )}
          <div>
            <h2 className="text-xl font-bold">
              {granted ? 'Document Verified Successfully' : 'Verification Failed'}
            </h2>
            <p className="text-sm mt-0.5 opacity-90">
              {granted
                ? `${result.revealedFields.length} field(s) selectively disclosed. Remaining fields protected.`
                : 'Presentation rejected. Check failed verification tests below.'}
            </p>
          </div>
        </div>
        <p className="mt-3 text-xs opacity-75 font-mono">
          Verified at {formatDateTime(result.verifiedAt)}
        </p>
      </div>

      {granted && result.attachment && (
        <Card className="p-5 border-blue-200">
          <CardHeader className="px-0 pt-0 pb-3">
            <CardTitle className="text-base flex items-center gap-2 text-slate-900">
              <FileText className="h-5 w-5 text-blue-600" />
              <span>Verified Attached Document: {result.attachment.name}</span>
            </CardTitle>
            <CardDescription className="text-sm">
              Type: {result.attachment.mime} · Size: {(result.attachment.size / 1024).toFixed(1)} KB · Decrypted and verified with active student consent
            </CardDescription>
          </CardHeader>
          <div className="h-96 mt-2 rounded-xl border border-slate-200 overflow-hidden bg-slate-50">
            <FileViewer
              url={api.verifierAttachmentUrl(result.attachment.id)}
              fileName={result.attachment.name}
              mimeType={result.attachment.mime}
              fileSize={result.attachment.size}
            />
          </div>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Core Cryptographic Checks</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2.5 sm:grid-cols-2">
            {HEADLINE.map((id) => {
              const c = byId.get(id);
              if (!c) return null;
              return (
                <div
                  key={id}
                  className={`rounded-xl border p-3.5 flex items-start gap-2.5 ${
                    c.passed
                      ? 'border-emerald-200 bg-emerald-50/50'
                      : 'border-rose-200 bg-rose-50/50'
                  }`}
                >
                  {c.passed ? (
                    <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
                  ) : (
                    <XCircle className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" />
                  )}
                  <div>
                    <p className="text-sm font-bold text-slate-800">{c.label}</p>
                    <p className="text-xs text-slate-600 mt-0.5">{c.detail}</p>
                  </div>
                </div>
              );
            })}
          </div>

          <details className="mt-4 pt-3 border-t border-slate-100">
            <summary className="cursor-pointer text-sm font-semibold text-slate-600 hover:text-slate-900">
              View all {result.checks.length} verification checks
            </summary>
            <ul className="mt-2 space-y-1.5 pl-2">
              {result.checks.map((c) => (
                <li
                  key={c.id}
                  className={`text-sm flex items-center gap-1.5 ${
                    c.passed ? 'text-emerald-700' : 'text-rose-700'
                  }`}
                >
                  <span>{c.passed ? '✓' : '✕'}</span>
                  <span className="font-mono text-xs">{c.id}:</span>
                  <span>{c.detail}</span>
                </li>
              ))}
            </ul>
          </details>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            {granted ? 'Disclosed Fields (Student Consent)' : 'Disclosed Fields'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {granted && Object.keys(result.revealed).length > 0 ? (
            <KeyValueDisplay data={result.revealed} />
          ) : (
            <p className="text-sm text-slate-500">
              {granted ? 'No fields were disclosed.' : 'No data revealed due to check failure.'}
            </p>
          )}

          {granted && result.withheldFields.length > 0 && (
            <div className="mt-4 rounded-xl bg-slate-50 p-3.5 border border-slate-200/60 text-sm text-slate-600">
              <span className="font-semibold text-slate-700">Kept Private by Selective Disclosure:</span>{' '}
              {result.withheldFields.map(fieldLabel).join(', ')}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
