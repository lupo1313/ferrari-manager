import { afterEach, describe, expect, it, vi } from 'vitest';
import { CART_KEY, createMemoryRepository } from '../src/storage/repository';
import { CART_TEXT_DELAY_MS } from '../src/state/store';
import { computeBalance } from '../src/domain/loyalty';
import { createTestStore } from './helpers';

afterEach(() => vi.useRealTimers());

const parse = (raw: string | null) => JSON.parse(raw!);

describe('panier : persistance séparée de l’historique', () => {
  it('saisir une note ne réécrit jamais l’historique, et regroupe les écritures du panier', () => {
    vi.useFakeTimers();
    const { store, repo } = createTestStore();
    store.addProduct('reine');
    const docSaves = repo.saves;
    const cartSaves = repo.control.cartSaves;

    for (const text of ['S', 'So', 'Son', 'Sonn', 'Sonner']) store.setOrderNote(text);
    expect(store.getData().cart.note).toBe('Sonner'); // affichage immédiat
    expect(repo.control.cartSaves).toBe(cartSaves); // pas encore écrit
    vi.advanceTimersByTime(CART_TEXT_DELAY_MS);
    expect(repo.control.cartSaves).toBe(cartSaves + 1); // une seule écriture pour 5 frappes
    expect(parse(repo.rawCart()).note).toBe('Sonner');
    expect(repo.saves).toBe(docSaves); // historique jamais réécrit
  });

  it('fermeture rapide : flushPendingWrites enregistre la saisie en attente', () => {
    vi.useFakeTimers();
    const { store, repo } = createTestStore();
    store.setCounterName('Paul');
    expect(repo.rawCart()).not.toContain('Paul');
    store.flushPendingWrites(); // appelé sur pagehide / visibilitychange
    expect(parse(repo.rawCart()).counterName).toBe('Paul');
  });

  it('les modifications structurelles (produit, quantité, client, mode) sont enregistrées immédiatement', () => {
    const { store, repo, customer } = createTestStore();
    const docSaves = repo.saves;
    store.selectCustomer(customer('Dupont').id);
    store.addProduct('reine');
    store.setLineQuantity(store.getData().cart.lines[0].id, 3);
    store.setMode('livraison');
    const saved = parse(repo.rawCart());
    expect(saved.customerId).toBe(customer('Dupont').id);
    expect(saved.lines[0].quantity).toBe(3);
    expect(saved.mode).toBe('livraison');
    expect(repo.saves).toBe(docSaves);
  });

  it('restauration après rechargement : personnalisations, suppléments, quantités, note et récompense identiques', () => {
    const { store, repo, customer } = createTestStore();
    store.selectCustomer(customer('Dupont').id);
    store.setMode('livraison');
    store.addConfiguredLine('royale', { removedIngredients: ['Œuf'], quantity: 2, note: 'Bien cuite' });
    store.addConfiguredLine('chevre-miel', { addedToppings: [store.topping('miel')!] });
    store.addReward('boisson', 'fanta-150');
    store.setRequestedTime('20:15');
    store.setOrderNote('Code 4521');
    store.flushPendingWrites();
    const before = store.getData().cart;
    const reloaded = createTestStore(repo).store;
    expect(reloaded.getData().cart).toEqual(before);
    expect(reloaded.getPersistError()).toBeNull();
  });

  it('panier illisible : l’historique est chargé normalement, le panier repart vide', () => {
    const { store, repo } = createTestStore();
    store.addProduct('reine');
    store.validateCart();
    const orders = store.getData().orders;
    const reloaded = createTestStore(createMemoryRepository(null, repo.raw()!, '{"lines": [')).store;
    expect(reloaded.getPersistError()).toBeNull();
    expect(reloaded.getData().orders).toEqual(orders);
    expect(reloaded.getData().cart.lines).toEqual([]);
  });
});

describe('transition depuis l’ancien format (panier inclus dans le document principal)', () => {
  it('le panier est repris, copié dans sa clé, puis retiré de l’historique à la première écriture ; rien n’est perdu', () => {
    // Fabrique des données au format de la version précédente : panier DANS le document principal.
    const { store, customer } = createTestStore();
    const jean = customer('Dupont');
    store.selectCustomer(jean.id);
    store.addConfiguredLine('royale', { removedIngredients: ['Œuf'] });
    store.validateCart();
    store.addProduct('reine');
    store.setOrderNote('ancien panier');
    const legacy = { ...store.getData() }; // contient `cart`
    const repo = createMemoryRepository(legacy);
    expect(repo.rawCart()).toBeNull();

    const reloaded = createTestStore(repo).store;
    const d = reloaded.getData();
    expect(reloaded.getPersistError()).toBeNull();
    expect(d.cart).toEqual(legacy.cart);
    expect(d.orders).toEqual(legacy.orders);
    expect(d.customers).toEqual(legacy.customers);
    expect(d.loyaltyEvents).toEqual(legacy.loyaltyEvents);
    expect(parse(repo.rawCart())).toEqual(legacy.cart); // copié dans sa clé dès le chargement

    // Première écriture durable : le document principal ne contient plus le panier.
    reloaded.updateCustomerInstructions(jean.id, 'Sonner fort');
    expect(parse(repo.raw()).cart).toBeUndefined();
    const again = createTestStore(repo).store.getData();
    expect(again.cart).toEqual(legacy.cart);
    expect(again.orders).toEqual(legacy.orders);
  });

  it('une version inconnue reste protégée (pas d’écriture, ni historique ni panier)', () => {
    const { store } = createTestStore();
    const future = JSON.stringify({ ...store.getData(), schemaVersion: 2 });
    const repo = createMemoryRepository(null, future);
    const locked = createTestStore(repo).store;
    locked.addProduct('reine');
    locked.validateCart();
    expect(repo.raw()).toBe(future);
    expect(repo.rawCart()).toBeNull();
  });
});

describe('intégrité : une écriture qui échoue n’affiche jamais une validation réussie', () => {
  it('validation : échec d’écriture → refus, aucune commande, aucun point, panier intact ; nouvel essai sans doublon', () => {
    const { store, repo, customer } = createTestStore();
    const jean = customer('Dupont');
    store.selectCustomer(jean.id);
    store.addProduct('reine');
    store.addProduct('margarita');
    const before = store.getData();
    const rawBefore = repo.raw();

    repo.control.failOn = 'doc';
    const r = store.validateCart();
    expect(r.ok).toBe(false);
    expect(store.getData().orders).toBe(before.orders);
    expect(store.getData().loyaltyEvents).toBe(before.loyaltyEvents);
    expect(store.getData().counters).toEqual(before.counters);
    expect(store.getData().cart).toEqual(before.cart);
    expect(repo.raw()).toBe(rawBefore);
    expect(store.getPersistError()).toMatch(/Sauvegarde locale impossible/);

    repo.control.failOn = null;
    const ok = store.validateCart();
    expect(ok.ok).toBe(true);
    expect(store.validateCart().ok).toBe(false); // double clic
    const mine = store.getData().orders.filter((o) => o.customerId === jean.id && o.status !== 'terminee');
    expect(mine.filter((o) => o.id === (ok.ok ? ok.value.id : ''))).toHaveLength(1);
    expect(store.getPersistError()).toBeNull();
    // Rechargé depuis le stockage : une seule commande, points crédités une seule fois.
    const reloaded = createTestStore(repo).store.getData();
    expect(reloaded.orders.filter((o) => ok.ok && o.id === ok.value.id)).toHaveLength(1);
    expect(computeBalance(reloaded.loyaltyEvents, jean.id, reloaded.settings.loyalty)).toEqual(
      computeBalance(store.getData().loyaltyEvents, jean.id, store.getData().settings.loyalty),
    );
  });

  it('écriture partielle : commande enregistrée mais panier non vidé → au rechargement, panier vide et aucun doublon possible', () => {
    const { store, repo } = createTestStore();
    store.addProduct('reine');
    repo.control.failOn = 'cart';
    const r = store.validateCart();
    expect(r.ok).toBe(true); // la commande EST enregistrée
    expect(parse(repo.rawCart()).lines).toHaveLength(1); // ancien panier resté sur disque

    repo.control.failOn = null;
    const reloaded = createTestStore(repo).store;
    expect(reloaded.getData().cart.lines).toEqual([]);
    expect(parse(repo.rawCart()).lines).toEqual([]);
    expect(reloaded.getData().orders.filter((o) => r.ok && o.id === r.value.id)).toHaveLength(1);
  });

  it('annulation, statut, client, paramètres et fin de service : échec → rien ne change', () => {
    const { store, repo, customer } = createTestStore();
    const jean = customer('Dupont');
    store.selectCustomer(jean.id);
    store.addProduct('reine');
    const v = store.validateCart();
    if (!v.ok) throw new Error('validation');
    const snapshot = JSON.stringify(store.getData());
    const raw = repo.raw();

    repo.control.failOn = 'doc';
    expect(store.cancelOrder(v.value.id).ok).toBe(false);
    expect(store.setOrderStatus(v.value.id, 'terminee').ok).toBe(false);
    expect(store.updateCustomerInstructions(jean.id, 'x').ok).toBe(false);
    expect(store.createCustomer({ firstName: 'A', lastName: 'B', phone: '0699999999', address: '', postalCode: '', city: '', complement: '', instructions: '' }).ok).toBe(false);
    expect(store.updateSettings({ deliveryFee: 0 }).ok).toBe(false);
    expect(store.closeService().ok).toBe(false);
    store.recordPrintRequest(v.value.id);
    expect(JSON.stringify(store.getData())).toBe(snapshot);
    expect(repo.raw()).toBe(raw);
  });
});

describe('cohérence stockage ↔ écran', () => {
  it('après un service complet, le rechargement restitue exactement les mêmes données', () => {
    const { store, repo, customer, clock } = createTestStore();
    const jean = customer('Dupont');
    store.selectCustomer(jean.id);
    store.addConfiguredLine('chevre-miel', { addedToppings: [store.topping('miel')!] });
    store.addReward('boisson', 'fanta-150');
    const a = store.validateCart();
    store.addProduct('reine');
    const b = store.validateCart();
    if (!a.ok || !b.ok) throw new Error('validation');
    store.startEditOrder(a.value.id);
    store.addProduct('margarita');
    store.validateCart();
    store.setOrderStatus(a.value.id, 'terminee');
    store.cancelOrder(b.value.id);
    store.recordPrintRequest(a.value.id);
    store.updateSettings({ deliveryFee: 300 });
    store.createCustomer({ firstName: 'Léa', lastName: 'Martin', phone: '0611223344', address: '1 rue A', postalCode: '13001', city: 'Marseille', complement: '', instructions: '' });
    clock.time = new Date('2026-10-29T23:30:00');
    store.closeService();
    store.addProduct('reine');
    store.flushPendingWrites();

    const reloaded = createTestStore(repo).store;
    expect(reloaded.getData()).toEqual(store.getData());
    expect(reloaded.getPersistError()).toBeNull();
  });

  it('le document principal ne contient pas le panier et la clé panier ne contient pas l’historique', () => {
    const { store, repo } = createTestStore();
    store.addProduct('reine');
    store.validateCart();
    store.addProduct('reine');
    expect(parse(repo.raw()).cart).toBeUndefined();
    expect(parse(repo.rawCart()).orders).toBeUndefined();
    expect(CART_KEY).not.toBe('ferrari-manager:v1');
  });
});
