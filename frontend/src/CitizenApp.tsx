/**
 * Citizen wallet — the sidebar design, wired to the real backend.
 *
 * Every screen from the original mock-up is kept (dashboard, credentials,
 * credential details, add document → review → pending, sharing history,
 * audit log, settings, consent, result). What changed: nothing is hard-coded
 * any more. Data comes from the API:
 *
 *   wallet / credentials ........ GET  /wallet/credentials
 *   incoming sharing requests ... GET  /wallet/requests
 *   Allow / Deny ................ POST /wallet/requests/:id/approve | reject
 *   documents ................... GET/POST /wallet/documents
 *   eligible issuers ............ GET  /organizations?documentType=
 *   sharing history ............. GET  /wallet/consents, POST /wallet/consents/:id/revoke
 *   who verified me ............. GET  /wallet/verifications
 *   audit log + hash chain ...... GET  /wallet/audit
 */
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { API_BASE, api } from './lib/api';
import { stashShare, useAuth } from './lib/auth';
import {
  DOCUMENT_TYPES,
  EVENT_STYLES,
  fieldLabel,
  formatValue,
  stageForType,
} from './lib/catalog';
import { formatDate, formatDateTime, prettyJson, relativeTime, shortHash } from './lib/format';
import { useAction, useRequest } from './lib/hooks';
import type {
  Consent,
  Credential,
  DocumentRequest,
  PresentationRequest,
  ShareResult,
} from './lib/types';
import { ConsentModal } from './components/ConsentModal';
import { ErrorBlock, InlineError, LoadingBlock, Spinner } from './components/ui';

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

const NAV: { id: NavId; label: string }[] = [
  { id: 'dashboard', label: '🏠 Dashboard' },
  { id: 'credentials', label: '📜 My Credentials' },
  { id: 'history', label: '📤 Sharing History' },
  { id: 'audit', label: '🔐 Audit Log' },
  { id: 'settings', label: '⚙️ Settings' },
];

/** Which sidebar item is highlighted for each screen. */
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

const BTN_PRIMARY =
  'bg-blue-700 text-white px-6 py-3 rounded-xl hover:bg-blue-800 transition disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500';
const INPUT = 'w-full mt-2 border border-slate-300 rounded-xl px-4 py-3 bg-white';

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function initialsId(did: string): string {
  return did.length > 22 ? `${did.slice(0, 14)}…${did.slice(-6)}` : did;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** SHA-256 of the chosen file, so the backend stores a fingerprint of the document. */
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
  type: string;
  organizationId: number | '';
  organizationName: string;
  purpose: string;
  file: PickedFile | null;
}

const EMPTY_DRAFT: DocDraft = {
  type: DOCUMENT_TYPES[0].value,
  organizationId: '',
  organizationName: '',
  purpose: 'Credential Verification',
  file: null,
};

export function CitizenApp() {
  const { user, logout } = useAuth();
  const citizenId = user?.id ?? 0;

  const [screen, setScreen] = useState<Screen>('dashboard');
  const [openCredentialId, setOpenCredentialId] = useState<number | null>(null);
  const [activeRequestId, setActiveRequestId] = useState<number | null>(null);
  const [draft, setDraft] = useState<DocDraft>(EMPTY_DRAFT);
  const [submitMessage, setSubmitMessage] = useState<string | null>(null);
  const [lastShare, setLastShare] = useState<ShareResult | null>(null);
  const [sharing, setSharing] = useState<Credential | null>(null);

  // Consent-screen choices
  const [pickedFields, setPickedFields] = useState<string[]>([]);
  const [pickedCredential, setPickedCredential] = useState<number | ''>('');

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
    const matching = credentials.filter((c) => c.type === req.credentialType);
    const firstValid = matching.find((c) => c.status === 'valid') ?? matching[0];
    setActiveRequestId(req.id);
    setPickedFields([...req.requestedFields]);
    setPickedCredential(firstValid?.id ?? '');
    approve.clearError();
    reject.clearError();
    setScreen('consent');
  }

  async function handleApprove() {
    if (!activeRequest || pickedCredential === '' || pickedFields.length === 0) return;
    const result = await approve.run(activeRequest.id, {
      credentialId: Number(pickedCredential),
      fields: pickedFields,
    });
    if (result) {
      stashShare({ presentation: result.presentation });
      setLastShare(result);
      setActiveRequestId(null);
      reloadAll();
      setScreen('result');
    }
  }

  async function handleDeny() {
    if (!activeRequest) return;
    const result = await reject.run(activeRequest.id);
    if (result) {
      setActiveRequestId(null);
      reloadAll();
      setScreen('dashboard');
    }
  }

  async function handleSubmitDocument() {
    if (!draft.file || draft.organizationId === '') return;
    const result = await submitDoc.run({
      documentType: draft.type,
      documentName: draft.file.name,
      documentRef: `sha256:${draft.file.hash}|name:${draft.file.name}|size:${draft.file.size}`,
      mimeType: draft.file.mime || 'application/octet-stream',
      organizationId: Number(draft.organizationId),
      purpose: draft.purpose.trim(),
    });
    if (result) {
      setSubmitMessage(result.message);
      reloadAll();
      setScreen('verificationPending');
    }
  }

  async function handleEnd(consent: Consent) {
    const result = await endConsent.run(consent.id);
    if (result) reloadAll();
  }

  const walletName = user?.name ?? 'Citizen';
  const firstName = walletName.split(' ')[0];
  const did = user?.did ?? '';
  const validCount = wallet.data?.summary.valid ?? 0;

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* SIDEBAR */}
      <aside className="w-64 shrink-0 bg-white border-r border-slate-200 p-6 flex flex-col">
        <div className="mb-10">
          <h1 className="text-2xl font-bold text-blue-700">LifeLink</h1>
          <p className="text-xs text-slate-400 mt-1">Digital Identity Wallet</p>
        </div>

        <nav className="space-y-2">
          {NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setScreen(item.id)}
              className={
                navFor(screen) === item.id
                  ? 'w-full text-left px-4 py-3 rounded-xl bg-blue-50 text-blue-700 font-semibold'
                  : 'w-full text-left px-4 py-3 rounded-xl text-slate-600 hover:bg-slate-50'
              }
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className="mt-12 bg-slate-50 rounded-xl p-4">
          <p className="text-xs text-slate-500">WALLET STATUS</p>
          <p className="text-sm font-semibold text-green-600 mt-2">● Active</p>
          <p className="text-xs text-slate-400 mt-2 break-all font-mono">{initialsId(did) || `LL-${citizenId}`}</p>
        </div>

        <button
          type="button"
          onClick={logout}
          className="mt-auto pt-6 text-left text-sm text-slate-500 hover:text-slate-800"
        >
          ⎋ Log out ({walletName})
        </button>
      </aside>

      {/* MAIN CONTENT */}
      <main className="flex-1 p-10 min-w-0">
        {wallet.loading && !wallet.data && <LoadingBlock label="Opening your wallet…" />}
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
            onEnd={(c) => void handleEnd(c)}
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
            pending={approve.pending || reject.pending}
            error={approve.error ?? reject.error}
            onBack={() => setScreen('dashboard')}
            onApprove={() => void handleApprove()}
            onDeny={() => void handleDeny()}
          />
        )}

        {screen === 'result' && (
          <ResultScreen
            result={lastShare}
            credential={credentials.find((c) => c.id === lastShare?.credential.id) ?? null}
            onDone={() => setScreen('dashboard')}
          />
        )}
      </main>

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
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* small shared pieces                                                 */
/* ------------------------------------------------------------------ */

function BackButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="text-blue-600 mb-6">
      {children}
    </button>
  );
}

function PageTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div>
      <h2 className="text-3xl font-bold text-slate-800">{title}</h2>
      {subtitle && <p className="text-slate-500 mt-2">{subtitle}</p>}
    </div>
  );
}

function StatusPill({ status }: { status: Credential['status'] }) {
  if (status === 'valid') return <span className="text-green-600 text-sm font-semibold">✓ Valid</span>;
  if (status === 'revoked') return <span className="text-rose-600 text-sm font-semibold">✕ Revoked</span>;
  return <span className="text-amber-600 text-sm font-semibold">⏱ Expired</span>;
}

function credentialIcon(type: string): string {
  return stageForType(type)?.icon ?? '📄';
}

function stageName(type: string): string {
  return (stageForType(type)?.label ?? 'Credential').toUpperCase();
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
    <>
      <div>
        <p className="text-sm text-blue-600 font-semibold">YOUR DIGITAL IDENTITY</p>
        <h2 className="text-3xl font-bold text-slate-800 mt-2">
          {greeting()}, {firstName} 👋
        </h2>
        <p className="text-slate-500 mt-2">Manage and securely share your verified credentials.</p>
      </div>

      {/* WALLET CARD */}
      <div className="mt-8 bg-gradient-to-r from-blue-700 to-indigo-700 text-white rounded-3xl p-7 shadow-lg">
        <div className="flex justify-between items-start">
          <div className="min-w-0">
            <p className="text-blue-200 text-sm">LIFELINK WALLET</p>
            <h3 className="text-2xl font-bold mt-3">{walletName}</h3>
            <p className="text-blue-200 mt-1 font-mono text-sm break-all">{initialsId(did)}</p>
          </div>
          <div className="bg-white/15 px-4 py-2 rounded-full">
            <span className="text-sm">● Active</span>
          </div>
        </div>

        <div className="border-t border-white/20 mt-7 pt-5 flex justify-between">
          <div>
            <p className="text-blue-200 text-xs">VERIFIED CREDENTIALS</p>
            <p className="text-xl font-bold mt-1">{validCount}</p>
          </div>
          <div>
            <p className="text-blue-200 text-xs">SHARING REQUESTS</p>
            <p className="text-xl font-bold mt-1">{pendingRequests.length}</p>
          </div>
          <div>
            <p className="text-blue-200 text-xs">IDENTITY STATUS</p>
            <p className="text-xl font-bold mt-1">{validCount > 0 ? 'Verified' : 'Not verified yet'}</p>
          </div>
        </div>
      </div>

      {/* VERIFICATION REQUESTS */}
      {pendingRequests.map((req) => (
        <div key={req.id} className="mt-8 bg-white border border-blue-200 rounded-2xl p-6 shadow-sm">
          <div className="flex justify-between items-start gap-4">
            <div>
              <p className="text-xs font-bold text-blue-600">ACTION REQUIRED</p>
              <h3 className="text-xl font-bold text-slate-800 mt-2">
                {req.verifier.name} wants to verify your {req.credentialTypeLabel}
              </h3>
              <p className="text-slate-500 mt-2">
                Purpose: “{req.purpose}”. They are requesting only the information needed.
              </p>
            </div>
            <div className="bg-amber-100 text-amber-700 px-3 py-1 rounded-full text-xs font-semibold shrink-0">
              Pending
            </div>
          </div>

          <div className="mt-5 bg-slate-50 rounded-xl p-4">
            <p className="text-xs text-slate-500">REQUESTED FIELDS</p>
            <div className="mt-1 space-y-1">
              {req.requestedFields.map((f) => (
                <p key={f} className="font-semibold text-slate-800">
                  ✓ {fieldLabel(f)}
                </p>
              ))}
            </div>
            <p className="text-xs text-slate-400 mt-3">Expires {relativeTime(req.expiresAt)}</p>
          </div>

          <button type="button" onClick={() => onReview(req)} className={`mt-5 ${BTN_PRIMARY}`}>
            Review Request →
          </button>
        </div>
      ))}

      {/* ADD DOCUMENT */}
      <div className="mt-8 bg-white border border-dashed border-blue-300 rounded-2xl p-6">
        <div className="flex justify-between items-center gap-4">
          <div>
            <p className="text-xs font-bold text-blue-600">NEW DOCUMENT</p>
            <h3 className="text-xl font-bold text-slate-800 mt-2">Add a document to LifeLink</h3>
            <p className="text-slate-500 mt-2">
              Upload a document that you want to verify and store in your digital wallet.
            </p>
          </div>
          <button type="button" onClick={onAddDocument} className={`${BTN_PRIMARY} shrink-0`}>
            + Add Document
          </button>
        </div>
      </div>

      {/* CREDENTIALS */}
      <div className="flex justify-between items-center mt-10 mb-4">
        <h3 className="text-xl font-bold text-slate-800">Your Credentials</h3>
        <button type="button" onClick={onViewAll} className="text-blue-600 text-sm font-semibold">
          View all →
        </button>
      </div>

      {credentials.length === 0 ? (
        <div className="bg-white rounded-2xl p-6 border border-slate-100 shadow-sm text-slate-500">
          Your wallet is empty. Add a document above, or ask your university or employer to issue a
          credential directly.
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-5">
          {credentials.slice(0, 4).map((c) => (
            <CredentialTile key={c.id} credential={c} onOpen={() => onOpenCredential(c.id)} />
          ))}
        </div>
      )}

      {/* RECENT ACTIVITY */}
      <h3 className="text-xl font-bold text-slate-800 mt-10 mb-4">Recent Activity</h3>
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm">
        {auditError && <p className="p-5 text-sm text-rose-600">{auditError}</p>}
        {!auditError && recent.length === 0 && (
          <p className="p-5 text-sm text-slate-500">No activity yet.</p>
        )}
        {recent.map((entry, index) => {
          const style = EVENT_STYLES[entry.eventType];
          return (
            <div
              key={entry.id}
              className={`p-5 flex items-center gap-4 ${index < recent.length - 1 ? 'border-b' : ''}`}
            >
              <div className="bg-blue-100 text-blue-600 rounded-full w-9 h-9 flex items-center justify-center">
                •
              </div>
              <p className="font-semibold">{style?.label ?? entry.eventType}</p>
              <p className="ml-auto text-xs text-slate-400">{relativeTime(entry.createdAt)}</p>
            </div>
          );
        })}
      </div>
    </>
  );
}

function CredentialTile({ credential, onOpen }: { credential: Credential; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="text-left bg-white rounded-2xl p-6 border border-slate-100 shadow-sm hover:border-blue-400 hover:shadow-md transition"
    >
      <div className="flex justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-slate-500">{stageName(credential.type)}</p>
          <h4 className="text-lg font-bold mt-2">
            {credentialIcon(credential.type)} {credential.typeLabel}
          </h4>
          <p className="text-slate-500 mt-1">{credential.issuer.name}</p>
        </div>
        <StatusPill status={credential.status} />
      </div>
      <div className="border-t mt-5 pt-4 flex justify-between">
        <div>
          <p className="text-xs text-slate-400">Issued</p>
          <p className="text-sm font-medium mt-1">{formatDate(credential.issuedAt)}</p>
        </div>
        <p className="text-blue-600 text-sm font-semibold self-end">View Credential →</p>
      </div>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* credentials                                                         */
/* ------------------------------------------------------------------ */

function CredentialsScreen({
  credentials,
  openDocuments,
  onOpen,
}: {
  credentials: Credential[];
  openDocuments: DocumentRequest[];
  onOpen: (id: number) => void;
}) {
  return (
    <div>
      <PageTitle title="My Credentials" subtitle="All credentials stored in your LifeLink wallet." />

      {credentials.length === 0 && openDocuments.length === 0 && (
        <div className="bg-white rounded-2xl p-6 mt-8 shadow-sm border text-slate-500">
          Nothing here yet. Add a document from the dashboard to get started.
        </div>
      )}

      <div className="grid grid-cols-2 gap-5 mt-8">
        {credentials.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => onOpen(c.id)}
            className="text-left bg-white rounded-2xl p-6 shadow-sm border hover:border-blue-400"
          >
            <p className="text-xs text-slate-500">{stageName(c.type)}</p>
            <h3 className="text-xl font-bold mt-2">
              {credentialIcon(c.type)} {c.typeLabel}
            </h3>
            <p className="text-slate-500">{c.issuer.name}</p>
            <span
              className={`inline-block mt-5 px-3 py-1 rounded-full text-sm ${
                c.status === 'valid'
                  ? 'bg-green-100 text-green-700'
                  : c.status === 'revoked'
                    ? 'bg-rose-100 text-rose-700'
                    : 'bg-amber-100 text-amber-700'
              }`}
            >
              {c.status === 'valid' ? '✓ Valid' : c.status === 'revoked' ? '✕ Revoked' : '⏱ Expired'}
            </span>
          </button>
        ))}

        {openDocuments.map((d) => (
          <div
            key={`doc-${d.id}`}
            className={`bg-white rounded-2xl p-6 shadow-sm border ${
              d.status === 'REJECTED' ? 'border-rose-200' : 'border-blue-200'
            }`}
          >
            <p
              className={`text-xs font-semibold ${
                d.status === 'REJECTED' ? 'text-rose-600' : 'text-blue-600'
              }`}
            >
              {d.status === 'REJECTED' ? 'REJECTED DOCUMENT' : 'NEW DOCUMENT'}
            </p>
            <h3 className="text-xl font-bold mt-2">{d.documentType}</h3>
            <p className="text-slate-500 mt-1">{d.organization?.name ?? `Organization #${d.organizationId}`}</p>
            <p className="text-sm text-slate-400 mt-1 break-all">{d.documentName}</p>
            {d.status === 'REJECTED' ? (
              <>
                <span className="inline-block mt-5 bg-rose-100 text-rose-700 px-3 py-1 rounded-full text-sm">
                  ✕ Rejected
                </span>
                {d.rejectionReason && (
                  <p className="text-sm text-rose-700 mt-2">Reason: {d.rejectionReason}</p>
                )}
              </>
            ) : (
              <span className="inline-block mt-5 bg-amber-100 text-amber-700 px-3 py-1 rounded-full text-sm">
                🟡 Pending Verification
              </span>
            )}
            <p className="text-xs text-slate-400 mt-3">Submitted {formatDateTime(d.createdAt)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

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
        <BackButton onClick={onBack}>← Back to Credentials</BackButton>
        <p className="text-slate-500">That credential is no longer in your wallet.</p>
      </div>
    );
  }
  return (
    <div>
      <BackButton onClick={onBack}>← Back to Credentials</BackButton>
      <h2 className="text-3xl font-bold text-slate-800">Credential Details</h2>

      <div className="bg-white rounded-2xl shadow-sm p-8 mt-6 max-w-2xl">
        <div className="flex justify-between items-start gap-4">
          <div>
            <p className="text-sm text-slate-500">CREDENTIAL TYPE</p>
            <h3 className="text-2xl font-bold mt-2">
              {credentialIcon(credential.type)} {credential.typeLabel}
            </h3>
            <p className="text-slate-600 mt-1">Issued by {credential.issuer.name}</p>
          </div>
          <span
            className={`px-4 py-2 rounded-full shrink-0 ${
              credential.status === 'valid'
                ? 'bg-green-100 text-green-700'
                : credential.status === 'revoked'
                  ? 'bg-rose-100 text-rose-700'
                  : 'bg-amber-100 text-amber-700'
            }`}
          >
            {credential.status === 'valid' ? '✓ Valid' : credential.status === 'revoked' ? '✕ Revoked' : '⏱ Expired'}
          </span>
        </div>

        <div className="border-t mt-8 pt-6 space-y-5">
          <Detail label="Issued Date" value={formatDate(credential.issuedAt)} />
          <Detail label="Expires" value={formatDate(credential.expiresAt)} />
          <Detail label="Credential ID" value={`LL-CRED-${credential.id}`} />
          <Detail label="Issuer" value={credential.issuer.name} />
          <Detail label="Issuer DID" value={credential.issuer.did} mono />
        </div>

        <div className="mt-8">
          <p className="text-sm text-slate-500">Details in this credential</p>
          <div className="mt-3 divide-y rounded-xl border">
            {Object.entries(credential.claims).map(([key, value]) => (
              <div key={key} className="flex justify-between gap-4 px-4 py-3 text-sm">
                <span className="text-slate-500">{fieldLabel(key)}</span>
                <span className="font-semibold text-slate-800 text-right break-all">{formatValue(value)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-8 bg-blue-50 rounded-xl p-5">
          <p className="font-semibold text-blue-800">🔐 Verified Credential</p>
          <p className="text-sm text-blue-700 mt-2">
            {credential.issuer.trusted
              ? 'This credential was issued by a trusted organization'
              : 'The issuer of this credential is not currently trusted'}
            {credential.status === 'valid'
              ? ' and its current status is valid.'
              : ` and its status is ${credential.status}.`}
          </p>
        </div>

        {credential.status === 'valid' && (
          <button type="button" onClick={() => onShare(credential)} className={`mt-6 ${BTN_PRIMARY}`}>
            Share this credential →
          </button>
        )}
      </div>
    </div>
  );
}

function Detail({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-sm text-slate-500">{label}</p>
      <p className={`font-semibold mt-1 break-all ${mono ? 'font-mono text-xs' : ''}`}>{value}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* add document → review → pending                                     */
/* ------------------------------------------------------------------ */

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
  const [fileError, setFileError] = useState<string | null>(null);
  const orgs = useRequest(() => api.organizations(draft.type), `eligible-orgs-${draft.type}`);
  const hint = DOCUMENT_TYPES.find((d) => d.value === draft.type)?.hint;

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setFileError(null);
    if (file.size > 25 * 1024 * 1024) {
      setFileError('Please choose a file smaller than 25 MB.');
      return;
    }
    setReading(true);
    try {
      const hash = await sha256Hex(file);
      setDraft({ ...draft, file: { name: file.name, size: file.size, mime: file.type, hash } });
    } catch {
      setFileError('Could not read that file. Try another one.');
    } finally {
      setReading(false);
    }
  }

  const ready = Boolean(draft.file) && draft.organizationId !== '' && draft.purpose.trim().length >= 3;

  return (
    <div>
      <BackButton onClick={onBack}>← Back to Dashboard</BackButton>
      <PageTitle title="Add Document" subtitle="Upload a document to submit it for verification." />

      <div className="bg-white rounded-2xl p-8 mt-6 max-w-2xl shadow-sm border">
        <label className="text-sm font-semibold text-slate-700" htmlFor="doc-type">
          Document Type
        </label>
        <select
          id="doc-type"
          value={draft.type}
          onChange={(e) => setDraft({ ...draft, type: e.target.value, organizationId: '', organizationName: '' })}
          className={INPUT}
        >
          {DOCUMENT_TYPES.map((d) => (
            <option key={d.value} value={d.value}>
              {d.label}
            </option>
          ))}
        </select>
        {hint && <p className="text-xs text-slate-500 mt-1">{hint}</p>}

        <label className="text-sm font-semibold text-slate-700 block mt-6" htmlFor="doc-org">
          Issuer
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
          className={INPUT}
        >
          <option value="">{orgs.loading ? 'Loading trusted organizations…' : 'Choose the issuing organization…'}</option>
          {(orgs.data?.organizations ?? []).map((o) => (
            <option key={o.id} value={o.id}>
              {o.name} ({o.orgType ?? 'Organization'})
            </option>
          ))}
        </select>
        {orgs.error && <p className="text-xs text-rose-600 mt-1">{orgs.error}</p>}

        <label className="text-sm font-semibold text-slate-700 block mt-6" htmlFor="doc-file">
          Upload Document
        </label>
        <input
          id="doc-file"
          type="file"
          onChange={(e) => void handleFile(e.target.files?.[0])}
          className={INPUT}
        />
        {reading && <p className="text-xs text-slate-500 mt-2">Reading file…</p>}
        {fileError && <p className="text-xs text-rose-600 mt-2">{fileError}</p>}

        {draft.file && (
          <div className="mt-4 bg-blue-50 rounded-xl p-4">
            <p className="text-xs text-blue-600 font-semibold">SELECTED FILE</p>
            <p className="font-medium text-slate-800 mt-1 break-all">{draft.file.name}</p>
            <p className="text-xs text-slate-500 mt-1">
              {formatBytes(draft.file.size)} · fingerprint {shortHash(draft.file.hash, 10, 6)}
            </p>
          </div>
        )}

        <label className="text-sm font-semibold text-slate-700 block mt-6" htmlFor="doc-purpose">
          Purpose
        </label>
        <input
          id="doc-purpose"
          type="text"
          value={draft.purpose}
          maxLength={500}
          onChange={(e) => setDraft({ ...draft, purpose: e.target.value })}
          className={INPUT}
        />

        <div className="mt-6 bg-slate-50 rounded-xl p-5">
          <p className="font-semibold text-slate-700">🔐 Your document is protected</p>
          <p className="text-sm text-slate-500 mt-2">
            LifeLink sends the issuing organization a fingerprint of your file, not the file itself. You
            control who can access the resulting credential.
          </p>
        </div>

        <button type="button" onClick={onContinue} disabled={!ready || reading} className={`mt-6 ${BTN_PRIMARY}`}>
          Continue →
        </button>
      </div>
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
  const typeLabel = DOCUMENT_TYPES.find((d) => d.value === draft.type)?.label ?? draft.type;
  return (
    <div>
      <BackButton onClick={onBack}>← Back</BackButton>
      <PageTitle title="Review Document" subtitle="Check the details before submitting the document." />

      <div className="bg-white rounded-2xl p-8 mt-6 max-w-2xl shadow-sm border">
        <div className="bg-blue-50 rounded-xl p-5">
          <p className="text-xs text-blue-600 font-semibold">DOCUMENT TYPE</p>
          <p className="text-xl font-bold text-slate-800 mt-2">{typeLabel}</p>
        </div>

        <div className="mt-6">
          <p className="text-sm text-slate-500">Issuer</p>
          <p className="font-semibold mt-1">{draft.organizationName || `Organization #${draft.organizationId}`}</p>
        </div>

        <div className="mt-6">
          <p className="text-sm text-slate-500">File Name</p>
          <p className="font-semibold mt-1 break-all">{draft.file?.name}</p>
        </div>

        <div className="mt-6">
          <p className="text-sm text-slate-500">Purpose</p>
          <p className="font-semibold mt-1">{draft.purpose}</p>
        </div>

        <div className="mt-6">
          <p className="text-sm text-slate-500">Next Step</p>
          <p className="font-semibold mt-1">Submit credential for verification</p>
        </div>

        <div className="mt-6 bg-amber-50 rounded-xl p-5">
          <p className="font-semibold text-amber-700">🟡 Verification Required</p>
          <p className="text-sm text-amber-700 mt-2">
            Uploading a document does not automatically make it verified. The issuing organization must
            review it and sign a credential before it counts.
          </p>
        </div>

        <InlineError error={error} />

        <button type="button" onClick={onSubmit} disabled={pending} className={`mt-6 ${BTN_PRIMARY}`}>
          {pending ? (
            <span className="inline-flex items-center gap-2">
              <Spinner /> Submitting…
            </span>
          ) : (
            'Submit for Verification →'
          )}
        </button>
      </div>
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
  const typeLabel = DOCUMENT_TYPES.find((d) => d.value === draft.type)?.label ?? draft.type;
  return (
    <div>
      <PageTitle title="Verification Submitted" subtitle="Your document has been submitted for verification." />

      <div className="bg-white rounded-2xl p-8 mt-6 max-w-2xl shadow-sm border">
        <div className="flex items-center gap-4">
          <div className="bg-amber-100 text-amber-600 w-12 h-12 rounded-full flex items-center justify-center text-xl">
            !
          </div>
          <div>
            <p className="text-sm text-slate-500">VERIFICATION STATUS</p>
            <h3 className="text-2xl font-bold text-amber-600 mt-1">Pending Verification</h3>
          </div>
        </div>

        <div className="mt-7 bg-slate-50 rounded-xl p-5">
          <p className="text-xs text-slate-500">DOCUMENT</p>
          <p className="font-semibold mt-1">{typeLabel}</p>
          <p className="text-sm text-slate-500 mt-1 break-all">{draft.file?.name}</p>
          <p className="text-xs text-slate-500 mt-4">ISSUER</p>
          <p className="font-semibold mt-1">{draft.organizationName}</p>
        </div>

        <div className="mt-6 bg-blue-50 rounded-xl p-5">
          <p className="font-semibold text-blue-800">🔐 What happens next?</p>
          <p className="text-sm text-blue-700 mt-2">
            {message ??
              'The organization reviews your document. If approved, a signed credential appears in your wallet.'}
          </p>
        </div>

        <button type="button" onClick={onDone} className={`mt-6 ${BTN_PRIMARY}`}>
          View My Credentials →
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* consent + result                                                    */
/* ------------------------------------------------------------------ */

function ConsentScreen({
  request,
  credentials,
  pickedFields,
  setPickedFields,
  pickedCredential,
  setPickedCredential,
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
  pending: boolean;
  error: string | null;
  onBack: () => void;
  onApprove: () => void;
  onDeny: () => void;
}) {
  if (!request) {
    return (
      <div>
        <BackButton onClick={onBack}>← Back</BackButton>
        <p className="text-slate-500">This request is no longer open.</p>
      </div>
    );
  }

  const matching = credentials.filter((c) => c.type === request.credentialType);
  const chosen = credentials.find((c) => c.id === pickedCredential);
  const stays = chosen
    ? Object.keys(chosen.claims).filter((k) => !pickedFields.includes(k))
    : [];

  function toggle(field: string) {
    setPickedFields(
      pickedFields.includes(field) ? pickedFields.filter((f) => f !== field) : [...pickedFields, field],
    );
  }

  return (
    <div>
      <BackButton onClick={onBack}>← Back</BackButton>
      <PageTitle
        title="Verification Request"
        subtitle={`Review exactly what ${request.verifier.name} wants to access.`}
      />

      <div className="bg-white rounded-2xl p-8 mt-6 max-w-2xl shadow-sm">
        <p className="text-xs text-slate-500">REQUESTED BY</p>
        <h3 className="text-2xl font-bold mt-2">{request.verifier.name}</h3>
        <p className="text-slate-500 mt-1">
          Purpose: “{request.purpose}” · expires {relativeTime(request.expiresAt)}
        </p>

        <div className="mt-7 bg-blue-50 rounded-xl p-5">
          <p className="font-semibold text-blue-800">Only the fields you tick will be shared</p>
          <div className="mt-4 space-y-2">
            {request.requestedFields.map((f) => (
              <label key={f} className="flex items-center gap-3 bg-white rounded-lg p-4 cursor-pointer">
                <input type="checkbox" checked={pickedFields.includes(f)} onChange={() => toggle(f)} />
                <span className="font-medium">{fieldLabel(f)}</span>
                {chosen && pickedFields.includes(f) && (
                  <span className="ml-auto text-sm text-slate-500">{formatValue(chosen.claims[f])}</span>
                )}
              </label>
            ))}
          </div>
          {stays.length > 0 && (
            <p className="text-xs text-slate-500 mt-3">
              Stays private: {stays.map(fieldLabel).join(', ')}
            </p>
          )}
        </div>

        <label className="text-sm font-semibold text-slate-700 block mt-6" htmlFor="use-cred">
          Credential to use
        </label>
        <select
          id="use-cred"
          value={pickedCredential}
          onChange={(e) => setPickedCredential(e.target.value === '' ? '' : Number(e.target.value))}
          className={INPUT}
        >
          <option value="">Choose…</option>
          {matching.map((c) => (
            <option key={c.id} value={c.id} disabled={c.status !== 'valid'}>
              {c.typeLabel} · {c.issuer.name} ({c.status})
            </option>
          ))}
        </select>
        {matching.length === 0 && (
          <p className="text-sm text-rose-600 mt-2">
            You don’t have a {request.credentialTypeLabel} credential yet, so you can’t answer this request.
          </p>
        )}

        <InlineError error={error} />

        <div className="flex gap-3 mt-6">
          <button
            type="button"
            onClick={onApprove}
            disabled={pending || pickedCredential === '' || pickedFields.length === 0}
            className={BTN_PRIMARY}
          >
            {pending ? 'Working…' : `Approve & Share (${pickedFields.length})`}
          </button>
          <button
            type="button"
            onClick={onDeny}
            disabled={pending}
            className="border border-slate-300 px-6 py-3 rounded-xl hover:bg-slate-50 disabled:opacity-50"
          >
            Deny
          </button>
        </div>
      </div>
    </div>
  );
}

function ResultScreen({
  result,
  credential,
  onDone,
}: {
  result: ShareResult | null;
  credential: Credential | null;
  onDone: () => void;
}) {
  const [copied, setCopied] = useState(false);
  if (!result) {
    return (
      <div>
        <PageTitle title="Verification Result" />
        <button type="button" onClick={onDone} className={`mt-6 ${BTN_PRIMARY}`}>
          Return to Dashboard
        </button>
      </div>
    );
  }
  const revealed = Object.entries(result.reveals);
  return (
    <div>
      <PageTitle title="Shared Successfully" />

      <div className="bg-white rounded-2xl p-8 mt-6 max-w-2xl shadow-sm">
        <div className="space-y-4">
          <p className={`font-semibold ${credential?.issuer.trusted ? 'text-green-600' : 'text-amber-600'}`}>
            {credential?.issuer.trusted ? '✓ Issuer Trusted' : '• Issuer trust unknown'}
          </p>
          <p className={`font-semibold ${credential?.status === 'valid' ? 'text-green-600' : 'text-amber-600'}`}>
            {credential?.status === 'valid' ? '✓ Credential Not Revoked' : `• Credential ${credential?.status ?? 'status unknown'}`}
          </p>
          <p className="text-green-600 font-semibold">
            ✓ Consent #{result.consent.id} recorded · expires {relativeTime(result.consent.expiresAt)}
          </p>
        </div>

        <div className="mt-8 bg-green-50 rounded-xl p-6">
          <h3 className="text-2xl font-bold text-green-700">ACCESS GRANTED</h3>
          <p className="mt-2 text-green-700">
            {revealed.length} field{revealed.length === 1 ? '' : 's'} shared with {result.verifier.name}.
          </p>
          <ul className="mt-4 space-y-1">
            {revealed.map(([key, value]) => (
              <li key={key} className="text-sm text-green-900">
                <span className="text-green-700">{fieldLabel(key)}:</span>{' '}
                <span className="font-semibold">{formatValue(value)}</span>
              </li>
            ))}
          </ul>
        </div>

        {result.hidden.length > 0 && (
          <div className="mt-5 bg-slate-50 rounded-xl p-5">
            <p className="text-xs text-slate-500">STAYED PRIVATE</p>
            <p className="text-sm text-slate-700 mt-2">{result.hidden.map(fieldLabel).join(', ')}</p>
          </div>
        )}

        <details className="mt-5">
          <summary className="cursor-pointer text-xs font-semibold text-slate-600">
            Show the raw presentation (this is all the verifier receives)
          </summary>
          <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-slate-900 p-3 font-mono text-[10px] text-slate-100">
            {result.presentation}
          </pre>
        </details>

        <div className="flex gap-3 mt-6">
          <button type="button" onClick={onDone} className={BTN_PRIMARY}>
            Return to Dashboard
          </button>
          <button
            type="button"
            className="border border-slate-300 px-6 py-3 rounded-xl hover:bg-slate-50"
            onClick={() => {
              void navigator.clipboard
                ?.writeText(result.presentation)
                .then(() => setCopied(true))
                .catch(() => undefined);
            }}
          >
            {copied ? 'Copied ✓' : 'Copy presentation'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* history, audit, settings                                            */
/* ------------------------------------------------------------------ */

const CONSENT_BADGE: Record<string, { label: string; className: string }> = {
  active: { label: 'Approved', className: 'text-green-600' },
  pending: { label: 'Waiting for you', className: 'text-amber-600' },
  rejected: { label: 'Denied', className: 'text-slate-500' },
  expired: { label: 'Expired', className: 'text-amber-600' },
  ended: { label: 'Ended', className: 'text-slate-500' },
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
    <div>
      <PageTitle title="Sharing History" subtitle="See where your credentials have been shared." />

      {loading && <div className="mt-8"><LoadingBlock label="Loading your sharing history…" /></div>}
      {error && <div className="mt-8"><ErrorBlock message={error} onRetry={onRetry} /></div>}
      <InlineError error={endError} />

      {!loading && !error && consents.length === 0 && (
        <div className="bg-white rounded-2xl mt-8 shadow-sm border p-6 text-slate-500">
          You haven’t shared anything yet.
        </div>
      )}

      {consents.length > 0 && (
        <div className="bg-white rounded-2xl mt-8 shadow-sm border">
          {consents.map((c, index) => {
            const badge = CONSENT_BADGE[c.state] ?? { label: c.state, className: 'text-slate-500' };
            return (
              <div key={c.id} className={`p-6 ${index < consents.length - 1 ? 'border-b' : ''}`}>
                <div className="flex justify-between gap-4">
                  <div>
                    <h3 className="font-bold">{c.verifier?.name ?? 'Unknown verifier'}</h3>
                    <p className="text-sm text-slate-500 mt-1">{c.purpose}</p>
                  </div>
                  <span className={`font-semibold text-sm ${badge.className}`}>{badge.label}</span>
                </div>

                <div className="mt-4 bg-slate-50 rounded-xl p-4">
                  <p className="text-xs text-slate-500">DATA SHARED</p>
                  <p className="font-semibold mt-1">
                    {c.fields.length > 0 ? c.fields.map(fieldLabel).join(', ') : '—'}
                  </p>
                </div>

                <div className="flex items-center justify-between mt-4">
                  <p className="text-xs text-slate-400">
                    {formatDateTime(c.createdAt)}
                    {c.state === 'active' ? ` · expires ${relativeTime(c.expiresAt)}` : ''}
                  </p>
                  {c.state === 'active' && (
                    <button
                      type="button"
                      disabled={ending}
                      onClick={() => onEnd(c)}
                      className="text-sm font-semibold text-rose-600 hover:text-rose-800 disabled:opacity-50"
                    >
                      End sharing
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <h3 className="text-xl font-bold text-slate-800 mt-10 mb-4">
        Who verified my records
        {verificationSummary && (
          <span className="ml-3 text-sm font-normal text-slate-400">
            {verificationSummary.granted} granted · {verificationSummary.denied} denied
          </span>
        )}
      </h3>
      <div className="bg-white rounded-2xl shadow-sm border">
        {verifications.length === 0 && (
          <p className="p-6 text-sm text-slate-500">Nobody has verified your records yet.</p>
        )}
        {verifications.map((v, index) => (
          <div key={v.eventId} className={`p-5 ${index < verifications.length - 1 ? 'border-b' : ''}`}>
            <div className="flex justify-between gap-4">
              <p className="font-semibold">
                {v.verifier.name}
                <span className="font-normal text-slate-500"> checked your {v.credential?.typeLabel ?? 'credential'}</span>
              </p>
              <span className={`text-sm font-semibold ${v.result === 'granted' ? 'text-green-600' : 'text-rose-600'}`}>
                {v.result === 'granted' ? '✓ Granted' : '✕ Denied'}
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-2">
              {v.result === 'granted'
                ? `Saw: ${v.revealedFields.map(fieldLabel).join(', ') || '—'}`
                : `Denied because: ${v.deniedBecause.join(', ') || 'unknown reason'}`}
            </p>
            <p className="text-xs text-slate-400 mt-1">{formatDateTime(v.createdAt)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

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
    entries: { id: number; eventType: string; payload: unknown; prevHash: string; hash: string; createdAt: string }[];
    chain: { valid: boolean; length: number; reason: string | null; brokenAtEntry: number | null };
  } | null;
}) {
  return (
    <div>
      <PageTitle title="Audit Log" subtitle="A transparent record of identity activity." />

      {loading && !data && <div className="mt-8"><LoadingBlock label="Reading the audit log…" /></div>}
      {error && <div className="mt-8"><ErrorBlock message={error} onRetry={onRetry} /></div>}

      {data && (
        <>
          <div
            className={`mt-8 rounded-2xl border p-5 ${
              data.chain.valid ? 'border-green-200 bg-green-50' : 'border-rose-300 bg-rose-50'
            }`}
          >
            <p className={`font-bold ${data.chain.valid ? 'text-green-700' : 'text-rose-700'}`}>
              {data.chain.valid
                ? `✓ Hash chain intact (${data.chain.length} entries checked)`
                : `✕ Chain broken at entry #${data.chain.brokenAtEntry ?? '?'}`}
            </p>
            {!data.chain.valid && data.chain.reason && (
              <p className="text-xs text-rose-700 mt-1">{data.chain.reason}</p>
            )}
          </div>

          {data.entries.length === 0 && (
            <div className="bg-white rounded-2xl mt-5 p-6 shadow-sm border text-slate-500">No events yet.</div>
          )}

          <div className="mt-5 space-y-5">
            {data.entries.map((entry) => {
              const style = EVENT_STYLES[entry.eventType];
              return (
                <div key={entry.id} className="bg-white rounded-2xl p-6 shadow-sm border">
                  <div className="flex gap-4">
                    <div className="bg-blue-100 text-blue-600 w-10 h-10 rounded-full flex items-center justify-center shrink-0">
                      ✓
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between gap-3">
                        <h3 className="font-bold">{style?.label ?? entry.eventType}</h3>
                        <span className="text-xs text-slate-400">{formatDateTime(entry.createdAt)}</span>
                      </div>

                      <div className="mt-4 bg-slate-50 rounded-xl p-4">
                        <p className="text-xs text-slate-400">AUDIT EVENT</p>
                        <p className="text-sm font-mono mt-2">AUD-{String(entry.id).padStart(5, '0')}</p>
                        <p className="text-xs text-slate-400 mt-3">Previous Hash</p>
                        <p className="text-xs font-mono mt-1 break-all">{shortHash(entry.prevHash, 10, 6)}</p>
                        <p className="text-xs text-slate-400 mt-3">Current Hash</p>
                        <p className="text-xs font-mono mt-1 break-all">{shortHash(entry.hash, 10, 6)}</p>
                      </div>

                      <details className="mt-3">
                        <summary className="cursor-pointer text-xs font-semibold text-slate-500">Event details</summary>
                        <pre className="mt-2 max-h-40 overflow-auto rounded-lg bg-slate-900 p-3 font-mono text-[10px] text-slate-100">
                          {prettyJson(typeof entry.payload === 'string' ? safeParse(entry.payload) : entry.payload)}
                        </pre>
                      </details>
                    </div>
                  </div>
                </div>
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
    <div>
      <PageTitle title="Settings" subtitle="Manage your LifeLink wallet." />

      <div className="bg-white rounded-2xl p-6 mt-8 shadow-sm border max-w-2xl">
        <h3 className="text-xl font-bold">Wallet Information</h3>
        <div className="mt-5 space-y-4">
          <Detail label="NAME" value={name} />
          {email && <Detail label="EMAIL" value={email} />}
          <Detail label="WALLET ID (DID)" value={did || '—'} mono />
          <Detail label="API" value={API_BASE} mono />
        </div>
      </div>

      <div className="bg-white rounded-2xl p-6 mt-5 shadow-sm border max-w-2xl">
        <div className="flex justify-between items-center gap-4">
          <div>
            <h3 className="text-xl font-bold">Session</h3>
            <p className="text-sm text-slate-500 mt-1">Log out of this wallet on this device.</p>
          </div>
          <button type="button" onClick={onLogout} className={BTN_PRIMARY}>
            Log out
          </button>
        </div>
      </div>
    </div>
  );
}
