import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'outline'
  | 'ghost'
  | 'danger'
  | 'danger-outline'
  | 'success';

export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
  iconRight?: ReactNode;
  fullWidth?: boolean;
  children?: ReactNode;
}

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800 shadow-sm focus-visible:ring-blue-500',
  secondary:
    'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 active:bg-slate-100 shadow-sm focus-visible:ring-slate-400',
  outline:
    'border border-blue-600 text-blue-600 hover:bg-blue-50 active:bg-blue-100 focus-visible:ring-blue-500',
  ghost:
    'text-slate-600 hover:bg-slate-100 hover:text-slate-900 active:bg-slate-200 focus-visible:ring-slate-400',
  danger:
    'bg-rose-600 text-white hover:bg-rose-700 active:bg-rose-800 shadow-sm focus-visible:ring-rose-500',
  'danger-outline':
    'border border-rose-300 bg-white text-rose-700 hover:bg-rose-50 active:bg-rose-100 focus-visible:ring-rose-500',
  success:
    'bg-emerald-600 text-white hover:bg-emerald-700 active:bg-emerald-800 shadow-sm focus-visible:ring-emerald-500',
};

const SIZES: Record<ButtonSize, string> = {
  xs: 'px-3 py-1.5 text-xs font-semibold rounded-lg gap-1.5',
  sm: 'px-3.5 py-2 text-sm font-semibold rounded-xl gap-2',
  md: 'px-5 py-2.5 text-base font-semibold rounded-xl gap-2 min-h-[44px]',
  lg: 'px-6 py-3 text-base font-bold rounded-2xl gap-2.5 min-h-[48px]',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'primary',
      size = 'md',
      loading = false,
      icon,
      iconRight,
      fullWidth = false,
      disabled,
      className = '',
      children,
      type = 'button',
      ...rest
    },
    ref,
  ) => {
    const isDisabled = disabled || loading;

    return (
      <button
        ref={ref}
        type={type}
        disabled={isDisabled}
        aria-busy={loading ? 'true' : undefined}
        className={`inline-flex items-center justify-center font-medium transition-colors duration-150 select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
          VARIANTS[variant]
        } ${SIZES[size]} ${fullWidth ? 'w-full' : ''} ${className}`}
        {...rest}
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin shrink-0" aria-hidden="true" />
        ) : (
          icon && <span className="shrink-0" aria-hidden="true">{icon}</span>
        )}
        {children && <span>{children}</span>}
        {!loading && iconRight && (
          <span className="shrink-0" aria-hidden="true">{iconRight}</span>
        )}
      </button>
    );
  },
);

Button.displayName = 'Button';
