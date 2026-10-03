import { useState, type FormEvent } from 'react';
import {
  Link2,
  Shield,
  Building2,
  GraduationCap,
  FileCheck,
  CheckCircle2,
  Lock,
  ArrowRight,
  Eye,
  EyeOff,
  Sparkles,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import type { AccountKind } from '../lib/types';
import { Button } from './ui';
import { useTitle } from '../lib/useTitle';

interface RoleOption {
  id: AccountKind;
  label: string;
  icon: typeof GraduationCap;
  description: string;
}

const ROLES: RoleOption[] = [
  {
    id: 'citizen',
    label: 'Student',
    icon: GraduationCap,
    description: 'Student wallet: manage, selectively disclose, and share verified documents',
  },
  {
    id: 'organization',
    label: 'Organization',
    icon: Building2,
    description: 'Review document requests, issue signed credentials, and verify presentations',
  },
  {
    id: 'verifier',
    label: 'Verifier',
    icon: FileCheck,
    description: 'Request specific document fields and verify cryptographic proofs instantly',
  },
  {
    id: 'admin',
    label: 'Admin',
    icon: Shield,
    description: 'Manage trust registry, registered institutions, and system audit logs',
  },
];

export function LoginScreen() {
  useTitle('Sign In');
  const { login, register, pending, error } = useAuth();
  const [kind, setKind] = useState<AccountKind>('citizen');
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Field-level validation errors
  const [touched, setTouched] = useState<{ name?: boolean; email?: boolean; password?: boolean }>({});

  const validateEmail = (val: string) => {
    if (!val.trim()) return 'Email is required';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val.trim())) return 'Please enter a valid email address';
    return null;
  };

  const validatePassword = (val: string) => {
    if (!val) return 'Password is required';
    if (val.length < 8) return 'Password must be at least 8 characters';
    return null;
  };

  const validateName = (val: string) => {
    if (mode === 'register' && !val.trim()) return 'Full name is required';
    return null;
  };

  const emailError = touched.email ? validateEmail(email) : null;
  const passwordError = touched.password ? validatePassword(password) : null;
  const nameError = touched.name ? validateName(name) : null;

  const isFormValid =
    !validateEmail(email) &&
    !validatePassword(password) &&
    (mode === 'login' || !validateName(name));

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setTouched({ name: true, email: true, password: true });

    if (!isFormValid) return;

    if (mode === 'login') {
      await login(kind, email.trim(), password);
    } else {
      await register(kind, name.trim(), email.trim(), password);
    }
  }

  const canRegister = kind === 'citizen';
  const activeRole = ROLES.find((r) => r.id === kind) ?? ROLES[0];

  return (
    <div className="min-h-screen w-full flex flex-col lg:flex-row bg-slate-50 font-sans antialiased text-slate-800">
      {/* Brand Panel on Desktop */}
      <div className="lg:w-5/12 xl:w-1/2 bg-gradient-to-br from-blue-700 via-blue-800 to-indigo-950 text-white p-8 sm:p-12 lg:p-16 flex flex-col justify-between relative overflow-hidden">
        {/* Glow decorations */}
        <div className="absolute -top-32 -right-32 w-96 h-96 rounded-full bg-blue-500/20 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-32 -left-32 w-96 h-96 rounded-full bg-indigo-500/20 blur-3xl pointer-events-none" />

        <div className="relative z-10">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10 backdrop-blur border border-white/20 shadow-md text-white">
              <Link2 className="h-6 w-6" aria-hidden="true" />
            </div>
            <div>
              <span className="text-3xl font-extrabold tracking-tight text-white block leading-none">
                GitLink
              </span>
              <span className="text-sm text-blue-200 font-medium block mt-1">
                Student-Owned Identity Wallet
              </span>
            </div>
          </div>

          {/* Value Prop */}
          <div className="mt-14 lg:mt-20">
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-semibold bg-blue-500/30 text-blue-100 border border-blue-400/30 backdrop-blur mb-5">
              <Sparkles className="h-4 w-4 text-blue-300" />
              W3C Verifiable Credentials
            </div>
            <h1 className="text-3xl sm:text-4xl xl:text-5xl font-extrabold tracking-tight text-white leading-tight">
              Your verified records, entirely student-owned.
            </h1>
            <p className="mt-5 text-base sm:text-lg text-blue-100/90 leading-relaxed max-w-xl">
              Store university degrees, employment letters, bank statements, and health records in one tamper-evident wallet.
              Grant granular access with full cryptographic proof and instant revocation.
            </p>
          </div>

          {/* 3 Core Benefits */}
          <div className="mt-12 space-y-6 max-w-lg">
            <div className="flex items-start gap-4">
              <div className="p-2 rounded-xl bg-white/10 text-blue-300 shrink-0 mt-0.5 border border-white/10">
                <CheckCircle2 className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-white">SD-JWT Selective Disclosure</h2>
                <p className="text-sm text-blue-100/80 mt-0.5">
                  Reveal only the specific fields a verifier requires. Sensitive attributes remain undisclosed.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-4">
              <div className="p-2 rounded-xl bg-white/10 text-blue-300 shrink-0 mt-0.5 border border-white/10">
                <FileCheck className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-white">W3C Compliant &amp; Real-Time Revocation</h2>
                <p className="text-sm text-blue-100/80 mt-0.5">
                  Built on did:key and did:web standards with Bitstring Status Lists for instant status checks.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-4">
              <div className="p-2 rounded-xl bg-white/10 text-blue-300 shrink-0 mt-0.5 border border-white/10">
                <Lock className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-white">Tamper-Evident Audit Hash Chain</h2>
                <p className="text-sm text-blue-100/80 mt-0.5">
                  Every issuance, consent grant, and verification is anchored in an immutable SHA-256 chain.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Footer info in brand panel */}
        <div className="mt-12 pt-6 border-t border-white/15 text-xs text-blue-200/80 relative z-10 flex flex-wrap justify-between items-center gap-2">
          <span>Enterprise-Grade Ed25519 &amp; AES-256 Security</span>
          <span>W3C VC 2.0 Standard</span>
        </div>
      </div>

      {/* Right Form Column */}
      <div className="lg:w-7/12 xl:w-1/2 flex items-center justify-center p-6 sm:p-10 lg:p-14">
        <div className="w-full max-w-[480px] bg-white rounded-3xl p-8 sm:p-10 shadow-xl border border-slate-200/80">
          {/* Header */}
          <div className="mb-8">
            <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
              {mode === 'login' ? 'Sign In to GitLink' : 'Create Student Account'}
            </h2>
            <p className="text-sm sm:text-base text-slate-500 mt-2">
              {activeRole.description}
            </p>
          </div>

          {/* Role Selector: Big Segmented Buttons */}
          <div className="mb-6">
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-2">
              Select Your Role
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-1.5 rounded-2xl bg-slate-100 border border-slate-200/80">
              {ROLES.map((role) => {
                const Icon = role.icon;
                const active = kind === role.id;
                return (
                  <button
                    key={role.id}
                    type="button"
                    onClick={() => {
                      setKind(role.id);
                      if (role.id !== 'citizen') setMode('login');
                    }}
                    className={`flex flex-col items-center justify-center gap-1.5 py-3 px-2 rounded-xl text-xs font-semibold transition-all ${
                      active
                        ? 'bg-white text-blue-700 shadow-md border border-slate-200 font-bold scale-[1.02]'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
                    }`}
                  >
                    <Icon className={`h-5 w-5 ${active ? 'text-blue-600' : 'text-slate-500'}`} />
                    <span>{role.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Mode switch for Student (Sign In vs Create Account) */}
          {canRegister && (
            <div className="flex border-b border-slate-200 mb-6">
              <button
                type="button"
                onClick={() => setMode('login')}
                className={`pb-3 px-4 text-sm font-semibold transition-colors relative ${
                  mode === 'login' ? 'text-blue-700' : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                Sign In
                {mode === 'login' && (
                  <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600 rounded-full" />
                )}
              </button>
              <button
                type="button"
                onClick={() => setMode('register')}
                className={`pb-3 px-4 text-sm font-semibold transition-colors relative ${
                  mode === 'register' ? 'text-blue-700' : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                Create Account
                {mode === 'register' && (
                  <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600 rounded-full" />
                )}
              </button>
            </div>
          )}

          {/* API Error Notification */}
          {error && (
            <div className="mb-6 rounded-xl bg-rose-50 border border-rose-200 p-4 text-sm text-rose-800 flex items-start gap-3">
              <div className="h-2 w-2 rounded-full bg-rose-500 mt-1.5 shrink-0" />
              <div className="flex-1 font-medium">{error}</div>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-5">
            {mode === 'register' && (
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                  Full Name
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    if (touched.name) setTouched((t) => ({ ...t, name: true }));
                  }}
                  onBlur={() => setTouched((t) => ({ ...t, name: true }))}
                  placeholder="e.g. Aarav Sharma"
                  className={`w-full h-12 px-4 rounded-xl text-base border bg-white text-slate-900 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                    nameError ? 'border-rose-400 bg-rose-50/20' : 'border-slate-300 hover:border-slate-400'
                  }`}
                  disabled={pending}
                  required
                />
                {nameError && (
                  <p className="mt-1.5 text-xs text-rose-600 font-medium">{nameError}</p>
                )}
              </div>
            )}

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                Email Address
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (touched.email) setTouched((t) => ({ ...t, email: true }));
                }}
                onBlur={() => setTouched((t) => ({ ...t, email: true }))}
                placeholder={
                  kind === 'citizen'
                    ? 'student@gitlink.org'
                    : kind === 'organization'
                    ? 'university@gitlink.org'
                    : kind === 'verifier'
                    ? 'bank-verify@gitlink.org'
                    : 'admin@gitlink.org'
                }
                className={`w-full h-12 px-4 rounded-xl text-base border bg-white text-slate-900 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                  emailError ? 'border-rose-400 bg-rose-50/20' : 'border-slate-300 hover:border-slate-400'
                }`}
                disabled={pending}
                required
              />
              {emailError && (
                <p className="mt-1.5 text-xs text-rose-600 font-medium">{emailError}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (touched.password) setTouched((t) => ({ ...t, password: true }));
                  }}
                  onBlur={() => setTouched((t) => ({ ...t, password: true }))}
                  placeholder="Enter your password"
                  className={`w-full h-12 pl-4 pr-12 rounded-xl text-base border bg-white text-slate-900 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                    passwordError ? 'border-rose-400 bg-rose-50/20' : 'border-slate-300 hover:border-slate-400'
                  }`}
                  disabled={pending}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
              {passwordError && (
                <p className="mt-1.5 text-xs text-rose-600 font-medium">{passwordError}</p>
              )}
            </div>

            <div className="pt-2">
              <Button
                type="submit"
                variant="primary"
                size="lg"
                className="w-full h-12 text-base font-semibold shadow-md flex items-center justify-center gap-2"
                disabled={pending}
              >
                <span>{pending ? 'Processing...' : mode === 'login' ? 'Sign In' : 'Create Account'}</span>
                {!pending && <ArrowRight className="h-5 w-5" />}
              </Button>
            </div>
          </form>

          {/* Notice */}
          <div className="mt-8 text-center">
            <p className="text-xs text-slate-500">
              Secured by W3C Verifiable Credentials and GitLink Trust Architecture.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
