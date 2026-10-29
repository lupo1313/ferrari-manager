import type { Cart, Customer, Order, OrderMode, OrderStatus, Settings } from './types';
import { computeTotals } from './pricing';
import { hasDeliveryAddress, snapshotCustomer } from './customers';
import { isValidTimeOfDay } from './time';
import { MAX_QUANTITY } from './cart';

export const STATUS_FLOW: OrderStatus[] = ['a_preparer', 'en_preparation', 'prete', 'terminee'];

export const STATUS_LABELS: Record<OrderStatus, string> = {
  a_preparer: 'À préparer',
  en_preparation: 'En préparation',
  prete: 'Prête',
  terminee: 'Terminée',
  annulee: 'Annulée',
};

export const MODE_LABELS: Record<OrderMode, string> = {
  livraison: 'Livraison',
  emporter: 'À emporter',
};

/** Commande visible dans le suivi opérationnel (compteur de la navigation). */
export function isActiveOrder(order: Order): boolean {
  return !order.archivedAt && order.status !== 'terminee' && order.status !== 'annulee';
}

export function canEditOrder(order: Order): boolean {
  return !order.archivedAt && (order.status === 'a_preparer' || order.status === 'en_preparation' || order.status === 'prete');
}

export function canCancelOrder(order: Order): boolean {
  return !order.archivedAt && order.status !== 'annulee';
}

/** Changement de statut libre parmi le flux normal ; l'annulation passe par cancelOrder. */
export function canChangeStatus(order: Order, to: OrderStatus): boolean {
  return !order.archivedAt && order.status !== 'annulee' && to !== 'annulee' && to !== order.status;
}

export function nextStatus(status: OrderStatus): OrderStatus | null {
  const i = STATUS_FLOW.indexOf(status);
  return i >= 0 && i < STATUS_FLOW.length - 1 ? STATUS_FLOW[i + 1] : null;
}

export interface CartValidationContext {
  customer: Customer | null;
  /** Récompenses restantes une fois celles du panier déduites (voir rewardsRemainingForCart). */
  rewardsRemaining: number;
}

/** Renvoie la liste des problèmes bloquants (vide = commande valide). */
export function validateCart(cart: Cart, ctx: CartValidationContext): string[] {
  const errors: string[] = [];
  if (cart.lines.length === 0) errors.push('La commande est vide.');
  if (cart.customerId && !ctx.customer) errors.push('Le client sélectionné est introuvable.');
  if (cart.mode === 'livraison') {
    if (!ctx.customer) errors.push('Une livraison nécessite une fiche client.');
    else if (!hasDeliveryAddress(ctx.customer)) errors.push("L'adresse de livraison du client est incomplète.");
  }
  if (cart.requestedTime !== null && !isValidTimeOfDay(cart.requestedTime)) {
    errors.push("L'heure souhaitée est invalide.");
  }
  if (cart.lines.some((l) => !Number.isInteger(l.quantity) || l.quantity < 1 || l.quantity > MAX_QUANTITY)) {
    errors.push('Une quantité est invalide.');
  }
  if (cart.lines.some((l) => l.reward)) {
    if (!ctx.customer) errors.push('Une récompense fidélité nécessite une fiche client.');
    else if (ctx.rewardsRemaining < 0) errors.push('Le client n’a pas assez de récompenses disponibles.');
  }
  return errors;
}

export interface BuildOrderParams {
  id: string;
  number: number;
  nowIso: string;
  customer: Customer | null;
  settings: Settings;
  /** Version précédente quand on modifie une commande existante. */
  previous?: Order;
}

export function buildOrder(cart: Cart, p: BuildOrderParams): Order {
  const totals = computeTotals(cart.lines, cart.mode, { deliveryFee: p.settings.deliveryFee });
  const base = {
    customerId: p.customer?.id ?? null,
    customer: p.customer ? snapshotCustomer(p.customer) : null,
    counterName: p.customer ? '' : cart.counterName.trim(),
    mode: cart.mode,
    requestedTime: cart.requestedTime,
    lines: cart.lines.map((l) => ({ ...l, addedToppings: [...l.addedToppings], removedIngredients: [...l.removedIngredients] })),
    note: cart.note.trim(),
    totals,
    updatedAt: p.nowIso,
  };
  if (p.previous) {
    return { ...p.previous, ...base, revision: p.previous.revision + 1 };
  }
  return {
    id: p.id,
    number: p.number,
    createdAt: p.nowIso,
    revision: 1,
    status: 'a_preparer',
    statusHistory: [{ status: 'a_preparer', at: p.nowIso }],
    printRequests: [],
    archivedAt: null,
    ...base,
  };
}

export function withStatus(order: Order, status: OrderStatus, nowIso: string): Order {
  return {
    ...order,
    status,
    updatedAt: nowIso,
    statusHistory: [...order.statusHistory, { status, at: nowIso }],
  };
}

/** Recharge une commande enregistrée dans le panier pour modification. */
export function orderToCart(order: Order): Cart {
  return {
    draftId: order.id,
    editingOrderId: order.id,
    customerId: order.customerId,
    counterName: order.counterName,
    mode: order.mode,
    requestedTime: order.requestedTime,
    lines: order.lines.map((l) => ({ ...l })),
    note: order.note,
  };
}

/**
 * Fin de service : archive les commandes terminées et annulées (elles restent stockées,
 * le journal de fidélité n'est pas touché). Les commandes encore actives restent affichées.
 */
export function closeService(orders: Order[], nowIso: string) {
  let archived = 0;
  const next = orders.map((o) => {
    if (!o.archivedAt && (o.status === 'terminee' || o.status === 'annulee')) {
      archived++;
      return { ...o, archivedAt: nowIso };
    }
    return o;
  });
  const stillActive = next.filter(isActiveOrder).length;
  return { orders: next, archived, stillActive };
}

export function orderDisplayName(order: Order): string {
  if (order.customer) return order.customer.name;
  return order.counterName ? `${order.counterName} (comptoir)` : 'Comptoir';
}
