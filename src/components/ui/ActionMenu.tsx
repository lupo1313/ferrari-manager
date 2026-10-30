import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Icon, type IconName } from './Icon';

export interface MenuItem {
  id: string;
  label: string;
  icon?: IconName;
  tone?: 'danger';
  /** Action immédiate (les actions sensibles ouvrent leur propre confirmation). */
  onSelect?: () => void;
  /** Sous-liste affichée dans le même menu (ex. correction de statut), avec un retour. */
  children?: MenuItem[];
}

interface ActionMenuProps {
  /** Nom accessible du bouton, ex. « Autres actions, commande n° 12 ». */
  label: string;
  items: MenuItem[];
  className?: string;
}

/**
 * Menu « ••• » utilisable au doigt et au clavier, sans survol :
 * ouverture au toucher, éléments de 48 px, fermeture par Échap, toucher à l'extérieur ou choix d'un élément,
 * flèches haut/bas pour se déplacer. S'ouvre vers le haut s'il manque de place en dessous.
 */
export function ActionMenu({ label, items, className = '' }: ActionMenuProps) {
  const [open, setOpen] = useState(false);
  const [sub, setSub] = useState<MenuItem | null>(null);
  const [up, setUp] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const close = (focusTrigger = true) => {
    setOpen(false);
    setSub(null);
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

  // À chaque ouverture (ou changement de sous-liste) : focus sur le premier élément.
  useEffect(() => {
    if (open) menu.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
  }, [open, sub]);

  const toggle = () => {
    if (open) {
      close();
      return;
    }
    const rect = wrap.current?.getBoundingClientRect();
    setUp(Boolean(rect && window.innerHeight - rect.bottom < 280 && rect.top > window.innerHeight - rect.bottom));
    setOpen(true);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (sub) setSub(null);
      else close();
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const list = [...(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === 'ArrowDown' ? (i + 1) % list.length : (i - 1 + list.length) % list.length;
    list[next]?.focus();
  };

  const visible = sub ? sub.children ?? [] : items;

  return (
    <div
      ref={wrap}
      className={`action-menu ${className}`}
      onBlur={(e) => {
        if (open && !e.currentTarget.contains(e.relatedTarget as Node | null)) close(false);
      }}
    >
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
        <div ref={menu} id={menuId} role="menu" aria-label={sub ? sub.label : label} className={`action-menu__list ${up ? 'action-menu__list--up' : ''}`} onKeyDown={onKeyDown}>
          {sub && (
            <button type="button" role="menuitem" className="action-menu__item action-menu__item--back" onClick={() => setSub(null)}>
              <Icon name="chevronLeft" size={18} /> {sub.label}
            </button>
          )}
          {visible.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              className={`action-menu__item ${item.tone === 'danger' ? 'action-menu__item--danger' : ''}`}
              aria-haspopup={item.children ? 'menu' : undefined}
              onClick={() => {
                if (item.children) {
                  setSub(item);
                  return;
                }
                close();
                item.onSelect?.();
              }}
            >
              {item.icon && <Icon name={item.icon} size={18} />}
              <span>{item.label}</span>
              {item.children && <Icon name="chevronRight" size={18} className="action-menu__more" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
