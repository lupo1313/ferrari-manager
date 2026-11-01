import type { CatalogDocument, Cents, OrderLine, PizzaTag, Product, ProductCategory, Topping } from './types';
import { parseEuros } from './money';

/**
 * Carte des produits modifiable depuis Paramètres (intervention 9a). Règles :
 * - un produit n'est jamais supprimé ni son identifiant réutilisé ; il peut être désactivé puis réactivé ;
 * - une modification ne concerne que les NOUVELLES sélections : les lignes déjà dans un panier ou une
 *   commande gardent leur nom, prix, catégorie et composition figés (voir domain/cart.ts) ;
 * - montants en centimes entiers, saisis en euros (« 12,50 »).
 */

export const CATALOG_VERSION = 1;

export const PRODUCT_CATEGORIES: readonly ProductCategory[] = ['pizza', 'boisson', 'dessert'];
export const PIZZA_TAGS: readonly PizzaTag[] = ['classique', 'speciale', 'blanche', 'viande', 'vegetarienne'];

export const CATEGORY_LABELS: Record<ProductCategory, string> = { pizza: 'Pizza', boisson: 'Boisson', dessert: 'Dessert' };
export const TAG_LABELS: Record<PizzaTag, string> = {
  classique: 'Classique',
  speciale: 'Spéciale',
  blanche: 'Blanche',
  viande: 'Viande',
  vegetarienne: 'Végétarienne',
};

export const PRODUCT_LIMITS = {
  name: 60,
  ingredient: 40,
  ingredients: 15,
  description: 120,
  minPrice: 10, // 0,10 €
  maxPrice: 99_999, // 999,99 €
} as const;

export const isActive = (p: Pick<Product, 'active'>) => p.active !== false;

export interface ProductInput {
  name: string;
  category: ProductCategory;
  /** Prix saisi en euros (« 12,50 »). */
  price: string;
  ingredients: string[];
  tags: PizzaTag[];
  description: string;
  alcohol: boolean;
}

export type ProductField = 'name' | 'category' | 'price' | 'ingredients' | 'description';
export type ProductErrors = Partial<Record<ProductField, string>>;

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

const cleanList = (list: string[]) => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const v = raw.trim().replace(/\s+/g, ' ');
    if (v && !seen.has(fold(v))) {
      seen.add(fold(v));
      out.push(v);
    }
  }
  return out;
};

/**
 * Contrôle d'une saisie. `products` : toute la carte (actifs et désactivés) ; `editingId` : produit modifié.
 * Renvoie les erreurs par champ et, si tout est valide, le prix en centimes.
 */
export function validateProductInput(input: ProductInput, products: Product[], editingId?: string): { errors: ProductErrors; price: Cents | null } {
  const errors: ProductErrors = {};
  const name = input.name.trim().replace(/\s+/g, ' ');
  if (!name) errors.name = 'Nom obligatoire.';
  else if (name.length > PRODUCT_LIMITS.name) errors.name = `${PRODUCT_LIMITS.name} caractères au plus.`;
  else if (products.some((p) => p.id !== editingId && isActive(p) && p.category === input.category && fold(p.name) === fold(name))) {
    errors.name = 'Un produit actif porte déjà ce nom dans cette catégorie.';
  }
  if (!PRODUCT_CATEGORIES.includes(input.category)) errors.category = 'Catégorie invalide.';
  const price = parseEuros(input.price);
  if (price === null || !Number.isInteger(price)) errors.price = 'Prix invalide (ex. : 12,50).';
  else if (price < PRODUCT_LIMITS.minPrice || price > PRODUCT_LIMITS.maxPrice) errors.price = 'Prix entre 0,10 € et 999,99 €.';
  const ingredients = cleanList(input.ingredients);
  if (ingredients.length > PRODUCT_LIMITS.ingredients) errors.ingredients = `${PRODUCT_LIMITS.ingredients} ingrédients au plus.`;
  else if (ingredients.some((i) => i.length > PRODUCT_LIMITS.ingredient)) errors.ingredients = `${PRODUCT_LIMITS.ingredient} caractères au plus par ingrédient.`;
  if (input.description.trim().length > PRODUCT_LIMITS.description) errors.description = `${PRODUCT_LIMITS.description} caractères au plus.`;
  return { errors, price: Object.keys(errors).length ? null : price };
}

/** Champs propres à chaque catégorie : composition et familles pour les pizzas, description pour les autres, alcool pour les boissons. */
function fieldsFor(input: ProductInput, price: Cents): Omit<Product, 'id' | 'active' | 'createdAt' | 'updatedAt' | 'deactivatedAt'> {
  const name = input.name.trim().replace(/\s+/g, ' ');
  if (input.category === 'pizza') {
    const ingredients = cleanList(input.ingredients);
    return {
      name,
      category: 'pizza',
      price,
      ingredients,
      description: ingredients.join(', '),
      tags: PIZZA_TAGS.filter((t) => input.tags.includes(t)),
    };
  }
  const description = input.description.trim();
  return {
    name,
    category: input.category,
    price,
    ...(description ? { description } : {}),
    ...(input.category === 'boisson' ? { alcohol: input.alcohol } : {}),
  };
}

export function buildProduct(input: ProductInput, price: Cents, id: string, nowIso: string): Product {
  return { id, ...fieldsFor(input, price), active: true, createdAt: nowIso, updatedAt: nowIso, deactivatedAt: null };
}

/** Nouvelle fiche : l'identifiant, l'état actif et les dates d'origine sont conservés. */
export function applyProductInput(product: Product, input: ProductInput, price: Cents, nowIso: string): Product {
  const kept: Partial<Product> = {};
  if (product.active !== undefined) kept.active = product.active;
  if (product.createdAt) kept.createdAt = product.createdAt;
  if (product.deactivatedAt !== undefined) kept.deactivatedAt = product.deactivatedAt;
  return {
    id: product.id, ...fieldsFor(input, price), ...kept, updatedAt: nowIso,
    categoryMemory: {
      ingredients: cleanList(input.ingredients),
      tags: PIZZA_TAGS.filter((t) => input.tags.includes(t)),
      description: input.description.trim(),
      alcohol: input.alcohol,
    },
  };
}

export function setProductActive(product: Product, active: boolean, nowIso: string): Product {
  return { ...product, active, updatedAt: nowIso, deactivatedAt: active ? null : nowIso };
}

export function productToInput(p: Product): ProductInput {
  return {
    name: p.name,
    category: p.category,
    price: (p.price / 100).toFixed(2).replace('.', ','),
    ingredients: [...(p.ingredients ?? p.categoryMemory?.ingredients ?? [])],
    tags: [...(p.tags ?? p.categoryMemory?.tags ?? [])],
    description: p.category === 'pizza' ? p.categoryMemory?.description ?? '' : p.description ?? '',
    alcohol: p.category === 'boisson' ? Boolean(p.alcohol) : p.categoryMemory?.alcohol ?? false,
  };
}

export function catalogDocument(products: Product[], toppings?: Topping[]): CatalogDocument {
  return { v: CATALOG_VERSION, products, ...(toppings === undefined ? {} : { toppings }) };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStringList = (v: unknown) => Array.isArray(v) && v.every((x) => typeof x === 'string');

/**
 * Lecture stricte d'une carte enregistrée (stockage ou fichier de sauvegarde). Une carte invalide n'est
 * jamais « réparée » : elle est refusée et laissée intacte.
 */
export function readCatalogDocument(raw: unknown): { ok: true; products: Product[]; toppings?: Topping[] } | { ok: false; reason: string } {
  if (!isObject(raw) || raw.v !== CATALOG_VERSION || !Array.isArray(raw.products)) return { ok: false, reason: 'format de carte inconnu' };
  const ids = new Set<string>();
  for (const [i, p] of (raw.products as unknown[]).entries()) {
    const who = `produit n° ${i + 1}`;
    if (!isObject(p) || typeof p.id !== 'string' || !p.id.trim()) return { ok: false, reason: `${who} : identifiant manquant` };
    if (ids.has(p.id)) return { ok: false, reason: `produit ${p.id} en double` };
    ids.add(p.id);
    if (typeof p.name !== 'string' || !p.name.trim()) return { ok: false, reason: `produit ${p.id} : nom manquant` };
    if (!PRODUCT_CATEGORIES.includes(p.category as ProductCategory)) return { ok: false, reason: `produit ${p.id} : catégorie inconnue` };
    if (typeof p.price !== 'number' || !Number.isInteger(p.price) || p.price < 0) return { ok: false, reason: `produit ${p.id} : prix invalide (centimes entiers)` };
    if (p.ingredients !== undefined && !isStringList(p.ingredients)) return { ok: false, reason: `produit ${p.id} : ingrédients invalides` };
    if (p.tags !== undefined && !(Array.isArray(p.tags) && p.tags.every((t) => PIZZA_TAGS.includes(t as PizzaTag)))) return { ok: false, reason: `produit ${p.id} : familles invalides` };
    if (p.description !== undefined && typeof p.description !== 'string') return { ok: false, reason: `produit ${p.id} : description invalide` };
    if (p.alcohol !== undefined && typeof p.alcohol !== 'boolean') return { ok: false, reason: `produit ${p.id} : indication alcool invalide` };
    if (p.categoryMemory !== undefined) {
      const m = p.categoryMemory;
      if (!isObject(m) || !isStringList(m.ingredients) ||
        !(Array.isArray(m.tags) && m.tags.every((t) => PIZZA_TAGS.includes(t as PizzaTag))) ||
        typeof m.description !== 'string' || typeof m.alcohol !== 'boolean') {
        return { ok: false, reason: `produit ${p.id} : champs mémorisés invalides` };
      }
    }
    if (p.active !== undefined && typeof p.active !== 'boolean') return { ok: false, reason: `produit ${p.id} : état invalide` };
  }
  if (raw.toppings !== undefined) {
    if (!Array.isArray(raw.toppings)) return { ok: false, reason: 'liste des suppléments invalide' };
    const toppingIds = new Set<string>();
    const names = new Set<string>();
    for (const t of raw.toppings) {
      if (!isObject(t) || typeof t.id !== 'string' || !t.id.trim() || toppingIds.has(t.id) ||
        typeof t.name !== 'string' || !t.name.trim() || typeof t.price !== 'number' || !Number.isInteger(t.price) || t.price < 0 ||
        (t.active !== undefined && typeof t.active !== 'boolean')) return { ok: false, reason: 'supplément invalide ou identifiant en double' };
      toppingIds.add(t.id);
      if (t.active !== false) {
        const name = fold(t.name);
        if (names.has(name)) return { ok: false, reason: 'suppléments actifs de même nom' };
        names.add(name);
      }
    }
  }
  return { ok: true, products: raw.products as Product[], ...(raw.toppings === undefined ? {} : { toppings: raw.toppings as Topping[] }) };
}

/** État d'une ligne par rapport à la carte actuelle (repère affiché dans le panier ; la ligne n'est jamais modifiée). */
export type LineCatalogState = { kind: 'ok' } | { kind: 'absent' } | { kind: 'desactive' } | { kind: 'modifie'; price: Cents; name: string };

export function lineCatalogState(line: OrderLine, product: Product | undefined): LineCatalogState {
  if (!product) return { kind: 'absent' };
  if (!isActive(product)) return { kind: 'desactive' };
  if (product.price !== line.unitPrice || product.name !== line.name || product.category !== line.category) {
    return { kind: 'modifie', price: product.price, name: product.name };
  }
  return { kind: 'ok' };
}

/** Liste indépendante : les versions 9a ne réécrivent jamais cette clé. */
export function readToppingsDocument(raw: unknown): { ok: true; toppings: Topping[] } | { ok: false; reason: string } {
  if (!isObject(raw) || raw.v !== 1 || !Array.isArray(raw.toppings)) return { ok: false, reason: 'format des suppléments inconnu' };
  const read = readCatalogDocument({ v: 1, products: [], toppings: raw.toppings });
  return read.ok ? { ok: true, toppings: read.toppings! } : read;
}
