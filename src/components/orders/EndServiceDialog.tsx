import { ConfirmDialog } from '../ui/ConfirmDialog';
import { useAppData, useStore } from '../../state/StoreContext';
import { useToast } from '../ui/Toast';
import { isActiveOrder } from '../../domain/orders';
import { formatTime } from '../../domain/time';

export function EndServiceDialog({ onClose }: { onClose: () => void }) {
  const store = useStore();
  const data = useAppData();
  const toast = useToast();
  const visible = data.orders.filter((o) => !o.archivedAt);
  const toArchive = visible.filter((o) => o.status === 'terminee' || o.status === 'annulee').length;
  const stillActive = visible.filter(isActiveOrder).length;

  return (
    <ConfirmDialog
      title="Clôturer le service ?"
      tone="primary"
      confirmLabel="Clôturer le service"
      onCancel={onClose}
      onConfirm={() => {
        const r = store.endService();
        if (r.ok) {
          toast(`Service clôturé : ${r.value.archived} commande${r.value.archived > 1 ? 's' : ''} archivée${r.value.archived > 1 ? 's' : ''}`, 'success');
        }
        onClose();
      }}
      message={
        <>
          <p>Service commencé à {formatTime(data.serviceStartedAt)}.</p>
          <ul className="confirm-list">
            <li>
              <strong>{toArchive}</strong> commande{toArchive > 1 ? 's' : ''} terminée{toArchive > 1 ? 's' : ''} ou annulée{toArchive > 1 ? 's' : ''} quitte{toArchive > 1 ? 'nt' : ''} l’écran de suivi (conservée{toArchive > 1 ? 's' : ''} dans les archives).
            </li>
            <li>
              <strong>{stillActive}</strong> commande{stillActive > 1 ? 's' : ''} encore en cours reste{stillActive > 1 ? 'nt' : ''} affichée{stillActive > 1 ? 's' : ''}.
            </li>
            <li>Les clients, les points et le journal de fidélité ne sont pas modifiés.</li>
            <li>
              {stillActive === 0
                ? 'La numérotation des commandes repartira à 1.'
                : 'La numérotation continue tant que des commandes sont en cours.'}
            </li>
          </ul>
        </>
      }
    />
  );
}
