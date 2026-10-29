import { createPortal } from 'react-dom';
import { Modal } from '../ui/Modal';
import { Icon } from '../ui/Icon';
import { useAppData, useStore } from '../../state/StoreContext';
import { TicketView } from './TicketView';
import { buildTicket } from '../../domain/ticket';
import { formatTime } from '../../domain/time';

interface TicketModalProps {
  orderId: string;
  onClose: () => void;
}

/**
 * Aperçu + impression via la boîte de dialogue standard du navigateur.
 * L'ouverture de la boîte de dialogue est tracée, mais le ticket n'est jamais
 * marqué « imprimé » : le navigateur ne confirme pas la sortie physique.
 */
export function TicketModal({ orderId, onClose }: TicketModalProps) {
  const store = useStore();
  const data = useAppData();
  const order = data.orders.find((o) => o.id === orderId);
  if (!order) return null;
  const ticket = buildTicket(order, data.settings);

  const print = () => {
    store.recordPrintRequest(order.id);
    // Laisse React rendre la zone d'impression avant d'ouvrir la boîte de dialogue.
    window.setTimeout(() => window.print(), 50);
  };

  const requests = order.printRequests.length;

  return (
    <>
      <Modal
        title={`Ticket · commande n° ${order.number}`}
        subtitle={`Largeur ${ticket.widthMm} mm (modifiable dans Paramètres)`}
        onClose={onClose}
        size="md"
        footer={
          <>
            <button type="button" className="btn btn--lg" onClick={onClose}>
              Fermer
            </button>
            <button type="button" className="btn btn--lg btn--dark" onClick={print} data-autofocus>
              <Icon name="printer" /> Imprimer
            </button>
          </>
        }
      >
        <div className="ticket-preview">
          <TicketView ticket={ticket} />
        </div>
        <p className="notice notice--info ticket-disclaimer">
          <Icon name="info" size={18} />
          <span>
            Impression via le navigateur. Aucune imprimante n’est pilotée par cette version : vérifiez que le ticket est bien sorti.
            {requests > 0 &&
              ` Impression demandée ${requests} fois (dernière à ${formatTime(order.printRequests[requests - 1])}), sortie non confirmée.`}
          </span>
        </p>
      </Modal>
      {createPortal(
        <div className="print-area">
          <style>{`@page { size: ${ticket.widthMm}mm auto; margin: 0; }`}</style>
          <TicketView ticket={ticket} />
        </div>,
        document.body,
      )}
    </>
  );
}
