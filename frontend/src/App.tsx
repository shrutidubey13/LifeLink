/**
 * LifeLink app shell: login gate, role-based tabs, and session header.
 *
 * Citizens see:  Wallet (credentials + sharing + who verified me), Issuer portal, Audit log.
 * Verifiers see: Verifier portal (profile + verify + history), Audit log.
 *
 * The issuer portal stays open to every logged-in user on purpose: in this
 * demo the citizen drives issuance themselves (standing in for the university).
 * In production, issuers would be separate accounts with their own login.
 */
import { useEffect, useState } from 'react';
import { API_BASE, api } from './lib/api';
import { AuthProvider, useAuth } from './lib/auth';
import { useRequest } from './lib/hooks';
import type { Citizen } from './lib/types';
import { WalletTab } from './tabs/WalletTab';
import { IssuerTab } from './tabs/IssuerTab';
import { VerifierTab } from './tabs/VerifierTab';
import { AuditTab } from './tabs/AuditTab';
import { LoginScreen } from './components/LoginScreen';
import { ErrorBlock, LoadingBlock } from './components/ui';

type CitizenTab = 'wallet' | 'issuer' | 'audit';
type VerifierTabId = 'verifier' | 'audit';

const CITIZEN_TABS: { id: CitizenTab; label: string; icon: string; blurb: string }[] = [
  { id: 'wallet', label: 'Wallet', icon: '👛', blurb: 'Your credentials, sharing, and who verified you' },
  { id: 'issuer', label: 'Issuer portal', icon: '🏫', blurb: 'Sign and revoke credentials (demo stand-in for institutions)' },
  { id: 'audit', label: 'Audit log', icon: '🔗', blurb: 'Tamper-evident history' },
];

const VERIFIER_TABS: { id: VerifierTabId; label: string; icon: string; blurb: string }[] = [
  { id: 'verifier', label: 'Verifier portal', icon: '🏦', blurb: 'Your profile, verifications, and checking shared records' },
  { id: 'audit', label: 'Audit log', icon: '🔗', blurb: 'Tamper-evident history' },
];

function Shell() {
  const { user, ready, logout } = useAuth();
  const [citizenTab, setCitizenTab] = useState<CitizenTab>('wallet');
  const [verifierTab, setVerifierTab] = useState<VerifierTabId>('verifier');

  // The citizen directory backs the issuer portal's "issue to whom" picker.
  // It is only fetched once logged in (it needs no login itself, but there is
  // no reason to fetch it for the login screen).
  const citizens = useRequest(() => (user ? api.citizens() : Promise.resolve(null)), `citizens-${user?.id ?? 'none'}`);

  useEffect(() => {
    if (user?.kind === 'citizen') setCitizenTab('wallet');
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

  const citizen: Citizen | null =
    user.kind === 'citizen'
      ? { id: user.id, name: user.name, did: user.did, email: user.email, hasLogin: true, createdAt: '' }
      : null;

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
                {user.kind === 'citizen'
                  ? 'Your verified life, your data. Share exactly what is needed — nothing more.'
                  : 'Check what citizens shared with you. Only consented fields ever arrive.'}
              </p>
            </div>

            <div className="rounded-xl bg-white/10 p-2 backdrop-blur">
              <span className="block text-[10px] font-bold uppercase tracking-wider text-indigo-100">
                Logged in as {user.kind}
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

      {user.kind === 'citizen' && citizen ? (
        <>
          <TabBar
            tabs={CITIZEN_TABS}
            active={citizenTab}
            onChange={setCitizenTab}
          />
          <main className="mx-auto max-w-5xl px-4 py-5 sm:px-6 sm:py-6">
            <p className="mb-4 text-sm text-slate-500">
              {CITIZEN_TABS.find((t) => t.id === citizenTab)?.blurb}
            </p>
            {citizenTab === 'wallet' && <WalletTab citizen={citizen} />}
            {citizenTab === 'issuer' && (
              <>
                {citizens.loading && <LoadingBlock label="Loading…" />}
                {citizens.error && <ErrorBlock message={citizens.error} onRetry={citizens.reload} />}
                {(citizens.data || (!citizens.loading && !citizens.error)) && (
                  <IssuerTab citizens={citizens.data?.citizens ?? []} />
                )}
              </>
            )}
            {citizenTab === 'audit' && <AuditTab />}
          </main>
        </>
      ) : (
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
