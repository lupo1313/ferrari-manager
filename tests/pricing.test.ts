import { describe, expect, it } from 'vitest';
import { addLine, addProduct, createLine, describeLine, emptyCart, setLineQuantity, updateLine } from '../src/domain/cart';
import { computeTotals, lineTotal } from '../src/domain/pricing';
import { formatPrice, parseEuros } from '../src/domain/money';
import { demoCatalog } from '../src/data/catalog';

const p = (id: string) => demoCatalog.products.find((x) => x.id === id)!;
const t = (id: string) => demoCatalog.toppings.find((x) => x.id === id)!;

describe('calcul des prix', () => {
  it('additionne lignes, quantités et frais de livraison', () => {
    let cart = emptyCart('d1');
    cart = addProduct(cart, p('royale'), 'l1');
    cart = addProduct(cart, p('royale'), 'l2'); // fusion → quantité 2
    cart = addProduct(cart, p('coca-150'), 'l3');
    expect(cart.lines).toHaveLength(2);
    expect(cart.lines[0].quantity).toBe(2);

    expect(computeTotals(cart.lines, 'livraison', { deliveryFee: 200 })).toEqual({
      subtotal: 2800 + 400,
      deliveryFee: 200,
      total: 3400,
    });
    expect(computeTotals(cart.lines, 'emporter', { deliveryFee: 200 }).total).toBe(3200);
  });

  it('pas de frais de livraison sur une commande vide', () => {
    expect(computeTotals([], 'livraison', { deliveryFee: 200 }).total).toBe(0);
  });

  it('les suppléments sont payants et multipliés par la quantité', () => {
    const line = createLine(p('chevre-miel'), 'l1', { quantity: 2, addedToppings: [t('miel'), t('mozzarella')] });
    // (14 + 0,50 + 1) × 2
    expect(lineTotal(line)).toBe(3100);
  });

  it('retirer un ingrédient ne change pas le prix', () => {
    const line = createLine(p('royale'), 'l1', { removedIngredients: ['Olives', 'Œuf'] });
    expect(line.removedIngredients).toEqual(['Œuf']); // "Olives" n'est pas un ingrédient de la Royale
    expect(lineTotal(line)).toBe(1400);
  });

  it('une pizza offerte ne coûte rien mais ses suppléments restent payants', () => {
    const line = createLine(p('reine'), 'l1', { addedToppings: [t('oeuf')], quantity: 5 }, 'pizza');
    expect(line.quantity).toBe(1);
    expect(lineTotal(line)).toBe(100);
  });

  it('une pizza personnalisée n’est pas fusionnée avec la même pizza simple', () => {
    let cart = addProduct(emptyCart('d'), p('reine'), 'l1');
    cart = addLine(cart, createLine(p('reine'), 'l2', { removedIngredients: ['Champignons'] }));
    expect(cart.lines).toHaveLength(2);
  });

  it('modifier une ligne conserve son prix figé', () => {
    let cart = addProduct(emptyCart('d'), p('reine'), 'l1');
    cart = { ...cart, lines: [{ ...cart.lines[0], unitPrice: 1100 }] };
    cart = updateLine(cart, 'l1', { addedToppings: [t('oeuf')], note: 'bien cuite' }, p('reine'));
    expect(cart.lines[0].unitPrice).toBe(1100);
    expect(describeLine(cart.lines[0])).toEqual(['+ Œuf', 'Note : bien cuite']);
  });

  it('quantité bornée et suppression à 0', () => {
    let cart = addProduct(emptyCart('d'), p('reine'), 'l1');
    cart = setLineQuantity(cart, 'l1', 500);
    expect(cart.lines[0].quantity).toBe(99);
    cart = setLineQuantity(cart, 'l1', 0);
    expect(cart.lines).toHaveLength(0);
  });

  it('formate et lit les montants en euros', () => {
    expect(formatPrice(4800)).toBe('48,00 €');
    expect(parseEuros('2,50')).toBe(250);
    expect(parseEuros('abc')).toBeNull();
  });
});
