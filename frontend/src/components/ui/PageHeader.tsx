import { type ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';

export interface PageHeaderProps {
  title: string;
  subtitle?: string;
  badge?: ReactNode;
  actions?: ReactNode;
  backButton?: {
    label?: string;
    onClick: () => void;
  };
  className?: string;
}

export function PageHeader({
  title,
  subtitle,
  badge,
  actions,
  backButton,
  className = '',
}: PageHeaderProps) {
  return (
    <div className={`mb-6 sm:mb-8 ${className}`}>
      {backButton && (
        <button
          type="button"
          onClick={backButton.onClick}
          className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500 hover:text-blue-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded transition-colors"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          <span>{backButton.label ?? 'Back'}</span>
        </button>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
              {title}
            </h1>
            {badge && <div>{badge}</div>}
          </div>
          {subtitle && (
            <p className="mt-1.5 text-base text-slate-600 max-w-3xl leading-relaxed">
              {subtitle}
            </p>
          )}
        </div>

        {actions && (
          <div className="flex flex-wrap items-center gap-2.5 shrink-0 sm:self-start pt-1 sm:pt-0">
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}
