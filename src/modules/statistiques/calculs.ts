import type { Cents, Order, ProductCategory, ServiceRecord } from '../../domain/types';
import { subtotal } from '../../domain/pricing';
import { isLegacyUnpaid, isPaid } from '../../domain/payment';
import { serviceOfOrder } from '../../domain/service';

/**
 * Calculs du module Statistiques : fonctions pures, en LECTURE SEULE.
 * Elles ne modifient jamais une commande, un encaissement ou la fidélité (aucun import du store).
 * Le module entier peut être masqué ou retiré sans effet sur le reste de l'application.
 *
 * Règles validées par le gérant (30/10/2026) :
 * - une commande appartient au service où elle a été créée (domain/service : serviceOfOrder) ;
 * - un encaissement tardif reste dans le service d'origine, distingué « après la clôture » ;
 * - montants = somme des lignes : aucun frais de livraison, même ancien, n'est compté ;
 * - les annulées sont exclues de tout et affichées à part ; les cadeaux fidélité ne sont pas des ventes ;
 * - les commandes « Paiement non suivi » ne sont ni encaissées ni à encaisser.
 */

export type PeriodKind = 'service' | 'jour' | 'semaine' | 'mois';

export interface Period {
  /** « avant » : commandes antérieures au suivi des services, regroupées sans être un vrai service. */
  kind: PeriodKind | 'avant';
  /** Identifiant du service, « AAAA-MM-JJ » (jour ou lundi de la semaine), « AAAA-MM » ou « avant ». */
  key: string;
  /** Services couverts, du plus ancien au plus récent (vide pour « avant »). */
  services: ServiceRecord[];
}

export const BEFORE_TRACKING_KEY = 'avant';

/* ---------- Dates (heure locale de la tablette) ---------- */

const pad = (n: number) => String(n).padStart(2, '0');
const dayKeyOfDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Jour d'un service = jour de son ouverture : un service qui passe minuit reste sur son jour. */
export function dayKey(iso: string): string {
  return dayKeyOfDate(new Date(iso));
}

/** Semaine du lundi au dimanche, identifiée par son lundi. */
export function weekKey(iso: string): string {
  const d = new Date(iso);
  const offset = (d.getDay() + 6) % 7;
  return dayKeyOfDate(new Date(d.getFullYear(), d.getMonth(), d.getDate() - offset));
}

export function monthKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

function periodKeyOf(kind: PeriodKind, service: ServiceRecord): string {
  if (kind === 'service') return service.id;
  if (kind === 'jour') return dayKey(service.openedAt);
  if (kind === 'semaine') return weekKey(service.openedAt);
  return monthKey(service.openedAt);
}

/**
 * Périodes consultables, de la plus récente à la plus ancienne. Seules les périodes contenant au moins
 * un service sont proposées. En vue « service », le bloc « Avant le suivi des services » vient en dernier
 * s'il existe des commandes antérieures.
 */
export function availablePeriods(kind: PeriodKind, services: ServiceRecord[], hasOrdersBeforeTracking: boolean): Period[] {
  const groups = new Map<string, ServiceRecord[]>();
  for (const s of services) {
    const key = periodKeyOf(kind, s);
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  const periods: Period[] = [...groups.entries()].map(([key, list]) => ({ kind, key, services: list })).reverse();
  if (kind === 'service' && hasOrdersBeforeTracking) periods.push({ kind: 'avant', key: BEFORE_TRACKING_KEY, services: [] });
  return periods;
}

export function hasOrdersBeforeTracking(orders: Order[], services: ServiceRecord[]): boolean {
  return orders.some((o) => serviceOfOrder(o, services) === null);
}

/* ---------- Libellés ---------- */

const dayFormat = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const shortDayFormat = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
const dayMonthFormat = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });
const monthFormat = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' });

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** « 1 novembre » → « 1er novembre ». */
const firstOfMonth = (s: string) => s.replace(/(^|\s)1(\s)/, '$11er$2');
const fromKey = (key: string) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d ?? 1);
};

/** « 18 h 05 » */
export function clockLabel(iso: string): string {
  const d = new Date(iso);
  return `${d.getHours()} h ${pad(d.getMinutes())}`;
}

export function periodLabel(period: Period): string {
  if (period.kind === 'avant') return 'Avant le suivi des services';
  if (period.kind === 'service') {
    const s = period.services[0];
    const hours = s.closedAt ? `${clockLabel(s.openedAt)} à ${clockLabel(s.closedAt)}` : `depuis ${clockLabel(s.openedAt)}`;
    return `${capitalize(firstOfMonth(shortDayFormat.format(new Date(s.openedAt))))} · ${hours}`;
  }
  if (period.kind === 'jour') return capitalize(firstOfMonth(dayFormat.format(fromKey(period.key))));
  if (period.kind === 'semaine') {
    const monday = fromKey(period.key);
    const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
    return `Semaine du ${firstOfMonth(dayMonthFormat.format(monday))} au ${firstOfMonth(dayMonthFormat.format(sunday))} ${sunday.getFullYear()}`;
  }
  return capitalize(monthFormat.format(fromKey(period.key)));
}

/* ---------- Indicateurs ---------- */

export interface RankedProduct {
  productId: string;
  name: string;
  quantity: number;
  /** Prix figé × quantité, hors suppléments. */
  amount: Cents;
}

export interface HourBucket {
  /** Heure locale 0 à 23. */
  hour: number;
  /** Commandes enregistrées (non annulées) créées dans cette heure. */
  orders: number;
  /** Encaissements confirmés pendant le service, dans cette heure. */
  payments: number;
}

export interface PeriodStats {
  /** Commandes enregistrées, annulées exclues. */
  orderCount: number;
  registered: Cents;
  paid: Cents;
  paidCount: number;
  /** Partie encaissée avant la clôture du service de la commande (ou service encore ouvert). */
  paidBeforeClose: Cents;
  /** Encaissements enregistrés après la clôture du service de la commande. */
  paidAfterClose: Cents;
  paidAfterCloseCount: number;
  due: Cents;
  dueCount: number;
  /** Commandes d'avant le suivi des paiements : ni encaissées ni dues. */
  untracked: { count: number; amount: Cents };
  cancelled: { count: number; amount: Cents; paidCount: number; paidAmount: Cents };
  averageBasket: Cents;
  pizzas: number;
  drinks: number;
  desserts: number;
  /** Produits offerts par la fidélité (jamais comptés comme ventes). */
  rewards: number;
  deliveries: number;
  takeaway: number;
  ranking: Record<ProductCategory, RankedProduct[]>;
  hourly: HourBucket[];
  peak: HourBucket | null;
  /** Vue service uniquement : encaissements, pendant ce service, de commandes d'un service précédent. */
  paidFromEarlier: { count: number; amount: Cents };
  /** Anciennes commandes avec frais de livraison : frais conservés sur la commande, exclus des montants. */
  legacyFeeOrders: number;
}

/** Heure locale « de service » : la journée commence à 6 h, donc 0 h et 1 h viennent après 23 h. */
const serviceHourIndex = (hour: number) => (hour + 18) % 24;
const hourOf = (iso: string) => new Date(iso).getHours();

export function computePeriodStats(period: Period, orders: Order[], allServices: ServiceRecord[], nowIso: string): PeriodStats {
  const inPeriod = new Map(period.services.map((s) => [s.id, s]));
  const scoped = orders.filter((o) => {
    const sid = serviceOfOrder(o, allServices);
    return period.kind === 'avant' ? sid === null : sid !== null && inPeriod.has(sid);
  });

  const stats: PeriodStats = {
    orderCount: 0,
    registered: 0,
    paid: 0,
    paidCount: 0,
    paidBeforeClose: 0,
    paidAfterClose: 0,
    paidAfterCloseCount: 0,
    due: 0,
    dueCount: 0,
    untracked: { count: 0, amount: 0 },
    cancelled: { count: 0, amount: 0, paidCount: 0, paidAmount: 0 },
    averageBasket: 0,
    pizzas: 0,
    drinks: 0,
    desserts: 0,
    rewards: 0,
    deliveries: 0,
    takeaway: 0,
    ranking: { pizza: [], boisson: [], dessert: [] },
    hourly: [],
    peak: null,
    paidFromEarlier: { count: 0, amount: 0 },
    legacyFeeOrders: 0,
  };
  const ranks: Record<ProductCategory, Map<string, RankedProduct>> = { pizza: new Map(), boisson: new Map(), dessert: new Map() };
  const orderHours = new Map<number, number>();
  const paymentHours = new Map<number, number>();
  const bump = (m: Map<number, number>, h: number) => m.set(h, (m.get(h) ?? 0) + 1);

  for (const o of scoped) {
    // Somme des lignes : les frais de livraison (anciennes commandes) ne sont jamais comptés.
    const amount = subtotal(o.lines);
    if (o.status === 'annulee') {
      stats.cancelled.count++;
      stats.cancelled.amount += amount;
      if (isPaid(o)) {
        stats.cancelled.paidCount++;
        stats.cancelled.paidAmount += amount;
      }
      continue;
    }
    stats.orderCount++;
    stats.registered += amount;
    if (o.mode === 'livraison') stats.deliveries++;
    else stats.takeaway++;
    if (o.totals.deliveryFee > 0) stats.legacyFeeOrders++;
    bump(orderHours, hourOf(o.createdAt));

    if (isPaid(o)) {
      stats.paid += amount;
      stats.paidCount++;
      const closedAt = inPeriod.get(serviceOfOrder(o, allServices) ?? '')?.closedAt ?? null;
      const paidAt = o.payment.paidAt;
      if (closedAt && paidAt && paidAt > closedAt) {
        stats.paidAfterClose += amount;
        stats.paidAfterCloseCount++;
      } else {
        stats.paidBeforeClose += amount;
        if (paidAt) bump(paymentHours, hourOf(paidAt));
      }
    } else if (isLegacyUnpaid(o)) {
      stats.untracked.count++;
      stats.untracked.amount += amount;
    } else {
      stats.due += amount;
      stats.dueCount++;
    }

    for (const l of o.lines) {
      if (l.reward) {
        stats.rewards += l.quantity;
        continue;
      }
      if (l.category === 'pizza') stats.pizzas += l.quantity;
      else if (l.category === 'boisson') stats.drinks += l.quantity;
      else stats.desserts += l.quantity;
      const r = ranks[l.category].get(l.productId) ?? { productId: l.productId, name: l.name, quantity: 0, amount: 0 };
      ranks[l.category].set(l.productId, { ...r, quantity: r.quantity + l.quantity, amount: r.amount + l.unitPrice * l.quantity });
    }
  }

  stats.averageBasket = stats.orderCount ? Math.round(stats.registered / stats.orderCount) : 0;
  for (const cat of ['pizza', 'boisson', 'dessert'] as const) {
    stats.ranking[cat] = [...ranks[cat].values()].sort((a, b) => b.quantity - a.quantity || b.amount - a.amount || a.name.localeCompare(b.name, 'fr'));
  }

  // Vue d'un seul service : encaissements faits pendant ce service pour des commandes plus anciennes.
  if (period.kind === 'service') {
    const s = period.services[0];
    const end = s.closedAt ?? nowIso;
    for (const o of orders) {
      if (o.status === 'annulee' || !isPaid(o) || !o.payment.paidAt) continue;
      if (serviceOfOrder(o, allServices) === s.id) continue;
      if (o.payment.paidAt >= s.openedAt && o.payment.paidAt <= end) {
        stats.paidFromEarlier.count++;
        stats.paidFromEarlier.amount += subtotal(o.lines);
      }
    }
  }

  stats.hourly = hourlyBuckets(orderHours, paymentHours, period, nowIso);
  stats.peak = stats.hourly.reduce<HourBucket | null>((best, b) => (b.orders > 0 && (!best || b.orders > best.orders) ? b : best), null);
  return stats;
}

/**
 * Axe horaire continu dans l'ordre du service (18 h, 19 h… 23 h, 0 h, 1 h), y compris les heures creuses.
 * Pour un seul service, l'axe couvre aussi l'ouverture et la fermeture (ou l'heure actuelle).
 */
function hourlyBuckets(orderHours: Map<number, number>, paymentHours: Map<number, number>, period: Period, nowIso: string): HourBucket[] {
  const indexes = [...orderHours.keys(), ...paymentHours.keys()].map(serviceHourIndex);
  if (period.kind === 'service') {
    const s = period.services[0];
    const start = serviceHourIndex(hourOf(s.openedAt));
    const end = serviceHourIndex(hourOf(s.closedAt ?? nowIso));
    indexes.push(start);
    // Service anormalement long (oubli de fermeture sur plus d'une journée) : on ne prolonge pas l'axe.
    if (end >= start) indexes.push(end);
  }
  if (indexes.length === 0) return [];
  const first = Math.min(...indexes);
  const last = Math.max(...indexes);
  const buckets: HourBucket[] = [];
  for (let i = first; i <= last; i++) {
    const hour = (i + 6) % 24;
    buckets.push({ hour, orders: orderHours.get(hour) ?? 0, payments: paymentHours.get(hour) ?? 0 });
  }
  return buckets;
}
