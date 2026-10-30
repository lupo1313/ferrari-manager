import { Modal } from '../ui/Modal';
import { Icon } from '../ui/Icon';
import { orderDisplayName, STATUS_FLOW, STATUS_LABELS, statusCorrections } from '../../domain/orders';
import type { Order, OrderStatus } from '../../domain/types';

interface StatusDialogProps {
  order: Order;
  onConfirm: (status: OrderStatus) => void;
  onClose: () => void;
}

/**
 * Correction d'un statut saisi par erreur : tous les statuts du flux sont visibles d'un coup,
 * le statut actuel est signalé, un appui applique le nouveau statut (mêmes transitions que le store).
 */
export function StatusDialog({ order, onConfirm, onClose }: StatusDialogProps) {
  const allowed = new Set(statusCorrections(order));
  return (
    <Modal
      title={`Corriger le statut de la n° ${order.number}`}
      subtitle={`${orderDisplayName(order)} · actuellement « ${STATUS_LABELS[order.status]} »`}
      onClose={onClose}
      size="sm"
    >
      <div className="status-choices" role="group" aria-label="Nouveau statut">
        {STATUS_FLOW.map((s) =>
          s === order.status ? (
            <div key={s} className="status-choice status-choice--current" aria-current="true">
              <span className={`status-pill status-pill--${s}`}>{STATUS_LABELS[s]}</span>
              <span className="status-choice__hint">Statut actuel</span>
            </div>
          ) : (
            <button key={s} type="button" className="status-choice" disabled={!allowed.has(s)} onClick={() => onConfirm(s)}>
              <span className={`status-pill status-pill--${s}`}>{STATUS_LABELS[s]}</span>
              <span className="status-choice__hint">Remettre à ce statut</span>
              <Icon name="arrowRight" size={18} />
            </button>
          ),
        )}
      </div>
      <p className="muted payment-hint">
        Seul le statut de préparation change. Le paiement, la fidélité, les produits et le montant de la commande restent identiques.
      </p>
    </Modal>
  );
}
