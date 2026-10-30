import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Icon, type IconName } from './Icon';

export interface MenuItem {
  id: string;
  label: string;
  icon?: IconName;
  tone?: 'danger';
  /** Action lancée après fermeture du menu (les actions sensibles ouvrent leur propre confirmation). */
  onSelect: () => void;
}

interface ActionMenuProps {
  /** Nom accessible du bouton, ex. « Autres actions, commande n° 12 ». */
  label: string;
  items: MenuItem[];
  className?: string;
}

/**
 * Menu « ••• » utilisable au doigt et au clavier, sans survol : une liste simple, sans sous-menu.
 * Fermeture : choix d'un élément, nouvel appui sur le bouton, toucher à l'extérieur, Échap ou Tab.
 *
 * Le menu ne se ferme JAMAIS sur une simple perte de focus : Safari (macOS, iPad) ne donne pas le focus
 * à un bouton touché et signale une perte de focus « vers rien » ; fermer à ce moment-là faisait
 * disparaître le menu avant que l'appui n'atteigne l'élément choisi.
 */
export function ActionMenu({ label, items, className = '' }: ActionMenuProps) {
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const close = (focusTrigger = true) => {
    setOpen(false);
    if (focusTrigger) trigger.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) close(false);
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open]);

  // À l'ouverture : focus sur le premier élément (navigation au clavier).
  useEffect(() => {
    if (open) menu.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
  }, [open]);

  const toggle = () => {
    if (open) {
      close();
      return;
    }
    const rect = wrap.current?.getBoundingClientRect();
    setUp(Boolean(rect && window.innerHeight - rect.bottom < 240 && rect.top > window.innerHeight - rect.bottom));
    setOpen(true);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }
    // Tab : le focus quitte le menu normalement, le menu se referme.
    if (e.key === 'Tab') {
      close(false);
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const list = [...(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === 'ArrowDown' ? (i + 1) % list.length : (i - 1 + list.length) % list.length;
    list[next]?.focus();
  };

  return (
    <div ref={wrap} className={`action-menu ${className}`}>
      <button
        ref={trigger}
        type="button"
        className="btn action-menu__trigger"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={toggle}
      >
        <span className="action-menu__dots" aria-hidden="true">
          •••
        </span>
      </button>
      {open && (
        <div ref={menu} id={menuId} role="menu" aria-label={label} className={`action-menu__list ${up ? 'action-menu__list--up' : ''}`} onKeyDown={onKeyDown}>
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              className={`action-menu__item ${item.tone === 'danger' ? 'action-menu__item--danger' : ''}`}
              onClick={() => {
                close();
                item.onSelect();
              }}
            >
              {item.icon && <Icon name={item.icon} size={18} />}
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
