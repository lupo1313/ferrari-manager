import { describe, expect, it } from 'vitest';
import { createMemoryRepository, type AppRepository } from '../src/storage/repository';
import { normalizeAppData, SCHEMA_VERSION } from '../src/storage/schema';
import { defaultSettings } from '../src/data/defaultSettings';
import { computeBalance } from '../src/domain/loyalty';
import { createTestStore } from './helpers';

const defaults = { settings: defaultSettings, newCartId: () => 'ord_x', nowIso: '2026-10-29T18:00:00.000Z' };

/** Données valides produites par un vrai store, avec une commande enregistrée. */
function savedData() {
  const { store, repo } = createTestStore();
  store.addProduct('reine');
  store.validateCart();
  return { raw: repo.raw()!, data: store.getData() };
}

describe('stockage local : aucune perte de données', () => {
  it('version inconnue : données d’origine intactes, aucune écriture, alerte affichée', () => {
    const { raw } = savedData();
    const future = JSON.stringify({ ...JSON.parse(raw), schemaVersion: 99 });
    const repo = createMemoryRepository(null, future);
    const { store } = createTestStore(repo);

    expect(store.getPersistError()).toMatch(/version de données inconnue/);
    // L'utilisation continue (données de démo en mémoire) sans jamais écrire.
    store.addProduct('reine');
    store.validateCart();
    expect(repo.saves).toBe(0);
    expect(repo.raw()).toBe(future);
  });

  it('JSON corrompu : non remplacé par la démo', () => {
    const repo = createMemoryRepository(null, '{"schemaVersion":1, "orders": [');
    const { store } = createTestStore(repo);
    expect(store.getPersistError()).toMatch(/JSON corrompu/);
    store.setOrderNote('test');
    expect(repo.saves).toBe(0);
    expect(repo.raw()).toBe('{"schemaVersion":1, "orders": [');
  });

  it('structure invalide (liste manquante) : refusée sans écrasement', () => {
    const { raw } = savedData();
    const broken = JSON.parse(raw);
    delete broken.orders;
    const repo = createMemoryRepository(broken);
    const { store } = createTestStore(repo);
    expect(store.getPersistError()).toMatch(/orders/);
    store.clearCart();
    expect(repo.saves).toBe(0);
  });

  it('lecture impossible (stockage bloqué) : pas d’écrasement', () => {
    const repo = createMemoryRepository();
    const writes = { n: 0 };
    const blocked: AppRepository = {
      ...repo,
      load: () => ({ kind: 'error', error: 'stockage local inaccessible' }),
      saveCart: () => void writes.n++,
      saveOrderWithLoyalty: () => void writes.n++,
    };
    const { store } = createTestStore(blocked as never);
    expect(store.getPersistError()).toMatch(/inaccessible/);
    store.addProduct('reine');
    store.validateCart();
    expect(writes.n).toBe(0);
  });

  it('la réinitialisation explicite remplace les données illisibles et réactive l’enregistrement', () => {
    const repo = createMemoryRepository(null, 'pas du json');
    const { store } = createTestStore(repo);
    store.resetDemoData();
    expect(store.getPersistError()).toBeNull();
    expect(repo.saves).toBe(1);
    expect(JSON.parse(repo.raw()!).schemaVersion).toBe(SCHEMA_VERSION);
    expect(repo.rawCart()).not.toBeNull();
  });

  it('écriture du panier impossible (quota plein) : erreur affichée, l’application continue, l’erreur disparaît au succès suivant', () => {
    const repo = createMemoryRepository();
    const { store } = createTestStore(repo);
    repo.control.failOn = 'cart';
    store.addProduct('reine');
    expect(store.getPersistError()).toMatch(/Sauvegarde du panier impossible/);
    expect(store.getData().cart.lines).toHaveLength(1);
    repo.control.failOn = null;
    store.addProduct('reine');
    expect(store.getPersistError()).toBeNull();
  });

  it('premier lancement (stockage vide) : la démo est installée et enregistrée', () => {
    const repo = createMemoryRepository();
    const { store } = createTestStore(repo);
    expect(store.getPersistError()).toBeNull();
    expect(repo.saves).toBe(1);
    expect(store.getData().customers.length).toBeGreaterThan(0);
  });
});

describe('valeurs par défaut des champs manquants', () => {
  it('un nouveau paramètre absent des anciennes données prend sa valeur par défaut, les réglages existants sont gardés', () => {
    const { data } = savedData();
    const old = JSON.parse(JSON.stringify(data));
    old.settings.deliveryFee = 350;
    delete old.settings.ticketWidthMm;
    old.settings.loyalty.awardOn = 'validation'; // ancien réglage, supprimé (règle fixe : crédit à l'encaissement)
    delete old.settings.pizzeria.phone;
    const r = normalizeAppData(old, defaults);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Ancien réglage des frais de livraison : ignoré, la livraison est toujours offerte.
    expect('deliveryFee' in r.data.settings).toBe(false);
    expect(r.data.settings.modules).toEqual({ statistiques: true });
    expect(r.data.settings.ticketWidthMm).toBe(defaultSettings.ticketWidthMm);
    expect('awardOn' in r.data.settings.loyalty).toBe(false);
    expect(r.data.settings.loyalty.eligiblePizzaIds).toEqual(data.settings.loyalty.eligiblePizzaIds);
    expect(r.data.settings.pizzeria.phone).toBe(defaultSettings.pizzeria.phone);
  });

  it('panier, compteur et début de service absents : complétés sans perdre les commandes', () => {
    const { data } = savedData();
    const old = JSON.parse(JSON.stringify(data));
    delete old.cart;
    delete old.counters;
    delete old.serviceStartedAt;
    const r = normalizeAppData(old, defaults);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.orders).toHaveLength(data.orders.length);
    expect(r.data.cart.lines).toEqual([]);
    const maxNumber = Math.max(...data.orders.filter((o) => !o.archivedAt).map((o) => o.number));
    expect(r.data.counters.nextOrderNumber).toBe(maxNumber + 1);
    expect(r.data.serviceStartedAt).toBe(defaults.nowIso);
  });

  it('rechargement : commandes, clients et fidélité conservés à l’identique', () => {
    const { store, repo, customer } = createTestStore();
    const jean = customer('Dupont');
    store.selectCustomer(jean.id);
    store.addProduct('reine');
    store.addProduct('reine');
    store.validateCart();
    const before = store.getData();
    const reloaded = createTestStore(repo).store;
    const after = reloaded.getData();
    expect(reloaded.getPersistError()).toBeNull();
    expect(after.orders).toEqual(before.orders);
    expect(after.customers).toEqual(before.customers);
    expect(after.loyaltyEvents).toEqual(before.loyaltyEvents);
    expect(computeBalance(after.loyaltyEvents, jean.id, after.settings.loyalty)).toEqual(
      computeBalance(before.loyaltyEvents, jean.id, before.settings.loyalty),
    );
  });
});
