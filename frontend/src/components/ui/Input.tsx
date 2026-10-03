import {
  forwardRef,
  useId,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';
import { Eye, EyeOff } from 'lucide-react';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: ReactNode;
  error?: string | null;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  showPasswordToggle?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    {
      label,
      hint,
      error,
      leftIcon,
      rightIcon,
      showPasswordToggle = false,
      type = 'text',
      id: customId,
      disabled,
      className = '',
      ...props
    },
    ref,
  ) => {
    const generatedId = useId();
    const id = customId || generatedId;
    const errorId = `${id}-error`;
    const hintId = `${id}-hint`;

    const [revealed, setRevealed] = useState(false);
    const isPassword = type === 'password';
    const computedType = isPassword && revealed ? 'text' : type;

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
          {leftIcon && (
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-slate-400">
              {leftIcon}
            </div>
          )}

          <input
            ref={ref}
            id={id}
            type={computedType}
            disabled={disabled}
            aria-invalid={Boolean(error)}
            aria-describedby={
              error ? errorId : hint ? hintId : undefined
            }
            className={`w-full h-12 rounded-xl border bg-white px-4 text-base text-slate-900 placeholder:text-slate-400 transition-colors focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400 ${
              error
                ? 'border-rose-300 focus:border-rose-500 focus:ring-rose-500/20'
                : 'border-slate-300 focus:border-blue-600 focus:ring-blue-600/20'
            } ${leftIcon ? 'pl-11' : ''} ${
              rightIcon || (isPassword && showPasswordToggle) ? 'pr-11' : ''
            } ${className}`}
            {...props}
          />

          {isPassword && showPasswordToggle ? (
            <button
              type="button"
              onClick={() => setRevealed(!revealed)}
              className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400 hover:text-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
              aria-label={revealed ? 'Hide password' : 'Show password'}
            >
              {revealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          ) : (
            rightIcon && (
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400">
                {rightIcon}
              </div>
            )
          )}
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

Input.displayName = 'Input';
