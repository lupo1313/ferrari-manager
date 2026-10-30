import { describe, expect, it } from 'vitest';
import { computeBalance, countEarningPizzas, isRewardEligible, reconcileOrderLoyalty } from '../src/domain/loyalty';
import { addProduct, createLine, emptyCart } from '../src/domain/cart';
import { buildOrder, withStatus } from '../src/domain/orders';
import { markPaid } from '../src/domain/payment';
import { buildCustomer, EMPTY_CUSTOMER_INPUT } from '../src/domain/customers';
import { demoCatalog } from '../src/data/catalog';
import { defaultSettings } from '../src/data/defaultSettings';
import type { Cart, LoyaltyEvent, LoyaltyRules, Order } from '../src/domain/types';
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

/** Les pizzas ne sont créditées qu'une fois la commande encaissée. */
const paid = (o: Order) => markPaid(o, 'especes', ctx.nowIso);

describe('solde de fidélité', () => {
  it('10 pizzas = 1 récompense, progression jamais à 10/10', () => {
    const b = computeBalance(seedPoints(10), 'c1', rules);
    expect(b.available).toBe(1);
    expect(b.progress).toBe(0);
    expect(b.pointsToNext).toBe(10);
  });

  it('exemple du cahier des charges : 1 récompense + 2/10, une pizza encaissée → 3/10, récompense conservée', () => {
    const events = seedPoints(12);
    const order = paid(orderWith(['reine']));
    const after = [...events, ...reconcileOrderLoyalty(events, order, ctx)];
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

  it('commande enregistrée non encaissée : aucun point crédité', () => {
    expect(reconcileOrderLoyalty([], orderWith(['reine', 'royale']), ctx)).toEqual([]);
  });

  it('est idempotente (double encaissement)', () => {
    const order = paid(orderWith(['reine', 'royale']));
    const first = reconcileOrderLoyalty([], order, ctx);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ type: 'points', delta: 2, reason: 'commande_encaissee' });
    expect(reconcileOrderLoyalty(first, order, ctx)).toEqual([]);
    expect(reconcileOrderLoyalty(first, paid(order), ctx)).toEqual([]);
  });

  it('pizza offerte : réserve une récompense à l’enregistrement, ne génère aucun point', () => {
    const events = seedPoints(10);
    const order = orderWith(['reine'], ['margarita']);
    const out = reconcileOrderLoyalty(events, order, ctx);
    expect(out).toEqual([expect.objectContaining({ type: 'rewards_used', delta: 1, reason: 'recompense_reservee' })]);
    const afterPay = [...events, ...out, ...reconcileOrderLoyalty([...events, ...out], paid(order), ctx)];
    // Seule la Reine payante est créditée ; la récompense n'est pas recomptée à l'encaissement.
    expect(computeBalance(afterPay, 'c1', rules)).toMatchObject({ available: 0, totalPoints: 11 });
  });

  it('annulation : retire les points et restitue la récompense', () => {
    const events = seedPoints(12);
    const order = paid(orderWith(['reine', 'royale'], ['coca-150']));
    const afterValidation = [...events, ...reconcileOrderLoyalty(events, order, ctx)];
    expect(computeBalance(afterValidation, 'c1', rules)).toMatchObject({ available: 0, progress: 4 });

    const cancelled = withStatus(order, 'annulee', ctx.nowIso);
    const afterCancel = [...afterValidation, ...reconcileOrderLoyalty(afterValidation, cancelled, ctx)];
    expect(computeBalance(afterCancel, 'c1', rules)).toMatchObject({ available: 1, progress: 2, totalPoints: 12 });
    // Annuler deux fois ne change plus rien.
    expect(reconcileOrderLoyalty(afterCancel, cancelled, ctx)).toEqual([]);
  });

  it('modification d’une commande encaissée : seul l’écart de points est écrit', () => {
    const order = paid(orderWith(['reine', 'royale', 'margarita']));
    const v1 = reconcileOrderLoyalty([], order, ctx);
    const edited = { ...order, revision: 2, lines: order.lines.slice(0, 1) };
    const v2 = reconcileOrderLoyalty(v1, edited, ctx);
    expect(v2).toEqual([expect.objectContaining({ delta: -2, reason: 'commande_modifiee' })]);
    expect(computeBalance([...v1, ...v2], 'c1', rules).totalPoints).toBe(1);
  });

  it('changement de client lors d’une modification : l’ancien client est régularisé', () => {
    const order = paid(orderWith(['reine']));
    const v1 = reconcileOrderLoyalty([], order, ctx);
    const moved = { ...order, revision: 2, customerId: 'c2' };
    const v2 = reconcileOrderLoyalty(v1, moved, ctx);
    const all = [...v1, ...v2];
    expect(computeBalance(all, 'c1', rules).totalPoints).toBe(0);
    expect(computeBalance(all, 'c2', rules).totalPoints).toBe(1);
  });

  it('commande comptoir sans client : aucun événement', () => {
    const order = { ...paid(orderWith(['reine'])), customerId: null, customer: null };
    expect(reconcileOrderLoyalty([], order, ctx)).toEqual([]);
  });

  it('récompense utilisée puis annulation des points qui l’avaient débloquée : dette visible, aucun solde négatif', () => {
    // 9 points ; commande A (1 pizza encaissée) débloque la récompense ; commande B l'utilise ; A est annulée.
    let events = seedPoints(9);
    const a = { ...paid(orderWith(['reine'])), id: 'A' };
    events = [...events, ...reconcileOrderLoyalty(events, a, ctx)];
    const b = { ...orderWith(['royale'], ['margarita']), id: 'B' };
    events = [...events, ...reconcileOrderLoyalty(events, b, ctx)];
    events = [...events, ...reconcileOrderLoyalty(events, withStatus(a, 'annulee', ctx.nowIso), ctx)];
    const balance = computeBalance(events, 'c1', rules);
    expect(balance).toMatchObject({ available: 0, debt: 1, progress: 9 });
  });
});
