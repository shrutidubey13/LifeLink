import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from 'react';
import { CheckCircle2, AlertCircle, Info, AlertTriangle, X } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastItem {
  id: string;
  type: ToastType;
  message: string;
  title?: string;
  duration?: number;
}

interface ToastContextValue {
  showToast: (toast: Omit<ToastItem, 'id'>) => string;
  dismissToast: (id: string) => void;
  toast: {
    success: (message: string, title?: string) => string;
    error: (message: string, title?: string) => string;
    warning: (message: string, title?: string) => string;
    info: (message: string, title?: string) => string;
  };
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    ({ type, message, title, duration = 4500 }: Omit<ToastItem, 'id'>) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const newToast: ToastItem = { id, type, message, title, duration };

      setToasts((prev) => [...prev, newToast]);

      if (duration > 0) {
        setTimeout(() => {
          dismissToast(id);
        }, duration);
      }

      return id;
    },
    [dismissToast],
  );

  const toastHelpers = {
    success: (message: string, title?: string) =>
      showToast({ type: 'success', message, title }),
    error: (message: string, title?: string) =>
      showToast({ type: 'error', message, title, duration: 6000 }),
    warning: (message: string, title?: string) =>
      showToast({ type: 'warning', message, title }),
    info: (message: string, title?: string) =>
      showToast({ type: 'info', message, title }),
  };

  return (
    <ToastContext.Provider
      value={{ showToast, dismissToast, toast: toastHelpers }}
    >
      {children}

      {/* Floating container */}
      <div
        className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none p-2 sm:p-0"
        aria-live="polite"
      >
        {toasts.map((item) => (
          <ToastCard
            key={item.id}
            item={item}
            onDismiss={() => dismissToast(item.id)}
          />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastCard({
  item,
  onDismiss,
}: {
  item: ToastItem;
  onDismiss: () => void;
}) {
  const config = {
    success: {
      icon: CheckCircle2,
      border: 'border-emerald-200',
      bg: 'bg-emerald-50 text-emerald-900',
      iconColor: 'text-emerald-600',
    },
    error: {
      icon: AlertCircle,
      border: 'border-rose-200',
      bg: 'bg-rose-50 text-rose-900',
      iconColor: 'text-rose-600',
    },
    warning: {
      icon: AlertTriangle,
      border: 'border-amber-200',
      bg: 'bg-amber-50 text-amber-900',
      iconColor: 'text-amber-600',
    },
    info: {
      icon: Info,
      border: 'border-blue-200',
      bg: 'bg-blue-50 text-blue-900',
      iconColor: 'text-blue-600',
    },
  }[item.type];

  const Icon = config.icon;

  return (
    <div
      role="alert"
      className={`pointer-events-auto flex items-start gap-3 rounded-xl border p-4 shadow-lg transition-all animate-fade-in ${config.bg} ${config.border}`}
    >
      <Icon className={`h-5 w-5 shrink-0 mt-0.5 ${config.iconColor}`} aria-hidden="true" />
      <div className="flex-1 min-w-0">
        {item.title && <p className="text-sm font-semibold">{item.title}</p>}
        <p className="text-xs break-words leading-relaxed">{item.message}</p>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="rounded p-1 text-slate-400 hover:text-slate-700 hover:bg-black/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 shrink-0"
        aria-label="Dismiss toast"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}
