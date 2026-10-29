import { useMemo, useState } from 'react';
import { Icon } from '../components/ui/Icon';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { useToast } from '../components/ui/Toast';
import { OrderCard } from '../components/orders/OrderCard';
import { PaymentDialog } from '../components/orders/PaymentDialog';
import { TicketModal } from '../components/ticket/TicketModal';
import { useAppData, useStore } from '../state/StoreContext';
import { isActiveOrder, orderDisplayName, STATUS_LABELS } from '../domain/orders';
import { netForOrder } from '../domain/loyalty';
import { isPaid } from '../domain/payment';
import type { Order } from '../domain/types';

type Filter = 'actives' | 'terminees' | 'archives';

interface OrdersPageProps {
  onGoToOrderTaking: () => void;
  onEndService: () => void;
}

export function OrdersPage({ onGoToOrderTaking, onEndService }: OrdersPageProps) {
  const store = useStore();
  const data = useAppData();
  const toast = useToast();
  const [filter, setFilter] = useState<Filter>('actives');
  const [query, setQuery] = useState('');
  const [ticketFor, setTicketFor] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<Order | null>(null);
  const [editing, setEditing] = useState<Order | null>(null);
  const [paying, setPaying] = useState<Order | null>(null);
  const [unpaying, setUnpaying] = useState<Order | null>(null);

  const groups = useMemo(() => {
    const actives = data.orders.filter(isActiveOrder).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const terminees = data.orders
      .filter((o) => !o.archivedAt && !isActiveOrder(o))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const archives = data.orders.filter((o) => o.archivedAt).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { actives, terminees, archives };
  }, [data.orders]);

  const q = query.trim().toLowerCase();
  const digits = q.replace(/\D/g, '');
  const list = groups[filter].filter(
    (o) =>
      !q ||
      String(o.number) === q.replace(/^n°?\s*/, '') ||
      orderDisplayName(o).toLowerCase().includes(q) ||
      (digits.length >= 2 && (o.customer?.phone ?? '').includes(digits)),
  );

  const startEdit = (order: Order) => {
    const r = store.startEditOrder(order.id);
    if (!r.ok) {
      toast(r.error, 'error');
      return;
    }
    toast(`Commande n° ${order.number} chargée pour modification`, 'info');
    onGoToOrderTaking();
  };

  /** Confirmation si un panier serait remplacé, ou si la commande est déjà encaissée. */
  const askEdit = (order: Order) => {
    const cart = data.cart;
    const replacesCart = cart.lines.length > 0 && cart.editingOrderId !== order.id;
    if (replacesCart || isPaid(order)) setEditing(order);
    else startEdit(order);
  };

  const confirmPaid = (order: Order, method: Parameters<typeof store.markOrderPaid>[1]) => {
    const r = store.markOrderPaid(order.id, method);
    setPaying(null);
    if (!r.ok) {
      toast(r.error, 'error');
      return;
    }
    const pts = r.value.pointsCredited;
    toast(
      `N° ${order.number} encaissée${pts > 0 ? ` · +${pts} pizza${pts > 1 ? 's' : ''} fidélité pour ${order.customer?.name}` : ''}`,
      'success',
    );
  };

  const cancelImpact = (order: Order) => {
    if (!order.customerId) return 'Commande comptoir : aucun impact fidélité.';
    const net = netForOrder(data.loyaltyEvents, order.id, order.customerId);
    const parts: string[] = [];
    if (net.points > 0) parts.push(`${net.points} pizza${net.points > 1 ? 's' : ''} retirée${net.points > 1 ? 's' : ''} du compteur`);
    if (net.rewardsUsed > 0) parts.push(`${net.rewardsUsed} récompense${net.rewardsUsed > 1 ? 's' : ''} restituée${net.rewardsUsed > 1 ? 's' : ''}`);
    return parts.length ? `Fidélité de ${order.customer?.name} : ${parts.join(', ')}.` : 'Aucun impact fidélité.';
  };

  const tabs: { id: Filter; label: string }[] = [
    { id: 'actives', label: 'En cours' },
    { id: 'terminees', label: 'Terminées et annulées' },
    { id: 'archives', label: 'Archives' },
  ];

  return (
    <div className="page">
      <header className="page__header">
        <div>
          <h1 className="page__title">Commandes</h1>
          <p className="muted">Suivi opérationnel du service. Les plus anciennes en premier.</p>
        </div>
        <button type="button" className="btn btn--dark" onClick={onEndService}>
          <Icon name="power" /> Fin de service
        </button>
      </header>

      <div className="page__toolbar">
        <div className="segmented orders-filter" role="tablist">
          {tabs.map((t) => (
            <button key={t.id} type="button" role="tab" className="segmented__item" aria-selected={filter === t.id} onClick={() => setFilter(t.id)}>
              {t.label}
              <span className="orders-filter__count">{groups[t.id].length}</span>
            </button>
          ))}
        </div>
        <div className="page-search">
          <Icon name="search" size={18} />
          <input
            className="input"
            type="search"
            placeholder="N°, nom ou téléphone"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Filtrer les commandes"
          />
        </div>
      </div>

      {list.length === 0 ? (
        <div className="empty page__empty">
          <span className="empty__icon">
            <Icon name="orders" size={26} />
          </span>
          <p className="empty__title">
            {filter === 'actives' ? 'Aucune commande en cours' : filter === 'terminees' ? 'Aucune commande terminée ou annulée' : 'Aucune commande archivée'}
          </p>
          {filter === 'actives' && (
            <button type="button" className="btn btn--primary" onClick={onGoToOrderTaking}>
              <Icon name="plus" /> Nouvelle commande
            </button>
          )}
        </div>
      ) : (
        <div className="orders-grid">
          {list.map((order) => (
            <OrderCard
              key={order.id}
              order={order}
              onStatus={(status) => {
                const r = store.setOrderStatus(order.id, status);
                toast(r.ok ? `N° ${order.number} : ${STATUS_LABELS[status]}` : r.error, r.ok ? 'success' : 'error');
              }}
              onTicket={() => setTicketFor(order.id)}
              onEdit={() => askEdit(order)}
              onCancel={() => setCancelling(order)}
              onMarkPaid={() => setPaying(order)}
              onMarkUnpaid={() => setUnpaying(order)}
            />
          ))}
        </div>
      )}

      {ticketFor && <TicketModal orderId={ticketFor} onClose={() => setTicketFor(null)} />}
      {cancelling && (
        <ConfirmDialog
          title={`Annuler la commande n° ${cancelling.number} ?`}
          confirmLabel={isPaid(cancelling) ? 'Annuler (remboursement traité)' : 'Annuler la commande'}
          cancelLabel="Ne pas annuler"
          onCancel={() => setCancelling(null)}
          onConfirm={() => {
            const r = store.cancelOrder(cancelling.id);
            if (r.ok) toast(`Commande n° ${cancelling.number} annulée`, 'success');
            else toast(r.error, 'error');
            setCancelling(null);
          }}
          message={
            <>
              <p>
                {orderDisplayName(cancelling)} · {cancelling.lines.length} ligne{cancelling.lines.length > 1 ? 's' : ''}. L’annulation est définitive.
              </p>
              {isPaid(cancelling) && (
                <p className="notice notice--warning">
                  Cette commande est déjà encaissée. L’annuler suppose que le remboursement a été traité en dehors de Ferrari Manager.
                </p>
              )}
              <p className="confirm-impact">{cancelImpact(cancelling)}</p>
            </>
          }
        />
      )}
      {editing && (
        <ConfirmDialog
          title={isPaid(editing) ? `Modifier une commande déjà encaissée ?` : 'Remplacer la commande en cours de saisie ?'}
          tone="primary"
          confirmLabel={`Modifier la n° ${editing.number}`}
          onCancel={() => setEditing(null)}
          onConfirm={() => {
            startEdit(editing);
            setEditing(null);
          }}
          message={
            <>
              {isPaid(editing) && (
                <p>
                  La commande n° {editing.number} est encaissée. La fidélité sera recalculée sur la version modifiée, sans double crédit.
                  Un éventuel écart de montant se règle en dehors de Ferrari Manager.
                </p>
              )}
              {data.cart.lines.length > 0 && data.cart.editingOrderId !== editing.id && (
                <p>Une commande non enregistrée est en cours de saisie. Elle sera remplacée par la commande à modifier.</p>
              )}
            </>
          }
        />
      )}
      {paying && <PaymentDialog order={paying} onClose={() => setPaying(null)} onConfirm={(m) => confirmPaid(paying, m)} />}
      {unpaying && (
        <ConfirmDialog
          title={`Annuler l’encaissement de la n° ${unpaying.number} ?`}
          confirmLabel="Repasser à encaisser"
          cancelLabel="Garder encaissée"
          onCancel={() => setUnpaying(null)}
          onConfirm={() => {
            const r = store.markOrderUnpaid(unpaying.id);
            if (r.ok) {
              const n = r.value.pointsReverted;
              toast(`N° ${unpaying.number} à encaisser${n > 0 ? ` · ${n} pizza${n > 1 ? 's' : ''} retirée${n > 1 ? 's' : ''} de la fidélité` : ''}`, 'info');
            } else toast(r.error, 'error');
            setUnpaying(null);
          }}
          message="À utiliser en cas d’erreur de saisie. Les pizzas créditées à l’encaissement sont retirées de la fidélité du client, puis recréditées au prochain encaissement."
        />
      )}
    </div>
  );
}
