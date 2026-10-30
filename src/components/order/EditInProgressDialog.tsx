import { useState } from 'react';
import { Modal } from '../ui/Modal';
import { Icon } from '../ui/Icon';
import { useToast } from '../ui/Toast';
import { useAppSelector, useStore } from '../../state/StoreContext';
import { customerFullName } from '../../domain/customers';
import { computeTotals } from '../../domain/pricing';
import { itemCount } from '../../domain/cart';
import { orderDisplayName, SERVICE_CLOSED_MESSAGE } from '../../domain/orders';
import { formatPrice } from '../../domain/money';
import type { Customer } from '../../domain/types';

interface EditInProgressDialogProps {
  /** Client pour lequel on a demandé une nouvelle commande. */
  customer: Customer;
  onContinue: () => void;
  onStartNew: () => void;
  onCancel: () => void;
}

/**
 * Demande de commande pour un client alors qu'une modification n'est pas enregistrée :
 * rien ne change sans un choix explicite (continuer, abandonner pour une nouvelle commande, rester ici).
 */
export function EditInProgressDialog({ customer, onContinue, onStartNew, onCancel }: EditInProgressDialogProps) {
  const cart = useAppSelector((d) => d.cart);
  const orders = useAppSelector((d) => d.orders);
  const serviceOpen = useAppSelector((d) => d.serviceOpen);
  const editing = orders.find((o) => o.id === cart.editingOrderId);
  const number = editing ? `n° ${editing.number}` : 'en cours';
  const count = itemCount(cart.lines);

  return (
    <Modal
      title={`Modification de la commande ${number} non enregistrée`}
      subtitle={`${editing ? orderDisplayName(editing) : 'Client d’origine'} · ${count} produit${count > 1 ? 's' : ''} · ${formatPrice(computeTotals(cart.lines).total)} dans le panier`}
      onClose={onCancel}
      size="sm"
    >
      <p className="confirm-message">
        Cette commande reste rattachée à son client d’origine. Choisissez comment continuer avant de commander pour{' '}
        <strong>{customerFullName(customer)}</strong>.
      </p>
      <div className="edit-choices" role="group" aria-label="Que faire de la modification en cours ?">
        <button type="button" className="edit-choice edit-choice--primary" onClick={onContinue} data-autofocus>
          <Icon name="pencil" size={20} />
          <span>
            <strong>Continuer la modification {number}</strong>
            <small>Retour au panier, sans changer de client.</small>
          </span>
        </button>
        <button type="button" className="edit-choice" onClick={onStartNew} disabled={!serviceOpen}>
          <Icon name="trash" size={20} />
          <span>
            <strong>Abandonner et commander pour {customerFullName(customer)}</strong>
            <small>
              {editing
                ? `La commande ${number} reste enregistrée telle qu’elle était (${formatPrice(editing.totals.total)}). Les changements du panier sont perdus.`
                : 'Les changements du panier sont perdus.'}
            </small>
          </span>
        </button>
        {!serviceOpen && (
          <p className="notice notice--closed" role="status">
            <Icon name="power" size={18} /> {SERVICE_CLOSED_MESSAGE} La modification {number} peut continuer.
          </p>
        )}
        <button type="button" className="edit-choice" onClick={onCancel}>
          <Icon name="close" size={20} />
          <span>
            <strong>Annuler</strong>
            <small>Rester sur cette page, rien n’est modifié.</small>
          </span>
        </button>
      </div>
    </Modal>
  );
}

/**
 * « Commander » pour un client (page Clients, recherche globale).
 * Sans modification en cours : sélection du client puis prise de commande, comme avant.
 * Pendant une modification : dialogue de choix, jamais de changement de client silencieux.
 */
export function useOrderForCustomer(onGoToOrderTaking: () => void) {
  const store = useStore();
  const toast = useToast();
  const [pending, setPending] = useState<Customer | null>(null);

  const request = (customer: Customer) => {
    if (store.getData().cart.editingOrderId) {
      setPending(customer);
      return;
    }
    const r = store.selectCustomer(customer.id);
    if (!r.ok) {
      toast(r.error, 'error');
      return;
    }
    if (r.value.removedRewards > 0) toast('Récompenses du client précédent retirées de la commande.', 'info');
    if (r.value.addressReset) toast('Adresse ponctuelle retirée : adresse habituelle du nouveau client utilisée.', 'info');
    toast(`${customerFullName(customer)} sélectionné`, 'success');
    onGoToOrderTaking();
  };

  const dialog = pending && (
    <EditInProgressDialog
      customer={pending}
      onCancel={() => setPending(null)}
      onContinue={() => {
        setPending(null);
        onGoToOrderTaking();
      }}
      onStartNew={() => {
        const r = store.abandonEditAndStartOrder(pending.id);
        if (!r.ok) {
          toast(r.error, 'error');
          return;
        }
        setPending(null);
        toast(`Modification abandonnée · nouvelle commande pour ${customerFullName(r.value)}`, 'info');
        onGoToOrderTaking();
      }}
    />
  );

  return { request, dialog };
}
