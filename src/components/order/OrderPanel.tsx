import { useEffect, useRef, useState } from 'react';
import { Icon } from '../ui/Icon';
import { useAppData, useStore } from '../../state/StoreContext';
import { useToast } from '../ui/Toast';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { CartLine } from './CartLine';
import { TimePickerModal } from './TimePickerModal';
import { CustomizeModal } from '../catalog/CustomizeModal';
import { TicketModal } from '../ticket/TicketModal';
import { computeTotals, rewardSavings } from '../../domain/pricing';
import { hasRewardWithoutPaidPizza, itemCount, REWARD_NEEDS_PAID_PIZZA } from '../../domain/cart';
import { isPaid } from '../../domain/payment';
import { SERVICE_CLOSED_MESSAGE } from '../../domain/orders';
import { formatPrice } from '../../domain/money';
import { formatTimeOfDay } from '../../domain/time';
import { hasDeliveryAddress } from '../../domain/customers';
import type { OrderLine } from '../../domain/types';

interface OrderPanelProps {
  /** Affiche la carte (utile en mode onglets) pour ajouter une pizza payante. */
  onShowCatalog?: () => void;
}

export function OrderPanel({ onShowCatalog }: OrderPanelProps) {
  const store = useStore();
  const data = useAppData();
  const toast = useToast();
  const cart = data.cart;
  const customer = cart.customerId ? data.customers.find((c) => c.id === cart.customerId) ?? null : null;
  const editing = cart.editingOrderId ? data.orders.find((o) => o.id === cart.editingOrderId) : undefined;

  const [timeOpen, setTimeOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(cart.note !== '');
  const [confirmClear, setConfirmClear] = useState(false);
  const [customizing, setCustomizing] = useState<OrderLine | null>(null);
  const [ticketFor, setTicketFor] = useState<string | null>(null);
  const [errors, setErrors] = useState<string | null>(null);
  const submitting = useRef(false);
  const [busy, setBusy] = useState(false);
  // Toute modification de la commande efface le dernier message d'erreur de validation.
  useEffect(() => setErrors(null), [cart.lines, cart.mode, cart.customerId]);

  const totals = computeTotals(cart.lines, cart.mode, { deliveryFee: data.settings.deliveryFee });
  const savings = rewardSavings(cart.lines);
  const count = itemCount(cart.lines);
  // Cadeau fidélité sans pizza payante : signalé (jamais retiré en silence) et enregistrement bloqué.
  const rewardIssue = hasRewardWithoutPaidPizza(cart.lines);
  const hadRewardIssue = useRef(rewardIssue);
  useEffect(() => {
    if (rewardIssue && !hadRewardIssue.current) toast(REWARD_NEEDS_PAID_PIZZA, 'error');
    hadRewardIssue.current = rewardIssue;
  }, [rewardIssue, toast]);
  const removeRewards = () => {
    for (const l of cart.lines) if (l.reward) store.removeLine(l.id);
    toast('Cadeau retiré : la récompense reste disponible pour le client.', 'info');
  };
  // Service fermé : une nouvelle commande ne peut pas être enregistrée (modifier une commande existante reste possible).
  const serviceClosed = !data.serviceOpen && !editing;
  const cannotSave = busy || cart.lines.length === 0 || rewardIssue || serviceClosed;
  const openService = () => {
    const r = store.openService();
    toast(r.ok ? 'Service ouvert : prise de commandes activée' : r.error, r.ok ? 'success' : 'error');
  };
  const deliveryProblem =
    cart.mode === 'livraison' && (!customer ? 'Sélectionnez un client pour la livraison.' : !hasDeliveryAddress(customer) ? 'Adresse du client incomplète.' : null);

  /** Protection double clic : verrou synchrone + validation idempotente côté store. */
  const validate = (print: boolean) => {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    try {
      const r = store.validateCart();
      if (!r.ok) {
        setErrors(r.error);
        toast(r.error, 'error');
        return;
      }
      setErrors(null);
      setNoteOpen(false);
      toast(`Commande n° ${r.value.number} ${editing ? 'modifiée' : 'enregistrée'}`, 'success');
      if (print) setTicketFor(r.value.id);
    } finally {
      window.setTimeout(() => {
        submitting.current = false;
        setBusy(false);
      }, 600);
    }
  };

  return (
    <section className="panel order-panel" aria-label="Commande en cours">
      <header className="panel__header">
        <h2 className="panel__title">
          <Icon name="cart" size={22} /> Commande
          {count > 0 && <span className="badge">{count}</span>}
        </h2>
        <button
          type="button"
          className="btn btn--sm btn--ghost order-panel__clear"
          onClick={() => setConfirmClear(true)}
          disabled={cart.lines.length === 0 && !editing}
        >
          <Icon name="trash" size={18} /> Vider
        </button>
      </header>
      {editing && (
        <p className="edit-banner">
          <Icon name="pencil" size={18} />
          <span>
            <strong>Modification de la commande n° {editing.number}</strong>
            <br />
            {isPaid(editing)
              ? 'Commande déjà encaissée : la fidélité sera recalculée sur la version enregistrée, sans double crédit.'
              : 'L’enregistrement remplacera la version actuelle.'}
          </span>
        </p>
      )}

      <div className="order-panel__settings">
        <div className="segmented" role="group" aria-label="Mode de retrait">
          <button type="button" className="segmented__item" aria-pressed={cart.mode === 'livraison'} onClick={() => store.setMode('livraison')}>
            <Icon name="truck" /> Livraison
          </button>
          <button type="button" className="segmented__item" aria-pressed={cart.mode === 'emporter'} onClick={() => store.setMode('emporter')}>
            <Icon name="bag" /> À emporter
          </button>
        </div>
        {cart.mode === 'livraison' && (
          <p className={`delivery-line ${deliveryProblem ? 'delivery-line--warn' : ''}`}>
            <Icon name={deliveryProblem ? 'alert' : 'pin'} size={16} />
            {deliveryProblem ?? `${customer!.address}, ${customer!.postalCode} ${customer!.city}`}
          </p>
        )}
        <button type="button" className="time-row" onClick={() => setTimeOpen(true)}>
          <Icon name="clock" />
          <span>{cart.requestedTime ? `Pour ${formatTimeOfDay(cart.requestedTime)}` : 'Dès que possible'}</span>
          <span className="time-row__action">Changer</span>
          <Icon name="chevronRight" size={18} />
        </button>
      </div>

      <div className="order-panel__lines scroll-y">
        {cart.lines.length === 0 ? (
          <div className="empty">
            <span className="empty__icon">
              <Icon name="pizza" size={26} />
            </span>
            <p className="empty__title">Aucun produit</p>
            <p>Touchez une pizza ou une boisson pour l’ajouter.</p>
          </div>
        ) : (
          <ul className="cart-lines">
            {cart.lines.map((line) => (
              <CartLine
                key={line.id}
                line={line}
                onQuantity={(q) => store.setLineQuantity(line.id, q)}
                onRemove={() => {
                  store.removeLine(line.id);
                  if (line.reward) toast('Récompense retirée : elle reste disponible pour le client.', 'info');
                }}
                onCustomize={line.category === 'pizza' ? () => setCustomizing(line) : undefined}
              />
            ))}
          </ul>
        )}

        {noteOpen ? (
          <label className="field order-note">
            <span className="field__label">Note de commande</span>
            <textarea
              className="textarea"
              value={cart.note}
              onChange={(e) => store.setOrderNote(e.target.value)}
              placeholder="Ex. : couverts, monnaie sur 50 €…"
              rows={2}
            />
          </label>
        ) : (
          <button type="button" className="add-note" onClick={() => setNoteOpen(true)}>
            <Icon name="plus" size={18} /> Ajouter une note à la commande
          </button>
        )}
      </div>

      <footer className="order-panel__footer">
        <dl className="totals">
          <div>
            <dt>Sous-total</dt>
            <dd className="price">{formatPrice(totals.subtotal)}</dd>
          </div>
          {cart.mode === 'livraison' && (
            <div>
              <dt>Livraison</dt>
              <dd className="price">{totals.deliveryFee === 0 ? 'Offerte' : formatPrice(totals.deliveryFee)}</dd>
            </div>
          )}
          {savings > 0 && (
            <div className="totals__gift">
              <dt>Valeur offerte (fidélité, non facturée)</dt>
              <dd className="price">{formatPrice(savings)}</dd>
            </div>
          )}
          <div className="totals__total">
            <dt>Total</dt>
            <dd className="price">{formatPrice(totals.total)}</dd>
          </div>
        </dl>

        {serviceClosed && (
          <div className="notice notice--closed service-closed" role="status">
            <p>
              <Icon name="power" size={18} /> <strong>{SERVICE_CLOSED_MESSAGE}</strong>
            </p>
            <button type="button" className="btn btn--sm btn--success" onClick={openService}>
              <Icon name="power" size={18} /> Ouvrir le service
            </button>
          </div>
        )}

        {rewardIssue && (
          <div className="notice notice--error reward-issue" role="alert">
            <p>
              <Icon name="alert" size={18} /> <strong>{REWARD_NEEDS_PAID_PIZZA}</strong>
            </p>
            <div className="reward-issue__actions">
              <button
                type="button"
                className="btn btn--sm btn--dark"
                onClick={() => {
                  onShowCatalog?.();
                  toast('Choisissez une pizza payante dans la carte.', 'info');
                }}
              >
                <Icon name="pizza" size={18} /> Ajouter une pizza payante
              </button>
              <button type="button" className="btn btn--sm" onClick={removeRewards}>
                <Icon name="trash" size={18} /> Retirer le cadeau
              </button>
            </div>
          </div>
        )}

        {errors && (
          <p className="notice notice--error" role="alert">
            <Icon name="alert" size={18} /> {errors}
          </p>
        )}

        <button
          type="button"
          className="btn btn--success btn--lg btn--block validate-btn"
          onClick={() => validate(true)}
          disabled={cannotSave}
        >
          <Icon name="printer" size={24} />
          {editing ? 'Enregistrer et imprimer' : 'Valider et imprimer'}
          <Icon name="arrowRight" size={22} />
        </button>
        <div className="order-panel__secondary">
          <button type="button" className="btn" onClick={() => validate(false)} disabled={cannotSave}>
            <Icon name="file" size={18} /> Enregistrer sans imprimer
          </button>
          <button
            type="button"
            className="btn btn--danger-soft"
            onClick={() => setConfirmClear(true)}
            disabled={cart.lines.length === 0 && !editing}
          >
            <Icon name="trash" size={18} /> Annuler
          </button>
        </div>
      </footer>

      {timeOpen && (
        <TimePickerModal value={cart.requestedTime} onSelect={(t) => store.setRequestedTime(t)} onClose={() => setTimeOpen(false)} />
      )}
      {customizing && store.product(customizing.productId) && (
        <CustomizeModal product={store.product(customizing.productId)!} line={customizing} onClose={() => setCustomizing(null)} />
      )}
      {confirmClear && (
        <ConfirmDialog
          title={editing ? 'Abandonner la modification ?' : 'Annuler la saisie ?'}
          message={
            editing
              ? `La commande n° ${editing.number} reste enregistrée telle qu’elle était avant modification.`
              : 'Tous les produits de la commande en cours seront retirés. Rien n’a encore été enregistré.'
          }
          confirmLabel={editing ? 'Abandonner' : 'Vider la commande'}
          onCancel={() => setConfirmClear(false)}
          onConfirm={() => {
            store.clearCart();
            setErrors(null);
            setNoteOpen(false);
            setConfirmClear(false);
            toast(editing ? 'Modification abandonnée' : 'Commande vidée', 'info');
          }}
        />
      )}
      {ticketFor && <TicketModal orderId={ticketFor} onClose={() => setTicketFor(null)} />}
    </section>
  );
}
