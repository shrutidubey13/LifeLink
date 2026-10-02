/**
 * LifeLink app shell: header, citizen switcher, and the four tabs.
 *
 * The shell also carries the hand-off between the Wallet and the Verifier: when
 * the citizen approves a share, the presentation travels to the verifier portal
 * so a demo can go wallet -> verifier in one click.
 */
import { useCallback, useState } from 'react';
import { api, API_BASE } from './lib/api';
import { useRequest } from './lib/hooks';
import type { Credential, ShareResult } from './lib/types';
import { WalletTab } from './tabs/WalletTab';
import { IssuerTab } from './tabs/IssuerTab';
import { VerifierTab } from './tabs/VerifierTab';
import { AuditTab } from './tabs/AuditTab';
import { ErrorBlock, LoadingBlock } from './components/ui';

type TabId = 'wallet' | 'issuer' | 'verifier' | 'audit';

const TABS: { id: TabId; label: string; icon: string; blurb: string }[] = [
  { id: 'wallet', label: 'Wallet', icon: '👛', blurb: 'Your credentials and sharing' },
  { id: 'issuer', label: 'Issuer portal', icon: '🏫', blurb: 'Sign and revoke credentials' },
  { id: 'verifier', label: 'Verifier portal', icon: '🏦', blurb: 'Check what a citizen shared' },
  { id: 'audit', label: 'Audit log', icon: '🔗', blurb: 'Tamper-evident history' },
];

export default function App() {
  const citizens = useRequest(() => api.citizens(), 'citizens');
  const [citizenId, setCitizenId] = useState<number | ''>('');
  const [tab, setTab] = useState<TabId>('wallet');
  const [pending, setPending] = useState<ShareResult | null>(null);

  const citizenList = citizens.data?.citizens ?? [];
  const activeCitizen = citizenList.find((c) => c.id === citizenId) ?? citizenList[0] ?? null;

  const handToVerifier = useCallback((result: ShareResult, _credential: Credential) => {
    setPending(result);
    setTab('verifier');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  return (
    <div className="min-h-screen">
      {/* header */}
      <header className="bg-gradient-to-br from-indigo-700 via-indigo-600 to-sky-600 text-white">
        <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight sm:text-3xl">
                <span aria-hidden="true">🔗</span> LifeLink
              </h1>
              <p className="mt-1 max-w-xl text-sm text-indigo-50">
                One wallet for your whole life. Verify your degree, job, bank KYC and health records
                without re-uploading a single document — and decide exactly what each verifier sees.
              </p>
            </div>

            {activeCitizen && (
              <label className="rounded-xl bg-white/10 p-2 backdrop-blur">
                <span className="block text-[10px] font-bold uppercase tracking-wider text-indigo-100">
                  Wallet owner
                </span>
                <select
                  className="mt-0.5 w-full rounded-lg border-0 bg-white/95 px-2 py-1 text-sm font-semibold text-slate-800 focus:ring-2 focus:ring-white"
                  value={activeCitizen.id}
                  onChange={(event) => setCitizenId(Number(event.target.value))}
                >
                  {citizenList.map((citizen) => (
                    <option key={citizen.id} value={citizen.id}>
                      {citizen.name}
                    </option>
                  ))}
                </select>
                <span className="mt-1 block max-w-[15rem] truncate font-mono text-[10px] text-indigo-100">
                  {activeCitizen.did}
                </span>
              </label>
            )}
          </div>
        </div>
      </header>

      {/* tabs */}
      <nav className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-2 sm:px-6">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              aria-current={tab === item.id ? 'page' : undefined}
              className={`flex shrink-0 items-center gap-2 border-b-2 px-3 py-3 text-sm font-semibold transition ${
                tab === item.id
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

      {/* content */}
      <main className="mx-auto max-w-5xl px-4 py-5 sm:px-6 sm:py-6">
        <p className="mb-4 text-sm text-slate-500">{TABS.find((t) => t.id === tab)?.blurb}</p>

        {citizens.loading && <LoadingBlock label="Connecting to the LifeLink API…" />}
        {citizens.error && (
          <div className="space-y-3">
            <ErrorBlock message={citizens.error} onRetry={citizens.reload} />
            <div className="card text-sm text-slate-600">
              <p className="font-semibold text-slate-800">Start the backend first:</p>
              <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-900 p-3 font-mono text-xs text-slate-100">
{`cd backend
npm install
npm run db:init
npm run seed
npm run dev`}
              </pre>
              <p className="mt-2 text-xs text-slate-500">
                API base URL: <code className="rounded bg-slate-100 px-1">{API_BASE}</code>
              </p>
            </div>
          </div>
        )}

        {activeCitizen && tab === 'wallet' && <WalletTab citizen={activeCitizen} onHandToVerifier={handToVerifier} />}
        {activeCitizen && tab === 'issuer' && <IssuerTab citizens={citizenList} />}
        {activeCitizen && tab === 'verifier' && (
          <VerifierTab pending={pending} onConsumed={() => setPending(null)} />
        )}
        {tab === 'audit' && <AuditTab />}

        {citizenList.length === 0 && !citizens.loading && !citizens.error && (
          <div className="card">
            <p className="text-sm text-slate-600">
              No citizens exist yet. Run <code className="rounded bg-slate-100 px-1">npm run seed</code> in
              the <code className="rounded bg-slate-100 px-1">backend</code> folder.
            </p>
          </div>
        )}
      </main>

      <footer className="mx-auto max-w-5xl px-4 pb-10 text-center text-xs text-slate-400 sm:px-6">
        <p>
          LifeLink · W3C Verifiable Credentials (SD-JWT / Ed25519) · did:key &amp; did:web · W3C Bitstring
          Status List · hash-chained audit log
        </p>
      </footer>
    </div>
  );
}
