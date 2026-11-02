import type { ClosureState } from './closure';
import { computePeriodStats } from './statistics';
import { currentService, serviceOfOrder } from './service';
import { isPaid, paidTenders, sumParts, TENDER_LABELS } from './payment';
import type { Order } from './types';
import { formatPrice } from './money';

export interface ReportLine { text: string; right?: string; heading?: boolean }
const date = (s: string) => new Date(s).toLocaleString('fr-FR');

/** Réutilise les calculs des statistiques, les lignes figées et les encaissements confirmés. */
export function serviceReport(data: ClosureState, at: string): ReportLine[] {
  const s = currentService(data.services);
  const stats = computePeriodStats({ kind: 'service', key: s.id, services: [s] }, data.orders, data.services, at);
  const current = data.orders.filter((o) => serviceOfOrder(o, data.services) === s.id);
  const earlier = data.orders.filter((o) => !current.includes(o));
  const lines: ReportLine[] = [
    { text: `Service du ${date(data.serviceStartedAt)}` }, { text: `Bilan préparé le ${date(at)}` },
    { text: 'Chiffres indicatifs. Ni document de caisse ni comptabilité certifiée.' },
    { text: 'Ventes enregistrées du service', heading: true },
    { text: `${stats.orderCount} commandes, hors annulations`, right: formatPrice(stats.registered) },
    { text: 'Panier moyen enregistré', right: formatPrice(stats.averageBasket) },
    { text: `Livraison : ${stats.deliveries} / À emporter : ${stats.takeaway}` },
    { text: 'Montants des ventes = somme des lignes, suppléments inclus. Cadeaux et annulations séparés.' },
    { text: 'Encaissements confirmés du service', heading: true },
  ];
  appendPayments(lines, current);
  const earlierPaidHere = earlier.filter((o) => o.payment.paidAt && o.payment.paidAt >= s.openedAt && o.payment.paidAt <= at);
  if (earlierPaidHere.length) {
    lines.push({ text: 'Encaissements du service pour commandes antérieures', heading: true });
    appendPayments(lines, earlierPaidHere);
  }
  lines.push({ text: `Commandes non encaissées : ${stats.dueCount}`, right: formatPrice(stats.due) },
    { text: `Paiement non suivi : ${stats.untracked.count}`, right: formatPrice(stats.untracked.amount) },
    { text: 'Ventes par produit (hors cadeaux)', heading: true });
  for (const cat of ['pizza', 'boisson', 'dessert'] as const) {
    lines.push({ text: cat === 'pizza' ? 'Pizzas' : cat === 'boisson' ? 'Boissons' : 'Desserts', heading: true });
    for (const p of stats.ranking[cat]) lines.push({ text: `${p.quantity} x ${p.name}`, right: formatPrice(p.amount) });
    if (!stats.ranking[cat].length) lines.push({ text: 'Aucune vente.' });
  }
  const toppings = new Map<string, { qty: number; amount: number }>();
  for (const o of current.filter((o) => o.status !== 'annulee')) for (const l of o.lines) for (const t of l.addedToppings) {
    const p = toppings.get(t.name) ?? { qty: 0, amount: 0 };
    toppings.set(t.name, { qty: p.qty + l.quantity, amount: p.amount + t.price * l.quantity });
  }
  lines.push({ text: 'Suppléments vendus (déjà inclus dans les ventes)', heading: true });
  for (const [name, t] of toppings) lines.push({ text: `${t.qty} x ${name}`, right: formatPrice(t.amount) });
  if (!toppings.size) lines.push({ text: 'Aucun supplément.' });
  lines.push({ text: 'Cadeaux fidélité (hors ventes)', heading: true });
  const gifts = current.filter((o) => o.status !== 'annulee').flatMap((o) => o.lines.filter((l) => l.reward));
  for (const l of gifts) lines.push({ text: `${l.quantity} x ${l.name} offert`, right: '0,00 €' });
  if (!gifts.length) lines.push({ text: 'Aucun cadeau.' });
  lines.push({ text: 'Les suppléments sur les cadeaux restent payants, inclus ci-dessus.' },
    { text: 'Annulations du service (hors ventes)', heading: true });
  appendCancellations(lines, current);
  lines.push({ text: 'Archives antérieures également retirées', heading: true },
    { text: `${earlier.length} commandes antérieures ; leurs montants ne sont pas ajoutés au service ci-dessus.` });
  if (earlier.length) {
    const active = earlier.filter((o) => o.status !== 'annulee');
    lines.push({ text: `${active.length} commandes antérieures enregistrées`, right: formatPrice(active.reduce((n, o) => n + o.totals.subtotal, 0)) });
    appendPayments(lines, earlier); appendCancellations(lines, earlier);
  }
  lines.push({ text: 'Périmètre de la clôture', heading: true },
    { text: `${data.orders.length} commandes et tout l'historique des services seront retirés du Manager et de ses archives.` },
    { text: 'Clients, fidélité, carte, suppléments et paramètres conservés. Ancienne copie interne de restauration supprimée.' },
    { text: 'Le PDF est un bilan. Seule la sauvegarde de reprise JSON permet de récupérer le logiciel, fermé et sans commandes.' });
  return lines;
}

export function confirmedPayments(orders: Order[]) {
  const paid = orders.filter((o) => o.status !== 'annulee' && isPaid(o));
  const totals = new Map<string, number>(); let total = 0;
  for (const o of paid) {
    const parts = paidTenders(o);
    const amount = parts.length ? sumParts(parts) : o.totals.total;
    total += amount;
    if (!parts.length) totals.set('Moyen non précisé', (totals.get('Moyen non précisé') ?? 0) + amount);
    for (const p of parts) totals.set(TENDER_LABELS[p.kind], (totals.get(TENDER_LABELS[p.kind]) ?? 0) + p.amount);
  }
  return { count: paid.length, total, totals };
}
function appendPayments(lines: ReportLine[], orders: Order[]) {
  const { count, total, totals } = confirmedPayments(orders);
  lines.push({ text: `${count} commandes marquées encaissées (hors annulées)`, right: formatPrice(total) });
  for (const [name, amount] of totals) lines.push({ text: name, right: formatPrice(amount) });
  lines.push({ text: 'Encaissements = montants confirmés dans le logiciel, pas un contrôle physique de caisse. Frais historiques inclus si enregistrés.' });
}
function appendCancellations(lines: ReportLine[], orders: Order[]) {
  const cancelled = orders.filter((o) => o.status === 'annulee');
  if (!cancelled.length) lines.push({ text: 'Aucune annulation.' });
  for (const o of cancelled) lines.push({ text: `N° ${o.number} du ${date(o.createdAt)} : annulée${isPaid(o) ? ', marquée encaissée' : ', non encaissée'}`, right: formatPrice(o.totals.total) });
  const amount = cancelled.filter(isPaid).reduce((n, o) => n + (paidTenders(o).length ? sumParts(paidTenders(o)) : o.totals.total), 0);
  lines.push({ text: 'Annulées marquées encaissées (séparées, remboursement non suivi)', right: formatPrice(amount) });
}
