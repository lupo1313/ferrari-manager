import type { LineTopping, OrderLine, Topping } from './types';
import { isActive, PRODUCT_LIMITS } from './catalog';
import { parseEuros } from './money';
export interface ToppingInput { name: string; price: string }
export type ToppingErrors = Partial<Record<'name' | 'price', string>>;
const folded = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toLowerCase();
export function validateToppingInput(input: ToppingInput, toppings: Topping[], editingId?: string) {
  const errors: ToppingErrors = {};
  const name = input.name.trim().replace(/\s+/g, ' ');
  if (!name) errors.name = 'Nom obligatoire.';
  else if (name.length > PRODUCT_LIMITS.name) errors.name = '60 caractères au plus.';
  else if (toppings.some((t) => t.id !== editingId && isActive(t) && folded(t.name) === folded(name))) errors.name = 'Un supplément actif porte déjà ce nom.';
  const price = parseEuros(input.price);
  if (price === null || price < PRODUCT_LIMITS.minPrice || price > PRODUCT_LIMITS.maxPrice) errors.price = 'Prix entre 0,10 € et 999,99 € (ex. : 1,50).';
  return { errors, name, price: Object.keys(errors).length ? null : price };
}
export const toppingToInput = (t: Topping): ToppingInput => ({ name: t.name, price: (t.price / 100).toFixed(2).replace('.', ',') });
export function unavailableTopping(line: Pick<OrderLine, 'addedToppings'>, toppings: Topping[]): boolean {
  return line.addedToppings.some((t) => !toppings.some((current) => current.id === t.id && isActive(current)));
}
/** Fige les nouvelles sélections aux valeurs actuelles ; garde exactement les copies déjà présentes. */
export function selectedToppings(requested: LineTopping[], catalog: Topping[], previous: LineTopping[] = []):
  { ok: true; value: LineTopping[] } | { ok: false; error: string } {
  const result: LineTopping[] = [];
  for (const t of requested) {
    if (result.some((x) => x.id === t.id)) continue;
    const old = previous.find((x) => x.id === t.id);
    if (old) { result.push({ ...old }); continue; }
    const current = catalog.find((x) => x.id === t.id);
    if (!current || !isActive(current)) return { ok: false, error: 'Supplément désactivé ou absent : nouvelle sélection impossible.' };
    result.push({ id: current.id, name: current.name, price: current.price });
  }
  return { ok: true, value: result };
}
