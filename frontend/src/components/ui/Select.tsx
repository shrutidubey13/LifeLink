import React, {
  forwardRef,
  useId,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';
import { ChevronDown } from 'lucide-react';

export interface SelectProps
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'value' | 'onChange'> {
  label?: string;
  hint?: ReactNode;
  error?: string | null;
  value?: number | string;
  onChange?: (value: any) => void;
  children: ReactNode;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  (
    {
      label,
      hint,
      error,
      value,
      onChange,
      id: customId,
      disabled,
      className = '',
      children,
      ...props
    },
    ref,
  ) => {
    const generatedId = useId();
    const id = customId || generatedId;
    const errorId = `${id}-error`;
    const hintId = `${id}-hint`;

    function handleChange(event: React.ChangeEvent<HTMLSelectElement>) {
      if (!onChange) return;
      const raw = event.target.value;
      if (typeof value === 'number' || value === '') {
        // If current value is numeric or empty string, convert to number or empty string
        const parsed = raw === '' ? '' : isNaN(Number(raw)) ? raw : Number(raw);
        onChange(parsed);
      } else {
        onChange(raw);
      }
    }

    return (
      <div className="w-full">
        {label && (
          <label
            htmlFor={id}
            className="mb-1.5 block text-sm font-semibold text-slate-700"
          >
            {label}
          </label>
        )}

        <div className="relative">
          <select
            ref={ref}
            id={id}
            value={value}
            disabled={disabled}
            onChange={handleChange}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? errorId : hint ? hintId : undefined}
            className={`w-full h-12 appearance-none rounded-xl border bg-white px-4 pr-10 text-base text-slate-900 transition-colors focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400 ${
              error
                ? 'border-rose-300 focus:border-rose-500 focus:ring-rose-500/20'
                : 'border-slate-300 focus:border-blue-600 focus:ring-blue-600/20'
            } ${className}`}
            {...props}
          >
            {children}
          </select>

          <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400">
            <ChevronDown className="h-4 w-4" aria-hidden="true" />
          </div>
        </div>

        {error && (
          <p id={errorId} className="mt-1 text-xs text-rose-600">
            {error}
          </p>
        )}
        {!error && hint && (
          <p id={hintId} className="mt-1 text-xs text-slate-500">
            {hint}
          </p>
        )}
      </div>
    );
  },
);

Select.displayName = 'Select';
