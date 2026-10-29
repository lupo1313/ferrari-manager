import { describe, expect, it } from 'vitest';
import { computeBalance } from '../src/domain/loyalty';
import { buildTicket } from '../src/domain/ticket';
import { createTestStore } from './helpers';

describe('scénario de validation V1 (store complet)', () => {
  it('Jean Dupont : 2 pizzas personnalisées + soda, livraison, ticket, statut, récompense, annulation', () => {
    const { store, customer } = createTestStore();
    const jean = customer('Dupont');
    const rules = () => store.getData().settings.loyalty;
    const balance = () => computeBalance(store.getData().loyaltyEvents, jean.id, rules());
    expect(balance()).toMatchObject({ available: 1, progress: 2 });

    // Sélection + composition
    expect(store.selectCustomer(jean.id).ok).toBe(true);
    store.setMode('livraison');
    store.addConfiguredLine('royale', { removedIngredients: ['Œuf'] });
    store.addConfiguredLine('chevre-miel', { addedToppings: [store.topping('miel')!] });
    store.addProduct('coca-150');
    const reward = store.addReward('boisson', 'fanta-150');
    expect(reward.ok).toBe(true);
    // Une seule récompense disponible : la seconde est refusée.
    expect(store.addReward('pizza', 'margarita').ok).toBe(false);

    const result = store.validateCart();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const order = result.value;
    // 14 + (14 + 0,50) + 4 + 0 (Fanta offert) + 2 livraison
    expect(order.totals).toEqual({ subtotal: 3250, deliveryFee: 200, total: 3450 });
    expect(balance()).toMatchObject({ available: 0, progress: 4 });

    // Double clic : la seconde validation ne crée rien.
    const again = store.validateCart();
    expect(again.ok).toBe(false);
    expect(store.getData().orders.filter((o) => o.customerId === jean.id)).toHaveLength(1);
    expect(balance()).toMatchObject({ available: 0, progress: 4 });

    // Ticket
    const ticket = buildTicket(order, store.getData().settings);
    expect(ticket.customer?.addressLines).toContain('15 rue de Rome');
    expect(ticket.lines[0].details).toContain('Sans œuf');
    expect(ticket.lines[1].details).toContain('+ Miel');
    expect(ticket.lines[3].amount).toBe('OFFERT');
    expect(ticket.total).toBe('34,50 €');

    // Statut
    expect(store.setOrderStatus(order.id, 'en_preparation').ok).toBe(true);

    // Annulation : points retirés et récompense restituée.
    const cancel = store.cancelOrder(order.id);
    expect(cancel.ok && cancel.value).toMatchObject({ pointsReverted: 2, rewardsRestored: 1 });
    expect(balance()).toMatchObject({ available: 1, progress: 2 });
    expect(store.cancelOrder(order.id).ok).toBe(false);
  });

  it('modifier l’adresse du client ne change pas les commandes déjà enregistrées', () => {
    const { store, customer } = createTestStore();
    const jean = customer('Dupont');
    store.selectCustomer(jean.id);
    store.setMode('livraison');
    store.addProduct('reine');
    const r = store.validateCart();
    expect(r.ok).toBe(true);
    store.updateCustomer(jean.id, {
      firstName: 'Jean', lastName: 'Dupont', phone: '0612345678',
      address: '1 place Castellane', postalCode: '13006', city: 'Marseille', complement: '', instructions: '',
    });
    const saved = store.getData().orders.find((o) => r.ok && o.id === r.value.id)!;
    expect(saved.customer?.address).toBe('15 rue de Rome');
    expect(store.getData().customers.find((c) => c.id === jean.id)?.address).toBe('1 place Castellane');
  });

  it('modifier une commande validée ajuste les points sans doublon', () => {
    const { store, customer } = createTestStore();
    const marie = customer('Lambert');
    const points = () => computeBalance(store.getData().loyaltyEvents, marie.id, store.getData().settings.loyalty).totalPoints;
    const before = points();
    store.selectCustomer(marie.id);
    store.addProduct('reine');
    store.addProduct('reine');
    const r = store.validateCart();
    if (!r.ok) throw new Error(r.error);
    expect(points()).toBe(before + 2);

    expect(store.startEditOrder(r.value.id).ok).toBe(true);
    const line = store.getData().cart.lines[0];
    store.setLineQuantity(line.id, 3);
    const edited = store.validateCart();
    expect(edited.ok && edited.value.revision).toBe(2);
    expect(edited.ok && edited.value.number).toBe(r.value.number);
    expect(points()).toBe(before + 3);
    expect(store.getData().orders.filter((o) => o.id === r.value.id)).toHaveLength(1);
  });

  it('refuse une livraison sans client et accepte une commande comptoir à emporter', () => {
    const { store } = createTestStore();
    store.addProduct('margarita');
    store.setMode('livraison');
    const refused = store.validateCart();
    expect(refused.ok).toBe(false);
    store.setMode('emporter');
    store.setCounterName('Paul');
    const r = store.validateCart();
    expect(r.ok && r.value.customerId).toBeNull();
    expect(r.ok && r.value.counterName).toBe('Paul');
  });

  it('empêche les doublons de fiche par téléphone', () => {
    const { store } = createTestStore();
    const r = store.createCustomer({
      firstName: 'Autre', lastName: 'Personne', phone: '06.12.34.56.78',
      address: '', postalCode: '', city: '', complement: '', instructions: '',
    });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.existingCustomerId).toBeTruthy();
  });

  it('changer de client retire les récompenses du panier', () => {
    const { store, customer } = createTestStore();
    store.selectCustomer(customer('Dupont').id);
    store.addReward('pizza', 'margarita');
    const r = store.selectCustomer(customer('Martin').id);
    expect(r.ok && r.value.removedRewards).toBe(1);
    expect(store.getData().cart.lines).toHaveLength(0);
  });

  it('fin de service : archive terminées/annulées, garde les actives et le journal de fidélité', () => {
    const { store } = createTestStore();
    const [first, second] = store.getData().orders;
    store.setOrderStatus(first.id, 'terminee');
    const eventsBefore = store.getData().loyaltyEvents.length;
    const r = store.endService();
    expect(r.ok && r.value).toEqual({ archived: 1, stillActive: 1 });
    expect(store.getData().orders.find((o) => o.id === second.id)?.archivedAt).toBeNull();
    expect(store.getData().loyaltyEvents.length).toBe(eventsBefore);
  });

  it('persistance : les données survivent à un rechargement, la réinitialisation recharge la démo', () => {
    const { store, repo } = createTestStore();
    store.addProduct('reine');
    store.validateCart();
    const count = store.getData().orders.length;
    const reloaded = createTestStore(repo).store;
    expect(reloaded.getData().orders.length).toBe(count);
    reloaded.resetDemoData();
    expect(reloaded.getData().orders.length).toBe(2);
  });

  it('les paramètres filtrent les boissons alcoolisées de la liste des récompenses', () => {
    const { store } = createTestStore();
    const r = store.updateSettings({
      loyalty: { ...store.getData().settings.loyalty, eligibleDrinkIds: ['coca-150', 'vin-rose-75'] },
    });
    expect(r.ok && r.value.loyalty.eligibleDrinkIds).toEqual(['coca-150']);
  });
});
