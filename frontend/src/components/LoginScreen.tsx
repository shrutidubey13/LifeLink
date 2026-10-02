/**
 * The front door: citizen and verifier login + registration.
 *
 * One-click demo buttons log in with the seeded accounts so a demo never gets
 * stuck typing passwords on stage.
 */
import { useState } from 'react';
import { useAuth } from '../lib/auth';
import type { AccountKind } from '../lib/types';
import { Field, InlineError, Spinner } from './ui';

const DEMO_ACCOUNTS: { kind: AccountKind; label: string; email: string; password: string }[] = [
  { kind: 'citizen', label: 'Demo Student (citizen)', email: 'student@demo.lifelink', password: 'lifelink123' },
  { kind: 'verifier', label: 'Demo Bank (verifier)', email: 'bank@demo.lifelink', password: 'lifelink123' },
  { kind: 'verifier', label: 'Demo Employer HR (verifier)', email: 'hr@demo.lifelink', password: 'lifelink123' },
];

export function LoginScreen() {
  const { login, register, pending, error } = useAuth();
  const [kind, setKind] = useState<AccountKind>('citizen');
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [demoPending, setDemoPending] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (mode === 'login') {
      await login(kind, email.trim(), password);
    } else {
      await register(kind, name.trim(), email.trim(), password);
    }
  }

  async function demoLogin(account: (typeof DEMO_ACCOUNTS)[number]) {
    setDemoPending(account.email);
    await login(account.kind, account.email, account.password);
    setDemoPending(null);
  }

  const busy = pending || demoPending !== null;

  return (
    <div className="mx-auto flex min-h-[70vh] w-full max-w-md flex-col justify-center px-4 py-10">
      <div className="text-center">
        <p className="text-4xl" aria-hidden="true">🔗</p>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">Welcome to LifeLink</h1>
        <p className="mt-1 text-sm text-slate-500">
          Citizens own their wallet. Verifiers check what was shared with them. Log in to begin.
        </p>
      </div>

      <div className="card mt-6">
        {/* role picker */}
        <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1" role="tablist" aria-label="I am a">
          {(['citizen', 'verifier'] as AccountKind[]).map((option) => (
            <button
              key={option}
              type="button"
              role="tab"
              aria-selected={kind === option}
              onClick={() => setKind(option)}
              className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${
                kind === option ? 'bg-white text-indigo-700 shadow' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {option === 'citizen' ? '👛 Citizen' : '🏦 Verifier'}
            </button>
          ))}
        </div>

        {/* login / register toggle */}
        <div className="mt-4 flex gap-4 border-b border-slate-200">
          {(['login', 'register'] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setMode(option)}
              className={`pb-2 text-sm font-semibold ${
                mode === option ? 'border-b-2 border-indigo-600 text-indigo-700' : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              {option === 'login' ? 'Log in' : 'Create account'}
            </button>
          ))}
        </div>

        <form onSubmit={(e) => void submit(e)} className="mt-4 space-y-4">
          {mode === 'register' && (
            <Field label={kind === 'citizen' ? 'Your full name' : 'Organisation name'} htmlFor="auth-name">
              <input
                id="auth-name"
                className="input"
                autoComplete="name"
                placeholder={kind === 'citizen' ? 'e.g. Priya Sharma' : 'e.g. Demo Bank'}
                value={name}
                disabled={busy}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
          )}

          <Field label="Email" htmlFor="auth-email">
            <input
              id="auth-email"
              className="input"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              disabled={busy}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>

          <Field
            label="Password"
            htmlFor="auth-password"
            hint={mode === 'register' ? 'At least 8 characters.' : undefined}
          >
            <input
              id="auth-password"
              className="input"
              type="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              placeholder="••••••••"
              value={password}
              disabled={busy}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>

          <InlineError error={error} />

          <button type="submit" className="btn-primary w-full" disabled={busy}>
            {pending ? (
              <>
                <Spinner /> {mode === 'login' ? 'Logging in…' : 'Creating account…'}
              </>
            ) : mode === 'login' ? (
              `Log in as ${kind}`
            ) : (
              `Create ${kind} account`
            )}
          </button>
        </form>

        <div className="mt-5 border-t border-slate-100 pt-4">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
            One-click demo accounts
          </p>
          <div className="mt-2 space-y-2">
            {DEMO_ACCOUNTS.map((account) => (
              <button
                key={account.email}
                type="button"
                className="btn-secondary w-full justify-start"
                disabled={busy}
                onClick={() => void demoLogin(account)}
              >
                {demoPending === account.email ? <Spinner /> : null}
                {account.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <p className="mt-4 text-center text-xs text-slate-400">
        Passwords are bcrypt-hashed on the server and sessions are short-lived signed tokens.
      </p>
    </div>
  );
}
