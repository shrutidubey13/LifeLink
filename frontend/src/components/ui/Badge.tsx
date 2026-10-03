import { type HTMLAttributes, type ReactNode } from 'react';

export type BadgeTone =
  | 'valid'
  | 'granted'
  | 'active'
  | 'trusted'
  | 'valid_yes'
  | 'success'
  | 'revoked'
  | 'denied'
  | 'untrusted'
  | 'broken'
  | 'danger'
  | 'error'
  | 'expired'
  | 'warning'
  | 'pending'
  | 'info'
  | 'ended'
  | 'neutral';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone | string;
  size?: 'sm' | 'md';
  children: ReactNode;
}

const BADGE_STYLES: Record<string, string> = {
  valid: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/80',
  granted: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/80',
  active: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/80',
  trusted: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/80',
  valid_yes: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/80',
  success: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/80',
  revoked: 'bg-rose-50 text-rose-700 ring-1 ring-rose-200/80',
  denied: 'bg-rose-50 text-rose-700 ring-1 ring-rose-200/80',
  untrusted: 'bg-rose-50 text-rose-700 ring-1 ring-rose-200/80',
  broken: 'bg-rose-50 text-rose-700 ring-1 ring-rose-200/80',
  danger: 'bg-rose-50 text-rose-700 ring-1 ring-rose-200/80',
  error: 'bg-rose-50 text-rose-700 ring-1 ring-rose-200/80',
  expired: 'bg-amber-50 text-amber-800 ring-1 ring-amber-200/80',
  warning: 'bg-amber-50 text-amber-800 ring-1 ring-amber-200/80',
  pending: 'bg-amber-50 text-amber-800 ring-1 ring-amber-200/80',
  info: 'bg-blue-50 text-blue-700 ring-1 ring-blue-200/80',
  ended: 'bg-slate-100 text-slate-600 ring-1 ring-slate-300/80',
  neutral: 'bg-slate-100 text-slate-600 ring-1 ring-slate-200',
};

export function Badge({
  tone = 'neutral',
  size = 'sm',
  children,
  className = '',
  title,
  ...props
}: BadgeProps) {
  const sizeClasses =
    size === 'sm' ? 'px-2.5 py-0.5 text-xs font-semibold' : 'px-3 py-1 text-sm font-semibold';
  const colorClass = BADGE_STYLES[tone] ?? BADGE_STYLES.neutral;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-medium ${sizeClasses} ${colorClass} ${className}`}
      title={title}
      {...props}
    >
      {children}
    </span>
  );
}

/** The status dot + word used on credential cards. */
export function StatusBadge({ status }: { status: string }) {
  const norm = status.toLowerCase();
  const tone = norm === 'valid' ? 'valid' : norm === 'revoked' ? 'revoked' : 'expired';
  const word =
    norm === 'valid' ? 'Valid' : norm === 'revoked' ? 'Revoked' : 'Expired';

  return (
    <Badge tone={tone}>
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          tone === 'valid'
            ? 'bg-emerald-500'
            : tone === 'revoked'
            ? 'bg-rose-500'
            : 'bg-amber-500'
        }`}
        aria-hidden="true"
      />
      <span>{word}</span>
    </Badge>
  );
}
