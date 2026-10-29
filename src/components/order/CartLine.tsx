import { Icon } from '../ui/Icon';
import { Stepper } from '../ui/Stepper';
import { describeLine } from '../../domain/cart';
import { formatPrice } from '../../domain/money';
import { lineTotal } from '../../domain/pricing';
import type { OrderLine } from '../../domain/types';

interface CartLineProps {
  line: OrderLine;
  onQuantity: (quantity: number) => void;
  onRemove: () => void;
  onCustomize?: () => void;
}

export function CartLine({ line, onQuantity, onRemove, onCustomize }: CartLineProps) {
  const details = describeLine(line);
  return (
    <li className={`cart-line ${line.reward ? 'cart-line--reward' : ''}`}>
      {line.reward ? (
        <span className="cart-line__gift" aria-label="Offert fidélité">
          <Icon name="gift" size={20} />
        </span>
      ) : (
        <Stepper value={line.quantity} onChange={onQuantity} label={`quantité ${line.name}`} removeAtMin />
      )}
      <button
        type="button"
        className="cart-line__body"
        onClick={onCustomize}
        disabled={!onCustomize}
        aria-label={onCustomize ? `Personnaliser ${line.name}` : undefined}
      >
        <span className="cart-line__name">
          {line.reward && <span className="pill pill--gold">Offert fidélité</span>}
          {line.name}
        </span>
        {details.map((d) => (
          <span key={d} className={`cart-line__detail ${d.startsWith('Sans') ? 'is-removed' : d.startsWith('+') ? 'is-added' : ''}`}>
            {d}
          </span>
        ))}
        {onCustomize && details.length === 0 && <span className="cart-line__hint">Toucher pour personnaliser</span>}
      </button>
      <span className="cart-line__price price">{lineTotal(line) === 0 && line.reward ? 'Offert' : formatPrice(lineTotal(line))}</span>
      <button type="button" className="icon-btn icon-btn--danger" onClick={onRemove} aria-label={`Supprimer ${line.name}`}>
        <Icon name="trash" />
      </button>
    </li>
  );
}
