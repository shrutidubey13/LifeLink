/**
 * Citizen wallet — the modern sidebar design, wired to the real backend.
 *
 * All screens:
 *   - Dashboard (overview, stats, pending requests, recent credentials, activity)
 *   - Credentials (full list, stage badges, open documents)
 *   - Credential details (claims, status list bit, selective disclosure preview)
 *   - Add document (file validation: type, size <= 10MB, progress, preview)
 *   - Document review & verification pending
 *   - Sharing history (active & ended consents, verifications, confirm end dialog)
 *   - Audit log (tamper-evident hash chain, event payloads)
 *   - Settings (DID, API URL, logout)
 *   - Consent & Result screens
 */
import { useCallback, useMemo, useState } from 'react';
import {
  LayoutDashboard,
  Award,
  History,
  ShieldCheck,
  Settings,
  ArrowRight,
  CheckCircle2,
  XCircle,
  Clock,
  UploadCloud,
  FileText,
  FileCheck2,
  Trash2,
  Share2,
  Eye,
  GraduationCap,
  Briefcase,
  Landmark,
  Activity,
  Plus,
  RotateCcw,
  Paperclip,
} from 'lucide-react';
import { API_BASE, api } from './lib/api';
import { stashShare, useAuth } from './lib/auth';
import {
  EVENT_STYLES,
  fieldLabel,
  formatValue,
  stageForType,
} from './lib/catalog';
import { formatDate, formatDateTime, relativeTime } from './lib/format';
import { useAction, useRequest } from './lib/hooks';
import type {
  Consent,
  Credential,
  DocumentRequest,
  PresentationRequest,
  ShareResult,
} from './lib/types';
import { ConsentModal } from './components/ConsentModal';
import { FileViewer } from './components/FileViewer';
import { KeyValueDisplay } from './components/ClaimsEditor';
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
  InlineError,
  PageHeader,
  SkeletonList,
  StatusBadge,
  TruncatedHash,
  useToast,
} from './components/ui';
import { AppShell } from './components/AppShell';
import { useTitle } from './lib/useTitle';

type Screen =
  | 'dashboard'
  | 'credentials'
  | 'credential'
  | 'history'
  | 'audit'
  | 'settings'
  | 'addDocument'
  | 'documentReview'
  | 'verificationPending'
  | 'consent'
  | 'result';

type NavId = 'dashboard' | 'credentials' | 'history' | 'audit' | 'settings';

function navFor(screen: Screen): NavId {
  switch (screen) {
    case 'credentials':
    case 'credential':
      return 'credentials';
    case 'history':
      return 'history';
    case 'audit':
      return 'audit';
    case 'settings':
      return 'settings';
    default:
      return 'dashboard';
  }
}

function screenTitle(screen: Screen): string {
  switch (screen) {
    case 'dashboard':
      return 'Dashboard';
    case 'credentials':
      return 'My Credentials';
    case 'credential':
      return 'Credential Details';
    case 'history':
      return 'Sharing History';
    case 'audit':
      return 'Audit Log';
    case 'settings':
      return 'Settings';
    case 'addDocument':
      return 'Add Document';
    case 'documentReview':
      return 'Review Document';
    case 'verificationPending':
      return 'Verification Pending';
    case 'consent':
      return 'Review & Share';
    case 'result':
      return 'Presentation Shared';
    default:
      return 'Citizen Wallet';
  }
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function sha256Hex(file: File): Promise<string> {
  if (!globalThis.crypto?.subtle) return 'unavailable';
  const digest = await globalThis.crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

interface PickedFile {
  name: string;
  size: number;
  mime: string;
  hash: string;
}

interface DocDraft {
  documentName: string;
  organizationId: number | '';
  organizationName: string;
  purpose: string;
  file: PickedFile | null;
  rawFile: File | null;
}

const EMPTY_DRAFT: DocDraft = {
  documentName: '',
  organizationId: '',
  organizationName: '',
  purpose: 'Document Verification',
  file: null,
  rawFile: null,
};

function getStageIcon(type: string) {
  const stage = stageForType(type);
  switch (stage?.id) {
    case 'education':
      return <GraduationCap className="h-4 w-4 text-blue-600" />;
    case 'employment':
      return <Briefcase className="h-4 w-4 text-emerald-600" />;
    case 'finance':
      return <Landmark className="h-4 w-4 text-purple-600" />;
    case 'healthcare':
      return <Activity className="h-4 w-4 text-rose-600" />;
    default:
      return <FileText className="h-4 w-4 text-slate-500" />;
  }
}

export function CitizenApp() {
  const { user, logout } = useAuth();
  const citizenId = user?.id ?? 0;
  const { toast } = useToast();

  const [screen, setScreen] = useState<Screen>('dashboard');
  const [openCredentialId, setOpenCredentialId] = useState<number | null>(null);
  const [activeRequestId, setActiveRequestId] = useState<number | null>(null);
  const [draft, setDraft] = useState<DocDraft>(EMPTY_DRAFT);
  const [submitMessage, setSubmitMessage] = useState<string | null>(null);
  const [lastShare, setLastShare] = useState<ShareResult | null>(null);
  const [sharing, setSharing] = useState<Credential | null>(null);

  // Destructive confirm dialog states
  const [consentToEnd, setConsentToEnd] = useState<Consent | null>(null);
  const [requestToDeny, setRequestToDeny] = useState<PresentationRequest | null>(null);

  // Consent-screen choices
  const [pickedFields, setPickedFields] = useState<string[]>([]);
  const [pickedCredential, setPickedCredential] = useState<number | ''>('');
  const [shareAttachment, setShareAttachment] = useState(false);

  useTitle(screenTitle(screen));

  const wallet = useRequest(() => api.wallet(), `wallet-${citizenId}`);
  const incoming = useRequest(() => api.walletRequests(), `incoming-${citizenId}`);
  const documents = useRequest(() => api.myDocuments(), `documents-${citizenId}`);
  const consents = useRequest(() => api.consents(), `consents-${citizenId}`);
  const verifications = useRequest(() => api.verifications(), `verifications-${citizenId}`);
  const audit = useRequest(() => api.walletAudit(100), `audit-${citizenId}`);
  const verifiers = useRequest(() => api.verifiers(), 'verifiers');

  const approve = useAction(api.approveRequest);
  const reject = useAction(api.rejectRequest);
  const submitDoc = useAction(api.submitDocument);
  const endConsent = useAction(api.endConsent);

  const reloadAll = useCallback(() => {
    wallet.reload();
    incoming.reload();
    documents.reload();
    consents.reload();
    verifications.reload();
    audit.reload();
  }, [wallet, incoming, documents, consents, verifications, audit]);

  const credentials = wallet.data?.credentials ?? [];
  const pendingRequests = useMemo<PresentationRequest[]>(
    () =>
      (incoming.data?.requests ?? []).filter(
        (r) => r.usable && !r.consent?.hasPresentation && r.consent?.status !== 'REJECTED',
      ),
    [incoming.data],
  );
  const openDocuments = (documents.data?.documents ?? []).filter((d) => d.status !== 'APPROVED');
  const activeRequest = pendingRequests.find((r) => r.id === activeRequestId) ?? null;
  const openCredential = credentials.find((c) => c.id === openCredentialId) ?? null;

  function openRequest(req: PresentationRequest) {
    const matching = credentials.filter(
      (c) =>
        c.type === req.credentialType ||
        (c.claims?.documentName && String(c.claims.documentName).toLowerCase() === req.credentialType.toLowerCase()) ||
        req.credentialType === 'DocumentCredential' ||
        req.credentialTypeLabel === c.typeLabel,
    );
    const firstValid = matching.find((c) => c.status === 'valid') ?? (credentials.find((c) => c.status === 'valid') ?? credentials[0]);
    setActiveRequestId(req.id);
    setPickedFields([...req.requestedFields]);
    setPickedCredential(firstValid?.id ?? '');
    setShareAttachment(Boolean(firstValid?.attachmentId || firstValid?.attachment));
    approve.clearError();
    reject.clearError();
    setScreen('consent');
  }

  async function handleApprove() {
    if (!activeRequest || pickedCredential === '' || pickedFields.length === 0) return;
    const result = await approve.run(activeRequest.id, {
      credentialId: Number(pickedCredential),
      fields: pickedFields,
      shareAttachment,
    });
    if (result) {
      toast.success('Presentation generated and shared with selective disclosure!');
      stashShare({ presentation: result.presentation });
      setLastShare(result);
      setActiveRequestId(null);
      reloadAll();
      setScreen('result');
    }
  }

  async function confirmDenyAction() {
    if (!requestToDeny) return;
    const result = await reject.run(requestToDeny.id);
    if (result) {
      toast.info('Sharing request denied. No claims were disclosed.');
      setRequestToDeny(null);
      setActiveRequestId(null);
      reloadAll();
      setScreen('dashboard');
    }
  }

  async function handleSubmitDocument() {
    if (!draft.file || draft.organizationId === '') return;
    const formData = new FormData();
    formData.append('documentName', draft.documentName.trim() || draft.file.name);
    formData.append('organizationId', String(draft.organizationId));
    formData.append('purpose', draft.purpose.trim());
    if (draft.rawFile) {
      formData.append('file', draft.rawFile);
    }
    formData.append('documentRef', `sha256:${draft.file.hash}|name:${draft.file.name}|size:${draft.file.size}`);
    formData.append('mimeType', draft.file.mime || 'application/octet-stream');

    const result = await submitDoc.run(formData);
    if (result) {
      toast.success('Document submitted to organization for verification!');
      setSubmitMessage(result.message);
      reloadAll();
      setScreen('verificationPending');
    }
  }

  async function confirmEndConsentAction() {
    if (!consentToEnd) return;
    const result = await endConsent.run(consentToEnd.id);
    if (result) {
      toast.success('Sharing access ended. The verifier can no longer read this presentation.');
      setConsentToEnd(null);
      reloadAll();
    }
  }

  const walletName = user?.name ?? 'Citizen';
  const firstName = walletName.split(' ')[0];
  const did = user?.did ?? '';
  const validCount = wallet.data?.summary.valid ?? 0;

  const footerNotice = (
    <p>
      GitLink · W3C Verifiable Credentials (SD-JWT / Ed25519) · did:key &amp; did:web · W3C Bitstring
      Status List · Hash-chained audit log · API at <code className="font-mono">{API_BASE}</code>
    </p>
  );

  return (
    <AppShell
      roleTitle="Student Wallet"
      userName={walletName}
      userIdentifier={did || `GL-${citizenId}`}
      userRole="citizen"
      onLogout={logout}
      footerInfo={footerNotice}
      navItems={[
        {
          id: 'dashboard',
          label: 'Dashboard',
          icon: <LayoutDashboard className="h-5 w-5" />,
          badge: pendingRequests.length > 0 ? pendingRequests.length : undefined,
          active: navFor(screen) === 'dashboard',
          onClick: () => setScreen('dashboard'),
        },
        {
          id: 'credentials',
          label: 'My Credentials',
          icon: <Award className="h-5 w-5" />,
          badge: credentials.length > 0 ? credentials.length : undefined,
          active: navFor(screen) === 'credentials',
          onClick: () => setScreen('credentials'),
        },
        {
          id: 'history',
          label: 'Sharing History',
          icon: <History className="h-5 w-5" />,
          active: navFor(screen) === 'history',
          onClick: () => setScreen('history'),
        },
        {
          id: 'audit',
          label: 'Audit Log',
          icon: <ShieldCheck className="h-5 w-5" />,
          active: navFor(screen) === 'audit',
          onClick: () => setScreen('audit'),
        },
        {
          id: 'settings',
          label: 'Settings',
          icon: <Settings className="h-5 w-5" />,
          active: navFor(screen) === 'settings',
          onClick: () => setScreen('settings'),
        },
      ]}
    >
      {/* Loading state for initial wallet fetch */}
      {wallet.loading && !wallet.data && <SkeletonList count={3} />}
      {wallet.error && <ErrorBlock message={wallet.error} onRetry={wallet.reload} />}

      {wallet.data && screen === 'dashboard' && (
        <Dashboard
          firstName={firstName}
          walletName={walletName}
          did={did}
          credentials={credentials}
          validCount={validCount}
          pendingRequests={pendingRequests}
          auditError={audit.error}
          recent={audit.data?.entries.slice(0, 5) ?? []}
          onReview={openRequest}
          onAddDocument={() => {
            setDraft(EMPTY_DRAFT);
            submitDoc.clearError();
            setScreen('addDocument');
          }}
          onViewAll={() => setScreen('credentials')}
          onOpenCredential={(id) => {
            setOpenCredentialId(id);
            setScreen('credential');
          }}
        />
      )}

      {wallet.data && screen === 'credentials' && (
        <CredentialsScreen
          credentials={credentials}
          openDocuments={openDocuments}
          onOpen={(id) => {
            setOpenCredentialId(id);
            setScreen('credential');
          }}
          onAddDocument={() => {
            setDraft(EMPTY_DRAFT);
            submitDoc.clearError();
            setScreen('addDocument');
          }}
        />
      )}

      {wallet.data && screen === 'credential' && (
        <CredentialDetail
          credential={openCredential}
          onBack={() => setScreen('credentials')}
          onShare={(c) => setSharing(c)}
        />
      )}

      {screen === 'addDocument' && (
        <AddDocumentScreen
          draft={draft}
          setDraft={setDraft}
          onBack={() => setScreen('dashboard')}
          onContinue={() => setScreen('documentReview')}
        />
      )}

      {screen === 'documentReview' && (
        <DocumentReview
          draft={draft}
          pending={submitDoc.pending}
          error={submitDoc.error}
          onBack={() => setScreen('addDocument')}
          onSubmit={() => void handleSubmitDocument()}
        />
      )}

      {screen === 'verificationPending' && (
        <VerificationPending
          draft={draft}
          message={submitMessage}
          onDone={() => {
            setDraft(EMPTY_DRAFT);
            setScreen('credentials');
          }}
        />
      )}

      {screen === 'history' && (
        <HistoryScreen
          consents={consents.data?.consents ?? []}
          loading={consents.loading}
          error={consents.error}
          onRetry={consents.reload}
          verifications={verifications.data?.verifications ?? []}
          verificationSummary={verifications.data?.summary ?? null}
          endError={endConsent.error}
          ending={endConsent.pending}
          onEnd={(c) => setConsentToEnd(c)}
        />
      )}

      {screen === 'audit' && (
        <AuditScreen
          loading={audit.loading}
          error={audit.error}
          onRetry={audit.reload}
          data={audit.data}
        />
      )}

      {screen === 'settings' && (
        <SettingsScreen
          name={walletName}
          email={user?.email ?? null}
          did={did}
          onLogout={logout}
        />
      )}

      {screen === 'consent' && (
        <ConsentScreen
          request={activeRequest}
          credentials={credentials}
          pickedFields={pickedFields}
          setPickedFields={setPickedFields}
          pickedCredential={pickedCredential}
          setPickedCredential={setPickedCredential}
          shareAttachment={shareAttachment}
          setShareAttachment={setShareAttachment}
          pending={approve.pending || reject.pending}
          error={approve.error ?? reject.error}
          onBack={() => setScreen('dashboard')}
          onApprove={() => void handleApprove()}
          onDeny={() => setRequestToDeny(activeRequest)}
        />
      )}

      {screen === 'result' && (
        <ResultScreen
          result={lastShare}
          credential={credentials.find((c) => c.id === lastShare?.credential.id) ?? null}
          onDone={() => setScreen('dashboard')}
        />
      )}

      {/* Share / Consent Modal triggered from Credential Detail */}
      {sharing && (
        <ConsentModal
          credential={sharing}
          verifiers={verifiers.data?.verifiers ?? []}
          onClose={() => setSharing(null)}
          onApprove={(result) => {
            setSharing(null);
            stashShare({ presentation: result.presentation });
            setLastShare(result);
            reloadAll();
            setScreen('result');
          }}
        />
      )}

      {/* Confirm End Sharing Dialog */}
      {consentToEnd && (
        <ConfirmDialog
          isOpen
          title="End Sharing Session?"
          description={`Are you sure you want to end sharing with ${
            consentToEnd.verifier?.name ?? 'this organization'
          }? Their cryptographic access to your credential will be revoked immediately.`}
          confirmLabel="End Sharing"
          tone="danger"
          loading={endConsent.pending}
          onClose={() => setConsentToEnd(null)}
          onConfirm={confirmEndConsentAction}
        />
      )}

      {/* Confirm Deny Request Dialog */}
      {requestToDeny && (
        <ConfirmDialog
          isOpen
          title="Deny Verification Request?"
          description={`Are you sure you want to deny the request from ${requestToDeny.verifier.name}? They will not receive any disclosed claims.`}
          confirmLabel="Deny Request"
          tone="danger"
          loading={reject.pending}
          onClose={() => setRequestToDeny(null)}
          onConfirm={confirmDenyAction}
        />
      )}
    </AppShell>
  );
}

/* ------------------------------------------------------------------ */
/* dashboard                                                           */
/* ------------------------------------------------------------------ */

function Dashboard({
  firstName,
  walletName,
  did,
  credentials,
  validCount,
  pendingRequests,
  recent,
  auditError,
  onReview,
  onAddDocument,
  onViewAll,
  onOpenCredential,
}: {
  firstName: string;
  walletName: string;
  did: string;
  credentials: Credential[];
  validCount: number;
  pendingRequests: PresentationRequest[];
  recent: { id: number; eventType: string; createdAt: string }[];
  auditError: string | null;
  onReview: (req: PresentationRequest) => void;
  onAddDocument: () => void;
  onViewAll: () => void;
  onOpenCredential: (id: number) => void;
}) {
  return (
    <div className="space-y-6 sm:space-y-8">
      {/* Greeting Header */}
      <div>
        <p className="text-xs font-bold uppercase tracking-wider text-blue-600">
          Citizen Identity Wallet
        </p>
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 mt-1">
          {greeting()}, {firstName}
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Manage, store, and selectively disclose your verified life records.
        </p>
      </div>

      {/* Wallet Identity Card */}
      <div className="rounded-3xl bg-gradient-to-br from-blue-700 via-blue-800 to-indigo-900 p-6 sm:p-8 text-white shadow-xl relative overflow-hidden">
        <div className="absolute -top-12 -right-12 w-48 h-48 rounded-full bg-blue-500/20 blur-2xl pointer-events-none" />

        <div className="relative z-10 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-blue-200">
                GitLink Decentralized Identity
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-300 border border-emerald-400/30">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Active
              </span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-bold text-white mt-2">{walletName}</h2>
            <div className="mt-2">
              <TruncatedHash value={did} start={14} end={8} />
            </div>
          </div>
        </div>

        <div className="relative z-10 mt-6 pt-6 border-t border-white/15 grid grid-cols-3 gap-3 text-center sm:text-left">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-blue-200">
              Verified Credentials
            </p>
            <p className="text-2xl font-bold text-white mt-1">{validCount}</p>
          </div>
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-blue-200">
              Pending Requests
            </p>
            <p className="text-2xl font-bold text-white mt-1">{pendingRequests.length}</p>
          </div>
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-blue-200">
              Identity Status
            </p>
            <p className="text-base sm:text-xl font-bold text-emerald-300 mt-1">
              {validCount > 0 ? 'Verified' : 'Initial'}
            </p>
          </div>
        </div>
      </div>

      {/* Action Required: Incoming Sharing Requests */}
      {pendingRequests.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Clock className="h-5 w-5 text-amber-500" />
              <span>Pending Sharing Requests</span>
            </h2>
            <Badge tone="pending">{pendingRequests.length} Action Required</Badge>
          </div>

          <div className="space-y-3">
            {pendingRequests.map((req) => (
              <Card key={req.id} className="border-amber-200 bg-amber-50/20 p-5">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-slate-900">
                        {req.verifier.name}
                      </span>
                      <Badge tone="info">{req.credentialTypeLabel}</Badge>
                      <Badge tone="pending">Pending Consent</Badge>
                    </div>
                    <p className="text-xs text-slate-600">
                      Purpose: “{req.purpose}” · Request expires {relativeTime(req.expiresAt)}
                    </p>
                    <div className="mt-3 rounded-xl bg-white p-3 border border-slate-200/80">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                        Requested Claims
                      </p>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {req.requestedFields.map((f) => (
                          <Badge key={f} tone="info">
                            ✓ {fieldLabel(f)}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="shrink-0 pt-2 sm:pt-0">
                    <Button
                      variant="primary"
                      size="sm"
                      iconRight={<ArrowRight className="h-4 w-4" />}
                      onClick={() => onReview(req)}
                    >
                      Review &amp; Share
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Add Document Banner */}
      <div className="rounded-2xl border border-dashed border-blue-300 bg-blue-50/40 p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <span className="text-[11px] font-bold uppercase tracking-wider text-blue-700">
            Submit Document
          </span>
          <h3 className="text-lg font-bold text-slate-900 mt-0.5">
            Add a document for official verification
          </h3>
          <p className="text-xs text-slate-600 mt-1 max-w-xl">
            Upload your degree certificate, employment contract, or bank KYC document. The issuing
            organization verifies it and signs an official credential into your wallet.
          </p>
        </div>
        <Button
          variant="primary"
          size="md"
          icon={<Plus className="h-4 w-4" />}
          onClick={onAddDocument}
          className="shrink-0 self-start sm:self-center"
        >
          Add Document
        </Button>
      </div>

      {/* Credentials Overview */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <Award className="h-5 w-5 text-blue-600" />
            <span>Your Credentials</span>
          </h2>
          {credentials.length > 0 && (
            <button
              type="button"
              onClick={onViewAll}
              className="text-xs font-semibold text-blue-600 hover:text-blue-800 transition-colors"
            >
              View all ({credentials.length}) →
            </button>
          )}
        </div>

        {credentials.length === 0 ? (
          <EmptyState
            icon={<Award className="h-6 w-6" />}
            title="Your wallet is empty"
            description="You don't have any verified credentials yet. Submit a document to an eligible organization to get your first credential."
            action={
              <Button variant="secondary" size="sm" onClick={onAddDocument}>
                Submit First Document
              </Button>
            }
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {credentials.slice(0, 4).map((c) => (
              <CredentialTile
                key={c.id}
                credential={c}
                onOpen={() => onOpenCredential(c.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Recent Activity */}
      <div className="space-y-3">
        <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-blue-600" />
          <span>Recent Activity</span>
        </h2>

        {auditError && <ErrorBlock message={auditError} />}
        {!auditError && recent.length === 0 && (
          <Card>
            <p className="text-xs text-slate-500">No cryptographic activity recorded yet.</p>
          </Card>
        )}

        {recent.length > 0 && (
          <Card className="p-0 overflow-hidden divide-y divide-slate-100">
            {recent.map((entry) => {
              const style = EVENT_STYLES[entry.eventType];
              return (
                <div key={entry.id} className="p-3.5 sm:p-4 flex items-center gap-3">
                  <div className="h-8 w-8 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                    <CheckCircle2 className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-slate-800 truncate">
                      {style?.label ?? entry.eventType}
                    </p>
                    <p className="text-[10px] text-slate-400 font-mono">
                      Event #{entry.id}
                    </p>
                  </div>
                  <span className="text-xs text-slate-400 shrink-0">
                    {relativeTime(entry.createdAt)}
                  </span>
                </div>
              );
            })}
          </Card>
        )}
      </div>
    </div>
  );
}

function CredentialTile({
  credential,
  onOpen,
}: {
  credential: Credential;
  onOpen: () => void;
}) {
  return (
    <Card
      className="cursor-pointer hover:border-blue-400 hover:shadow-md transition-all p-5 flex flex-col justify-between"
      onClick={onOpen}
    >
      <div>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-slate-100 text-slate-700">
              {getStageIcon(credential.type)}
            </div>
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                {stageForType(credential.type)?.label ?? 'Credential'}
              </span>
              <h3 className="text-base font-bold text-slate-900 leading-snug">
                {credential.typeLabel}
              </h3>
            </div>
          </div>
          <StatusBadge status={credential.status} />
        </div>
        <p className="text-xs text-slate-500 mt-3">
          Issuer: <strong className="text-slate-700">{credential.issuer.name}</strong>
        </p>
      </div>

      <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
        <span className="text-slate-400 font-medium">Issued {formatDate(credential.issuedAt)}</span>
        <span className="text-blue-600 font-semibold inline-flex items-center gap-1">
          <span>View Details</span>
          <ArrowRight className="h-3 w-3" />
        </span>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* credentials list                                                   */
/* ------------------------------------------------------------------ */

function CredentialsScreen({
  credentials,
  openDocuments,
  onOpen,
  onAddDocument,
}: {
  credentials: Credential[];
  openDocuments: DocumentRequest[];
  onOpen: (id: number) => void;
  onAddDocument: () => void;
}) {
  return (
    <div className="space-y-6">
      <PageHeader
        title="My Credentials"
        subtitle="All verifiable credentials cryptographically stored in your GitLink wallet."
        badge={<Badge tone="neutral">{credentials.length} Total</Badge>}
        actions={
          <Button
            variant="primary"
            size="sm"
            icon={<Plus className="h-4 w-4" />}
            onClick={onAddDocument}
          >
            Add Document
          </Button>
        }
      />

      {credentials.length === 0 && openDocuments.length === 0 && (
        <EmptyState
          icon={<Award className="h-6 w-6" />}
          title="No credentials or documents"
          description="Your wallet is currently empty. Submit a document to an issuing organization to get started."
          action={
            <Button variant="primary" size="sm" onClick={onAddDocument}>
              Submit Document
            </Button>
          }
        />
      )}

      {/* Verified Credentials */}
      {credentials.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {credentials.map((c) => (
            <CredentialTile key={c.id} credential={c} onOpen={() => onOpen(c.id)} />
          ))}
        </div>
      )}

      {/* Submitted Documents Pending / Rejected */}
      {openDocuments.length > 0 && (
        <div className="space-y-3 pt-6 border-t border-slate-200">
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <FileText className="h-5 w-5 text-blue-600" />
            <span>Document Submissions ({openDocuments.length})</span>
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {openDocuments.map((d) => (
              <Card
                key={`doc-${d.id}`}
                className={
                  d.status === 'REJECTED'
                    ? 'border-rose-200 bg-rose-50/20'
                    : 'border-amber-200 bg-amber-50/20'
                }
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      {d.documentType}
                    </span>
                    <h3 className="text-base font-bold text-slate-900 mt-0.5">
                      {d.documentName}
                    </h3>
                    <p className="text-xs text-slate-500 mt-1">
                      Submitted to {d.organization?.name ?? `Organization #${d.organizationId}`}
                    </p>
                  </div>
                  <Badge tone={d.status === 'REJECTED' ? 'danger' : 'pending'}>
                    {d.status === 'REJECTED' ? 'Rejected' : 'Pending Verification'}
                  </Badge>
                </div>

                {d.status === 'REJECTED' && d.rejectionReason && (
                  <div className="mt-3 rounded-lg bg-rose-50 p-2.5 text-xs text-rose-800 border border-rose-200">
                    <strong>Rejection reason:</strong> {d.rejectionReason}
                  </div>
                )}

                <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-400">
                  <span>Submitted {formatDateTime(d.createdAt)}</span>
                  <TruncatedHash value={d.documentRef} start={8} end={6} />
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* credential details                                                 */
/* ------------------------------------------------------------------ */

function CredentialDetail({
  credential,
  onBack,
  onShare,
}: {
  credential: Credential | null;
  onBack: () => void;
  onShare: (c: Credential) => void;
}) {
  if (!credential) {
    return (
      <div>
        <PageHeader title="Credential Details" backButton={{ label: 'Back to Credentials', onClick: onBack }} />
        <EmptyState title="Credential not found" description="That credential is no longer available in your wallet." />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={credential.typeLabel}
        subtitle={`Issued by ${credential.issuer.name}`}
        backButton={{ label: 'Back to Credentials', onClick: onBack }}
        badge={<StatusBadge status={credential.status} />}
        actions={
          credential.status === 'valid' ? (
            <Button
              variant="primary"
              size="sm"
              icon={<Share2 className="h-4 w-4" />}
              onClick={() => onShare(credential)}
            >
              Share with Verifier
            </Button>
          ) : undefined
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Metadata & Claims */}
        <div className="lg:col-span-8 space-y-6">
          {credential.attachment && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2 text-slate-900">
                  <FileText className="h-5 w-5 text-blue-600" />
                  <span>Attached File: {credential.attachment.name}</span>
                </CardTitle>
                <CardDescription className="text-sm">
                  {credential.attachment.mime} · {(credential.attachment.size / 1024).toFixed(1)} KB · Stored encrypted at rest with AES-256-GCM
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-96 rounded-xl border border-slate-200 overflow-hidden bg-slate-50">
                  <FileViewer
                    url={api.walletAttachmentUrl(credential.attachment.id)}
                    fileName={credential.attachment.name}
                    mimeType={credential.attachment.mime}
                    fileSize={credential.attachment.size}
                  />
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Verified Claims</CardTitle>
              <CardDescription>
                Cryptographically bound data signed by {credential.issuer.name}.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="divide-y divide-slate-100">
                {Object.entries(credential.claims).map(([key, value]) => (
                  <div key={key} className="flex justify-between py-2.5 text-base">
                    <dt className="text-slate-500 font-medium">{fieldLabel(key)}</dt>
                    <dd className="font-semibold text-slate-900 break-all text-right">{formatValue(value)}</dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>W3C Cryptographic Proof Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex justify-between py-1.5 border-b border-slate-100">
                <span className="text-slate-500 font-medium">Credential ID</span>
                <span className="font-mono text-slate-800">GL-CRED-{credential.id}</span>
              </div>
              {credential.attachment && (
                <div className="flex justify-between py-1.5 border-b border-slate-100">
                  <span className="text-slate-500 font-medium">Attached File</span>
                  <span className="font-mono text-slate-800 text-xs">
                    {credential.attachment.name} ({(credential.attachment.size / 1024).toFixed(1)} KB, {credential.attachment.mime})
                  </span>
                </div>
              )}
              <div className="flex justify-between py-1.5 border-b border-slate-100">
                <span className="text-slate-500 font-medium">Issued Date</span>
                <span className="text-slate-800 font-medium">{formatDate(credential.issuedAt)}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-slate-100">
                <span className="text-slate-500 font-medium">Expiration Date</span>
                <span className="text-slate-800 font-medium">{formatDate(credential.expiresAt)}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-slate-100">
                <span className="text-slate-500 font-medium">Status Bit Index</span>
                <span className="font-mono text-slate-800">Bit #{credential.statusIndex}</span>
              </div>
              <div className="flex justify-between py-1.5">
                <span className="text-slate-500 font-medium">Issuer DID</span>
                <TruncatedHash value={credential.issuer.did} start={14} end={8} />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right: Security & Trust Card */}
        <div className="lg:col-span-4 space-y-6">
          <Card className="border-blue-100 bg-blue-50/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-blue-900">
                <ShieldCheck className="h-5 w-5 text-blue-600" />
                <span>Issuer Trust Status</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-xs text-slate-600">
              <p>
                {credential.issuer.trusted ? (
                  <span className="text-emerald-700 font-medium flex items-center gap-1.5">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                    Issuer is verified in the GitLink Trust Registry.
                  </span>
                ) : (
                  <span className="text-amber-700 font-medium flex items-center gap-1.5">
                    <XCircle className="h-4 w-4 text-amber-600 shrink-0" />
                    Issuer status is unverified or pending.
                  </span>
                )}
              </p>
              <p className="leading-relaxed">
                When you share this credential with a relying party (e.g., employer or bank), they
                will verify the signature and trust registry directly without contacting the issuer.
              </p>
              {credential.status === 'valid' && (
                <div className="pt-2">
                  <Button
                    variant="primary"
                    size="sm"
                    fullWidth
                    icon={<Share2 className="h-4 w-4" />}
                    onClick={() => onShare(credential)}
                  >
                    Share Credential
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* add document with validation (Task 5)                              */
/* ------------------------------------------------------------------ */

const ALLOWED_MIMES = ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg'];
const ALLOWED_EXTS = ['.pdf', '.png', '.jpg', '.jpeg'];
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

function AddDocumentScreen({
  draft,
  setDraft,
  onBack,
  onContinue,
}: {
  draft: DocDraft;
  setDraft: (next: DocDraft) => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  const [reading, setReading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [fileError, setFileError] = useState<string | null>(null);

  // Fetch all organizations that can issue (no fixed type restriction)
  const orgs = useRequest(() => api.organizations(), 'eligible-orgs');

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setFileError(null);

    // 1. File Type validation (pdf, png, jpg)
    const ext = '.' + file.name.split('.').pop()?.toLowerCase();
    const isAllowedExt = ALLOWED_EXTS.includes(ext);
    const isAllowedMime = ALLOWED_MIMES.includes(file.type);

    if (!isAllowedExt && !isAllowedMime) {
      setFileError('Invalid file type. Only PDF, PNG, and JPG files are supported.');
      return;
    }

    // 2. File Size validation (max 10 MB)
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setFileError(
        `File size (${formatBytes(file.size)}) exceeds the maximum allowed limit of 10 MB.`,
      );
      return;
    }

    // 3. Show reading / hashing progress
    setReading(true);
    setUploadProgress(20);

    try {
      const step1 = setTimeout(() => setUploadProgress(65), 150);
      const hash = await sha256Hex(file);
      clearTimeout(step1);
      setUploadProgress(100);

      setTimeout(() => {
        setDraft({
          ...draft,
          documentName: draft.documentName || file.name.replace(/\.[^/.]+$/, ''),
          rawFile: file,
          file: {
            name: file.name,
            size: file.size,
            mime: file.type || (ext === '.pdf' ? 'application/pdf' : 'image/jpeg'),
            hash,
          },
        });
        setReading(false);
        setUploadProgress(0);
      }, 250);
    } catch {
      setFileError('Could not process this file. Please try another one.');
      setReading(false);
      setUploadProgress(0);
    }
  }

  const ready =
    Boolean(draft.file) &&
    draft.documentName.trim().length > 0 &&
    draft.organizationId !== '' &&
    draft.purpose.trim().length >= 3;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Add Document"
        subtitle="Upload a document to request cryptographic verification and document issuance."
        backButton={{ label: 'Back to Dashboard', onClick: onBack }}
      />

      <Card className="max-w-2xl">
        <CardContent className="space-y-5 pt-2">
          {/* Document Name */}
          <div>
            <label className="text-sm font-semibold uppercase tracking-wider text-slate-600 block mb-1.5" htmlFor="doc-name">
              Document Name
            </label>
            <input
              id="doc-name"
              type="text"
              value={draft.documentName}
              onChange={(e) => setDraft({ ...draft, documentName: e.target.value })}
              className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-base text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="e.g. Bachelor of Computer Applications, Degree Certificate, Employment Letter"
            />
            <p className="text-xs text-slate-500 mt-1">Enter the official title of the document.</p>
          </div>

          {/* Issuing Organization */}
          <div>
            <label className="text-sm font-semibold uppercase tracking-wider text-slate-600 block mb-1.5" htmlFor="doc-org">
              Issuing Organization
            </label>
            <select
              id="doc-org"
              value={draft.organizationId}
              disabled={orgs.loading}
              onChange={(e) => {
                const id = e.target.value === '' ? '' : Number(e.target.value);
                const org = orgs.data?.organizations.find((o) => o.id === id);
                setDraft({ ...draft, organizationId: id, organizationName: org?.name ?? '' });
              }}
              className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-base text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">
                {orgs.loading ? 'Loading trusted organizations…' : 'Choose eligible organization…'}
              </option>
              {(orgs.data?.organizations ?? []).map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name} ({o.orgType ?? 'Organization'})
                </option>
              ))}
            </select>
            {orgs.error && <p className="text-xs text-rose-600 mt-1">{orgs.error}</p>}
          </div>

          {/* File Upload Zone */}
          <div>
            <label className="text-sm font-semibold uppercase tracking-wider text-slate-600 block mb-1.5" htmlFor="doc-file">
              Upload Document File
            </label>

            {!draft.file ? (
              <div className="rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50/60 p-6 text-center hover:bg-slate-50 transition-colors">
                <UploadCloud className="h-8 w-8 text-blue-600 mx-auto mb-2" />
                <p className="text-sm font-semibold text-slate-700">
                  Select a document file to verify
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  Supported formats: PDF, PNG, JPG (maximum size 10 MB)
                </p>
                <div className="mt-3">
                  <input
                    id="doc-file"
                    type="file"
                    accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
                    onChange={(e) => void handleFile(e.target.files?.[0])}
                    className="block w-full text-sm text-slate-500 file:mr-4 file:py-2.5 file:px-4 file:rounded-xl file:border-0 file:text-sm file:font-semibold file:bg-blue-600 file:text-white hover:file:bg-blue-700 cursor-pointer"
                  />
                </div>

                {reading && (
                  <div className="mt-4 space-y-1.5">
                    <div className="flex justify-between text-xs text-slate-600">
                      <span>Computing SHA-256 fingerprint…</span>
                      <span>{uploadProgress}%</span>
                    </div>
                    <div className="h-1.5 w-full bg-slate-200 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-600 transition-all duration-200 rounded-full"
                        style={{ width: `${uploadProgress}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            ) : (
              /* Rich File Preview Card */
              <div className="rounded-2xl border border-blue-200 bg-blue-50/50 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="p-2.5 rounded-xl bg-blue-600 text-white shrink-0 mt-0.5">
                      <FileCheck2 className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-bold uppercase tracking-wider text-blue-700">
                        Selected Document Preview
                      </p>
                      <p className="text-base font-bold text-slate-900 truncate mt-0.5">
                        {draft.file.name}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                        <Badge tone="info" size="sm">
                          {draft.file.mime.includes('pdf') ? 'PDF' : 'IMAGE'}
                        </Badge>
                        <span>{formatBytes(draft.file.size)}</span>
                        <span>·</span>
                        <span>{draft.file.mime}</span>
                      </div>
                      <div className="mt-2 text-xs">
                        <span className="text-slate-500 font-semibold mr-1">SHA-256:</span>
                        <TruncatedHash value={draft.file.hash} start={12} end={8} />
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setDraft({ ...draft, file: null, rawFile: null })}
                    className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                    aria-label="Remove file"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}

            {fileError && <p className="text-xs text-rose-600 mt-2 font-medium">{fileError}</p>}
          </div>

          {/* Verification Purpose */}
          <div>
            <label className="text-sm font-semibold uppercase tracking-wider text-slate-600 block mb-1.5" htmlFor="doc-purpose">
              Purpose / Notes for Reviewer
            </label>
            <input
              id="doc-purpose"
              type="text"
              value={draft.purpose}
              maxLength={500}
              onChange={(e) => setDraft({ ...draft, purpose: e.target.value })}
              className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-base text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="e.g. Official verification for education / employment record"
            />
          </div>

          {/* Security notice */}
          <div className="rounded-xl bg-slate-50 p-4 border border-slate-200/80 text-xs text-slate-600 leading-relaxed">
            <span className="font-semibold text-slate-800 block mb-0.5">
              Privacy Notice:
            </span>
            GitLink encrypts and stores your document file at rest with AES-256-GCM so only authorized
            organizations you consent to can view it.
          </div>

          <div className="pt-2 flex justify-end">
            <Button
              variant="primary"
              size="md"
              disabled={!ready || reading}
              onClick={onContinue}
              iconRight={<ArrowRight className="h-4 w-4" />}
            >
              Continue to Review
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function DocumentReview({
  draft,
  pending,
  error,
  onBack,
  onSubmit,
}: {
  draft: DocDraft;
  pending: boolean;
  error: string | null;
  onBack: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Review Document Submission"
        subtitle="Confirm details before sending to the issuing organization."
        backButton={{ label: 'Back to Edit', onClick: onBack }}
      />

      <Card className="max-w-2xl">
        <CardContent className="space-y-4 pt-2">
          <div className="rounded-xl bg-blue-50 p-4 border border-blue-200">
            <span className="text-xs font-bold uppercase tracking-wider text-blue-700">
              Document Name
            </span>
            <p className="text-xl font-bold text-slate-900 mt-1">{draft.documentName}</p>
          </div>

          <dl className="divide-y divide-slate-100 text-sm">
            <div className="flex justify-between py-2.5">
              <dt className="text-slate-500 font-medium">Target Organization</dt>
              <dd className="font-semibold text-slate-800">
                {draft.organizationName || `Org #${draft.organizationId}`}
              </dd>
            </div>
            <div className="flex justify-between py-2.5">
              <dt className="text-slate-500 font-medium">File Name</dt>
              <dd className="font-semibold text-slate-800 break-all">{draft.file?.name}</dd>
            </div>
            <div className="flex justify-between py-2.5">
              <dt className="text-slate-500 font-medium">File Size</dt>
              <dd className="font-semibold text-slate-800">
                {draft.file ? formatBytes(draft.file.size) : '—'}
              </dd>
            </div>
            <div className="flex justify-between py-2.5">
              <dt className="text-slate-500 font-medium">File Type</dt>
              <dd className="font-semibold text-slate-800 font-mono text-xs">
                {draft.file?.mime}
              </dd>
            </div>
            <div className="flex justify-between py-2.5">
              <dt className="text-slate-500 font-medium">Purpose</dt>
              <dd className="font-semibold text-slate-800">{draft.purpose}</dd>
            </div>
          </dl>

          <div className="rounded-xl bg-amber-50 p-4 border border-amber-200 text-xs text-amber-800 leading-relaxed">
            <span className="font-semibold block mb-0.5">Verification Required:</span>
            Submitting this document queues it for review by {draft.organizationName}. A verifiable
            document will be issued into your wallet upon approval.
          </div>

          <InlineError error={error} />

          <div className="pt-2 flex justify-end gap-3">
            <Button variant="secondary" size="md" onClick={onBack} disabled={pending}>
              Back
            </Button>
            <Button
              variant="primary"
              size="md"
              loading={pending}
              onClick={onSubmit}
              iconRight={<ArrowRight className="h-4 w-4" />}
            >
              Submit for Verification
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function VerificationPending({
  draft,
  message,
  onDone,
}: {
  draft: DocDraft;
  message: string | null;
  onDone: () => void;
}) {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Verification Submitted"
        subtitle="Your document has been sent to the issuing organization."
      />

      <Card className="max-w-2xl">
        <CardContent className="space-y-5 pt-2">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center font-bold">
              <Clock className="h-5 w-5" />
            </div>
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                Submission Status
              </span>
              <h2 className="text-xl font-bold text-amber-600">Pending Review</h2>
            </div>
          </div>

          <div className="rounded-xl bg-slate-50 p-4 border border-slate-200 text-sm space-y-2">
            <div className="flex justify-between">
              <span className="text-slate-500 font-medium">Document:</span>
              <span className="font-semibold text-slate-800">{draft.documentName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500 font-medium">File:</span>
              <span className="font-semibold text-slate-800 break-all">{draft.file?.name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500 font-medium">Organization:</span>
              <span className="font-semibold text-slate-800">{draft.organizationName}</span>
            </div>
          </div>

          <div className="rounded-xl bg-blue-50 p-4 border border-blue-200 text-xs text-blue-900 leading-relaxed">
            <span className="font-semibold block mb-0.5">What happens next?</span>
            {message ??
              'The organization will inspect your document against official records. When approved, a signed document appears automatically in your wallet.'}
          </div>

          <div className="pt-2 flex justify-end">
            <Button variant="primary" size="md" onClick={onDone}>
              View My Documents
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* consent screen                                                     */
/* ------------------------------------------------------------------ */

function ConsentScreen({
  request,
  credentials,
  pickedFields,
  setPickedFields,
  pickedCredential,
  setPickedCredential,
  shareAttachment,
  setShareAttachment,
  pending,
  error,
  onBack,
  onApprove,
  onDeny,
}: {
  request: PresentationRequest | null;
  credentials: Credential[];
  pickedFields: string[];
  setPickedFields: (fields: string[]) => void;
  pickedCredential: number | '';
  setPickedCredential: (id: number | '') => void;
  shareAttachment: boolean;
  setShareAttachment: (val: boolean) => void;
  pending: boolean;
  error: string | null;
  onBack: () => void;
  onApprove: () => void;
  onDeny: () => void;
}) {
  if (!request) {
    return (
      <div>
        <PageHeader title="Verification Request" backButton={{ label: 'Back to Dashboard', onClick: onBack }} />
        <EmptyState title="Request not found" description="This verification request is no longer active." />
      </div>
    );
  }

  const matching = credentials.filter(
    (c) =>
      c.type === request.credentialType ||
      (c.claims?.documentName && String(c.claims.documentName).toLowerCase() === request.credentialType.toLowerCase()) ||
      request.credentialType === 'DocumentCredential' ||
      request.credentialTypeLabel === c.typeLabel,
  );
  const eligibleCredentials = matching.length > 0 ? matching : credentials;
  const chosen = credentials.find((c) => c.id === pickedCredential);
  const staysPrivate = chosen
    ? Object.keys(chosen.claims).filter((k) => !pickedFields.includes(k))
    : [];

  function toggleField(field: string) {
    setPickedFields(
      pickedFields.includes(field)
        ? pickedFields.filter((f) => f !== field)
        : [...pickedFields, field],
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Selective Disclosure Consent"
        subtitle={`Review what ${request.verifier.name} is requesting.`}
        backButton={{ label: 'Back to Dashboard', onClick: onBack }}
      />

      <Card className="max-w-2xl">
        <CardContent className="space-y-5 pt-2">
          <div className="rounded-xl bg-slate-50 p-4 border border-slate-200">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Requesting Organization
            </span>
            <h3 className="text-xl font-bold text-slate-900 mt-0.5">
              {request.verifier.name}
            </h3>
            <p className="text-sm text-slate-600 mt-1">
              Purpose: “{request.purpose}” · Request expires {relativeTime(request.expiresAt)}
            </p>
          </div>

          {/* Credential Selector */}
          <div>
            <label className="text-sm font-semibold uppercase tracking-wider text-slate-600 block mb-1.5" htmlFor="use-cred">
              Select Source Document
            </label>
            <select
              id="use-cred"
              value={pickedCredential}
              onChange={(e) => {
                const id = e.target.value === '' ? '' : Number(e.target.value);
                setPickedCredential(id);
                const chosenDoc = credentials.find((c) => c.id === id);
                setShareAttachment(Boolean(chosenDoc?.attachment || chosenDoc?.attachmentId));
              }}
              className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-base text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Choose a document…</option>
              {eligibleCredentials.map((c) => (
                <option key={c.id} value={c.id} disabled={c.status !== 'valid'}>
                  {String(c.claims?.documentName || c.typeLabel)} · {c.issuer.name} ({c.status})
                </option>
              ))}
            </select>
          </div>

          {/* Selective Disclosure Pick List */}
          <div className="rounded-2xl border border-blue-200 bg-blue-50/40 p-4 sm:p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-bold text-blue-900">
                Choose fields to selectively disclose
              </span>
              <span className="text-sm text-blue-700 font-medium">
                {pickedFields.length} of {request.requestedFields.length} selected
              </span>
            </div>

            <div className="space-y-2">
              {request.requestedFields.map((f) => {
                const checked = pickedFields.includes(f);
                return (
                  <label
                    key={f}
                    className={`flex items-center justify-between p-3.5 rounded-xl border cursor-pointer transition-colors ${
                      checked
                        ? 'border-blue-300 bg-white shadow-xs'
                        : 'border-slate-200 bg-white/70 hover:bg-white'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleField(f)}
                        className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="text-base font-semibold text-slate-800">
                        {fieldLabel(f)}
                      </span>
                    </div>

                    {chosen && checked && (
                      <span className="text-sm font-mono text-slate-600 bg-slate-100 px-2 py-0.5 rounded">
                        {formatValue(chosen.claims[f])}
                      </span>
                    )}
                  </label>
                );
              })}
            </div>

            {staysPrivate.length > 0 && (
              <p className="mt-3 text-sm text-blue-700">
                <strong>Stays mathematically hidden:</strong> {staysPrivate.map(fieldLabel).join(', ')}
              </p>
            )}
          </div>

          {/* Optional Attached File Sharing Checkbox */}
          {chosen && (chosen.attachment || chosen.attachmentId) && (
            <div className="p-4 rounded-xl border border-blue-200 bg-blue-50/70">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={shareAttachment}
                  onChange={(e) => setShareAttachment(e.target.checked)}
                  className="h-5 w-5 mt-0.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <div>
                  <span className="text-base font-semibold text-slate-800 flex items-center gap-1.5">
                    <Paperclip className="h-4 w-4 text-blue-600" />
                    Share attached file {chosen.attachment ? `(${chosen.attachment.name})` : ''}
                  </span>
                  {chosen.attachment && (
                    <span className="block text-sm text-slate-600 font-mono mt-0.5">
                      {(chosen.attachment.size / 1024).toFixed(1)} KB · {chosen.attachment.mime}
                    </span>
                  )}
                  <span className="text-xs text-slate-500 block mt-1">
                    If ticked, the verifier will be granted temporary cryptographic access to inspect this original file while your consent remains active.
                  </span>
                </div>
              </label>
            </div>
          )}

          <InlineError error={error} />

          <div className="pt-2 flex justify-end gap-3">
            <Button
              variant="danger-outline"
              size="md"
              disabled={pending}
              onClick={onDeny}
            >
              Deny Request
            </Button>
            <Button
              variant="primary"
              size="md"
              loading={pending}
              disabled={pickedCredential === '' || pickedFields.length === 0}
              onClick={onApprove}
            >
              Approve &amp; Disclose ({pickedFields.length})
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* result screen                                                      */
/* ------------------------------------------------------------------ */

function ResultScreen({
  result,
  credential,
  onDone,
}: {
  result: ShareResult | null;
  credential: Credential | null;
  onDone: () => void;
}) {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Presentation Shared"
        subtitle="Your cryptographic presentation was created and verified."
      />

      <Card className="max-w-2xl">
        <CardContent className="space-y-5 pt-2">
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50/80 p-5 text-emerald-900">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-7 w-7 text-emerald-600 shrink-0" />
              <div>
                <h2 className="text-lg font-bold">Successfully Shared with Verifier</h2>
                <p className="text-xs opacity-90 mt-0.5">
                  Only the claims you consented to were included. All other fields were excluded.
                </p>
              </div>
            </div>
          </div>

          {result && (
            <div className="space-y-3">
              <div className="rounded-xl bg-slate-50 p-4 border border-slate-200 text-xs space-y-2">
                <div className="flex justify-between">
                  <span className="text-slate-500 font-medium">Verifier:</span>
                  <span className="font-semibold text-slate-800">{result.verifier.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 font-medium">Credential:</span>
                  <span className="font-semibold text-slate-800">
                    {credential?.typeLabel ?? 'Credential'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 font-medium">Consent Record:</span>
                  <span className="font-mono text-slate-800">#{result.consent.id}</span>
                </div>
              </div>

              <div>
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-600 block mb-1">
                  Presentation Token (SD-JWT+KB):
                </span>
                <div className="mt-1">
                  <TruncatedHash value={result.presentation} start={20} end={14} />
                </div>
              </div>
            </div>
          )}

          <div className="pt-2 flex justify-end">
            <Button variant="primary" size="md" onClick={onDone}>
              Back to Dashboard
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* sharing history                                                    */
/* ------------------------------------------------------------------ */

const CONSENT_BADGE: Record<string, { label: string; tone: string }> = {
  active: { label: 'Active', tone: 'active' },
  ended: { label: 'Ended', tone: 'neutral' },
  revoked: { label: 'Revoked', tone: 'danger' },
  expired: { label: 'Expired', tone: 'warning' },
};

function HistoryScreen({
  consents,
  loading,
  error,
  onRetry,
  verifications,
  verificationSummary,
  endError,
  ending,
  onEnd,
}: {
  consents: Consent[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  verifications: {
    eventId: number;
    result: 'granted' | 'denied';
    verifier: { name: string };
    credential: { typeLabel: string } | null;
    revealedFields: string[];
    deniedBecause: string[];
    createdAt: string;
  }[];
  verificationSummary: { granted: number; denied: number } | null;
  endError: string | null;
  ending: boolean;
  onEnd: (consent: Consent) => void;
}) {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Sharing History & Consents"
        subtitle="Manage active consents, audit who checked your credentials, and revoke access at any time."
        actions={
          <Button
            variant="secondary"
            size="sm"
            icon={<RotateCcw className="h-3.5 w-3.5" />}
            onClick={onRetry}
          >
            Refresh
          </Button>
        }
      />

      {loading && !consents.length && <SkeletonList count={3} />}
      {error && <ErrorBlock message={error} onRetry={onRetry} />}
      <InlineError error={endError} />

      {/* Consents List */}
      <div className="space-y-3">
        <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
          <History className="h-5 w-5 text-blue-600" />
          <span>Active &amp; Past Sharing Consents</span>
        </h2>

        {!loading && consents.length === 0 && (
          <EmptyState
            icon={<History className="h-6 w-6" />}
            title="No sharing sessions"
            description="You haven't shared any credentials with relying parties yet."
          />
        )}

        <div className="space-y-3">
          {consents.map((c) => {
            const badgeInfo = CONSENT_BADGE[c.state] ?? { label: c.state, tone: 'neutral' };
            return (
              <Card key={c.id} className="p-4 sm:p-5">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-bold text-slate-900">
                        {c.verifier?.name ?? 'Relying Party'}
                      </h3>
                      <Badge tone={badgeInfo.tone}>{badgeInfo.label}</Badge>
                      <span className="text-xs font-mono text-slate-400">#{c.id}</span>
                    </div>
                    <p className="text-xs text-slate-600">Purpose: “{c.purpose}”</p>
                    <div className="mt-2.5 rounded-xl bg-slate-50 p-2.5 border border-slate-100">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                        Disclosed Fields
                      </span>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {c.fields.map((f) => (
                          <Badge key={f} tone="info" size="sm">
                            {fieldLabel(f)}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </div>

                  {c.state === 'active' && (
                    <Button
                      variant="danger-outline"
                      size="xs"
                      disabled={ending}
                      onClick={() => onEnd(c)}
                    >
                      End Sharing Access
                    </Button>
                  )}
                </div>

                <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between text-xs text-slate-400">
                  <span>Created {formatDateTime(c.createdAt)}</span>
                  {c.state === 'active' && <span>Expires {relativeTime(c.expiresAt)}</span>}
                </div>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Verifications Audit History */}
      <div className="space-y-3 pt-6 border-t border-slate-200">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <Eye className="h-5 w-5 text-blue-600" />
            <span>Who Verified My Records</span>
          </h2>
          {verificationSummary && (
            <div className="flex items-center gap-1.5">
              <Badge tone="success">{verificationSummary.granted} Granted</Badge>
              <Badge tone="danger">{verificationSummary.denied} Denied</Badge>
            </div>
          )}
        </div>

        {verifications.length === 0 && (
          <EmptyState
            icon={<Eye className="h-6 w-6" />}
            title="No verifications logged yet"
            description="When an organization checks your presentation, the verification event will be recorded here."
          />
        )}

        <div className="space-y-2.5">
          {verifications.map((v) => (
            <Card key={v.eventId} className="p-3.5">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-bold text-slate-900 truncate">
                    {v.verifier.name}{' '}
                    <span className="font-normal text-slate-500">
                      checked your {v.credential?.typeLabel ?? 'credential'}
                    </span>
                  </p>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    {v.result === 'granted'
                      ? `Disclosed claims: ${v.revealedFields.map(fieldLabel).join(', ') || 'none'}`
                      : `Denied: ${v.deniedBecause.join(', ') || 'unspecified reason'}`}
                  </p>
                </div>
                <Badge tone={v.result === 'granted' ? 'granted' : 'denied'} size="sm">
                  {v.result === 'granted' ? '✓ Granted' : '✕ Denied'}
                </Badge>
              </div>
              <p className="text-[10px] text-slate-400 mt-2 font-mono">
                {formatDateTime(v.createdAt)}
              </p>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* citizen audit screen                                               */
/* ------------------------------------------------------------------ */

function AuditScreen({
  loading,
  error,
  onRetry,
  data,
}: {
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  data: {
    entries: {
      id: number;
      eventType: string;
      payload: unknown;
      prevHash: string;
      hash: string;
      createdAt: string;
    }[];
    chain: { valid: boolean; length: number; reason: string | null; brokenAtEntry: number | null };
  } | null;
}) {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Wallet Audit Log"
        subtitle="Transparent, tamper-evident cryptographic log of all wallet actions."
        badge={
          data && (
            <Badge tone={data.chain.valid ? 'trusted' : 'danger'} size="md">
              {data.chain.valid ? 'Chain Intact' : 'Broken'}
            </Badge>
          )
        }
        actions={
          <Button
            variant="secondary"
            size="sm"
            icon={<RotateCcw className="h-3.5 w-3.5" />}
            onClick={onRetry}
          >
            Refresh
          </Button>
        }
      />

      {loading && !data && <SkeletonList count={3} />}
      {error && <ErrorBlock message={error} onRetry={onRetry} />}

      {data && (
        <>
          <div
            className={`rounded-2xl border p-4 sm:p-5 flex items-start gap-3 ${
              data.chain.valid
                ? 'border-emerald-200 bg-emerald-50/80 text-emerald-900'
                : 'border-rose-200 bg-rose-50/80 text-rose-900'
            }`}
          >
            {data.chain.valid ? (
              <CheckCircle2 className="h-6 w-6 text-emerald-600 shrink-0" />
            ) : (
              <XCircle className="h-6 w-6 text-rose-600 shrink-0" />
            )}
            <div>
              <p className="text-base font-bold">
                {data.chain.valid
                  ? `Cryptographic hash chain intact (${data.chain.length} events checked)`
                  : `Hash chain broken at entry #${data.chain.brokenAtEntry ?? '?'}`}
              </p>
              {!data.chain.valid && data.chain.reason && (
                <p className="text-xs text-rose-700 mt-1">{data.chain.reason}</p>
              )}
            </div>
          </div>

          <div className="space-y-3">
            {data.entries.length === 0 && (
              <EmptyState title="No audit events" description="Your audit log is currently empty." />
            )}

            {data.entries.map((entry) => {
              const style = EVENT_STYLES[entry.eventType];
              return (
                <Card key={entry.id} className="p-4 sm:p-5">
                  <div className="flex items-start gap-3.5">
                    <div className="h-8 w-8 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center shrink-0 mt-0.5">
                      <CheckCircle2 className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between gap-3">
                        <h3 className="text-sm font-bold text-slate-900">
                          {style?.label ?? entry.eventType}
                        </h3>
                        <span className="text-xs text-slate-400">
                          {formatDateTime(entry.createdAt)}
                        </span>
                      </div>

                      <div className="mt-3 rounded-xl bg-slate-50 p-3 text-xs space-y-1 font-mono text-slate-600 border border-slate-100">
                        <div className="flex justify-between">
                          <span className="text-slate-400">EVENT ID:</span>
                          <span>AUD-{String(entry.id).padStart(5, '0')}</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-slate-400">PREV HASH:</span>
                          <TruncatedHash value={entry.prevHash} start={10} end={6} />
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-slate-400">HASH:</span>
                          <TruncatedHash value={entry.hash} start={10} end={6} />
                        </div>
                      </div>

                      <details className="mt-2.5">
                        <summary className="cursor-pointer text-sm font-semibold text-slate-500 hover:text-slate-700">
                          Event details
                        </summary>
                        <div className="mt-2">
                          <KeyValueDisplay
                            data={
                              typeof entry.payload === 'string'
                                ? (safeParse(entry.payload) as Record<string, unknown>)
                                : (entry.payload as Record<string, unknown>)
                            }
                          />
                        </div>
                      </details>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/* ------------------------------------------------------------------ */
/* settings                                                           */
/* ------------------------------------------------------------------ */

function SettingsScreen({
  name,
  email,
  did,
  onLogout,
}: {
  name: string;
  email: string | null;
  did: string;
  onLogout: () => void;
}) {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        subtitle="Manage your GitLink wallet parameters and session."
      />

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Wallet Identity Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 pt-1">
          <div className="flex justify-between py-2 border-b border-slate-100 text-sm">
            <span className="text-slate-500 font-medium">Name</span>
            <span className="font-semibold text-slate-900">{name}</span>
          </div>
          {email && (
            <div className="flex justify-between py-2 border-b border-slate-100 text-sm">
              <span className="text-slate-500 font-medium">Email</span>
              <span className="font-semibold text-slate-900 font-mono text-xs">{email}</span>
            </div>
          )}
          <div className="flex justify-between py-2 border-b border-slate-100 text-sm items-center">
            <span className="text-slate-500 font-medium">Wallet DID</span>
            <TruncatedHash value={did} start={14} end={8} />
          </div>
          <div className="flex justify-between py-2 text-sm items-center">
            <span className="text-slate-500 font-medium">API Endpoint</span>
            <span className="font-mono text-xs text-slate-700">{API_BASE}</span>
          </div>
        </CardContent>
      </Card>

      <Card className="max-w-2xl">
        <CardContent className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-2">
          <div>
            <h3 className="text-base font-bold text-slate-900">Current Session</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Log out of your GitLink wallet on this browser session.
            </p>
          </div>
          <Button variant="danger-outline" size="sm" onClick={onLogout}>
            Log Out of Wallet
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
