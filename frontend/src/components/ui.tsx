/**
 * Small shared UI pieces. Everything is mobile-first: single column on a phone,
 * multi-column from `sm` upwards.
 */
import type { ReactNode } from 'react';
import { errorMessage } from '../lib/format';

/* ---------------- layout ---------------- */

export function Card({
  title,
  subtitle,
  actions,
  children,
  className = '',
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            {title && <h2 className="text-base font-semibold text-slate-900">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
          </div>
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}

export function SectionTitle({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">{children}</h3>
      {hint && <span className="text-xs text-slate-400">{hint}</span>}
    </div>
  );
}

/* ---------------- state placeholders ---------------- */

export function Spinner({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

export function LoadingBlock({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-sm text-slate-500">
      <Spinner />
      {label}
    </div>
  );
}

export function ErrorBlock({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="animate-fade-in rounded-xl border border-rose-200 bg-rose-50 p-4">
      <p className="text-sm font-semibold text-rose-800">Something went wrong</p>
      <p className="mt-1 break-words text-sm text-rose-700">{message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="btn-secondary mt-3">
          Try again
        </button>
      )}
    </div>
  );
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center">
      <p className="text-sm font-semibold text-slate-700">{title}</p>
      <p className="mt-1 text-sm text-slate-500">{body}</p>
    </div>
  );
}

export function InlineError({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
      {error}
    </p>
  );
}

/* ---------------- badges ---------------- */

const BADGE_STYLES: Record<string, string> = {
  valid: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
  granted: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
  active: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
  trusted: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
  valid_yes: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
  revoked: 'bg-rose-50 text-rose-700 ring-1 ring-rose-200',
  denied: 'bg-rose-50 text-rose-700 ring-1 ring-rose-200',
  ended: 'bg-slate-100 text-slate-600 ring-1 ring-slate-300',
  untrusted: 'bg-rose-50 text-rose-700 ring-1 ring-rose-200',
  expired: 'bg-amber-50 text-amber-800 ring-1 ring-amber-200',
  broken: 'bg-rose-50 text-rose-700 ring-1 ring-rose-200',
  neutral: 'bg-slate-100 text-slate-600 ring-1 ring-slate-200',
  info: 'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200',
};

export function Badge({
  tone = 'neutral',
  children,
  title,
}: {
  tone?: keyof typeof BADGE_STYLES | string;
  children: ReactNode;
  title?: string;
}) {
  return (
    <span className={`pill ${BADGE_STYLES[tone] ?? BADGE_STYLES.neutral}`} title={title}>
      {children}
    </span>
  );
}

/** The status dot + word used on credential cards. */
export function StatusBadge({ status }: { status: string }) {
  const icon = status === 'valid' ? '●' : status === 'revoked' ? '●' : '●';
  const word = status === 'valid' ? 'Valid' : status === 'revoked' ? 'Revoked' : 'Expired';
  return (
    <Badge tone={status}>
      <span aria-hidden="true">{icon}</span>
      {word}
    </Badge>
  );
}

/* ---------------- form controls ---------------- */

export function Field({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label className="label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export function Select({
  id,
  value,
  onChange,
  children,
  disabled,
}: {
  id?: string;
  value: number | '';
  onChange: (value: number | '') => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <select
      id={id}
      className="input"
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value === '' ? '' : Number(event.target.value))}
    >
      {children}
    </select>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`flex w-full items-start gap-3 rounded-xl border p-3 text-left transition ${
        checked
          ? 'border-indigo-300 bg-indigo-50/70'
          : 'border-slate-200 bg-white hover:border-slate-300'
      }`}
    >
      <span
        aria-hidden="true"
        className={`mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition ${
          checked ? 'bg-indigo-600' : 'bg-slate-300'
        }`}
      >
        <span
          className={`h-4 w-4 rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-4' : 'translate-x-0'
          }`}
        />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-slate-800">{label}</span>
        {description && <span className="mt-0.5 block text-xs text-slate-500">{description}</span>}
      </span>
    </button>
  );
}

/* ---------------- misc ---------------- */

export function Mono({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <span className={`font-mono text-xs ${className}`}>{children}</span>;
}

export function KeyValue({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 py-1.5 last:border-0">
      <span className="text-xs text-slate-500">{label}</span>
      <span className="break-all text-right text-sm font-medium text-slate-800">{value}</span>
    </div>
  );
}

export function DidTag({ did }: { did: string }) {
  return (
    <span
      title={did}
      className="inline-flex max-w-full items-center gap-1 rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-600"
    >
      <span className="truncate">{did}</span>
    </span>
  );
}

export { errorMessage };
