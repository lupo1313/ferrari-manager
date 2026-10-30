import type {
  Cart,
  Catalog,
  LoyaltyEvent,
  LoyaltyReason,
  LoyaltyRules,
  Order,
  OrderLine,
  Product,
  RewardKind,
} from './types';
import type { IdFactory } from './ids';
import { paidPizzaCount, rewardLineCount } from './cart';
import { isLegacyUnpaid, isPaid } from './payment';

/**
 * Programme de fidélité : 10 pizzas payantes = 1 récompense.
 * Récompense = 1 pizza parmi une liste éligible OU 1 grande bouteille de soda éligible,
 * ajoutée à une commande qui contient au moins une pizza payante.
 *
 * Principe : le solde n'est jamais stocké, il est recalculé depuis le journal d'événements.
 * Chaque commande est « réconciliée » : on calcule ce qu'elle devrait avoir crédité/consommé,
 * on compare à ce qui figure déjà dans le journal, et on n'écrit que la différence.
 * Conséquences : double validation, double encaissement, annulation et modification toujours cohérents.
 *
 * - Pizzas payantes : créditées quand la commande est encaissée (pas avant).
 * - Récompense : prise dès l'enregistrement de la commande (réservée), consommée quand elle est
 *   encaissée, restituée si elle est annulée. Une récompense réservée n'est donc jamais réutilisable
 *   par une autre commande.
 */

export interface LoyaltyBalance {
  /** Pizzas payantes comptabilisées au total. */
  totalPoints: number;
  rewardsEarned: number;
  rewardsUsed: number;
  /** Récompenses utilisables maintenant (jamais négatif). */
  available: number;
  /** Progression vers la prochaine récompense : 0 à pizzasPerReward - 1 (jamais 10/10). */
  progress: number;
  pointsToNext: number;
  /**
   * > 0 quand une récompense a été utilisée puis que les points qui l'avaient débloquée
   * ont été annulés : la prochaine récompense gagnée compensera.
   */
  debt: number;
}

export function computeBalance(events: LoyaltyEvent[], customerId: string, rules: LoyaltyRules): LoyaltyBalance {
  let points = 0;
  let used = 0;
  for (const e of events) {
    if (e.customerId !== customerId) continue;
    if (e.type === 'points') points += e.delta;
    else used += e.delta;
  }
  const safePoints = Math.max(0, points);
  const per = rules.pizzasPerReward;
  const rewardsEarned = Math.floor(safePoints / per);
  const raw = rewardsEarned - used;
  const progress = safePoints % per;
  return {
    totalPoints: safePoints,
    rewardsEarned,
    rewardsUsed: used,
    available: Math.max(0, raw),
    progress,
    pointsToNext: per - progress,
    debt: Math.max(0, -raw),
  };
}

/** Pizzas qui génèrent des points : pizzas payantes uniquement (une pizza offerte ne rapporte rien). */
export function countEarningPizzas(lines: OrderLine[]): number {
  return paidPizzaCount(lines);
}

/**
 * Éligibilité d'un produit comme récompense.
 * Les garde-fous (alcool, desserts, catégorie) s'appliquent même si la configuration les liste par erreur.
 */
export function isRewardEligible(product: Product, kind: RewardKind, rules: LoyaltyRules): boolean {
  if (kind === 'pizza') {
    return product.category === 'pizza' && rules.eligiblePizzaIds.includes(product.id);
  }
  return product.category === 'boisson' && !product.alcohol && rules.eligibleDrinkIds.includes(product.id);
}

export function eligibleRewardProducts(catalog: Catalog, kind: RewardKind, rules: LoyaltyRules): Product[] {
  return catalog.products.filter((p) => isRewardEligible(p, kind, rules));
}

/** Ce que le journal a déjà enregistré pour une commande et un client donnés. */
export function netForOrder(events: LoyaltyEvent[], orderId: string, customerId: string) {
  let points = 0;
  let rewardsUsed = 0;
  for (const e of events) {
    if (e.orderId !== orderId || e.customerId !== customerId) continue;
    if (e.type === 'points') points += e.delta;
    else rewardsUsed += e.delta;
  }
  return { points, rewardsUsed };
}

/**
 * Points que la commande doit avoir crédités : ses pizzas payantes, une fois encaissée ; 0 sinon.
 * Cas des commandes d'avant le suivi des paiements : voir reconcileOrderLoyalty (points gelés).
 */
export function targetPoints(order: Order): number {
  if (!order.customerId || order.status === 'annulee' || !isPaid(order)) return 0;
  return countEarningPizzas(order.lines);
}

/** Récompenses que la commande consomme (restituées si la commande est annulée). */
export function targetRewardsUsed(order: Order): number {
  if (!order.customerId || order.status === 'annulee') return 0;
  return rewardLineCount(order.lines);
}

/**
 * Renvoie les événements à ajouter au journal pour que la commande soit cohérente.
 * Idempotent : appelé deux fois de suite, le second appel renvoie [].
 * Gère aussi le changement de client lors d'une modification (l'ancien client est régularisé).
 */
export function reconcileOrderLoyalty(
  events: LoyaltyEvent[],
  order: Order,
  ctx: { nowIso: string; newId: IdFactory },
): LoyaltyEvent[] {
  const customerIds = new Set<string>();
  for (const e of events) if (e.orderId === order.id) customerIds.add(e.customerId);
  if (order.customerId) customerIds.add(order.customerId);

  const out: LoyaltyEvent[] = [];
  const label = `Commande n° ${order.number}`;
  for (const customerId of customerIds) {
    const isCurrent = customerId === order.customerId;
    const net = netForOrder(events, order.id, customerId);
    // Commande d'avant le suivi des paiements, non encaissée et non annulée : ses points (crédités à
    // l'enregistrement par l'ancienne règle) sont gelés tels quels. Ni retirés sans action explicite,
    // ni ajoutés sans encaissement. L'encaissement ou l'annulation les remet à la règle normale.
    const frozen = isCurrent && isLegacyUnpaid(order) && order.status !== 'annulee';
    const wantPoints = frozen ? net.points : isCurrent ? targetPoints(order) : 0;
    const wantRewards = isCurrent ? targetRewardsUsed(order) : 0;

    const pointsDelta = wantPoints - net.points;
    if (pointsDelta !== 0) {
      let reason: LoyaltyReason;
      if (order.status === 'annulee') reason = 'commande_annulee';
      else if (!isPaid(order)) reason = 'encaissement_annule';
      else if (net.points === 0 && pointsDelta > 0) reason = 'commande_encaissee';
      else reason = 'commande_modifiee';
      out.push({
        id: ctx.newId('loy'),
        at: ctx.nowIso,
        customerId,
        orderId: order.id,
        type: 'points',
        delta: pointsDelta,
        reason,
        label,
      });
    }

    const rewardsDelta = wantRewards - net.rewardsUsed;
    if (rewardsDelta !== 0) {
      out.push({
        id: ctx.newId('loy'),
        at: ctx.nowIso,
        customerId,
        orderId: order.id,
        type: 'rewards_used',
        delta: rewardsDelta,
        reason: rewardsDelta > 0 ? 'recompense_reservee' : 'recompense_restituee',
        label,
      });
    }
  }
  return out;
}

/**
 * Récompenses encore disponibles pour la commande en cours de saisie :
 * solde du client − récompenses déjà ajoutées au panier
 * (+ celles déjà consommées par la commande si on la modifie).
 * Peut être négatif si le panier dépasse le solde.
 */
export function rewardsRemainingForCart(events: LoyaltyEvent[], cart: Cart, rules: LoyaltyRules): number {
  if (!cart.customerId) return 0;
  const balance = computeBalance(events, cart.customerId, rules);
  const alreadyUsedByEditedOrder = cart.editingOrderId
    ? netForOrder(events, cart.editingOrderId, cart.customerId).rewardsUsed
    : 0;
  return balance.available - balance.debt + alreadyUsedByEditedOrder - rewardLineCount(cart.lines);
}

/**
 * Vue d'un client pour l'affichage : récompenses réservées par des commandes non encaissées,
 * récompenses consommées, et pizzas en attente d'encaissement (pas encore créditées).
 */
export function customerLoyaltyStatus(events: LoyaltyEvent[], orders: Order[], customerId: string) {
  let reserved = 0;
  let pendingPizzas = 0;
  const reservingOrders: number[] = [];
  for (const o of orders) {
    if (o.status === 'annulee') continue;
    const net = netForOrder(events, o.id, customerId);
    // Ancienne commande (legacy) : sa récompense était déjà considérée comme utilisée, pas « réservée ».
    if (!isPaid(o) && !isLegacyUnpaid(o) && net.rewardsUsed > 0) {
      reserved += net.rewardsUsed;
      reservingOrders.push(o.number);
    }
    if (o.customerId === customerId && !isPaid(o) && !isLegacyUnpaid(o)) pendingPizzas += countEarningPizzas(o.lines);
  }
  return { reserved, reservingOrders, pendingPizzas };
}

export const LOYALTY_REASON_LABELS: Record<LoyaltyReason, string> = {
  commande_encaissee: 'Pizzas créditées (commande encaissée)',
  encaissement_annule: 'Pizzas retirées (encaissement annulé)',
  commande_modifiee: 'Pizzas ajustées (commande modifiée)',
  commande_annulee: 'Pizzas retirées (commande annulée)',
  recompense_reservee: 'Récompense réservée (consommée à l’encaissement)',
  recompense_restituee: 'Récompense restituée',
  reprise_demo: 'Reprise d’historique (démo)',
  commande_validee: 'Points crédités à l’enregistrement (ancienne règle)',
  statut_modifie: 'Points ajustés (changement de statut)',
  recompense_utilisee: 'Récompense utilisée (ancienne règle)',
};
