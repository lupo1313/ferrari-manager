import type { ReactNode } from 'react';
import { Modal } from './Modal';

interface ConfirmDialogProps {
  title: string;
  message: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'danger' | 'primary';
  onConfirm: () => void;
  onCancel: () => void;
}

/** Confirmation systématique avant toute action destructive. */
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel = 'Retour',
  tone = 'danger',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Modal
      title={title}
      onClose={onCancel}
      size="sm"
      footer={
        <>
          <button type="button" className="btn btn--lg" onClick={onCancel} data-autofocus>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`btn btn--lg ${tone === 'danger' ? 'btn--primary' : 'btn--success'}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="confirm-message">{message}</div>
    </Modal>
  );
}
