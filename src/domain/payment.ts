import type { Cents, Order, Payment, PaymentMethod, PaymentPart, PaymentPlan, PaymentStatus, TenderKind } from './types';
import { hasRewardWithoutPaidPizza, hasTooManyRewards, ONE_REWARD_PER_ORDER, REWARD_NEEDS_PAID_PIZZA } from './cart';
import { formatPrice } from './money';

/**
 * Suivi d'encaissement : deux statuts, un moyen facultatif. Pas de caisse : le paiement se fait sur la caisse habituelle.
 * Sert au suivi opérationnel et au crédit de fidélité (les pizzas sont créditées à l'encaissement).
 *
 * Paiement prévu (PaymentPlan) et encaissement confirmé (Payment) sont strictement séparés. L'encaissement
 * reste « tout ou rien » : une répartition confirmée couvre exactement le total, sinon rien n'est confirmé.
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

export const TENDER_KINDS: readonly TenderKind[] = ['especes', 'carte', 'titres_restaurant'];

export const TENDER_LABELS: Record<TenderKind, string> = {
  especes: 'Espèces',
  carte: 'Carte bancaire',
  titres_restaurant: 'Titres-restaurant',
};

const isCents = (v: unknown): v is Cents => typeof v === 'number' && Number.isInteger(v) && v >= 0;

function asParts(v: unknown): PaymentPart[] | null {
  if (!Array.isArray(v)) return null;
  const parts: PaymentPart[] = [];
  for (const p of v) {
    if (typeof p !== 'object' || p === null) return null;
    const { kind, amount } = p as Record<string, unknown>;
    if (!TENDER_KINDS.includes(kind as TenderKind) || !isCents(amount)) return null;
    parts.push({ kind: kind as TenderKind, amount });
  }
  return parts;
}

/** Relit un paiement prévu (stockage, saisie) ; null si absent ou incohérent. */
export function asPaymentPlan(v: unknown): PaymentPlan | null {
  if (typeof v !== 'object' || v === null) return null;
  const p = v as Record<string, unknown>;
  if (p.type === 'unique') return TENDER_KINDS.includes(p.kind as TenderKind) ? { type: 'unique', kind: p.kind as TenderKind } : null;
  if (p.type === 'mixte') {
    const parts = asParts(p.parts);
    return parts ? { type: 'mixte', parts } : null;
  }
  return null;
}

/** Une ligne par moyen utilisé, montants nuls retirés, ordre fixe (espèces, carte, titres). */
export function cleanParts(parts: PaymentPart[]): PaymentPart[] {
  return TENDER_KINDS.map((kind) => ({ kind, amount: parts.filter((p) => p.kind === kind).reduce((s, p) => s + p.amount, 0) })).filter(
    (p) => p.amount > 0,
  );
}

export const sumParts = (parts: PaymentPart[]): Cents => parts.reduce((s, p) => s + p.amount, 0);

export interface PlanBreakdown {
  parts: PaymentPart[];
  /** Montant du total rattaché à aucun moyen (répartition mixte incomplète). */
  unassigned: Cents;
  /** Montant prévu au-delà du total (commande réduite depuis la saisie de la répartition). */
  excess: Cents;
}

/** Répartition prévue appliquée au total actuel. Un moyen unique couvre toujours la totalité. */
export function planBreakdown(plan: PaymentPlan, total: Cents): PlanBreakdown {
  const parts = plan.type === 'unique' ? (total > 0 ? [{ kind: plan.kind, amount: total }] : []) : cleanParts(plan.parts);
  const sum = sumParts(parts);
  return { parts, unassigned: Math.max(0, total - sum), excess: Math.max(0, sum - total) };
}

/** Raison bloquante d'un paiement prévu, ou null. Incomplet : autorisé ; supérieur au total : refusé. */
export function planProblem(plan: PaymentPlan, total: Cents): string | null {
  const { excess } = planBreakdown(plan, total);
  if (excess > 0) return `La répartition prévue dépasse le total de ${formatPrice(excess)}. Corrigez les montants.`;
  return null;
}

/** Résumé court : « Espèces », « Espèces 10,00 € + Carte bancaire 18,00 € », « Non renseigné ». */
export function planLabel(plan: PaymentPlan | null | undefined, total: Cents): string {
  const p = asPaymentPlan(plan);
  if (!p) return 'Non renseigné';
  if (p.type === 'unique') return TENDER_LABELS[p.kind];
  const { parts, unassigned } = planBreakdown(p, total);
  if (parts.length === 0) return 'Non renseigné';
  const text = parts.map((x) => `${TENDER_LABELS[x.kind]} ${formatPrice(x.amount)}`).join(' + ');
  return unassigned > 0 ? `${text} · ${formatPrice(unassigned)} non affecté` : text;
}

/**
 * Contrôle d'une répartition à CONFIRMER comme encaissée : montants entiers positifs, au moins un moyen,
 * somme exactement égale au total (pas d'encaissement partiel, pas de rendu de monnaie).
 */
export function tendersProblem(parts: PaymentPart[], total: Cents): string | null {
  if (parts.some((p) => !isCents(p.amount) || !TENDER_KINDS.includes(p.kind))) return 'Montant invalide.';
  const sum = sumParts(parts);
  if (sum === 0) return 'Indiquez au moins un montant.';
  if (sum < total) return `Il reste ${formatPrice(total - sum)} à répartir : l’encaissement doit couvrir le total.`;
  if (sum > total) return `La répartition dépasse le total de ${formatPrice(sum - total)}.`;
  return null;
}

/** Résumé compatible avec la version précédente (voir PaymentMethod). */
export function methodFromTenders(parts: PaymentPart[]): PaymentMethod {
  const used = cleanParts(parts);
  if (used.length === 1 && used[0].kind === 'especes') return 'especes';
  if (used.length === 1 && used[0].kind === 'carte') return 'carte';
  return 'non_precise';
}

/** Détail de l'encaissement confirmé ; déduit du moyen pour les encaissements d'avant l'intervention 5. */
export function paidTenders(order: Order): PaymentPart[] {
  if (!isPaid(order)) return [];
  const parts = asParts(order.payment.tenders);
  if (parts && parts.length) return cleanParts(parts);
  const m = order.payment.method;
  return m === 'especes' || m === 'carte' ? [{ kind: m, amount: order.totals.total }] : [];
}

/** Libellé de l'encaissement confirmé : « Espèces », « Espèces 15,00 € + Carte bancaire 15,00 € », ou null. */
export function paidLabel(order: Order): string | null {
  const parts = paidTenders(order);
  if (parts.length === 0) return null;
  if (parts.length === 1) return TENDER_LABELS[parts[0].kind];
  return parts.map((x) => `${TENDER_LABELS[x.kind]} ${formatPrice(x.amount)}`).join(' + ');
}

/**
 * Commande encaissée puis modifiée : écart entre le total actuel et la somme encaissée (positif = manque).
 * 0 si rien n'est détaillé (« Non précisé », anciens encaissements) : on ne suppose rien.
 */
export function paidGap(order: Order): Cents {
  const parts = asParts(order.payment.tenders);
  if (!isPaid(order) || !parts || parts.length === 0) return 0;
  return order.totals.total - sumParts(parts);
}

/** Un paiement prévu a du sens tant que la commande attend un encaissement suivi. */
export function canPlanPayment(order: Order): boolean {
  return !isPaid(order) && !isLegacyUnpaid(order) && order.status !== 'annulee' && !order.archivedAt;
}

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
  if (order.customerId && hasTooManyRewards(order.lines)) {
    return `${ONE_REWARD_PER_ORDER} Modifiez la commande (retrait d’un cadeau) avant de l’encaisser.`;
  }
  return null;
}

/**
 * Marque la commande encaissée. Idempotent : sur une commande déjà encaissée, seul le moyen
 * de paiement peut changer, la date d'encaissement d'origine est conservée.
 */
export function markPaid(order: Order, how: PaymentMethod | PaymentPart[], nowIso: string): Order {
  const tenders = Array.isArray(how) ? cleanParts(how) : undefined;
  const method = Array.isArray(how) ? methodFromTenders(how) : how;
  if (isPaid(order)) {
    const same = order.payment.method === method && JSON.stringify(order.payment.tenders ?? null) === JSON.stringify(tenders ?? null);
    if (same) return order;
    // Correction du moyen : la date d'encaissement d'origine est conservée.
    const { tenders: _previous, ...rest } = order.payment;
    void _previous;
    return { ...order, payment: { ...rest, method, ...(tenders ? { tenders } : {}) }, updatedAt: nowIso };
  }
  return { ...order, payment: { status: 'encaissee', method, ...(tenders ? { tenders } : {}), paidAt: nowIso }, updatedAt: nowIso };
}

/** Correction d'une erreur de saisie : la commande repasse « à encaisser » (les points seront retirés). */
export function markUnpaid(order: Order, nowIso: string): Order {
  return { ...order, payment: unpaid(), updatedAt: nowIso };
}
