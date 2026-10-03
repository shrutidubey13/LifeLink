/**
 * LifeLink app shell: login gate, role-based tabs, and session header.
 *
 * Citizens get their own sidebar wallet (see CitizenApp.tsx).
 * Organizations see: Dashboard (documents to review + issue + verify), Audit.
 * Admins see: Trust registry, Audit.
 * Legacy verifiers see: Verifier portal, Audit (kept for old databases).
 */
import { useEffect, useState } from 'react';
import { API_BASE } from './lib/api';
import { AuthProvider, useAuth } from './lib/auth';
import { CitizenApp } from './CitizenApp';
import { OrganizationTab } from './tabs/OrganizationTab';
import { VerifierTab } from './tabs/VerifierTab';
import { AdminTab } from './tabs/AdminTab';
import { AuditTab } from './tabs/AuditTab';
import { LoginScreen } from './components/LoginScreen';
import { LoadingBlock } from './components/ui';

type OrgTab = 'dashboard' | 'audit';
type AdminTabId = 'admin' | 'audit';
type VerifierTabId = 'verifier' | 'audit';

const ORG_TABS: { id: OrgTab; label: string; icon: string; blurb: string }[] = [
  { id: 'dashboard', label: 'Organization', icon: '🏛', blurb: 'Verify documents, issue credentials, verify presentations' },
  { id: 'audit', label: 'Activity', icon: '🔗', blurb: 'Your issuance/verification activity' },
];

const ADMIN_TABS: { id: AdminTabId; label: string; icon: string; blurb: string }[] = [
  { id: 'admin', label: 'Trust Registry', icon: '🛡', blurb: 'Approve, suspend, or revoke organizations' },
  { id: 'audit', label: 'Audit log', icon: '🔗', blurb: 'System-wide tamper-evident history' },
];

const VERIFIER_TABS: { id: VerifierTabId; label: string; icon: string; blurb: string }[] = [
  { id: 'verifier', label: 'Verifier portal', icon: '🏦', blurb: 'Verify presentations shared with you' },
  { id: 'audit', label: 'Audit log', icon: '🔗', blurb: 'Tamper-evident history' },
];

function Shell() {
  const { user, ready, logout } = useAuth();
  const [orgTab, setOrgTab] = useState<OrgTab>('dashboard');
  const [adminTab, setAdminTab] = useState<AdminTabId>('admin');
  const [verifierTab, setVerifierTab] = useState<VerifierTabId>('verifier');

  useEffect(() => {
    if (user?.kind === 'organization' || user?.kind === 'issuer') setOrgTab('dashboard');
    if (user?.kind === 'admin') setAdminTab('admin');
    if (user?.kind === 'verifier') setVerifierTab('verifier');
  }, [user?.kind, user?.id]);

  if (!ready) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <LoadingBlock label="Checking your session…" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen">
        <header className="bg-gradient-to-br from-indigo-700 via-indigo-600 to-sky-600 text-white">
          <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
            <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight sm:text-3xl">
              <span aria-hidden="true">🔗</span> LifeLink
            </h1>
            <p className="mt-1 max-w-xl text-sm text-indigo-50">
              One wallet for your whole life. Verify your degree, job, bank KYC and health records
              without re-uploading a single document — and decide exactly what each verifier sees.
            </p>
          </div>
        </header>
        <main className="mx-auto max-w-5xl sm:px-6">
          <LoginScreen />
        </main>
        <Footer />
      </div>
    );
  }

  if (user.kind === 'citizen') {
    return <CitizenApp />;
  }

  const roleLabel =
    user.kind === 'organization' || user.kind === 'issuer' ? 'organization' : user.kind;

  return (
    <div className="min-h-screen">
      <header className="bg-gradient-to-br from-indigo-700 via-indigo-600 to-sky-600 text-white">
        <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight sm:text-3xl">
                <span aria-hidden="true">🔗</span> LifeLink
              </h1>
              <p className="mt-1 max-w-xl text-sm text-indigo-50">
                {user.kind === 'admin'
                  ? 'Guard the trust registry. Only trusted organizations may sign.'
                  : 'Issue credentials, verify documents, and check what was shared with you.'}
              </p>
            </div>

            <div className="rounded-xl bg-white/10 p-2 backdrop-blur">
              <span className="block text-[10px] font-bold uppercase tracking-wider text-indigo-100">
                Logged in as {roleLabel}
              </span>
              <p className="mt-0.5 text-sm font-semibold text-white">{user.name}</p>
              <span className="block max-w-[15rem] truncate font-mono text-[10px] text-indigo-100">
                {user.email ?? user.did}
              </span>
              <button
                type="button"
                onClick={logout}
                className="mt-1.5 w-full rounded-lg bg-white/95 px-2 py-1 text-xs font-bold text-slate-700 hover:bg-white"
              >
                Log out
              </button>
            </div>
          </div>
        </div>
      </header>

      {(user.kind === 'organization' || user.kind === 'issuer') && (
        <>
          <TabBar tabs={ORG_TABS} active={orgTab} onChange={setOrgTab} />
          <main className="mx-auto max-w-5xl px-4 py-5 sm:px-6 sm:py-6">
            <p className="mb-4 text-sm text-slate-500">
              {ORG_TABS.find((t) => t.id === orgTab)?.blurb}
            </p>
            {orgTab === 'dashboard' && <OrganizationTab />}
            {orgTab === 'audit' && <AuditTab />}
          </main>
        </>
      )}

      {user.kind === 'admin' && (
        <>
          <TabBar tabs={ADMIN_TABS} active={adminTab} onChange={setAdminTab} />
          <main className="mx-auto max-w-5xl px-4 py-5 sm:px-6 sm:py-6">
            <p className="mb-4 text-sm text-slate-500">
              {ADMIN_TABS.find((t) => t.id === adminTab)?.blurb}
            </p>
            {adminTab === 'admin' && <AdminTab />}
            {adminTab === 'audit' && <AuditTab />}
          </main>
        </>
      )}

      {user.kind === 'verifier' && (
        <>
          <TabBar tabs={VERIFIER_TABS} active={verifierTab} onChange={setVerifierTab} />
          <main className="mx-auto max-w-5xl px-4 py-5 sm:px-6 sm:py-6">
            <p className="mb-4 text-sm text-slate-500">
              {VERIFIER_TABS.find((t) => t.id === verifierTab)?.blurb}
            </p>
            {verifierTab === 'verifier' && <VerifierTab userId={user.id} />}
            {verifierTab === 'audit' && <AuditTab />}
          </main>
        </>
      )}

      <Footer />
    </div>
  );
}

function TabBar<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: { id: T; label: string; icon: string; blurb: string }[];
  active: T;
  onChange: (tab: T) => void;
}) {
  return (
    <nav className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-2 sm:px-6">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onChange(item.id)}
            aria-current={active === item.id ? 'page' : undefined}
            className={`flex shrink-0 items-center gap-2 border-b-2 px-3 py-3 text-sm font-semibold transition ${
              active === item.id
                ? 'border-indigo-600 text-indigo-700'
                : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700'
            }`}
          >
            <span aria-hidden="true">{item.icon}</span>
            {item.label}
          </button>
        ))}
      </div>
    </nav>
  );
}

function Footer() {
  return (
    <footer className="mx-auto max-w-5xl px-4 pb-10 text-center text-xs text-slate-400 sm:px-6">
      <p>
        LifeLink · W3C Verifiable Credentials (SD-JWT / Ed25519) · did:key &amp; did:web · W3C Bitstring
        Status List · hash-chained audit log · API at <code>{API_BASE}</code>
      </p>
    </footer>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
}
