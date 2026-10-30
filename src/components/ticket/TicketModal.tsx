import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Modal } from '../ui/Modal';
import { Icon } from '../ui/Icon';
import { useAppData, useStore } from '../../state/StoreContext';
import { DeliveryTicketView, KitchenTicketView } from './TicketView';
import { buildDeliveryTicket, buildKitchenTicket, TICKET_LABELS, ticketKindsFor, type TicketKind } from '../../domain/ticket';
import { formatTime } from '../../domain/time';

interface TicketModalProps {
  orderId: string;
  onClose: () => void;
  /** Ouvert juste après l'enregistrement : la commande existe déjà, l'impression est facultative. */
  justSaved?: boolean;
}

/**
 * Tickets cuisine et livreur : aperçu de chacun, impression séparée ou des deux à la suite (un seul passage
 * dans la boîte de dialogue du navigateur, un ticket par page). Imprimer ne modifie jamais la commande :
 * seule la demande d'impression est tracée, sans preuve de sortie physique.
 */
export function TicketModal({ orderId, onClose, justSaved = false }: TicketModalProps) {
  const store = useStore();
  const data = useAppData();
  const order = data.orders.find((o) => o.id === orderId);
  const kinds = order ? ticketKindsFor(order) : [];
  const [shown, setShown] = useState<TicketKind>('cuisine');
  const [toPrint, setToPrint] = useState<TicketKind[]>(kinds);
  if (!order) return null;

  const kitchen = buildKitchenTicket(order, data.settings);
  const delivery = buildDeliveryTicket(order, data.settings);
  const view = (k: TicketKind) => (k === 'livreur' && delivery ? <DeliveryTicketView ticket={delivery} /> : <KitchenTicketView ticket={kitchen} />);

  const print = (which: TicketKind[]) => {
    setToPrint(which);
    store.recordPrintRequest(order.id);
    // Laisse React rendre la zone d'impression avant d'ouvrir la boîte de dialogue.
    window.setTimeout(() => window.print(), 50);
  };

  const requests = order.printRequests.length;
  const both = kinds.length > 1;

  return (
    <>
      <Modal
        title={justSaved ? `Commande n° ${order.number} enregistrée` : `Tickets · commande n° ${order.number}`}
        subtitle={both ? 'Livraison : ticket cuisine et ticket livreur' : 'À emporter : ticket cuisine'}
        onClose={onClose}
        size="md"
        footer={
          <div className="ticket-actions">
            <button type="button" className="btn btn--lg" onClick={onClose}>
              {justSaved ? 'Terminer sans imprimer' : 'Fermer'}
            </button>
            {both && (
              <>
                <button type="button" className="btn btn--lg" onClick={() => print(['cuisine'])}>
                  <Icon name="printer" /> Cuisine
                </button>
                <button type="button" className="btn btn--lg" onClick={() => print(['livreur'])}>
                  <Icon name="printer" /> Livreur
                </button>
              </>
            )}
            <button type="button" className="btn btn--lg btn--dark" onClick={() => print(kinds)} data-autofocus>
              <Icon name="printer" /> {both ? 'Imprimer les deux' : 'Imprimer le ticket cuisine'}
            </button>
          </div>
        }
      >
        {both && (
          <div className="segmented ticket-tabs" role="tablist" aria-label="Aperçu du ticket">
            {kinds.map((k) => (
              <button key={k} type="button" role="tab" className="segmented__item" aria-selected={shown === k} aria-pressed={shown === k} onClick={() => setShown(k)}>
                {TICKET_LABELS[k]}
              </button>
            ))}
          </div>
        )}
        <div className="ticket-preview">{view(both ? shown : 'cuisine')}</div>
        <p className="notice notice--info ticket-disclaimer">
          <Icon name="info" size={18} />
          <span>
            {justSaved ? 'La commande est enregistrée : imprimer est facultatif et ne la modifie pas. ' : ''}
            Impression via le navigateur{both ? ' (« Imprimer les deux » : un ticket par page, dans une seule boîte de dialogue)' : ''}. Aucune
            imprimante n’est pilotée : vérifiez que les tickets sont bien sortis.
            {requests > 0 &&
              ` Impression demandée ${requests} fois (dernière à ${formatTime(order.printRequests[requests - 1])}), sortie non confirmée.`}
          </span>
        </p>
      </Modal>
      {createPortal(
        <div className="print-area">
          <style>{`@page { size: ${kitchen.widthMm}mm auto; margin: 0; }`}</style>
          {toPrint.map((k) => (
            <div key={k} className="print-page">
              {view(k)}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
