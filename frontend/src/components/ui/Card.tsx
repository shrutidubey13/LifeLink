import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';

export interface CardProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ title, subtitle, actions, children, className = '', ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={`rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-shadow ${className}`}
        {...props}
      >
        {(title || subtitle || actions) && (
          <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              {title && (
                <h3 className="text-base font-semibold text-slate-900 leading-snug">{title}</h3>
              )}
              {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
            </div>
            {actions && <div className="flex items-center gap-2">{actions}</div>}
          </header>
        )}
        {children}
      </div>
    );
  },
);
Card.displayName = 'Card';

export function CardHeader({
  className = '',
  children,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`mb-4 flex flex-wrap items-start justify-between gap-3 ${className}`} {...props}>
      {children}
    </div>
  );
}

export function CardTitle({
  className = '',
  children,
  ...props
}: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3 className={`text-base font-semibold text-slate-900 ${className}`} {...props}>
      {children}
    </h3>
  );
}

export function CardDescription({
  className = '',
  children,
  ...props
}: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={`mt-0.5 text-sm text-slate-500 ${className}`} {...props}>
      {children}
    </p>
  );
}

export function CardContent({
  className = '',
  children,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={className} {...props}>
      {children}
    </div>
  );
}

export function CardFooter({
  className = '',
  children,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`mt-4 pt-4 border-t border-slate-100 flex items-center justify-between gap-3 ${className}`} {...props}>
      {children}
    </div>
  );
}
