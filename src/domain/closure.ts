import type { Cart, Customer, LoyaltyEvent, Order, ServiceRecord, Settings } from './types';
import { emptyCart } from './cart';
import { computeBalance, customerLoyaltyStatus } from './loyalty';
import { isPaid, paidGap } from './payment';
import { currentService } from './service';

export interface ClosureState {
  customers: Customer[]; orders: Order[]; loyaltyEvents: LoyaltyEvent[]; settings: Settings;
  cart: Cart; services: ServiceRecord[]; serviceStartedAt: string; serviceOpen: boolean;
  serviceClosedAt: string | null; counters: { nextOrderNumber: number };
}

/** Toute commande conservée, archives comprises, doit être résolue avant son retrait. */
export function closureBlockers(data: ClosureState) {
  const orders = data.orders.flatMap((order) => {
    if (order.status === 'annulee') return [];
    const reasons = [order.status !== 'terminee' ? 'non terminée' : '',
      !isPaid(order) ? (order.payment.legacy ? 'paiement non suivi' : 'non encaissée') : '',
      isPaid(order) && paidGap(order) !== 0 ? 'encaissement à régulariser' : ''].filter(Boolean);
    return reasons.length ? [{ order, reasons }] : [];
  });
  const c = data.cart;
  const cart = Boolean(c.editingOrderId || c.lines.length || c.customerId || c.counterName || c.note || c.requestedTime || c.paymentPlan || c.deliveryAddress);
  const reservations = data.customers.reduce((n, customer) => n + customerLoyaltyStatus(data.loyaltyEvents, data.orders, customer.id).reserved, 0);
  return { orders, cart, reservations, blocked: orders.length > 0 || cart || reservations > 0 || !data.serviceOpen };
}

/** Reprise du journal sans dépendance à une commande retirée : mêmes IDs, deltas et raisons. */
export function closedState<T extends ClosureState>(data: T, closedAt: string, id: string): T {
  if (closureBlockers(data).blocked) throw new Error('Résolvez les commandes, le panier et les réservations avant de clôturer.');
  const loyaltyEvents = data.loyaltyEvents.map((e) => e.orderId === null ? e : { ...e, orderId: null, label: 'Fidélité conservée après clôture' });
  for (const customer of data.customers) {
    if (JSON.stringify(computeBalance(loyaltyEvents, customer.id, data.settings.loyalty)) !==
      JSON.stringify(computeBalance(data.loyaltyEvents, customer.id, data.settings.loyalty))) throw new Error('Reprise de fidélité incohérente.');
  }
  const service = currentService(data.services);
  return { ...data, orders: [], loyaltyEvents, cart: emptyCart(id), counters: { nextOrderNumber: 1 },
    serviceOpen: false, serviceClosedAt: closedAt,
    // Aucun ancien service consultable dans les statistiques ; seule la borne du service fermé demeure.
    services: [{ id: service.id, openedAt: data.serviceStartedAt, closedAt }] };
}

export interface ClosureChoices { report: boolean; backup: boolean }
export interface ClosureReceipts { report: boolean; backup: boolean }
export function exportsConfirmed(choices: ClosureChoices, generated: ClosureReceipts, saved: ClosureReceipts) {
  return (!choices.report || generated.report && saved.report) && (!choices.backup || generated.backup && saved.backup);
}
