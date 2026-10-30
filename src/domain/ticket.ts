import type { Order, Settings } from './types';
import { describeLine } from './cart';
import { formatPhone } from './customers';
import { formatPrice } from './money';
import { lineTotal, rewardSavings } from './pricing';
import { MODE_LABELS } from './orders';
import { formatDate, formatTime, formatTimeOfDay } from './time';

/**
 * Modèle de ticket indépendant de l'affichage : le même objet servira en V2
 * à générer des commandes ESC/POS pour une imprimante thermique.
 */
export interface TicketLine {
  quantity: number;
  name: string;
  amount: string;
  details: string[];
  offered: boolean;
}

export interface TicketModel {
  pizzeriaName: string;
  pizzeriaAddress: string;
  pizzeriaPhone: string;
  orderLabel: string;
  revisionLabel: string | null;
  date: string;
  time: string;
  modeLabel: string;
  requestedLabel: string;
  customer: {
    name: string;
    phone: string | null;
    addressLines: string[];
    instructions: string | null;
  } | null;
  lines: TicketLine[];
  note: string | null;
  subtotal: string;
  deliveryFee: string | null;
  savings: string | null;
  total: string;
  statusWarning: string | null;
  widthMm: number;
}

export function buildTicket(order: Order, settings: Settings): TicketModel {
  const c = order.customer;
  let customer: TicketModel['customer'] = null;
  if (c) {
    const addressLines =
      order.mode === 'livraison'
        ? [c.address, `${c.postalCode} ${c.city}`.trim(), c.complement].filter((s) => s.trim() !== '')
        : [];
    customer = {
      name: c.name,
      phone: c.phone ? formatPhone(c.phone) : null,
      addressLines,
      instructions: order.mode === 'livraison' && c.instructions ? c.instructions : null,
    };
  } else if (order.counterName) {
    customer = { name: order.counterName, phone: null, addressLines: [], instructions: null };
  }

  const savings = rewardSavings(order.lines);
  return {
    pizzeriaName: settings.pizzeria.name,
    pizzeriaAddress: settings.pizzeria.address,
    pizzeriaPhone: settings.pizzeria.phone,
    orderLabel: `Commande n° ${order.number}`,
    revisionLabel: order.revision > 1 ? `Modifiée (version ${order.revision})` : null,
    date: formatDate(order.createdAt),
    time: formatTime(order.createdAt),
    modeLabel: MODE_LABELS[order.mode].toUpperCase(),
    requestedLabel: order.requestedTime ? `Pour ${formatTimeOfDay(order.requestedTime)}` : 'Dès que possible',
    customer,
    lines: order.lines.map((l) => ({
      quantity: l.quantity,
      name: l.name,
      amount: l.reward ? (lineTotal(l) > 0 ? formatPrice(lineTotal(l)) : 'OFFERT') : formatPrice(lineTotal(l)),
      details: [...(l.reward ? ['Offert fidélité'] : []), ...describeLine(l)],
      offered: l.reward !== null,
    })),
    note: order.note || null,
    subtotal: formatPrice(order.totals.subtotal),
    // Livraison toujours offerte ; une ancienne commande garde l'affichage de ses frais d'origine.
    deliveryFee: order.mode === 'livraison' ? (order.totals.deliveryFee > 0 ? formatPrice(order.totals.deliveryFee) : 'Offerte') : null,
    savings: savings > 0 ? formatPrice(savings) : null,
    total: formatPrice(order.totals.total),
    statusWarning: order.status === 'annulee' ? 'COMMANDE ANNULÉE' : null,
    widthMm: settings.ticketWidthMm,
  };
}
