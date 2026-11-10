import type { Product, PizzaBase } from './types';
export const BASE_LABELS: Record<PizzaBase, string> = { tomate: 'Tomate', creme: 'Crème fraîche' };
export function pizzaBaseOf(p: Pick<Product, 'pizzaBase' | 'ingredients' | 'tags'>): PizzaBase | undefined {
  if (p.pizzaBase) return p.pizzaBase;
  const ingredients = p.ingredients?.map((i) => i.toLocaleLowerCase('fr')) ?? [];
  if (ingredients.includes('crème fraîche') || p.tags?.includes('blanche')) return 'creme';
  if (ingredients.includes('sauce tomate') || ingredients.includes('tomate')) return 'tomate';
  return undefined;
}
/** La base explicite distingue aussi les pizzas homonymes sur les lignes et tickets. */
export function productLabel(p: Pick<Product, 'name' | 'category' | 'pizzaBase'>): string {
  return p.category === 'pizza' && p.pizzaBase ? p.name + ' (' + BASE_LABELS[p.pizzaBase].toLowerCase() + ')' : p.name;
}
