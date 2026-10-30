import { Modal } from '../ui/Modal';
import { Icon, type IconName } from '../ui/Icon';
import { formatPrice } from '../../domain/money';
import { orderDisplayName } from '../../domain/orders';
import type { Order, PaymentMethod } from '../../domain/types';

interface PaymentDialogProps {
  order: Order;
  onConfirm: (method: PaymentMethod) => void;
  onClose: () => void;
}

const METHODS: { method: PaymentMethod; label: string; icon: IconName }[] = [
  { method: 'especes', label: 'Espèces', icon: 'check' },
  { method: 'carte', label: 'Carte bancaire', icon: 'check' },
  { method: 'non_precise', label: 'Non précisé', icon: 'check' },
];

/** Encaissement en un appui : le choix du moyen confirme directement (moyen facultatif). */
export function PaymentDialog({ order, onConfirm, onClose }: PaymentDialogProps) {
  return (
    <Modal
      title={`Encaisser la commande n° ${order.number}`}
      subtitle={`${orderDisplayName(order)} · ${formatPrice(order.totals.total)}`}
      onClose={onClose}
      size="sm"
    >
      <div className="payment-methods">
        {METHODS.map((m) => (
          <button key={m.method} type="button" className="payment-method" onClick={() => onConfirm(m.method)}>
            <Icon name={m.icon} size={20} />
            {m.label}
          </button>
        ))}
      </div>
      <p className="muted payment-hint">
        Suivi uniquement : le paiement se fait sur la caisse habituelle. Les pizzas payantes sont ajoutées à la fidélité du client à
        l’encaissement.
      </p>
    </Modal>
  );
}
