import { Icon } from '../ui/Icon';
import { describeLine, hasRewardWithoutPaidPizza, REWARD_NEEDS_PAID_PIZZA } from '../../domain/cart';
import { formatPhone } from '../../domain/customers';
import { formatPrice } from '../../domain/money';
import { canCancelOrder, canEditOrder, MODE_LABELS, nextStatus, orderDisplayName, STATUS_FLOW, STATUS_LABELS } from '../../domain/orders';
import { isLegacyUnpaid, isPaid, PAYMENT_METHOD_LABELS } from '../../domain/payment';
import { formatDate, formatTime, formatTimeOfDay } from '../../domain/time';
import type { Order, OrderStatus } from '../../domain/types';

interface OrderCardProps {
  order: Order;
  onStatus: (status: OrderStatus) => void;
  onTicket: () => void;
  onEdit: () => void;
  onCancel: () => void;
  onMarkPaid: () => void;
  onMarkUnpaid: () => void;
}

/** Statut de paiement, indépendant du statut de préparation. */
function PaymentRow({ order, onMarkPaid, onMarkUnpaid }: Pick<OrderCardProps, 'order' | 'onMarkPaid' | 'onMarkUnpaid'>) {
  const locked = Boolean(order.archivedAt) || order.status === 'annulee';
  if (isPaid(order)) {
    const method = order.payment.method && order.payment.method !== 'non_precise' ? ` · ${PAYMENT_METHOD_LABELS[order.payment.method]}` : '';
    const at = order.payment.paidAt ? ` · ${formatTime(order.payment.paidAt)}` : '';
    return (
      <div className="payment-row">
        <span className="payment-pill payment-pill--paid">
          <Icon name="check" size={16} /> Encaissée{method}
          {at}
        </span>
        {!locked && (
          <button type="button" className="payment-row__undo" onClick={onMarkUnpaid}>
            Annuler l’encaissement
          </button>
        )}
      </div>
    );
  }
  return (
    <div className="payment-row">
      <span className={`payment-pill ${isLegacyUnpaid(order) ? 'payment-pill--unknown' : 'payment-pill--due'}`}>
        {isLegacyUnpaid(order) ? 'Paiement non suivi' : order.status === 'annulee' ? 'Non encaissée' : 'À encaisser'}
      </span>
      {!locked && (
        <button type="button" className="btn btn--sm payment-row__pay" onClick={onMarkPaid}>
          <Icon name="check" size={18} /> Marquer encaissée
        </button>
      )}
    </div>
  );
}

const NEXT_LABEL: Partial<Record<OrderStatus, string>> = {
  a_preparer: 'Lancer la préparation',
  en_preparation: 'Marquer prête',
  prete: 'Terminer',
};

export function OrderCard({ order, onStatus, onTicket, onEdit, onCancel, onMarkPaid, onMarkUnpaid }: OrderCardProps) {
  const next = nextStatus(order.status);
  const readOnly = Boolean(order.archivedAt) || order.status === 'annulee';
  const isToday = formatDate(order.createdAt) === formatDate(new Date().toISOString());

  return (
    <article className={`order-card order-card--${order.status}`}>
      <header className="order-card__head">
        <div>
          <p className="order-card__number">N° {order.number}</p>
          <p className="order-card__time">
            {isToday ? '' : `${formatDate(order.createdAt)} · `}
            Prise à {formatTime(order.createdAt)}
            {order.revision > 1 && ` · modifiée (v${order.revision})`}
          </p>
        </div>
        <span className={`status-pill status-pill--${order.status}`}>{STATUS_LABELS[order.status]}</span>
      </header>

      <div className="order-card__who">
        <p className="order-card__name">{orderDisplayName(order)}</p>
        {order.customer?.phone && <p className="muted">{formatPhone(order.customer.phone)}</p>}
        <p className="order-card__mode">
          <Icon name={order.mode === 'livraison' ? 'truck' : 'bag'} size={18} />
          <strong>{MODE_LABELS[order.mode]}</strong>
          <span>· {order.requestedTime ? `pour ${formatTimeOfDay(order.requestedTime)}` : 'dès que possible'}</span>
        </p>
        {order.mode === 'livraison' && order.customer && (
          <p className="muted order-card__address">
            {order.customer.address}, {order.customer.postalCode} {order.customer.city}
            {order.customer.complement && ` · ${order.customer.complement}`}
          </p>
        )}
      </div>

      <ul className="order-card__lines">
        {order.lines.map((l) => (
          <li key={l.id}>
            <span className="order-card__qty">{l.quantity}×</span>
            <span>
              {l.name}
              {l.reward && <span className="pill pill--gold">Offert</span>}
              {describeLine(l).map((d) => (
                <small key={d}>{d}</small>
              ))}
            </span>
          </li>
        ))}
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

      <PaymentRow order={order} onMarkPaid={onMarkPaid} onMarkUnpaid={onMarkUnpaid} />
      {order.status !== 'annulee' && order.customerId && hasRewardWithoutPaidPizza(order.lines) && (
        <p className="notice notice--error order-card__issue">
          <Icon name="alert" size={18} /> {REWARD_NEEDS_PAID_PIZZA} Modifiez ou annulez cette commande.
        </p>
      )}

      {!readOnly && (
        <div className="status-switch" role="group" aria-label="Statut de la commande">
          {STATUS_FLOW.map((s) => (
            <button key={s} type="button" aria-pressed={order.status === s} onClick={() => order.status !== s && onStatus(s)}>
              {STATUS_LABELS[s]}
            </button>
          ))}
        </div>
      )}

      <footer className="order-card__actions">
        {!readOnly && next && (
          <button type="button" className="btn btn--dark order-card__next" onClick={() => onStatus(next)}>
            {NEXT_LABEL[order.status]} <Icon name="arrowRight" size={18} />
          </button>
        )}
        <button type="button" className="btn btn--sm" onClick={onTicket}>
          <Icon name="printer" size={18} /> Ticket
        </button>
        {canEditOrder(order) && (
          <button type="button" className="btn btn--sm" onClick={onEdit}>
            <Icon name="pencil" size={18} /> Modifier
          </button>
        )}
        {canCancelOrder(order) && (
          <button type="button" className="btn btn--sm btn--danger-soft" onClick={onCancel}>
            <Icon name="close" size={18} /> Annuler
          </button>
        )}
      </footer>
    </article>
  );
}
