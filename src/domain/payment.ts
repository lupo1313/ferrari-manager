import type { Order, Payment, PaymentMethod, PaymentStatus } from './types';
import { hasRewardWithoutPaidPizza, REWARD_NEEDS_PAID_PIZZA } from './cart';

/**
 * Suivi d'encaissement : deux statuts, un moyen facultatif. Pas de caisse, pas de montants encaissés.
 * Sert au suivi opérationnel et au crédit de fidélité (les pizzas sont créditées à l'encaissement).
 */

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  a_encaisser: 'À encaisser',
  encaissee: 'Encaissée',
};

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  especes: 'Espèces',
  carte: 'Carte bancaire',
  non_precise: 'Non précisé',
};

export function unpaid(): Payment {
  return { status: 'a_encaisser', method: null, paidAt: null };
}

/** Paiement des commandes enregistrées avant le suivi des paiements (voir Payment.legacy). */
export function legacyPayment(): Payment {
  return { ...unpaid(), legacy: true };
}

export function isPaid(order: Order): boolean {
  return order.payment.status === 'encaissee';
}

/** Commande d'avant le suivi des paiements, jamais marquée encaissée depuis. */
export function isLegacyUnpaid(order: Order): boolean {
  return !isPaid(order) && order.payment.legacy === true;
}

/** Raison bloquante, ou null si la commande peut être marquée encaissée. */
export function cannotMarkPaid(order: Order): string | null {
  if (order.status === 'annulee') return 'Une commande annulée ne peut pas être encaissée.';
  // La commande a pu évoluer (ou date d'avant la règle) : la condition du cadeau est revérifiée ici.
  if (order.customerId && hasRewardWithoutPaidPizza(order.lines)) {
    return `${REWARD_NEEDS_PAID_PIZZA} Modifiez la commande (ajout d’une pizza ou retrait du cadeau) avant de l’encaisser.`;
  }
  return null;
}

/**
 * Marque la commande encaissée. Idempotent : sur une commande déjà encaissée, seul le moyen
 * de paiement peut changer, la date d'encaissement d'origine est conservée.
 */
export function markPaid(order: Order, method: PaymentMethod, nowIso: string): Order {
  if (isPaid(order)) {
    return order.payment.method === method ? order : { ...order, payment: { ...order.payment, method }, updatedAt: nowIso };
  }
  return { ...order, payment: { status: 'encaissee', method, paidAt: nowIso }, updatedAt: nowIso };
}

/** Correction d'une erreur de saisie : la commande repasse « à encaisser » (les points seront retirés). */
export function markUnpaid(order: Order, nowIso: string): Order {
  return { ...order, payment: unpaid(), updatedAt: nowIso };
}
