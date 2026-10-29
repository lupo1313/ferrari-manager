import { ConfirmDialog } from '../ui/ConfirmDialog';
import { useAppData, useStore } from '../../state/StoreContext';
import { useToast } from '../ui/Toast';
import { isActiveOrder, isDoneButUnpaid, isSettledOrder } from '../../domain/orders';
import { formatTime } from '../../domain/time';

const s = (n: number) => (n > 1 ? 's' : '');

export function EndServiceDialog({ onClose }: { onClose: () => void }) {
  const store = useStore();
  const data = useAppData();
  const toast = useToast();
  const visible = data.orders.filter((o) => !o.archivedAt);
  const toArchive = visible.filter(isSettledOrder).length;
  const stillActive = visible.filter(isActiveOrder).length;
  const waitingPayment = visible.filter(isDoneButUnpaid).length;

  return (
    <ConfirmDialog
      title="Clôturer le service ?"
      tone="primary"
      confirmLabel="Clôturer le service"
      onCancel={onClose}
      onConfirm={() => {
        const r = store.endService();
        if (r.ok) {
          toast(`Service clôturé : ${r.value.archived} commande${s(r.value.archived)} archivée${s(r.value.archived)}`, 'success');
        }
        onClose();
      }}
      message={
        <>
          <p>Service commencé à {formatTime(data.serviceStartedAt)}.</p>
          <ul className="confirm-list">
            <li>
              <strong>{toArchive}</strong> commande{s(toArchive)} soldée{s(toArchive)} (terminée{s(toArchive)} et encaissée{s(toArchive)}, ou
              annulée{s(toArchive)}) quitte{toArchive > 1 ? 'nt' : ''} l’écran de suivi (conservée{s(toArchive)} dans les archives).
            </li>
            <li>
              <strong>{stillActive}</strong> commande{s(stillActive)} encore en cours reste{stillActive > 1 ? 'nt' : ''} affichée{s(stillActive)}.
            </li>
            {waitingPayment > 0 && (
              <li className="confirm-list__warn">
                <strong>{waitingPayment}</strong> commande{s(waitingPayment)} terminée{s(waitingPayment)} mais <strong>non encaissée{s(waitingPayment)}</strong>{' '}
                reste{waitingPayment > 1 ? 'nt' : ''} affichée{s(waitingPayment)} : à vérifier.
              </li>
            )}
            <li>Les clients, les points et le journal de fidélité ne sont pas modifiés.</li>
            <li>
              {stillActive + waitingPayment === 0
                ? 'La numérotation des commandes repartira à 1.'
                : 'La numérotation continue tant que des commandes restent affichées.'}
            </li>
          </ul>
        </>
      }
    />
  );
}
