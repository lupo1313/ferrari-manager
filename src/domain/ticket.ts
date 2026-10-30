import type { Order, OrderLine, ProductCategory, Settings } from './types';
import { describeLine } from './cart';
import { formatPhone } from './customers';
import { formatPrice } from './money';
import { MODE_LABELS } from './orders';
import { asPaymentPlan, isLegacyUnpaid, isPaid, paidGap, paidTenders, planBreakdown, TENDER_LABELS } from './payment';
import { formatDate, formatTime, formatTimeOfDay } from './time';
import { formatDistance, formatDuration, validTripFor } from './trip';

/**
 * Deux documents distincts, indépendants de l'affichage (le même modèle servira en V2 à générer
 * des commandes ESC/POS pour une imprimante thermique) :
 * - ticket CUISINE : préparation, sans coordonnées ni paiement ;
 * - ticket LIVREUR : livraison et sommes à encaisser (commandes en livraison uniquement).
 */

export type TicketKind = 'cuisine' | 'livreur';

export const TICKET_LABELS: Record<TicketKind, string> = {
  cuisine: 'Ticket cuisine',
  livreur: 'Ticket livreur',
};

/** Tickets d'une commande : cuisine toujours, livreur seulement pour une livraison. */
export function ticketKindsFor(order: Pick<Order, 'mode'>): TicketKind[] {
  return order.mode === 'livraison' ? ['cuisine', 'livreur'] : ['cuisine'];
}

interface TicketHeader {
  pizzeriaName: string;
  /** Ex. « COMMANDE N° 28 · LIVRAISON » */
  headline: string;
  /** Commande modifiée après sa création : la cuisine doit le voir. */
  revisionLabel: string | null;
  date: string;
  time: string;
  requestedLabel: string;
  statusWarning: string | null;
  widthMm: number;
}

export interface KitchenLine {
  quantity: number;
  name: string;
  details: string[];
}

export interface KitchenTicket extends TicketHeader {
  kind: 'cuisine';
  /** Nom seul, pour reconnaître le sac ou appeler le client au comptoir (ni téléphone ni adresse). */
  customerName: string | null;
  groups: { title: string; lines: KitchenLine[] }[];
  pizzaCount: number;
  note: string | null;
}

export interface DeliveryLine {
  quantity: number;
  name: string;
  offered: boolean;
}

/** Bloc paiement du livreur : ce qui est payé, ce qui reste à encaisser, et comment. */
export interface DeliveryPayment {
  /** Ex. « À ENCAISSER : 28,00 € », « COMMANDE DÉJÀ PAYÉE ». */
  headline: string;
  /** Ex. « Reste à encaisser : 0,00 € » ; null si sans objet. */
  dueLine: string | null;
  /** Titre des lignes : « Mode prévu », « Payé ». */
  rowsTitle: string | null;
  rows: { label: string; amount: string }[];
  /** Avertissements à lire avant de partir. */
  notes: string[];
}

export interface DeliveryTicket extends TicketHeader {
  kind: 'livreur';
  pizzeriaPhone: string;
  customer: {
    name: string;
    phone: string | null;
    addressLines: string[];
    /** Repères renseignés uniquement (Bâtiment, Étage, Interphone, Digicode, Complément). */
    details: { label: string; value: string }[];
    instructions: string | null;
  } | null;
  /** Trajet en scooter calculé pour l'adresse de la commande ; null si non calculé ou caduc. */
  trip: { distance: string; duration: string } | null;
  lines: DeliveryLine[];
  itemCount: number;
  total: string;
  /** Ancienne commande avec frais de livraison historiques : rappel du montant inclus dans le total. */
  historicFee: string | null;
  payment: DeliveryPayment;
}

function header(order: Order, settings: Settings): TicketHeader {
  return {
    pizzeriaName: settings.pizzeria.name.toUpperCase(),
    headline: `COMMANDE N° ${order.number} · ${MODE_LABELS[order.mode].toUpperCase()}`,
    revisionLabel: order.revision > 1 ? `MODIFIÉE (version ${order.revision})` : null,
    date: formatDate(order.createdAt),
    time: formatTime(order.createdAt),
    requestedLabel: order.requestedTime ? `POUR ${formatTimeOfDay(order.requestedTime).toUpperCase()}` : 'DÈS QUE POSSIBLE',
    statusWarning: order.status === 'annulee' ? 'COMMANDE ANNULÉE' : null,
    widthMm: settings.ticketWidthMm,
  };
}

const GROUPS: { category: ProductCategory; title: string }[] = [
  { category: 'pizza', title: 'PIZZAS' },
  { category: 'dessert', title: 'DESSERTS' },
  { category: 'boisson', title: 'BOISSONS' },
];

export function buildKitchenTicket(order: Order, settings: Settings): KitchenTicket {
  const kitchenLine = (l: OrderLine): KitchenLine => ({ quantity: l.quantity, name: l.name.toUpperCase(), details: describeLine(l) });
  return {
    ...header(order, settings),
    kind: 'cuisine',
    customerName: order.customer?.name || order.counterName || null,
    groups: GROUPS.map((g) => ({ title: g.title, lines: order.lines.filter((l) => l.category === g.category).map(kitchenLine) })).filter(
      (g) => g.lines.length > 0,
    ),
    pizzaCount: order.lines.filter((l) => l.category === 'pizza').reduce((s, l) => s + l.quantity, 0),
    note: order.note || null,
  };
}

/** Ce que le livreur doit savoir du paiement. Un paiement prévu n'est jamais présenté comme effectué. */
export function deliveryPayment(order: Order): DeliveryPayment {
  const total = order.totals.total;
  if (order.status === 'annulee') {
    return { headline: 'COMMANDE ANNULÉE', dueLine: null, rowsTitle: null, rows: [], notes: ['Ne pas livrer sans accord du gérant.'] };
  }
  if (isPaid(order)) {
    const paid = paidTenders(order);
    const gap = paidGap(order);
    const notes: string[] = [];
    if (gap > 0) notes.push(`Montant augmenté après paiement : écart de ${formatPrice(gap)}, à voir avec le gérant.`);
    if (gap < 0) notes.push(`Montant réduit après paiement : ${formatPrice(-gap)} perçu en trop, à voir avec le gérant.`);
    return {
      headline: 'COMMANDE DÉJÀ PAYÉE',
      dueLine: `Reste à encaisser : ${formatPrice(0)}`,
      rowsTitle: paid.length ? 'Payé' : null,
      rows: paid.map((p) => ({ label: TENDER_LABELS[p.kind], amount: formatPrice(p.amount) })),
      notes,
    };
  }
  if (isLegacyUnpaid(order)) {
    return {
      headline: 'PAIEMENT NON SUIVI',
      dueLine: null,
      rowsTitle: null,
      rows: [],
      notes: [`Ancienne commande : vérifier avec le gérant s’il faut encaisser ${formatPrice(total)}.`],
    };
  }
  const plan = asPaymentPlan(order.paymentPlan);
  const breakdown = plan ? planBreakdown(plan, total) : null;
  if (!breakdown || breakdown.parts.length === 0) {
    return { headline: `À ENCAISSER : ${formatPrice(total)}`, dueLine: null, rowsTitle: null, rows: [], notes: ['MODE DE PAIEMENT À CONFIRMER'] };
  }
  const rows = breakdown.parts.map((p) => ({ label: TENDER_LABELS[p.kind], amount: formatPrice(p.amount) }));
  if (breakdown.unassigned > 0) rows.push({ label: 'Non affecté', amount: formatPrice(breakdown.unassigned) });
  const notes = breakdown.excess > 0 ? [`Répartition prévue supérieure au total de ${formatPrice(breakdown.excess)} : à vérifier.`] : [];
  return { headline: `À ENCAISSER : ${formatPrice(total)}`, dueLine: null, rowsTitle: 'Mode prévu', rows, notes };
}

/** Ticket livreur, ou null pour une commande à emporter. */
export function buildDeliveryTicket(order: Order, settings: Settings): DeliveryTicket | null {
  if (order.mode !== 'livraison') return null;
  const c = order.customer;
  const detail = (label: string, value: string | undefined) => (value && value.trim() ? [{ label, value: value.trim() }] : []);
  return {
    ...header(order, settings),
    kind: 'livreur',
    pizzeriaPhone: settings.pizzeria.phone,
    customer: c
      ? {
          name: c.name,
          phone: c.phone ? formatPhone(c.phone) : null,
          addressLines: [c.address, `${c.postalCode} ${c.city}`].map((s) => s.trim()).filter(Boolean),
          details: [
            ...detail('Bâtiment', c.building),
            ...detail('Étage', c.floor),
            ...detail('Interphone', c.intercom),
            ...detail('Digicode', c.doorCode),
            ...detail('Complément', c.complement),
          ],
          instructions: c.instructions.trim() || null,
        }
      : null,
    trip: (() => {
      const t = validTripFor(order.deliveryTrip, order.mode, c);
      return t ? { distance: formatDistance(t.distanceM), duration: formatDuration(t.durationS) } : null;
    })(),
    lines: order.lines.map((l) => ({ quantity: l.quantity, name: l.name, offered: l.reward !== null })),
    itemCount: order.lines.reduce((s, l) => s + l.quantity, 0),
    total: formatPrice(order.totals.total),
    // Livraison toujours offerte ; une ancienne commande garde ses frais d'origine, inclus dans son total.
    historicFee: order.totals.deliveryFee > 0 ? formatPrice(order.totals.deliveryFee) : null,
    payment: deliveryPayment(order),
  };
}
