import { type ReactNode } from 'react';
import { Loader2, AlertCircle, RefreshCw } from 'lucide-react';
import { errorMessage } from '../../lib/format';
import { CopyButton } from './CopyButton';

/* ---------------- state placeholders ---------------- */

export function Spinner({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <Loader2 className={`animate-spin text-blue-600 ${className}`} aria-hidden="true" />
  );
}

export function LoadingBlock({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2.5 rounded-2xl border border-dashed border-slate-300 bg-slate-50/70 px-4 py-8 text-sm font-medium text-slate-500">
      <Spinner className="h-5 w-5" />
      <span>{label}</span>
    </div>
  );
}

export function ErrorBlock({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="animate-fade-in rounded-2xl border border-rose-200 bg-rose-50/80 p-5 shadow-sm"
    >
      <div className="flex items-start gap-3">
        <AlertCircle className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <p className="text-base font-semibold text-rose-800">Something went wrong</p>
          <p className="mt-1 break-words text-sm text-rose-700 leading-relaxed">{message}</p>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-rose-300 bg-white px-3.5 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 transition-colors"
            >
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              <span>Try again</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function InlineError({ error }: { error: string | null | undefined }) {
  if (!error) return null;
  return (
    <div
      role="alert"
      className="mt-2 flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700"
    >
      <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{error}</span>
    </div>
  );
}

/* ---------------- form helpers ---------------- */

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
      <label className="mb-1.5 block text-sm font-semibold text-slate-700" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint && <p className="mt-1.5 text-xs text-slate-500">{hint}</p>}
    </div>
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
      className={`flex w-full items-start gap-3 rounded-xl border p-4 text-left transition-colors ${
        checked
          ? 'border-blue-300 bg-blue-50/70'
          : 'border-slate-200 bg-white hover:border-slate-300'
      }`}
    >
      <span
        aria-hidden="true"
        className={`mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors ${
          checked ? 'bg-blue-600' : 'bg-slate-300'
        }`}
      >
        <span
          className={`h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
            checked ? 'translate-x-4' : 'translate-x-0'
          }`}
        />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-base font-semibold text-slate-800">{label}</span>
        {description && <span className="mt-0.5 block text-sm text-slate-500">{description}</span>}
      </span>
    </button>
  );
}

/* ---------------- typography and key-values ---------------- */

export function SectionTitle({
  children,
  hint,
}: {
  children: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h3 className="text-sm font-bold uppercase tracking-wider text-slate-600">
        {children}
      </h3>
      {hint && <span className="text-sm text-slate-400">{hint}</span>}
    </div>
  );
}

export function Mono({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return <span className={`font-mono text-sm ${className}`}>{children}</span>;
}

export function KeyValue({
  label,
  value,
}: {
  label: ReactNode;
  value: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 py-2.5 last:border-0">
      <span className="text-sm font-medium text-slate-500">{label}</span>
      <span className="break-all text-right text-base font-semibold text-slate-800">{value}</span>
    </div>
  );
}

export function DidTag({ did }: { did: string }) {
  if (!did) return null;
  const short = did.length > 22 ? `${did.slice(0, 14)}…${did.slice(-6)}` : did;

  return (
    <span
      title={did}
      className="inline-flex max-w-full items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 py-1 font-mono text-sm text-slate-700 border border-slate-200/60"
    >
      <span className="truncate">{short}</span>
      <CopyButton text={did} label={`Copy DID: ${did}`} />
    </span>
  );
}

export { errorMessage };
