import { productLabel } from './productDisplay';
import type { Cart, LineTopping, OrderLine, Product, RewardKind, Topping } from './types';

export const MAX_QUANTITY = 99;

export interface LineOptions {
  quantity?: number;
  addedToppings?: LineTopping[];
  removedIngredients?: string[];
  note?: string;
}

export function emptyCart(draftId: string): Cart {
  return {
    draftId,
    editingOrderId: null,
    customerId: null,
    counterName: '',
    mode: 'emporter',
    requestedTime: null,
    lines: [],
    note: '',
    paymentPlan: null,
    deliveryTrip: null,
    deliveryAddress: null,
  };
}

function clampQuantity(quantity: number): number {
  if (!Number.isFinite(quantity)) return 1;
  return Math.min(MAX_QUANTITY, Math.max(1, Math.round(quantity)));
}

export function createLine(
  product: Product,
  id: string,
  options: LineOptions = {},
  reward: RewardKind | null = null,
): OrderLine {
  const allowedIngredients = new Set(product.ingredients ?? []);
  const line: OrderLine = {
    id,
    productId: product.id,
    name: productLabel(product),
    category: product.category,
    unitPrice: product.price,
    quantity: reward ? 1 : clampQuantity(options.quantity ?? 1),
    addedToppings: product.category === 'pizza' ? dedupeToppings(options.addedToppings ?? []) : [],
    removedIngredients: (options.removedIngredients ?? []).filter((i) => allowedIngredients.has(i)),
    note: (options.note ?? '').trim(),
    reward,
  };
  // Composition figée avec la ligne : une fiche modifiée ensuite ne la reconstruit jamais.
  if (product.ingredients && product.ingredients.length > 0) line.ingredients = [...product.ingredients];
  return line;
}

/**
 * Ingrédients retirables d'une ligne existante : sa composition figée ; pour une ligne plus ancienne
 * (sans composition enregistrée), la fiche actuelle complétée par les retraits déjà enregistrés,
 * qui ne sont jamais perdus. Rien n'est ajouté à la ligne elle-même.
 */
export function lineIngredients(line: OrderLine, product?: Product): string[] {
  if (line.ingredients) return line.ingredients;
  const list = [...(product?.legacyIngredients ?? product?.ingredients ?? [])];
  for (const i of line.removedIngredients) if (!list.includes(i)) list.push(i);
  return list;
}

const sameList = (a?: string[], b?: string[]) => (a === undefined || b === undefined ? a === b : a.length === b.length && a.every((x, i) => x === b[i]));

/** Même produit, dans le même état de fiche (nom, prix, catégorie, composition) : condition pour fusionner deux lignes. */
export function sameSelection(a: OrderLine, b: OrderLine): boolean {
  return a.productId === b.productId && a.name === b.name && a.unitPrice === b.unitPrice && a.category === b.category && sameList(a.ingredients, b.ingredients);
}

function dedupeToppings(toppings: LineTopping[]): LineTopping[] {
  const seen = new Set<string>();
  return toppings.filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)));
}

/** Ligne sans aucune personnalisation : peut être fusionnée avec une ligne identique. */
export function isPlainLine(line: OrderLine): boolean {
  return (
    !line.reward &&
    line.addedToppings.length === 0 &&
    line.removedIngredients.length === 0 &&
    line.note.trim() === ''
  );
}

/** Ajout rapide d'un produit : incrémente la ligne identique si elle existe. */
export function addProduct(cart: Cart, product: Product, newLineId: string): Cart {
  return addLine(cart, createLine(product, newLineId));
}

export function addLine(cart: Cart, line: OrderLine): Cart {
  if (isPlainLine(line)) {
    // Fusion seulement entre lignes sans personnalisation (ni supplément, ni retrait, ni note, ni récompense)
    // ET issues de la même fiche : un produit dont le prix ou le nom a changé forme une nouvelle ligne.
    const existing = cart.lines.find((l) => isPlainLine(l) && sameSelection(l, line));
    if (existing) {
      return setLineQuantity(cart, existing.id, existing.quantity + line.quantity);
    }
  }
  return { ...cart, lines: [...cart.lines, line] };
}

/**
 * Remplace les personnalisations d'une ligne existante, à partir de la LIGNE elle-même : nom, prix,
 * catégorie, récompense et composition restent ceux figés à l'ajout, même si la fiche a changé depuis.
 * `product` ne sert qu'aux anciennes lignes sans composition enregistrée (voir lineIngredients).
 */
export function updateLine(cart: Cart, lineId: string, options: LineOptions, product?: Product): Cart {
  return {
    ...cart,
    lines: cart.lines.map((l) => {
      if (l.id !== lineId) return l;
      const allowed = new Set(lineIngredients(l, product));
      return {
        ...l,
        quantity: l.reward ? 1 : clampQuantity(options.quantity ?? l.quantity),
        addedToppings: l.category === 'pizza' ? dedupeToppings(options.addedToppings ?? []) : [],
        removedIngredients: (options.removedIngredients ?? []).filter((i) => allowed.has(i)),
        note: (options.note ?? '').trim(),
      };
    }),
  };
}

export function setLineQuantity(cart: Cart, lineId: string, quantity: number): Cart {
  if (quantity < 1) return removeLine(cart, lineId);
  return {
    ...cart,
    lines: cart.lines.map((l) =>
      l.id === lineId ? { ...l, quantity: l.reward ? 1 : clampQuantity(quantity) } : l,
    ),
  };
}

export function removeLine(cart: Cart, lineId: string): Cart {
  return { ...cart, lines: cart.lines.filter((l) => l.id !== lineId) };
}

/** Ajoute un supplément à une ligne de pizza (s'applique à toutes les unités de la ligne). */
export function addToppingToLine(cart: Cart, lineId: string, topping: Topping): Cart {
  return {
    ...cart,
    lines: cart.lines.map((l) => {
      if (l.id !== lineId || l.category !== 'pizza') return l;
      if (l.addedToppings.some((t) => t.id === topping.id)) return l;
      return { ...l, addedToppings: [...l.addedToppings, { id: topping.id, name: topping.name, price: topping.price }] };
    }),
  };
}

export function rewardLineCount(lines: OrderLine[]): number {
  return lines.filter((l) => l.reward).length;
}

/** Pizzas achetées (hors pizzas offertes) : ce sont elles qui comptent pour la fidélité. */
export function paidPizzaCount(lines: OrderLine[]): number {
  return lines.filter((l) => l.category === 'pizza' && !l.reward).reduce((sum, l) => sum + l.quantity, 0);
}

export const REWARD_NEEDS_PAID_PIZZA = 'Une pizza payante est nécessaire pour bénéficier de cette récompense.';

/** Règle commerciale : une seule récompense par commande, même si le client en a plusieurs. */
export const MAX_REWARDS_PER_ORDER = 1;
export const ONE_REWARD_PER_ORDER = 'Une seule récompense fidélité par commande : les autres restent disponibles pour une prochaine commande.';

export function hasTooManyRewards(lines: OrderLine[]): boolean {
  return rewardLineCount(lines) > MAX_REWARDS_PER_ORDER;
}

/**
 * Règle commerciale : un cadeau fidélité n'est valable qu'avec au moins une pizza payante dans la commande.
 * Le cadeau s'ajoute à la commande, il ne remplace jamais une pizza payante.
 */
export function hasRewardWithoutPaidPizza(lines: OrderLine[]): boolean {
  return rewardLineCount(lines) > 0 && paidPizzaCount(lines) === 0;
}

export function withoutRewardLines(cart: Cart): Cart {
  return { ...cart, lines: cart.lines.filter((l) => !l.reward) };
}

export function itemCount(lines: OrderLine[]): number {
  return lines.reduce((sum, l) => sum + l.quantity, 0);
}

/** Quantité d'un produit déjà présente dans la commande (badge sur la carte produit). */
export function quantityOfProduct(lines: OrderLine[], productId: string): number {
  return lines.filter((l) => l.productId === productId).reduce((sum, l) => sum + l.quantity, 0);
}

/** Lignes de personnalisation lisibles, utilisées dans la commande et sur le ticket. */
export function describeLine(line: OrderLine): string[] {
  const details: string[] = [];
  for (const ingredient of line.removedIngredients) details.push(`Sans ${ingredient.toLowerCase()}`);
  for (const topping of line.addedToppings) details.push(`+ ${topping.name}`);
  if (line.note) details.push(`Note : ${line.note}`);
  return details;
}
