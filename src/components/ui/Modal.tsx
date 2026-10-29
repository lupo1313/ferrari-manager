import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';

interface ModalProps {
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  /** Empêche la fermeture par clic sur le fond (formulaires en cours de saisie). */
  dismissOnBackdrop?: boolean;
}

export function Modal({ title, subtitle, onClose, children, footer, size = 'md', dismissOnBackdrop = true }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // Un double appui sur le bouton qui ouvre la fenêtre ne doit pas la refermer aussitôt.
  const openedAt = useRef(Date.now());

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    // Pas de focus automatique sur un champ : sur tablette, cela ouvrirait le clavier sans raison.
    const first = dialogRef.current?.querySelector<HTMLElement>('[data-autofocus]');
    (first ?? dialogRef.current)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, []);

  return createPortal(
    <div
      className="modal-backdrop"
      onPointerDown={(e) => {
        if (dismissOnBackdrop && e.target === e.currentTarget && Date.now() - openedAt.current > 500) onClose();
      }}
    >
      <div ref={dialogRef} className={`modal modal--${size}`} role="dialog" aria-modal="true" tabIndex={-1}>
        <header className="modal__header">
          <div>
            <h2 className="modal__title">{title}</h2>
            {subtitle && <p className="modal__subtitle">{subtitle}</p>}
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Fermer">
            <Icon name="close" />
          </button>
        </header>
        <div className="modal__body scroll-y">{children}</div>
        {footer && <footer className="modal__footer">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}
