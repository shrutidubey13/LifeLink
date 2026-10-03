import { type ReactNode } from 'react';
import { AlertTriangle, AlertCircle, Info } from 'lucide-react';
import { Modal } from './Modal';
import { Button } from './Button';

export interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'warning' | 'primary';
  loading?: boolean;
}

export function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'danger',
  loading = false,
}: ConfirmDialogProps) {
  const Icon = tone === 'danger' ? AlertCircle : tone === 'warning' ? AlertTriangle : Info;
  const iconColor =
    tone === 'danger'
      ? 'bg-rose-100 text-rose-600'
      : tone === 'warning'
      ? 'bg-amber-100 text-amber-600'
      : 'bg-blue-100 text-blue-600';

  return (
    <Modal isOpen={isOpen} onClose={loading ? () => {} : onClose} size="sm">
      <div className="flex gap-4 items-start">
        <div className={`p-2.5 rounded-full shrink-0 ${iconColor}`}>
          <Icon className="h-6 w-6" aria-hidden="true" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-bold text-slate-900">{title}</h3>
          <div className="mt-2 text-sm text-slate-600 leading-relaxed">{description}</div>
        </div>
      </div>

      <div className="mt-6 flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
        <Button
          variant="secondary"
          size="sm"
          disabled={loading}
          onClick={onClose}
        >
          {cancelLabel}
        </Button>
        <Button
          variant={tone === 'danger' ? 'danger' : 'primary'}
          size="sm"
          loading={loading}
          onClick={onConfirm}
        >
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
