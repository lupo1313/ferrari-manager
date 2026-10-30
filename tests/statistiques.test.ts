import { describe, expect, it } from 'vitest';
import { createAppStore } from '../src/state/store';
import { createMemoryRepository } from '../src/storage/repository';
import { demoCatalog } from '../src/data/catalog';
import { buildDemoData } from '../src/data/seed';
import { currentService } from '../src/domain/service';
import { subtotal } from '../src/domain/pricing';
import {
  availablePeriods,
  computePeriodStats,
  dayKey,
  hasOrdersBeforeTracking,
  monthKey,
  periodLabel,
  weekKey,
  type Period,
} from '../src/modules/statistiques/calculs';
import type { Order, ServiceRecord } from '../src/domain/types';

const price = (id: string) => demoCatalog.products.find((p) => p.id === id)!.price;

/**
 * Store de test : un service vide ouvert le 30/10 à 18 h (le service de démonstration est clôturé
 * et ses commandes annulées pour partir de zéro).
 */
function setup() {
  let n = 0;
  const clock = { time: new Date('2026-10-30T16:00:00') };
  const repo = createMemoryRepository();
  const store = createAppStore({ repo, catalog: demoCatalog, seed: buildDemoData, now: () => clock.time, newId: (p) => `${p}_${++n}` });
  for (const o of store.getData().orders) store.cancelOrder(o.id);
  store.closeService();
  const set = (iso: string) => (clock.time = new Date(iso));
  set('2026-10-30T18:00:00');
  store.openService();
  const jean = store.getData().customers.find((c) => c.lastName === 'Dupont')!;
  const karim = store.getData().customers.find((c) => c.lastName === 'Benali')!;

  /** Enregistre une commande. `products` : identifiants, éventuellement répétés (fusionnés en quantité). */
  const order = (products: string[], opts: { mode?: 'livraison' | 'emporter'; customerId?: string | null; reward?: string } = {}) => {
    store.selectCustomer(opts.customerId === undefined ? jean.id : opts.customerId);
    store.setMode(opts.mode ?? 'emporter');
    for (const p of products) store.addProduct(p);
    if (opts.reward) {
      const r = store.addReward('pizza', opts.reward);
      if (!r.ok) throw new Error(r.error);
    }
    const r = store.validateCart();
    if (!r.ok) throw new Error(r.error);
    return r.value;
  };
  const data = () => store.getData();
  const svc = () => currentService(data().services);
  const servicePeriod = (s: ServiceRecord = svc()): Period => ({ kind: 'service', key: s.id, services: [s] });
  const stats = (period: Period = servicePeriod()) => computePeriodStats(period, data().orders, data().services, clock.time.toISOString());
  return { store, clock, set, jean, karim, order, data, svc, servicePeriod, stats };
}

describe('statistiques : indicateurs d’un service', () => {
  it('un nouveau service commence à zéro, les commandes de la veille n’y apparaissent pas', () => {
    const t = setup();
    const s = t.stats();
    expect(s).toMatchObject({ orderCount: 0, registered: 0, paid: 0, due: 0, pizzas: 0, averageBasket: 0, peak: null });
    expect(s.ranking.pizza).toEqual([]);
    // Axe horaire de l'ouverture (18 h) à maintenant (18 h).
    expect(s.hourly.map((b) => b.hour)).toEqual([18]);
  });

  it('total enregistré, encaissé, reste à encaisser, panier moyen', () => {
    const t = setup();
    const a = t.order(['reine', 'coca-150']);
    t.order(['margarita']);
    t.store.markOrderPaid(a.id, 'carte');
    const s = t.stats();
    const aAmount = price('reine') + price('coca-150');
    expect(s.orderCount).toBe(2);
    expect(s.registered).toBe(aAmount + price('margarita'));
    expect(s.paid).toBe(aAmount);
    expect(s.paidCount).toBe(1);
    expect(s.due).toBe(price('margarita'));
    expect(s.dueCount).toBe(1);
    expect(s.averageBasket).toBe(Math.round(s.registered / 2));
    // Contrôle : enregistré = encaissé + reste + non suivi.
    expect(s.registered).toBe(s.paid + s.due + s.untracked.amount);
  });

  it('quantités réelles : une ligne de trois pizzas compte pour trois', () => {
    const t = setup();
    t.order(['reine', 'reine', 'reine', 'tiramisu', 'coca-150', 'coca-150']);
    const s = t.stats();
    expect(s.pizzas).toBe(3);
    expect(s.desserts).toBe(1);
    expect(s.drinks).toBe(2);
    expect(s.ranking.pizza).toEqual([{ productId: 'reine', name: 'Reine', quantity: 3, amount: 3 * price('reine') }]);
  });

  it('cadeau fidélité : jamais compté comme vente, compté à part', () => {
    const t = setup();
    t.order(['reine'], { reward: 'margarita' });
    const s = t.stats();
    expect(s.pizzas).toBe(1);
    expect(s.rewards).toBe(1);
    expect(s.ranking.pizza.map((r) => r.productId)).toEqual(['reine']);
    expect(s.registered).toBe(price('reine'));
  });

  it('annulation : exclue de tous les totaux, comptée à part', () => {
    const t = setup();
    t.order(['reine']);
    const b = t.order(['margarita', 'margarita']);
    t.store.cancelOrder(b.id);
    const s = t.stats();
    expect(s.orderCount).toBe(1);
    expect(s.pizzas).toBe(1);
    expect(s.registered).toBe(price('reine'));
    expect(s.cancelled).toEqual({ count: 1, amount: 2 * price('margarita'), paidCount: 0, paidAmount: 0 });
    expect(s.ranking.pizza.map((r) => r.productId)).toEqual(['reine']);
  });

  it('annulation après encaissement : retirée de l’encaissé, signalée comme telle', () => {
    const t = setup();
    const a = t.order(['reine']);
    t.store.markOrderPaid(a.id, 'especes');
    t.store.cancelOrder(a.id);
    const s = t.stats();
    expect(s.paid).toBe(0);
    expect(s.cancelled).toEqual({ count: 1, amount: price('reine'), paidCount: 1, paidAmount: price('reine') });
  });

  it('modification : une seule commande, comptée avec son nouveau contenu', () => {
    const t = setup();
    const a = t.order(['reine']);
    t.store.startEditOrder(a.id);
    t.store.addProduct('margarita');
    expect(t.store.validateCart().ok).toBe(true);
    // Double clic sur la validation : aucun doublon.
    expect(t.store.validateCart().ok).toBe(false);
    const s = t.stats();
    expect(s.orderCount).toBe(1);
    expect(s.pizzas).toBe(2);
    expect(s.registered).toBe(price('reine') + price('margarita'));
  });

  it('modes : livraisons et commandes à emporter, livraison toujours à 0 €', () => {
    const t = setup();
    t.order(['reine'], { mode: 'livraison' });
    t.order(['reine'], { mode: 'livraison', customerId: t.karim.id });
    t.order(['margarita'], { customerId: null });
    const s = t.stats();
    expect(s).toMatchObject({ deliveries: 2, takeaway: 1, legacyFeeOrders: 0 });
    expect(s.registered).toBe(2 * price('reine') + price('margarita'));
  });

  it('classement : par quantité, puis par montant à égalité', () => {
    const t = setup();
    t.order(['margarita', 'margarita', 'reine', 'reine', 'quatre-fromages']);
    const s = t.stats();
    const names = s.ranking.pizza.map((r) => r.productId);
    expect(names.slice(0, 2)).toEqual(price('reine') >= price('margarita') ? ['reine', 'margarita'] : ['margarita', 'reine']);
    expect(names[2]).toBe('quatre-fromages');
  });

  it('activité par heure : commandes à leur heure de création, encaissements à leur heure de paiement', () => {
    const t = setup();
    t.set('2026-10-30T19:10:00');
    const a = t.order(['reine']);
    t.set('2026-10-30T19:40:00');
    t.order(['reine']);
    t.set('2026-10-30T21:05:00');
    t.order(['reine']);
    t.store.markOrderPaid(a.id);
    const s = t.stats();
    expect(s.hourly).toEqual([
      { hour: 18, orders: 0, payments: 0 },
      { hour: 19, orders: 2, payments: 0 },
      { hour: 20, orders: 0, payments: 0 },
      { hour: 21, orders: 1, payments: 1 },
    ]);
    expect(s.peak).toEqual({ hour: 19, orders: 2, payments: 0 });
  });
});

describe('statistiques : encaissements tardifs et services successifs', () => {
  it('commande payée après la clôture : reste dans son service, distinguée « après la clôture »', () => {
    const t = setup();
    const a = t.order(['reine']);
    const b = t.order(['margarita']);
    t.store.markOrderPaid(b.id);
    t.set('2026-10-30T23:05:00');
    t.store.closeService();
    const closed = t.svc();
    t.set('2026-10-31T18:00:00');
    t.store.openService();
    t.set('2026-10-31T18:20:00');
    t.store.markOrderPaid(a.id);

    const before = t.stats(t.servicePeriod(closed));
    expect(before.paid).toBe(price('reine') + price('margarita'));
    expect(before.paidBeforeClose).toBe(price('margarita'));
    expect(before.paidAfterClose).toBe(price('reine'));
    expect(before.paidAfterCloseCount).toBe(1);
    expect(before.due).toBe(0);
    // Le graphique du service clôturé ne montre que les encaissements faits pendant le service.
    expect(before.hourly.reduce((n, h) => n + h.payments, 0)).toBe(1);

    // Le nouveau service ne compte pas cette vente : il la signale à part.
    const current = t.stats();
    expect(current).toMatchObject({ orderCount: 0, paid: 0, registered: 0 });
    expect(current.paidFromEarlier).toEqual({ count: 1, amount: price('reine') });
  });

  it('encaissement annulé puis refait après la clôture : compté une seule fois, après la clôture', () => {
    const t = setup();
    const a = t.order(['reine']);
    t.store.markOrderPaid(a.id);
    t.set('2026-10-30T23:00:00');
    t.store.closeService();
    t.set('2026-10-30T23:30:00');
    t.store.markOrderUnpaid(a.id);
    t.store.markOrderPaid(a.id, 'carte');
    const s = t.stats();
    expect(s.paid).toBe(price('reine'));
    expect(s.paidCount).toBe(1);
    expect(s.paidAfterClose).toBe(price('reine'));
  });

  it('un bilan reste consultable service fermé, et les services précédents restent dans l’historique', () => {
    const t = setup();
    t.order(['reine']);
    t.set('2026-10-30T23:00:00');
    t.store.closeService();
    expect(t.stats().orderCount).toBe(1); // service clôturé : bilan disponible sans rouvrir
    t.set('2026-10-31T18:00:00');
    t.store.openService();
    const periods = availablePeriods('service', t.data().services, hasOrdersBeforeTracking(t.data().orders, t.data().services));
    expect(periods.map((p) => p.services[0]?.openedAt ?? p.key)).toEqual([
      new Date('2026-10-31T18:00:00').toISOString(),
      new Date('2026-10-30T18:00:00').toISOString(),
      new Date('2026-10-30T14:00:00').toISOString(), // service de démonstration
    ]);
    expect(t.stats(periods[1]).orderCount).toBe(1);
  });

  it('service qui passe minuit : axe 22 h, 23 h, 0 h, 1 h, et rattaché au jour d’ouverture', () => {
    const t = setup();
    t.set('2026-10-30T22:30:00');
    t.order(['reine']);
    t.set('2026-10-31T00:20:00');
    t.order(['reine']);
    t.set('2026-10-31T01:10:00');
    t.store.closeService();
    const s = t.stats();
    expect(s.orderCount).toBe(2);
    expect(s.hourly.map((b) => b.hour)).toEqual([18, 19, 20, 21, 22, 23, 0, 1]);
    expect(s.hourly.find((b) => b.hour === 0)?.orders).toBe(1);
    const day = availablePeriods('jour', t.data().services, false)[0];
    expect(day.key).toBe('2026-10-30');
    expect(t.stats(day).orderCount).toBe(2);
  });

  it('nuit du changement d’heure : aucune commande perdue ni comptée deux fois', () => {
    const t = setup();
    t.set('2026-10-24T18:00:00');
    t.store.closeService();
    t.store.openService();
    for (const iso of ['2026-10-24T23:30:00', '2026-10-25T00:30:00Z', '2026-10-25T01:30:00Z', '2026-10-25T02:30:00Z']) {
      t.set(iso);
      t.order(['reine']);
    }
    const s = t.stats();
    expect(s.orderCount).toBe(4);
    expect(s.hourly.reduce((n, b) => n + b.orders, 0)).toBe(4);
  });
});

describe('statistiques : anciennes données', () => {
  /** Commande d'avant le suivi des services et des paiements, avec 2 € de frais de livraison. */
  function legacyOrder(t: ReturnType<typeof setup>, createdAt: string): Order {
    const base = t.data().orders[0];
    const lines = [{ ...base.lines[0], quantity: 2 }];
    return {
      ...base,
      id: `legacy-${createdAt}`,
      createdAt,
      mode: 'livraison',
      lines,
      status: 'terminee',
      payment: { status: 'a_encaisser', method: null, paidAt: null, legacy: true },
      totals: { subtotal: subtotal(lines), deliveryFee: 200, total: subtotal(lines) + 200 },
      serviceId: undefined,
    };
  }

  it('« Paiement non suivi » : ni encaissé ni à encaisser, compté à part', () => {
    const t = setup();
    const old = legacyOrder(t, new Date('2026-10-30T18:30:00').toISOString());
    const orders = [...t.data().orders, old];
    const s = computePeriodStats(t.servicePeriod(), orders, t.data().services, t.clock.time.toISOString());
    expect(s.orderCount).toBe(1);
    expect(s.paid).toBe(0);
    expect(s.due).toBe(0);
    expect(s.untracked).toEqual({ count: 1, amount: subtotal(old.lines) });
    // Frais de livraison historiques : conservés sur la commande, exclus des montants.
    expect(s.registered).toBe(subtotal(old.lines));
    expect(s.legacyFeeOrders).toBe(1);
  });

  it('commandes antérieures au suivi des services : regroupées dans « Avant le suivi des services »', () => {
    const t = setup();
    const old = legacyOrder(t, new Date('2026-10-01T19:00:00').toISOString());
    const orders = [...t.data().orders, old];
    const services = t.data().services;
    expect(hasOrdersBeforeTracking(orders, services)).toBe(true);
    const periods = availablePeriods('service', services, true);
    const before = periods[periods.length - 1];
    expect(before).toEqual({ kind: 'avant', key: 'avant', services: [] });
    expect(periodLabel(before)).toBe('Avant le suivi des services');
    expect(computePeriodStats(before, orders, services, t.clock.time.toISOString()).orderCount).toBe(1);
    // Jamais mélangées aux périodes datées.
    for (const kind of ['jour', 'semaine', 'mois'] as const) {
      for (const p of availablePeriods(kind, services, true)) {
        expect(computePeriodStats(p, orders, services, t.clock.time.toISOString()).untracked.count).toBe(0);
      }
    }
  });

  it('les calculs ne modifient jamais les données (lecture seule)', () => {
    const t = setup();
    const a = t.order(['reine'], { reward: 'margarita' });
    t.store.markOrderPaid(a.id);
    const freeze = <T>(v: T): T => {
      if (v && typeof v === 'object') {
        Object.values(v).forEach(freeze);
        Object.freeze(v);
      }
      return v;
    };
    const orders = freeze(structuredClone(t.data().orders));
    const services = freeze(structuredClone(t.data().services));
    const snapshot = JSON.stringify({ orders, services });
    for (const kind of ['service', 'jour', 'semaine', 'mois'] as const) {
      for (const p of availablePeriods(kind, services, true)) computePeriodStats(p, orders, services, t.clock.time.toISOString());
    }
    expect(JSON.stringify({ orders, services })).toBe(snapshot);
  });
});

describe('statistiques : jour, semaine, mois', () => {
  const svc = (id: string, openedAt: string): ServiceRecord => ({ id, openedAt: new Date(openedAt).toISOString(), closedAt: null });
  const services = [
    svc('a', '2026-10-30T11:30:00'), // vendredi midi
    svc('b', '2026-10-30T18:00:00'), // vendredi soir
    svc('c', '2026-11-01T18:00:00'), // dimanche
    svc('d', '2026-11-02T18:00:00'), // lundi : nouvelle semaine
  ];

  it('regroupe les services par jour, semaine (lundi à dimanche) et mois, du plus récent au plus ancien', () => {
    expect(availablePeriods('jour', services, false).map((p) => [p.key, p.services.map((s) => s.id)])).toEqual([
      ['2026-11-02', ['d']],
      ['2026-11-01', ['c']],
      ['2026-10-30', ['a', 'b']],
    ]);
    expect(availablePeriods('semaine', services, false).map((p) => [p.key, p.services.map((s) => s.id)])).toEqual([
      ['2026-11-02', ['d']],
      ['2026-10-26', ['a', 'b', 'c']],
    ]);
    expect(availablePeriods('mois', services, false).map((p) => [p.key, p.services.map((s) => s.id)])).toEqual([
      ['2026-11', ['c', 'd']],
      ['2026-10', ['a', 'b']],
    ]);
  });

  it('clés de dates en heure locale', () => {
    expect(dayKey(new Date('2026-11-01T23:59:00').toISOString())).toBe('2026-11-01');
    expect(weekKey(new Date('2026-11-01T12:00:00').toISOString())).toBe('2026-10-26');
    expect(weekKey(new Date('2026-11-02T00:01:00').toISOString())).toBe('2026-11-02');
    expect(monthKey(new Date('2026-10-31T23:00:00').toISOString())).toBe('2026-10');
  });

  it('libellés lisibles', () => {
    const [jour] = availablePeriods('jour', services, false);
    expect(periodLabel(jour)).toBe('Lundi 2 novembre 2026');
    const [semaine] = availablePeriods('semaine', services, false);
    expect(periodLabel(semaine)).toMatch(/^Semaine du 2 nov\.? au 8 nov\.? 2026$/);
    const [, dimanche] = availablePeriods('jour', services, false);
    expect(periodLabel(dimanche)).toBe('Dimanche 1er novembre 2026');
    const [, semaineOctobre] = availablePeriods('semaine', services, false);
    expect(periodLabel(semaineOctobre)).toMatch(/^Semaine du 26 oct\.? au 1er nov\.? 2026$/);
    const [mois] = availablePeriods('mois', services, false);
    expect(periodLabel(mois)).toBe('Novembre 2026');
    expect(periodLabel({ kind: 'service', key: 'x', services: [{ id: 'x', openedAt: services[1].openedAt, closedAt: new Date('2026-10-30T23:05:00').toISOString() }] })).toMatch(
      /^Ven\.? 30 oct\.? · 18 h 00 à 23 h 05$/,
    );
  });

  it('une journée cumule ses services ; une commande n’est comptée que dans son service', () => {
    const t = setup();
    t.order(['reine']);
    t.set('2026-10-30T22:00:00');
    t.store.closeService();
    t.store.openService();
    t.order(['margarita']);
    const [day] = availablePeriods('jour', t.data().services, false);
    const s = t.stats(day);
    expect(s.orderCount).toBe(2);
    expect(s.pizzas).toBe(2);
    // Vue service : chacun le sien.
    expect(t.stats().orderCount).toBe(1);
  });
});
