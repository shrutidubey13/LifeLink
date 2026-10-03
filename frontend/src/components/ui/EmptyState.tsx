import { type ReactNode } from 'react';
import { Inbox } from 'lucide-react';

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  body?: string; // backwards compatibility with old ui.tsx
  action?: ReactNode;
  className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  body,
  action,
  className = '',
}: EmptyStateProps) {
  const desc = description ?? body;

  return (
    <div
      className={`flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50/70 p-8 text-center sm:p-10 ${className}`}
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-slate-400 shadow-sm border border-slate-200 mb-4">
        {icon || <Inbox className="h-6 w-6" aria-hidden="true" />}
      </div>
      <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
      {desc && (
        <p className="mt-1.5 max-w-sm text-xs text-slate-500 leading-relaxed">
          {desc}
        </p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
