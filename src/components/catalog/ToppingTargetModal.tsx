import { Modal } from '../ui/Modal';
import { Icon } from '../ui/Icon';
import { useStore } from '../../state/StoreContext';
import { useToast } from '../ui/Toast';
import { formatPrice } from '../../domain/money';
import { describeLine } from '../../domain/cart';
import type { OrderLine, Topping } from '../../domain/types';

interface ToppingTargetModalProps {
  topping: Topping;
  pizzaLines: OrderLine[];
  onClose: () => void;
}

/** Choix de la pizza sur laquelle ajouter un supplément quand la commande en contient plusieurs. */
export function ToppingTargetModal({ topping, pizzaLines, onClose }: ToppingTargetModalProps) {
  const store = useStore();
  const toast = useToast();
  return (
    <Modal title={`Ajouter ${topping.name} (+${formatPrice(topping.price)})`} subtitle="Sur quelle pizza ?" onClose={onClose} size="sm">
      <div className="target-list">
        {pizzaLines.map((l) => {
          const already = l.addedToppings.some((t) => t.id === topping.id);
          return (
            <button
              key={l.id}
              type="button"
              className="target-item"
              disabled={already}
              onClick={() => {
                store.addToppingToLine(l.id, topping.id);
                toast(`${topping.name} ajouté sur ${l.name}${l.quantity > 1 ? ` (× ${l.quantity})` : ''}`, 'success');
                onClose();
              }}
            >
              <span className="target-item__name">
                {l.quantity} × {l.name}
                {l.reward && <span className="pill pill--gold">Offerte</span>}
              </span>
              <span className="target-item__meta">{already ? 'Déjà ajouté' : describeLine(l).join(' · ') || 'Sans personnalisation'}</span>
              <Icon name="chevronRight" />
            </button>
          );
        })}
      </div>
      <p className="muted target-hint">Le supplément s’applique à toutes les pizzas de la ligne choisie.</p>
    </Modal>
  );
}
