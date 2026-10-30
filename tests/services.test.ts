import { describe, expect, it } from 'vitest';
import { createAppStore } from '../src/state/store';
import { createMemoryRepository } from '../src/storage/repository';
import { normalizeAppData, normalizeServices } from '../src/storage/schema';
import { demoCatalog } from '../src/data/catalog';
import { buildDemoData } from '../src/data/seed';
import { defaultSettings } from '../src/data/defaultSettings';
import { currentService, newServiceId, serviceIdFromStart, serviceOfOrder } from '../src/domain/service';
import { buildTicket } from '../src/domain/ticket';
import type { Order, Settings } from '../src/domain/types';

/** Store de test à horloge réglable. */
function setup(repo = createMemoryRepository(), prefix = 's') {
  let n = 0;
  const clock = { time: new Date('2026-10-30T19:00:00') };
  const store = createAppStore({
    repo,
    catalog: demoCatalog,
    seed: buildDemoData,
    now: () => clock.time,
    newId: (p) => `${p}_${prefix}${++n}`,
  });
  const jean = store.getData().customers.find((c) => c.lastName === 'Dupont')!;
  const order = (products = ['reine'], mode: 'livraison' | 'emporter' = 'emporter') => {
    store.selectCustomer(jean.id);
    store.setMode(mode);
    for (const p of products) store.addProduct(p);
    const r = store.validateCart();
    if (!r.ok) throw new Error(r.error);
    return r.value;
  };
  return { store, repo, clock, jean, order };
}

/** Anciennes données (production actuelle) : ni historique des services, ni serviceId, frais de 2 €. */
function legacyData() {
  const data = buildDemoData(demoCatalog, new Date('2026-10-30T20:00:00'), (p) => `${p}_old${Math.random().toString(36).slice(2, 8)}`);
  const raw = JSON.parse(JSON.stringify(data));
  delete raw.services;
  for (const o of raw.orders) delete o.serviceId;
  raw.settings.deliveryFee = 200;
  delete raw.settings.modules;
  return raw;
}

const at = (h: string) => new Date(`2026-10-30T${h}:00`).toISOString();

describe('historique des services (socle)', () => {
  it('une nouvelle commande est rattachée au service en cours', () => {
    const t = setup();
    const svc = currentService(t.store.getData().services);
    expect(svc.closedAt).toBeNull();
    expect(t.order().serviceId).toBe(svc.id);
  });

  it('fermer puis ouvrir : le service est clôturé dans l’historique, un nouveau service commence', () => {
    const t = setup();
    const first = currentService(t.store.getData().services);
    t.order();
    t.clock.time = new Date('2026-10-30T23:05:00');
    t.store.closeService();
    expect(t.store.getData().services).toEqual([{ ...first, closedAt: at('23:05') }]);
    t.clock.time = new Date('2026-10-31T18:00:00');
    t.store.openService();
    const services = t.store.getData().services;
    expect(services).toHaveLength(2);
    expect(services[1]).toEqual({ id: serviceIdFromStart(new Date('2026-10-31T18:00:00').toISOString()), openedAt: new Date('2026-10-31T18:00:00').toISOString(), closedAt: null });
    expect(t.order().serviceId).toBe(services[1].id);
    // Aucune commande supprimée ni déplacée.
    expect(t.store.getData().orders.filter((o) => o.serviceId === first.id).length).toBeGreaterThan(0);
  });

  it('double fermeture : la date de clôture d’origine est conservée', () => {
    const t = setup();
    t.clock.time = new Date('2026-10-30T23:05:00');
    t.store.closeService();
    t.clock.time = new Date('2026-10-30T23:40:00');
    t.store.closeService();
    expect(currentService(t.store.getData().services).closedAt).toBe(at('23:05'));
  });

  it('une commande modifiée pendant le service suivant reste rattachée à son service d’origine', () => {
    const t = setup();
    const o = t.order();
    t.store.closeService(); // la commande n'est pas soldée : elle reste affichée
    t.clock.time = new Date('2026-10-31T18:00:00');
    t.store.openService();
    t.store.startEditOrder(o.id);
    t.store.addProduct('margarita');
    const edited = t.store.validateCart();
    expect(edited.ok && edited.value.serviceId).toBe(o.serviceId);
    expect(edited.ok && edited.value.revision).toBe(2);
  });

  it('l’historique est enregistré et relu à l’identique', () => {
    const t = setup();
    t.order();
    t.store.closeService();
    t.clock.time = new Date('2026-10-31T18:00:00');
    t.store.openService();
    const reloaded = setup(t.repo, 'r');
    expect(reloaded.store.getData().services).toEqual(t.store.getData().services);
    expect(reloaded.store.getData().orders).toEqual(t.store.getData().orders);
  });

  it('deux ouvertures à la même milliseconde gardent des identifiants distincts', () => {
    const openedAt = at('18:00');
    const services = [{ id: serviceIdFromStart(openedAt), openedAt, closedAt: openedAt }];
    expect(newServiceId(openedAt, services)).toBe(`${serviceIdFromStart(openedAt)}-2`);
  });
});

describe('anciennes données : compatibilité sans réécriture', () => {
  it('sans historique : un service est reconstitué à partir du début de service, sans aucune écriture', () => {
    const raw = legacyData();
    const repo = createMemoryRepository(raw);
    const before = repo.raw();
    const t = setup(repo);
    const services = t.store.getData().services;
    expect(services).toEqual([{ id: serviceIdFromStart(raw.serviceStartedAt), openedAt: raw.serviceStartedAt, closedAt: null }]);
    expect(repo.raw()).toBe(before);
    expect(repo.saves).toBe(0);
    // Identifiant stable : un second chargement donne le même service.
    expect(setup(createMemoryRepository(raw), 'b').store.getData().services).toEqual(services);
  });

  it('commande sans serviceId : rattachée par sa date de création, sinon « avant le suivi »', () => {
    const services = [
      { id: 'a', openedAt: at('12:00'), closedAt: at('14:00') },
      { id: 'b', openedAt: at('18:00'), closedAt: null },
    ];
    const o = (createdAt: string, serviceId?: string) => ({ createdAt, serviceId }) as Order;
    expect(serviceOfOrder(o(at('11:00')), services)).toBeNull();
    expect(serviceOfOrder(o(at('13:00')), services)).toBe('a');
    expect(serviceOfOrder(o(at('18:30')), services)).toBe('b');
    // Le rattachement enregistré prime sur la date (encaissement ou modification tardifs).
    expect(serviceOfOrder(o(at('18:30'), 'a'), services)).toBe('a');
    // Service inconnu (données incohérentes) : repli sur la date, jamais perdu.
    expect(serviceOfOrder(o(at('13:00'), 'zzz'), services)).toBe('a');
  });

  it('les commandes du service ouvert lors de la mise à jour lui sont rattachées', () => {
    const raw = legacyData();
    const t = setup(createMemoryRepository(raw));
    const { services, orders } = t.store.getData();
    for (const o of orders) expect(serviceOfOrder(o, services)).toBe(services[0].id);
  });

  it('historique en retard (ancienne version utilisée entre-temps) : rattrapé en mémoire', () => {
    const s1 = { id: 'svc-1', openedAt: at('12:00'), closedAt: null };
    const services = normalizeServices([s1], { startedAt: at('18:00'), storedStartedAt: true, open: true, closedAt: null });
    expect(services).toEqual([
      { ...s1, closedAt: at('18:00') },
      { id: serviceIdFromStart(at('18:00')), openedAt: at('18:00'), closedAt: null },
    ]);
    // Fermeture faite par l'ancienne version : la date de fermeture est reprise.
    const closed = normalizeServices([s1], { startedAt: at('12:00'), storedStartedAt: true, open: false, closedAt: at('15:00') });
    expect(closed).toEqual([{ ...s1, closedAt: at('15:00') }]);
  });

  it('entrées d’historique invalides ignorées sans bloquer le chargement', () => {
    const raw = legacyData();
    raw.services = [null, { id: 3 }, 'x'];
    const r = normalizeAppData(raw, { settings: defaultSettings, newCartId: () => 'c', nowIso: at('20:00') });
    expect(r.ok && r.data.services).toHaveLength(1);
  });

  it('retour éventuel à l’ancienne version : les champs ajoutés restent dans le stockage', () => {
    const t = setup();
    t.order();
    t.store.closeService();
    const doc = JSON.parse(t.repo.raw()!);
    expect(doc.services).toHaveLength(1);
    expect(doc.orders.every((o: Order) => typeof o.serviceId === 'string')).toBe(true);
  });
});

describe('livraison toujours offerte (0 €)', () => {
  it('un ancien réglage à 2 € est ignoré : les nouvelles livraisons sont à 0 €', () => {
    const t = setup(createMemoryRepository(legacyData()));
    const o = t.order(['reine'], 'livraison');
    expect(o.totals.deliveryFee).toBe(0);
    expect(o.totals.total).toBe(o.totals.subtotal);
    expect(buildTicket(o, t.store.getData().settings).deliveryFee).toBe('Offerte');
  });

  it('impossible d’ajouter des frais depuis les paramètres', () => {
    const t = setup();
    const r = t.store.updateSettings({ deliveryFee: 500 } as Partial<Settings>);
    expect(r.ok).toBe(true);
    expect('deliveryFee' in t.store.getData().settings).toBe(false);
    expect(t.order(['reine'], 'livraison').totals.deliveryFee).toBe(0);
    expect(JSON.parse(t.repo.raw()!).settings.deliveryFee).toBeUndefined();
  });

  it('les anciennes commandes gardent leurs frais figés ; une modification les recalcule à 0 €', () => {
    const raw = legacyData();
    raw.orders[0].mode = 'livraison';
    raw.orders[0].totals = { ...raw.orders[0].totals, deliveryFee: 200, total: raw.orders[0].totals.subtotal + 200 };
    const t = setup(createMemoryRepository(raw));
    const old = t.store.getData().orders[0];
    expect(old.totals.deliveryFee).toBe(200);
    expect(buildTicket(old, t.store.getData().settings).deliveryFee).toBe('2,00 €');
    t.store.startEditOrder(old.id);
    const edited = t.store.validateCart();
    expect(edited.ok && edited.value.totals).toEqual({ subtotal: old.totals.subtotal, deliveryFee: 0, total: old.totals.subtotal });
  });
});

describe('module Statistiques facultatif', () => {
  it('masquer l’onglet est enregistré et ne touche ni aux commandes ni aux services', () => {
    const t = setup();
    t.order();
    const { orders, services, loyaltyEvents } = t.store.getData();
    expect(t.store.getData().settings.modules.statistiques).toBe(true);
    expect(t.store.updateSettings({ modules: { statistiques: false } }).ok).toBe(true);
    expect(t.store.getData()).toMatchObject({ orders, services, loyaltyEvents });
    const reloaded = setup(t.repo, 'r').store;
    expect(reloaded.getData().settings.modules.statistiques).toBe(false);
    // Module masqué : la prise de commande et l'historique des services continuent normalement.
    t.store.closeService();
    t.store.openService();
    expect(t.order().serviceId).toBe(currentService(t.store.getData().services).id);
  });

  it('valeur invalide stockée : le module reste affiché (valeur par défaut)', () => {
    const raw = legacyData();
    raw.settings.modules = { statistiques: 'oui' };
    const t = setup(createMemoryRepository(raw));
    expect(t.store.getData().settings.modules.statistiques).toBe(true);
  });
});
