import { describe, expect, it } from 'vitest';
import { createAppStore } from '../src/state/store';
import { createMemoryRepository } from '../src/storage/repository';
import { demoCatalog } from '../src/data/catalog';
import { buildDemoData } from '../src/data/seed';
import { computeBalance, customerLoyaltyStatus, reconcileOrderLoyalty } from '../src/domain/loyalty';
import { addProduct, createLine, emptyCart, hasRewardWithoutPaidPizza, ONE_REWARD_PER_ORDER, REWARD_NEEDS_PAID_PIZZA } from '../src/domain/cart';
import { buildOrder, validateCart } from '../src/domain/orders';
import { cannotMarkPaid } from '../src/domain/payment';
import type { Cart } from '../src/domain/types';
import { createTestStore } from './helpers';

/**
 * Intervention 3 : encaissement et fidélité.
 * Jean Dupont (démo) : 12 pizzas comptées = 1 récompense disponible + 2/10.
 */
function setup(repo = createMemoryRepository()) {
  const t = createTestStore(repo);
  const jean = t.customer('Dupont');
  const balance = () => computeBalance(t.store.getData().loyaltyEvents, jean.id, t.store.getData().settings.loyalty);
  const status = () => customerLoyaltyStatus(t.store.getData().loyaltyEvents, t.store.getData().orders, jean.id);
  const pointEvents = (orderId: string) => t.store.getData().loyaltyEvents.filter((e) => e.orderId === orderId && e.type === 'points');
  const rewardEvents = (orderId: string) => t.store.getData().loyaltyEvents.filter((e) => e.orderId === orderId && e.type === 'rewards_used');
  /** Enregistre une commande pour Jean à partir de produits payants et de cadeaux éventuels. */
  const order = (products: string[], gift?: { kind: 'pizza' | 'boisson'; id: string }) => {
    t.store.selectCustomer(jean.id);
    for (const p of products) t.store.addProduct(p);
    if (gift) {
      const g = t.store.addReward(gift.kind, gift.id);
      if (!g.ok) throw new Error(g.error);
    }
    const r = t.store.validateCart();
    if (!r.ok) throw new Error(r.error);
    return r.value;
  };
  return { ...t, jean, balance, status, pointEvents, rewardEvents, order };
}

/** Relit un stockage existant avec des identifiants distincts (évite toute collision dans les tests). */
function reload(repo: ReturnType<typeof createMemoryRepository>) {
  let n = 0;
  return createAppStore({
    repo,
    catalog: demoCatalog,
    seed: buildDemoData,
    now: () => new Date('2026-10-29T21:00:00'),
    newId: (p) => `${p}_r${++n}`,
  });
}

describe('A. Encaissement et crédit des pizzas', () => {
  it('1. commande enregistrée non encaissée : aucun point crédité, pizzas identifiables en attente', () => {
    const t = setup();
    const o = t.order(['reine', 'royale']);
    expect(o.payment.status).toBe('a_encaisser');
    expect(t.pointEvents(o.id)).toHaveLength(0);
    expect(t.balance()).toMatchObject({ totalPoints: 12, progress: 2 });
    expect(t.status().pendingPizzas).toBe(2);
  });

  it('2. commande encaissée : crédit exact des pizzas payantes', () => {
    const t = setup();
    const o = t.order(['reine', 'royale', 'coca-150', 'tiramisu']);
    const r = t.store.markOrderPaid(o.id, 'especes');
    expect(r.ok && r.value.pointsCredited).toBe(2);
    expect(t.balance()).toMatchObject({ totalPoints: 14, progress: 4 });
    expect(t.pointEvents(o.id)).toEqual([expect.objectContaining({ delta: 2, reason: 'commande_encaissee' })]);
    expect(t.status().pendingPizzas).toBe(0);
  });

  it('3. pizza offerte : aucun crédit pour elle, seule la pizza payante compte', () => {
    const t = setup();
    const o = t.order(['reine'], { kind: 'pizza', id: 'margarita' });
    const r = t.store.markOrderPaid(o.id, 'carte');
    expect(r.ok && r.value.pointsCredited).toBe(1);
    expect(t.balance().totalPoints).toBe(13);
  });

  it('4. double confirmation d’encaissement : aucun double crédit (moyen corrigeable, date conservée)', () => {
    const t = setup();
    const o = t.order(['reine', 'royale']);
    const first = t.store.markOrderPaid(o.id, 'especes');
    const paidAt = first.ok ? first.value.order.payment.paidAt : null;
    const second = t.store.markOrderPaid(o.id, 'especes');
    expect(second.ok && second.value).toMatchObject({ alreadyPaid: true, pointsCredited: 0 });
    const third = t.store.markOrderPaid(o.id, 'carte');
    expect(third.ok && third.value.pointsCredited).toBe(0);
    const saved = t.store.getData().orders.find((x) => x.id === o.id)!;
    expect(saved.payment).toMatchObject({ status: 'encaissee', method: 'carte', paidAt });
    expect(t.pointEvents(o.id)).toHaveLength(1);
    expect(t.balance().totalPoints).toBe(14);
  });

  it('5. annulation avant paiement : aucun point conservé, récompense réservée libérée', () => {
    const t = setup();
    const o = t.order(['reine'], { kind: 'boisson', id: 'coca-150' });
    expect(t.balance().available).toBe(0);
    const r = t.store.cancelOrder(o.id);
    expect(r.ok && r.value).toMatchObject({ pointsReverted: 0, rewardsRestored: 1, wasPaid: false });
    expect(t.pointEvents(o.id)).toHaveLength(0);
    expect(t.balance()).toMatchObject({ totalPoints: 12, available: 1 });
    // Une commande annulée ne peut plus être encaissée.
    expect(t.store.markOrderPaid(o.id).ok).toBe(false);
  });

  it('6. annulation après paiement : fidélité recalculée, aucun reste', () => {
    const t = setup();
    const o = t.order(['reine', 'royale']);
    t.store.markOrderPaid(o.id, 'carte');
    const r = t.store.cancelOrder(o.id);
    expect(r.ok && r.value).toMatchObject({ pointsReverted: 2, wasPaid: true });
    expect(t.balance()).toMatchObject({ totalPoints: 12, progress: 2 });
    expect(t.store.cancelOrder(o.id).ok).toBe(false);
  });

  it('annuler un encaissement saisi par erreur retire les pizzas ; un nouvel encaissement les recrédite une seule fois', () => {
    const t = setup();
    const o = t.order(['reine', 'royale']);
    t.store.markOrderPaid(o.id, 'especes');
    const undo = t.store.markOrderUnpaid(o.id);
    expect(undo.ok && undo.value.pointsReverted).toBe(2);
    expect(t.balance().totalPoints).toBe(12);
    t.store.markOrderPaid(o.id, 'especes');
    expect(t.balance().totalPoints).toBe(14);
  });

  it('le statut de préparation n’encaisse jamais : terminée reste à encaisser et sans points', () => {
    const t = setup();
    const o = t.order(['reine']);
    t.store.setOrderStatus(o.id, 'terminee');
    expect(t.store.getData().orders.find((x) => x.id === o.id)!.payment.status).toBe('a_encaisser');
    expect(t.balance().totalPoints).toBe(12);
    // Fin de service : terminée non encaissée reste affichée.
    const end = t.store.closeService();
    expect(end.ok && end.value.waitingPayment).toBe(1);
    expect(t.store.getData().orders.find((x) => x.id === o.id)!.archivedAt).toBeNull();
  });
});

describe('B. Cadeau fidélité : au moins une pizza payante', () => {
  it('7. cadeau ajouté avec une pizza payante : autorisé', () => {
    const t = setup();
    t.store.selectCustomer(t.jean.id);
    t.store.addProduct('reine');
    expect(t.store.addReward('pizza', 'margarita').ok).toBe(true);
    expect(t.store.validateCart().ok).toBe(true);
  });

  it('8. cadeau sans pizza payante : refusé (panier vide, ou seulement boissons/desserts)', () => {
    const t = setup();
    t.store.selectCustomer(t.jean.id);
    const empty = t.store.addReward('pizza', 'margarita');
    expect(!empty.ok && empty.error).toContain(REWARD_NEEDS_PAID_PIZZA);
    t.store.addProduct('coca-150');
    t.store.addProduct('tiramisu');
    expect(t.store.addReward('boisson', 'fanta-150').ok).toBe(false);
    expect(t.store.getData().cart.lines.some((l) => l.reward)).toBe(false);
  });

  it('9. suppression de la dernière pizza payante : cadeau conservé mais invalide, enregistrement bloqué', () => {
    const t = setup();
    t.store.selectCustomer(t.jean.id);
    t.store.addProduct('reine');
    t.store.addReward('pizza', 'margarita');
    const reine = t.store.getData().cart.lines.find((l) => l.productId === 'reine')!;
    t.store.removeLine(reine.id);
    const cart = t.store.getData().cart;
    expect(cart.lines).toHaveLength(1); // le cadeau n'est pas retiré en silence
    expect(hasRewardWithoutPaidPizza(cart.lines)).toBe(true);
    const r = t.store.validateCart();
    expect(!r.ok && r.error).toContain(REWARD_NEEDS_PAID_PIZZA);
    expect(t.store.getData().orders.filter((o) => o.customerId === t.jean.id)).toHaveLength(0);
    expect(t.balance().available).toBe(1);

    // Même chose en passant la quantité à zéro, puis correction par ajout d'une pizza payante.
    t.store.addProduct('royale');
    const royale = t.store.getData().cart.lines.find((l) => l.productId === 'royale')!;
    t.store.setLineQuantity(royale.id, 0);
    expect(t.store.validateCart().ok).toBe(false);
    t.store.addProduct('reine');
    expect(t.store.validateCart().ok).toBe(true);
  });

  it('10. modification d’une commande pour contourner la règle : refusée, la version enregistrée reste intacte', () => {
    const t = setup();
    const o = t.order(['reine'], { kind: 'pizza', id: 'margarita' });
    t.store.startEditOrder(o.id);
    const reine = t.store.getData().cart.lines.find((l) => l.productId === 'reine')!;
    t.store.removeLine(reine.id);
    const r = t.store.validateCart();
    expect(!r.ok && r.error).toContain(REWARD_NEEDS_PAID_PIZZA);
    const saved = t.store.getData().orders.find((x) => x.id === o.id)!;
    expect(saved.revision).toBe(1);
    expect(saved.lines).toHaveLength(2);
  });

  it('10 bis. une commande enregistrée sans pizza payante (anciennes données) ne peut pas être encaissée', () => {
    let cart: Cart = { ...emptyCart('x'), customerId: 'c1' };
    const margarita = demoCatalog.products.find((p) => p.id === 'margarita')!;
    cart = { ...cart, lines: [createLine(margarita, 'g', {}, 'pizza')] };
    const giftOnly = buildOrder(cart, { id: 'x', number: 9, nowIso: '2026-10-29T19:00:00Z', customer: null });
    expect(cannotMarkPaid({ ...giftOnly, customerId: 'c1' })).toContain(REWARD_NEEDS_PAID_PIZZA);
  });

  it('règle précise : une commande à 0 € sans cadeau n’est pas bloquée pour autant', () => {
    const t = setup();
    // Aucun produit gratuit dans la carte de démo : on vérifie que la règle ne regarde pas le montant.
    t.store.selectCustomer(t.jean.id);
    t.store.addProduct('reine');
    t.store.addReward('pizza', 'margarita');
    expect(t.store.validateCart().ok).toBe(true);
    expect(hasRewardWithoutPaidPizza([])).toBe(false);
  });
});

describe('C. Réservation des récompenses', () => {
  it('11. récompense réservée par une commande non encaissée : impossible de la réutiliser ailleurs', () => {
    const t = setup();
    const a = t.order(['reine'], { kind: 'pizza', id: 'margarita' });
    expect(t.status()).toMatchObject({ reserved: 1, reservingOrders: [a.number] });
    expect(t.balance().available).toBe(0);
    t.store.selectCustomer(t.jean.id);
    t.store.addProduct('royale');
    const second = t.store.addReward('pizza', 'reine');
    expect(second.ok).toBe(false);
    expect(t.store.rewardsRemaining()).toBe(0);
  });

  it('12. annulation d’une commande avec récompense réservée : restituée une seule fois', () => {
    const t = setup();
    const a = t.order(['reine'], { kind: 'pizza', id: 'margarita' });
    t.store.cancelOrder(a.id);
    t.store.cancelOrder(a.id); // refusée, sans effet
    expect(t.rewardEvents(a.id).map((e) => e.delta)).toEqual([1, -1]);
    expect(t.balance().available).toBe(1);
    expect(t.status().reserved).toBe(0);
  });

  it('13. annulation d’une commande encaissée avec récompense : restitution correcte, pizzas retirées', () => {
    const t = setup();
    const a = t.order(['reine'], { kind: 'boisson', id: 'sprite-150' });
    t.store.markOrderPaid(a.id, 'carte');
    // Encaissée : la récompense n'est plus « réservée », elle est consommée.
    expect(t.status().reserved).toBe(0);
    expect(t.balance()).toMatchObject({ available: 0, rewardsUsed: 1, totalPoints: 13 });
    t.store.cancelOrder(a.id);
    expect(t.balance()).toMatchObject({ available: 1, rewardsUsed: 0, totalPoints: 12 });
    expect(t.rewardEvents(a.id).map((e) => e.delta)).toEqual([1, -1]);
  });

});

describe('F. Une seule récompense par commande', () => {
  /** Karim Benali (démo) : 23 pizzas = 2 récompenses disponibles. */
  const karimSetup = () => {
    const t = setup();
    const karim = t.customer('Benali');
    const bal = () => computeBalance(t.store.getData().loyaltyEvents, karim.id, t.store.getData().settings.loyalty);
    return { ...t, karim, bal };
  };

  it('client avec plusieurs récompenses et plusieurs pizzas payantes : une seule récompense acceptée, les autres restent disponibles', () => {
    const t = karimSetup();
    expect(t.bal().available).toBe(2);
    t.store.selectCustomer(t.karim.id);
    t.store.addProduct('reine');
    t.store.addProduct('royale');
    expect(t.store.addReward('pizza', 'margarita').ok).toBe(true);
    const second = t.store.addReward('boisson', 'coca-150');
    expect(!second.ok && second.error).toContain('Une seule récompense');
    expect(t.store.getData().cart.lines.filter((l) => l.reward)).toHaveLength(1);
    const r = t.store.validateCart();
    expect(r.ok).toBe(true);
    // 1 récompense réservée, 1 toujours disponible pour une prochaine commande.
    expect(t.bal().available).toBe(1);
    t.store.selectCustomer(t.karim.id);
    t.store.addProduct('reine');
    expect(t.store.addReward('boisson', 'coca-150').ok).toBe(true);
    expect(t.store.validateCart().ok).toBe(true);
    expect(t.bal().available).toBe(0);
  });

  it('contournement par modification : impossible d’ajouter un 2e cadeau à une commande existante', () => {
    const t = karimSetup();
    t.store.selectCustomer(t.karim.id);
    t.store.addProduct('reine');
    t.store.addProduct('royale');
    t.store.addReward('pizza', 'margarita');
    const r = t.store.validateCart();
    if (!r.ok) throw new Error(r.error);
    // Modification de la commande (encaissée ou non) : le 2e cadeau est refusé.
    t.store.markOrderPaid(r.value.id, 'especes');
    t.store.startEditOrder(r.value.id);
    expect(t.store.addReward('boisson', 'coca-150').ok).toBe(false);
    // Retirer puis remettre un cadeau reste possible (toujours un seul).
    const gift = t.store.getData().cart.lines.find((l) => l.reward)!;
    t.store.removeLine(gift.id);
    expect(t.store.addReward('boisson', 'coca-150').ok).toBe(true);
    const v2 = t.store.validateCart();
    expect(v2.ok && v2.value.lines.filter((l) => l.reward)).toHaveLength(1);
    expect(t.rewardEvents(r.value.id).reduce((s, e) => s + e.delta, 0)).toBe(1);
    expect(t.bal().available).toBe(1);
  });

  it('contournement par un panier forgé (2 cadeaux) : refusé à l’enregistrement et à l’encaissement', () => {
    const karim = buildDemoData(demoCatalog, new Date('2026-10-29T19:00:00'), (p) => p + Math.random()).customers[2];
    const prod = (id: string) => demoCatalog.products.find((p) => p.id === id)!;
    let cart: Cart = { ...emptyCart('f'), customerId: karim.id };
    cart = addProduct(cart, prod('reine'), 'l1');
    cart = addProduct(cart, prod('royale'), 'l2');
    cart = { ...cart, lines: [...cart.lines, createLine(prod('margarita'), 'g1', {}, 'pizza'), createLine(prod('coca-150'), 'g2', {}, 'boisson')] };
    // Même avec assez de récompenses (rewardsRemaining positif), la règle refuse.
    expect(validateCart(cart, { customer: karim, rewardsRemaining: 5 })).toContain(ONE_REWARD_PER_ORDER);
    const forged = buildOrder(cart, { id: 'f', number: 7, nowIso: 'x', customer: karim });
    expect(cannotMarkPaid(forged)).toContain('Une seule récompense');
  });

  it('commande stockée avec 2 cadeaux (anciennes données) : non encaissable tant qu’elle n’est pas corrigée', () => {
    const t = karimSetup();
    t.store.selectCustomer(t.karim.id);
    t.store.addProduct('reine');
    t.store.addReward('pizza', 'margarita');
    const r = t.store.validateCart();
    if (!r.ok) throw new Error(r.error);
    const doc = JSON.parse(t.repo.raw()!);
    const stored = doc.orders.find((x: { id: string }) => x.id === r.value.id);
    stored.lines.push({ ...stored.lines.find((l: { reward: unknown }) => l.reward), id: 'g2', productId: 'coca-150', name: 'Coca-Cola 1,5L', category: 'boisson', reward: 'boisson' });
    const s = reload(createMemoryRepository(null, JSON.stringify(doc)));
    const pay = s.markOrderPaid(r.value.id, 'carte');
    expect(!pay.ok && pay.error).toContain('Une seule récompense');
    // L'annulation, elle, reste possible et restitue sans erreur.
    expect(s.cancelOrder(r.value.id).ok).toBe(true);
  });
});

describe('D. Modifications', () => {
  it('14. modification d’une commande non encaissée : aucun crédit avant l’encaissement, puis crédit de la version finale', () => {
    const t = setup();
    const o = t.order(['reine', 'reine']);
    t.store.startEditOrder(o.id);
    const line = t.store.getData().cart.lines[0];
    t.store.setLineQuantity(line.id, 3);
    expect(t.store.validateCart().ok).toBe(true);
    expect(t.balance().totalPoints).toBe(12);
    expect(t.status().pendingPizzas).toBe(3);
    t.store.markOrderPaid(o.id);
    expect(t.balance().totalPoints).toBe(15);
  });

  it('15. modification d’une commande encaissée : pas de double crédit, recalcul sur la version finale', () => {
    const t = setup();
    const o = t.order(['reine', 'reine']);
    t.store.markOrderPaid(o.id, 'especes');
    expect(t.balance().totalPoints).toBe(14);

    t.store.startEditOrder(o.id);
    t.store.setLineQuantity(t.store.getData().cart.lines[0].id, 3);
    const v2 = t.store.validateCart();
    expect(v2.ok && v2.value.payment.status).toBe('encaissee');
    expect(t.balance().totalPoints).toBe(15);

    // Ré-enregistrer sans changement : rien n'est recrédité.
    t.store.startEditOrder(o.id);
    t.store.validateCart();
    expect(t.balance().totalPoints).toBe(15);

    t.store.startEditOrder(o.id);
    t.store.setLineQuantity(t.store.getData().cart.lines[0].id, 1);
    t.store.validateCart();
    expect(t.balance().totalPoints).toBe(13);
    expect(t.pointEvents(o.id).reduce((s, e) => s + e.delta, 0)).toBe(1);
  });

  it('17. les personnalisations des pizzas sont conservées après encaissement, modification et rechargement', () => {
    const t = setup();
    t.store.selectCustomer(t.jean.id);
    t.store.addConfiguredLine('royale', { removedIngredients: ['Œuf'], addedToppings: [t.store.topping('olives')!], note: 'bien cuite' });
    const r = t.store.validateCart();
    if (!r.ok) throw new Error(r.error);
    t.store.markOrderPaid(r.value.id, 'carte');
    t.store.startEditOrder(r.value.id);
    t.store.addProduct('coca-150');
    t.store.validateCart();
    const line = reload(t.repo).getData().orders.find((o) => o.id === r.value.id)!.lines.find((l) => l.productId === 'royale')!;
    expect(line).toMatchObject({ removedIngredients: ['Œuf'], note: 'bien cuite' });
    expect(line.addedToppings.map((x) => x.id)).toEqual(['olives']);
  });

  it('18. calcul des prix : exemples validés par le gérant (cadeau en plus, jamais en remplacement)', () => {
    const t = setup();
    // Exemple 1 : Reine 12 € + Margarita offerte → 12 €, 1 pizza payante.
    const ex1 = t.order(['reine'], { kind: 'pizza', id: 'margarita' });
    expect(ex1.totals.total).toBe(1200);
    expect(ex1.lines.filter((l) => !l.reward).map((l) => l.productId)).toEqual(['reine']);
    t.store.cancelOrder(ex1.id);
    // Exemple 2 : Reine + Margarita + pizza offerte → 22 €, 2 pizzas payantes.
    const ex2 = t.order(['reine', 'margarita'], { kind: 'pizza', id: 'margarita' });
    expect(ex2.totals.total).toBe(2200);
    expect(ex2.lines.filter((l) => l.productId === 'margarita' && !l.reward)).toHaveLength(1);
    t.store.markOrderPaid(ex2.id);
    expect(t.balance().totalPoints).toBe(14);
  });
});

describe('E. Données et persistance', () => {
  it('16. anciennes commandes sans statut de paiement : ni supposées payées, ni privées de leurs points', () => {
    // Données « d'avant » : une commande sans bloc paiement, ses 2 pizzas créditées à l'enregistrement.
    const t = setup();
    const o = t.order(['reine', 'royale']);
    const doc = JSON.parse(t.repo.raw()!);
    const old = doc.orders.find((x: { id: string }) => x.id === o.id);
    delete old.payment;
    doc.orders.push({ ...old, id: 'ancienne-terminee', number: 90, status: 'terminee', lines: old.lines });
    delete doc.settings.loyalty.awardOn;
    doc.loyaltyEvents.push(
      { id: 'old1', at: old.createdAt, customerId: t.jean.id, orderId: o.id, type: 'points', delta: 2, reason: 'commande_validee' },
      { id: 'old2', at: old.createdAt, customerId: t.jean.id, orderId: 'ancienne-terminee', type: 'points', delta: 2, reason: 'commande_validee' },
    );
    const raw = JSON.stringify(doc);
    const repo = createMemoryRepository(null, raw, t.repo.rawCart() ?? undefined);
    const s = reload(repo);
    const bal = () => computeBalance(s.getData().loyaltyEvents, t.jean.id, s.getData().settings.loyalty);

    const legacy = s.getData().orders.find((x) => x.id === o.id)!;
    expect(legacy.payment).toMatchObject({ status: 'a_encaisser', legacy: true });
    expect(bal().totalPoints).toBe(16); // points historiques conservés
    expect(repo.raw()).toBe(raw); // lecture seule : rien n'est réécrit au chargement

    // Une action sans rapport (statut) ne change pas ses points.
    s.setOrderStatus(o.id, 'en_preparation');
    expect(bal().totalPoints).toBe(16);
    // Encaissement : aucun double crédit.
    s.markOrderPaid(o.id, 'especes');
    expect(bal().totalPoints).toBe(16);
    // Annulation : points retirés une seule fois.
    s.cancelOrder(o.id);
    expect(bal().totalPoints).toBe(14);
    // Ancienne commande terminée : archivée en fin de service comme avant.
    const end = s.closeService();
    expect(end.ok && end.value.waitingPayment).toBe(0);
    expect(s.getData().orders.find((x) => x.id === 'ancienne-terminee')!.archivedAt).not.toBeNull();
  });

  it('19. persistance : statut de paiement, moyen, points et réservations identiques après rechargement', () => {
    const t = setup();
    const paid = t.order(['reine', 'royale']);
    t.store.markOrderPaid(paid.id, 'carte');
    const reserved = t.order(['reine'], { kind: 'pizza', id: 'margarita' });
    const s = reload(t.repo);
    const o = s.getData().orders.find((x) => x.id === paid.id)!;
    expect(o.payment).toMatchObject({ status: 'encaissee', method: 'carte' });
    expect(o.payment.legacy).toBeUndefined();
    expect(computeBalance(s.getData().loyaltyEvents, t.jean.id, s.getData().settings.loyalty)).toMatchObject({ totalPoints: 14, available: 0 });
    expect(customerLoyaltyStatus(s.getData().loyaltyEvents, s.getData().orders, t.jean.id)).toMatchObject({
      reserved: 1,
      reservingOrders: [reserved.number],
      pendingPizzas: 1,
    });
  });

  it('20. données locales corrompues : bloc paiement illisible traité prudemment, JSON corrompu toujours protégé', () => {
    const t = setup();
    const o = t.order(['reine']);
    const doc = JSON.parse(t.repo.raw()!);
    doc.orders.find((x: { id: string }) => x.id === o.id).payment = { status: 'payé ?', method: 42 };
    const s = reload(createMemoryRepository(null, JSON.stringify(doc)));
    const loaded = s.getData().orders.find((x) => x.id === o.id)!;
    // Jamais supposée encaissée, et aucun point ajouté ni retiré à la lecture.
    expect(loaded.payment.status).toBe('a_encaisser');
    expect(computeBalance(s.getData().loyaltyEvents, t.jean.id, s.getData().settings.loyalty).totalPoints).toBe(12);
    expect(reconcileOrderLoyalty(s.getData().loyaltyEvents, loaded, { nowIso: '', newId: (p) => p })).toEqual([]);

    // Protection existante : un JSON corrompu n'est jamais écrasé.
    const broken = createMemoryRepository(null, '{"schemaVersion":1,"orders":[');
    const locked = reload(broken);
    expect(locked.getPersistError()).toBeTruthy();
    expect(broken.raw()).toBe('{"schemaVersion":1,"orders":[');
  });
});

describe('domaine indépendant de l’interface', () => {
  it('réconciliation pure : non encaissée → réservation seule ; encaissée → pizzas ; ré-encaissée → rien', () => {
    const jean = buildDemoData(demoCatalog, new Date('2026-10-29T19:00:00'), (p) => p + Math.random()).customers[0];
    let cart: Cart = { ...emptyCart('o'), customerId: jean.id };
    cart = addProduct(cart, demoCatalog.products.find((p) => p.id === 'reine')!, 'l1');
    cart = { ...cart, lines: [...cart.lines, createLine(demoCatalog.products.find((p) => p.id === 'coca-150')!, 'g', {}, 'boisson')] };
    const o = buildOrder(cart, { id: 'o', number: 1, nowIso: 'x', customer: jean });
    const ctx = { nowIso: 'x', newId: (p: string) => p + Math.random() };
    const e1 = reconcileOrderLoyalty([], o, ctx);
    expect(e1.map((e) => [e.type, e.delta])).toEqual([['rewards_used', 1]]);
    const paidOrder = { ...o, payment: { status: 'encaissee' as const, method: null, paidAt: 'x' } };
    const e2 = reconcileOrderLoyalty(e1, paidOrder, ctx);
    expect(e2.map((e) => [e.type, e.delta])).toEqual([['points', 1]]);
    expect(reconcileOrderLoyalty([...e1, ...e2], paidOrder, ctx)).toEqual([]);
  });
});
