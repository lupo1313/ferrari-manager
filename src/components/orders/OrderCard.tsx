import { Icon, type IconName } from '../ui/Icon';
import { ActionMenu, type MenuItem } from '../ui/ActionMenu';
import { describeLine, hasRewardWithoutPaidPizza, REWARD_NEEDS_PAID_PIZZA } from '../../domain/cart';
import { formatPhone } from '../../domain/customers';
import { formatPrice } from '../../domain/money';
import { lineTotal } from '../../domain/pricing';
import {
  canEditOrder,
  canMarkPaidFromCard,
  isActiveOrder,
  MODE_LABELS,
  orderDisplayName,
  primaryAction,
  secondaryActions,
  STATUS_LABELS,
  statusCorrections,
  type OrderMenuAction,
} from '../../domain/orders';
import { isLegacyUnpaid, isPaid, PAYMENT_METHOD_LABELS } from '../../domain/payment';
import { elapsedLabel, formatDate, formatTime, formatTimeOfDay } from '../../domain/time';
import type { Order, OrderStatus } from '../../domain/types';

interface OrderCardProps {
  order: Order;
  /** Heure courante (ancienneté des commandes en cours). */
  now: string;
  onStatus: (status: OrderStatus) => void;
  onTicket: () => void;
  onEdit: () => void;
  onCancel: () => void;
  onMarkPaid: () => void;
  onMarkUnpaid: () => void;
}

/** Couleur et icône du bouton principal, selon l'étape à franchir. */
const PRIMARY_STYLE: Partial<Record<OrderStatus, { className: string; icon: IconName }>> = {
  a_preparer: { className: 'btn--dark', icon: 'play' },
  en_preparation: { className: 'btn--primary', icon: 'check' },
  prete: { className: 'btn--success', icon: 'check' },
};

/** Statut de paiement, indépendant du statut de préparation ; encaissement accessible en un appui. */
function PaymentRow({ order, onMarkPaid }: Pick<OrderCardProps, 'order' | 'onMarkPaid'>) {
  if (isPaid(order)) {
    const method = order.payment.method && order.payment.method !== 'non_precise' ? ` · ${PAYMENT_METHOD_LABELS[order.payment.method]}` : '';
    const at = order.payment.paidAt ? ` · ${formatTime(order.payment.paidAt)}` : '';
    return (
      <div className="payment-row">
        <span className="payment-pill payment-pill--paid">
          <Icon name="check" size={16} /> Encaissée{method}
          {at}
        </span>
      </div>
    );
  }
  return (
    <div className="payment-row">
      <span className={`payment-pill ${isLegacyUnpaid(order) ? 'payment-pill--unknown' : 'payment-pill--due'}`}>
        {isLegacyUnpaid(order) ? 'Paiement non suivi' : order.status === 'annulee' ? 'Non encaissée' : 'À encaisser'}
      </span>
      {canMarkPaidFromCard(order) && (
        <button type="button" className="btn btn--sm payment-row__pay" onClick={onMarkPaid}>
          <Icon name="check" size={18} /> Marquer encaissée
        </button>
      )}
    </div>
  );
}

export function OrderCard({ order, now, onStatus, onTicket, onEdit, onCancel, onMarkPaid, onMarkUnpaid }: OrderCardProps) {
  const primary = primaryAction(order);
  const primaryStyle = PRIMARY_STYLE[order.status];
  const editable = canEditOrder(order);
  const isToday = formatDate(order.createdAt) === formatDate(now);
  const customer = order.customer;

  // Bouton direct à côté du menu : Modifier si possible, sinon Ticket (alors retiré du menu).
  const direct: 'modifier' | 'ticket' = editable ? 'modifier' : 'ticket';
  const menuItems = secondaryActions(order)
    .filter((a) => !(direct === 'ticket' && a === 'ticket'))
    .map((a: OrderMenuAction): MenuItem => {
      switch (a) {
        case 'ticket':
          return { id: a, label: 'Ticket', icon: 'printer', onSelect: onTicket };
        case 'corriger_statut':
          return {
            id: a,
            label: 'Corriger le statut',
            icon: 'refresh',
            children: statusCorrections(order).map((s) => ({ id: s, label: `Remettre à « ${STATUS_LABELS[s]} »`, onSelect: () => onStatus(s) })),
          };
        case 'annuler_encaissement':
          return { id: a, label: 'Annuler l’encaissement', icon: 'history', onSelect: onMarkUnpaid };
        case 'annuler':
          return { id: a, label: 'Annuler la commande', icon: 'close', tone: 'danger', onSelect: onCancel };
      }
    });

  return (
    <article className={`order-card order-card--${order.status}`} aria-label={`Commande n° ${order.number}, ${STATUS_LABELS[order.status]}`}>
      <header className="order-card__head">
        <p className="order-card__id">
          <strong className="order-card__number">N° {order.number}</strong>
          <span className="order-card__time">
            {isToday ? '' : `${formatDate(order.createdAt)} · `}
            {formatTime(order.createdAt)}
            {order.revision > 1 && ` · modifiée (v${order.revision})`}
          </span>
        </p>
        <p className="order-card__badges">
          <span className={`status-pill status-pill--${order.status}`}>{STATUS_LABELS[order.status]}</span>
          {isActiveOrder(order) && (
            <span className="order-card__age" title="Temps écoulé depuis la prise de commande">
              <Icon name="clock" size={14} /> {elapsedLabel(order.createdAt, now)}
            </span>
          )}
        </p>
      </header>

      <div className="order-card__who">
        <p className="order-card__line order-card__name">
          <Icon name="user" size={18} /> {orderDisplayName(order)}
        </p>
        {customer?.phone && (
          <p className="order-card__line">
            <Icon name="phone" size={18} /> {formatPhone(customer.phone)}
          </p>
        )}
        <p className="order-card__line">
          <Icon name={order.mode === 'livraison' ? 'truck' : 'bag'} size={18} />
          <span>
            <strong>{MODE_LABELS[order.mode]}</strong> · {order.requestedTime ? `pour ${formatTimeOfDay(order.requestedTime)}` : 'dès que possible'}
          </span>
        </p>
        {order.mode === 'livraison' && customer && (
          <>
            <p className="order-card__line order-card__address">
              <Icon name="pin" size={18} />
              <span>
                {customer.address}, {customer.postalCode} {customer.city}
                {customer.complement && <span className="order-card__complement">{customer.complement}</span>}
              </span>
            </p>
            {customer.instructions && (
              <p className="order-card__line order-card__instructions">
                <Icon name="info" size={18} /> {customer.instructions}
              </p>
            )}
          </>
        )}
      </div>

      <ul className="order-card__lines" aria-label="Produits">
        {order.lines.map((l) => {
          const amount = lineTotal(l);
          return (
            <li key={l.id}>
              <span className="order-card__qty">{l.quantity} ×</span>
              <span className="order-card__product">
                <span className="order-card__product-name">
                  {l.name}
                  {l.reward && <span className="pill pill--gold">Offert fidélité</span>}
                </span>
                {describeLine(l).map((d) => (
                  <small key={d}>{d}</small>
                ))}
              </span>
              <span className="order-card__amount">{l.reward && amount === 0 ? 'Offert' : formatPrice(amount)}</span>
            </li>
          );
        })}
      </ul>
      {order.note && (
        <p className="order-card__note">
          <Icon name="note" size={16} /> {order.note}
        </p>
      )}

      <div className="order-card__total">
        <span>Total</span>
        <span className="price">{formatPrice(order.totals.total)}</span>
      </div>

      <PaymentRow order={order} onMarkPaid={onMarkPaid} />
      {order.status !== 'annulee' && order.customerId && hasRewardWithoutPaidPizza(order.lines) && (
        <p className="notice notice--error order-card__issue">
          <Icon name="alert" size={18} /> {REWARD_NEEDS_PAID_PIZZA} Modifiez ou annulez cette commande.
        </p>
      )}

      <footer className="order-card__actions">
        {primary && primaryStyle && (
          <button type="button" className={`btn ${primaryStyle.className} order-card__primary`} onClick={() => onStatus(primary.to)}>
            <Icon name={primaryStyle.icon} size={20} />
            <span>{primary.label}</span>
            <Icon name="arrowRight" size={20} className="order-card__primary-arrow" />
          </button>
        )}
        <div className="order-card__secondary">
          {direct === 'modifier' ? (
            <button type="button" className="btn" onClick={onEdit}>
              <Icon name="pencil" size={18} /> Modifier
            </button>
          ) : (
            <button type="button" className="btn" onClick={onTicket}>
              <Icon name="printer" size={18} /> Ticket
            </button>
          )}
          {menuItems.length > 0 && <ActionMenu label={`Autres actions, commande n° ${order.number}`} items={menuItems} className="order-card__menu" />}
        </div>
      </footer>
    </article>
  );
}
