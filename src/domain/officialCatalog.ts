import type { Product } from './types';
import { demoCatalog } from '../data/catalog';
import { officialPizzas } from '../data/officialCatalog';
import { pizzaBaseOf } from './productDisplay';
import { isActive } from './catalog';

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');
export interface OfficialPlan {
  products: Product[];
  updated: { before: Product; after: Product }[];
  added: Product[];
  retired: Product[];
  retained: Product[];
}
/** Préparation pure : aucun écrit et aucun effacement. Les 39 fiches proposées sont montrées avant application. */
export function planOfficialCatalog(current: Product[], at: string): OfficialPlan {
  const used = new Set<string>();
  const ids = new Set(current.map((p) => p.id));
  const updated: OfficialPlan['updated'] = []; const added: Product[] = [];
  const official = officialPizzas.map((p) => {
    const byId = current.find((old) => old.id === p.id && old.category === 'pizza');
    const candidates = current.filter((old) => old.category === 'pizza' && !used.has(old.id) &&
      (fold(old.name) === fold(p.name) || (p.name === 'Ferrari' && fold(old.name) === 'dany')) &&
      (!pizzaBaseOf(old) || pizzaBaseOf(old) === p.pizzaBase));
    if (!byId && candidates.length > 1) throw new Error('Plusieurs fiches correspondent à ' + p.name + '. Renommez les doublons avant application.');
    const before = byId ?? candidates[0];
    if (before) {
      used.add(before.id);
      const after: Product = { ...before, ...p, id: before.id, active: true, updatedAt: at, deactivatedAt: null,
        legacyIngredients: [...(before.legacyIngredients ?? before.ingredients ?? [])] };
      updated.push({ before, after }); return after;
    }
    let id = p.id;
    while (ids.has(id)) id = 'officiel-' + id;
    ids.add(id); used.add(id);
    const after: Product = { ...p, id, active: true, createdAt: at, updatedAt: at, deactivatedAt: null };
    added.push(after); return after;
  });
  const demoIds = new Set(demoCatalog.products.filter((p) => p.category === 'pizza').map((p) => p.id));
  const retired: Product[] = []; const retained: Product[] = [];
  const others = current.filter((p) => !used.has(p.id)).map((p) => {
    if (p.category === 'pizza' && demoIds.has(p.id) && isActive(p)) {
      retired.push(p); return { ...p, active: false, updatedAt: at, deactivatedAt: at };
    }
    retained.push(p); return p;
  });
  return { products: [...official, ...others], updated, added, retired, retained };
}
