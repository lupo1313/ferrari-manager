import { describe, expect, it } from 'vitest';
import { computeBalance, countEarningPizzas, isRewardEligible, reconcileOrderLoyalty } from '../src/domain/loyalty';
import { addProduct, createLine, emptyCart } from '../src/domain/cart';
import { buildOrder, withStatus } from '../src/domain/orders';
import { buildCustomer, EMPTY_CUSTOMER_INPUT } from '../src/domain/customers';
import { demoCatalog } from '../src/data/catalog';
import { defaultSettings } from '../src/data/defaultSettings';
import type { Cart, LoyaltyEvent, LoyaltyRules } from '../src/domain/types';
import { sequentialIds } from './helpers';

const rules: LoyaltyRules = defaultSettings.loyalty;
const p = (id: string) => demoCatalog.products.find((x) => x.id === id)!;
const customer = buildCustomer({ ...EMPTY_CUSTOMER_INPUT, lastName: 'Test', phone: '0600000001' }, 'c1', '2026-01-01T00:00:00Z');
const ctx = { nowIso: '2026-10-29T19:00:00Z', newId: sequentialIds() };

const seedPoints = (points: number): LoyaltyEvent[] => [
  { id: 's', at: '', customerId: 'c1', orderId: null, type: 'points', delta: points, reason: 'reprise_demo' },
];

function orderWith(ids: string[], rewardIds: string[] = []) {
  let cart: Cart = { ...emptyCart('o1'), customerId: 'c1' };
  ids.forEach((id, i) => (cart = addProduct(cart, p(id), `l${i}`)));
  rewardIds.forEach((id, i) => {
    const kind = p(id).category === 'pizza' ? 'pizza' : 'boisson';
    cart = { ...cart, lines: [...cart.lines, createLine(p(id), `r${i}`, {}, kind)] };
  });
  return buildOrder(cart, { id: 'o1', number: 1, nowIso: ctx.nowIso, customer, settings: defaultSettings });
}

describe('solde de fidélité', () => {
  it('10 pizzas = 1 récompense, progression jamais à 10/10', () => {
    const b = computeBalance(seedPoints(10), 'c1', rules);
    expect(b.available).toBe(1);
    expect(b.progress).toBe(0);
    expect(b.pointsToNext).toBe(10);
  });

  it('exemple du cahier des charges : 1 récompense + 2/10, une pizza commandée → 3/10, récompense conservée', () => {
    const events = seedPoints(12);
    const order = orderWith(['reine']);
    const after = [...events, ...reconcileOrderLoyalty(events, order, rules, ctx)];
    const b = computeBalance(after, 'c1', rules);
    expect(b.progress).toBe(3);
    expect(b.available).toBe(1); // jamais consommée automatiquement
  });

  it('plusieurs récompenses disponibles', () => {
    expect(computeBalance(seedPoints(23), 'c1', rules)).toMatchObject({ available: 2, progress: 3 });
  });
});

describe('règles d’éligibilité', () => {
  it('seules les pizzas de la liste sont éligibles', () => {
    expect(isRewardEligible(p('margarita'), 'pizza', rules)).toBe(true);
    expect(isRewardEligible(p('burrata'), 'pizza', rules)).toBe(false);
  });

  it('alcool, desserts et boissons hors liste exclus même si configurés par erreur', () => {
    const loose: LoyaltyRules = { ...rules, eligibleDrinkIds: ['vin-rose-75', 'biere-33', 'tiramisu', 'coca-150'] };
    expect(isRewardEligible(p('vin-rose-75'), 'boisson', loose)).toBe(false);
    expect(isRewardEligible(p('biere-33'), 'boisson', loose)).toBe(false);
    expect(isRewardEligible(p('tiramisu'), 'boisson', loose)).toBe(false);
    expect(isRewardEligible(p('coca-150'), 'boisson', loose)).toBe(true);
    expect(isRewardEligible(p('coca-33'), 'boisson', rules)).toBe(false);
    expect(isRewardEligible(p('coca-150'), 'pizza', rules)).toBe(false);
  });
});

describe('réconciliation des commandes', () => {
  it('compte uniquement les pizzas payantes', () => {
    const order = orderWith(['reine', 'reine', 'coca-150', 'tiramisu'], ['margarita']);
    expect(countEarningPizzas(order.lines)).toBe(2);
  });

  it('est idempotente (double validation)', () => {
    const order = orderWith(['reine', 'royale']);
    const first = reconcileOrderLoyalty([], order, rules, ctx);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ type: 'points', delta: 2, reason: 'commande_validee' });
    expect(reconcileOrderLoyalty(first, order, rules, ctx)).toEqual([]);
  });

  it('pizza offerte : consomme une récompense, ne génère aucun point', () => {
    const events = seedPoints(10);
    const order = orderWith([], ['margarita']);
    const out = reconcileOrderLoyalty(events, order, rules, ctx);
    expect(out).toEqual([expect.objectContaining({ type: 'rewards_used', delta: 1 })]);
    const b = computeBalance([...events, ...out], 'c1', rules);
    expect(b).toMatchObject({ available: 0, totalPoints: 10 });
  });

  it('annulation : retire les points et restitue la récompense', () => {
    const events = seedPoints(12);
    const order = orderWith(['reine', 'royale'], ['coca-150']);
    const afterValidation = [...events, ...reconcileOrderLoyalty(events, order, rules, ctx)];
    expect(computeBalance(afterValidation, 'c1', rules)).toMatchObject({ available: 0, progress: 4 });

    const cancelled = withStatus(order, 'annulee', ctx.nowIso);
    const afterCancel = [...afterValidation, ...reconcileOrderLoyalty(afterValidation, cancelled, rules, ctx)];
    expect(computeBalance(afterCancel, 'c1', rules)).toMatchObject({ available: 1, progress: 2, totalPoints: 12 });
    // Annuler deux fois ne change plus rien.
    expect(reconcileOrderLoyalty(afterCancel, cancelled, rules, ctx)).toEqual([]);
  });

  it('modification : seul l’écart de points est écrit', () => {
    const order = orderWith(['reine', 'royale', 'margarita']);
    const v1 = reconcileOrderLoyalty([], order, rules, ctx);
    const edited = { ...order, revision: 2, lines: order.lines.slice(0, 1) };
    const v2 = reconcileOrderLoyalty(v1, edited, rules, ctx);
    expect(v2).toEqual([expect.objectContaining({ delta: -2, reason: 'commande_modifiee' })]);
    expect(computeBalance([...v1, ...v2], 'c1', rules).totalPoints).toBe(1);
  });

  it('changement de client lors d’une modification : l’ancien client est régularisé', () => {
    const order = orderWith(['reine']);
    const v1 = reconcileOrderLoyalty([], order, rules, ctx);
    const moved = { ...order, revision: 2, customerId: 'c2' };
    const v2 = reconcileOrderLoyalty(v1, moved, rules, ctx);
    const all = [...v1, ...v2];
    expect(computeBalance(all, 'c1', rules).totalPoints).toBe(0);
    expect(computeBalance(all, 'c2', rules).totalPoints).toBe(1);
  });

  it('commande comptoir sans client : aucun événement', () => {
    const order = { ...orderWith(['reine']), customerId: null, customer: null };
    expect(reconcileOrderLoyalty([], order, rules, ctx)).toEqual([]);
  });

  it('récompense utilisée puis annulation des points qui l’avaient débloquée : dette visible, aucun solde négatif', () => {
    // 9 points ; commande A (1 pizza) débloque la récompense ; commande B l'utilise ; A est annulée.
    let events = seedPoints(9);
    const a = { ...orderWith(['reine']), id: 'A' };
    events = [...events, ...reconcileOrderLoyalty(events, a, rules, ctx)];
    const b = { ...orderWith([], ['margarita']), id: 'B' };
    events = [...events, ...reconcileOrderLoyalty(events, b, rules, ctx)];
    events = [...events, ...reconcileOrderLoyalty(events, withStatus(a, 'annulee', ctx.nowIso), rules, ctx)];
    const balance = computeBalance(events, 'c1', rules);
    expect(balance).toMatchObject({ available: 0, debt: 1, progress: 9 });
  });

  it('règle évolutive : points attribués seulement quand la commande est terminée', () => {
    const later: LoyaltyRules = { ...rules, awardOn: 'terminee' };
    const order = orderWith(['reine']);
    expect(reconcileOrderLoyalty([], order, later, ctx)).toEqual([]);
    const done = withStatus(order, 'terminee', ctx.nowIso);
    expect(reconcileOrderLoyalty([], done, later, ctx)).toEqual([expect.objectContaining({ delta: 1 })]);
  });
});
