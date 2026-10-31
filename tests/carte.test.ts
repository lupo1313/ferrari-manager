import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createAppStore } from '../src/state/store';
import { createKeyValueRepository } from '../src/storage/repository';
import { backupToText, createBackup, readAppKeys, type BackupFile } from '../src/storage/export';
import {
  JOURNAL_FRESH_MS,
  analyzeBackupText,
  performRestore,
  planFromSafetyCopy,
  recoverInterruptedRestore,
  restoreKeys,
  type AnalyzedBackup,
  type RestorePlan,
  type StorageAccess,
} from '../src/storage/restore';
import { dryRunLoad, emptyCartText } from '../src/state/restoreDryRun';
import {
  buildProduct,
  lineCatalogState,
  productToInput,
  readCatalogDocument,
  validateProductInput,
  type ProductInput,
} from '../src/domain/catalog';
import { createLine, sameSelection, updateLine } from '../src/domain/cart';
import { computeBalance } from '../src/domain/loyalty';
import { availablePeriods, computePeriodStats } from '../src/modules/statistiques/calculs';
import { demoCatalog } from '../src/data/catalog';
import { buildDemoData } from '../src/data/seed';
import { sequentialIds } from './helpers';
import type { Product } from '../src/domain/types';

const NS = 'ferrari-manager';
const K = restoreKeys(NS);
const T0 = new Date('2026-11-01T19:00:00Z');
const ORIGIN = 'https://exemple.test/';

function memory(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  const writes: string[] = [];
  let failing: (key: string) => boolean = () => false;
  const kv: StorageAccess = {
    get length() {
      return map.size;
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      if (failing(k)) throw new Error('QuotaExceededError');
      writes.push(k);
      map.set(k, v);
    },
    removeItem: (k) => {
      if (failing(k)) throw new Error('QuotaExceededError');
      writes.push(k);
      map.delete(k);
    },
  };
  return { map, kv, writes, failOn: (f: (k: string) => boolean) => (failing = f), keys: () => readAppKeys(kv, NS) };
}

function open(kv: StorageAccess, ns = NS, prefix = 's') {
  const ids = sequentialIds();
  return createAppStore({
    repo: createKeyValueRepository(kv, `${ns}:v1`, `${ns}:v1:panier`),
    catalog: demoCatalog,
    seed: buildDemoData,
    now: () => T0,
    newId: (p) => ids(`${prefix}${p}`),
  });
}

const input = (over: Partial<ProductInput> = {}): ProductInput => ({
  name: 'Diavola',
  category: 'pizza',
  price: '13,50',
  ingredients: ['Tomate', 'Mozzarella', 'Salami piquant'],
  tags: ['speciale', 'viande'],
  description: '',
  alcohol: false,
  ...over,
});

const ok = <T,>(r: { ok: true; value: T } | { ok: false; error: string }): T => {
  if (!r.ok) throw new Error(r.error);
  return r.value;
};

describe('1. fiche produit : validation, centimes, champs par catégorie', () => {
  const products = demoCatalog.products;

  it('prix saisi en euros converti en centimes ; bornes 0,10 € à 999,99 €', () => {
    expect(validateProductInput(input({ price: '13,50' }), products).price).toBe(1350);
    expect(validateProductInput(input({ price: '13.5' }), products).price).toBe(1350);
    for (const bad of ['', 'abc', '0', '0,05', '1000', '12,345', '-3']) {
      expect(validateProductInput(input({ price: bad }), products).errors.price, bad).toBeTruthy();
    }
  });

  it('nom obligatoire, 60 caractères, pas de doublon ACTIF dans la même catégorie (accents et casse ignorés)', () => {
    expect(validateProductInput(input({ name: '  ' }), products).errors.name).toMatch(/obligatoire/);
    expect(validateProductInput(input({ name: 'x'.repeat(61) }), products).errors.name).toMatch(/60/);
    expect(validateProductInput(input({ name: 'REINE' }), products).errors.name).toMatch(/déjà/);
    expect(validateProductInput(input({ name: 'Chevre miel' }), products).errors.name).toMatch(/déjà/);
    // Même nom dans une autre catégorie, ou porté par un produit désactivé : autorisé.
    expect(validateProductInput(input({ name: 'Reine', category: 'dessert' }), products).errors.name).toBeUndefined();
    const inactive = products.map((p) => (p.id === 'reine' ? { ...p, active: false } : p));
    expect(validateProductInput(input({ name: 'Reine' }), inactive).errors.name).toBeUndefined();
    // En modification, le produit ne se compare pas à lui-même.
    expect(validateProductInput(input({ name: 'Reine' }), products, 'reine').errors.name).toBeUndefined();
  });

  it('ingrédients : 15 au plus, 40 caractères chacun, doublons retirés', () => {
    expect(validateProductInput(input({ ingredients: Array.from({ length: 16 }, (_, i) => `I${i}`) }), products).errors.ingredients).toBeTruthy();
    expect(validateProductInput(input({ ingredients: ['x'.repeat(41)] }), products).errors.ingredients).toBeTruthy();
    const p = buildProduct(input({ ingredients: ['Tomate', ' tomate ', 'Basilic'] }), 1000, 'prd_x', T0.toISOString());
    expect(p.ingredients).toEqual(['Tomate', 'Basilic']);
  });

  it('pizza : composition, description et familles ; boisson : description et alcool ; dessert : description', () => {
    const pizza = buildProduct(input(), 1350, 'prd_1', T0.toISOString());
    expect(pizza).toMatchObject({ category: 'pizza', price: 1350, description: 'Tomate, Mozzarella, Salami piquant', tags: ['speciale', 'viande'], active: true });
    const drink = buildProduct(input({ name: 'Limonade', category: 'boisson', description: 'Bouteille 33 cl', alcohol: true, ingredients: ['x'] }), 300, 'prd_2', T0.toISOString());
    expect(drink).toMatchObject({ category: 'boisson', description: 'Bouteille 33 cl', alcohol: true });
    expect(drink.ingredients).toBeUndefined();
    const dessert = buildProduct(input({ name: 'Crème', category: 'dessert', description: 'Vanille', alcohol: true }), 450, 'prd_3', T0.toISOString());
    expect(dessert.alcohol).toBeUndefined();
    expect(productToInput(pizza)).toMatchObject({ price: '13,50', ingredients: pizza.ingredients });
  });

  it('lecture stricte d’une carte enregistrée : rien n’est « réparé »', () => {
    expect(readCatalogDocument({ v: 1, products: demoCatalog.products }).ok).toBe(true);
    for (const bad of [
      null,
      { v: 2, products: [] },
      { v: 1, products: [{ ...demoCatalog.products[0] }, { ...demoCatalog.products[0] }] },
      { v: 1, products: [{ ...demoCatalog.products[0], price: 10.5 }] },
      { v: 1, products: [{ ...demoCatalog.products[0], category: 'entrée' }] },
      { v: 1, products: [{ ...demoCatalog.products[0], active: 'non' }] },
    ]) {
      expect(readCatalogDocument(bad).ok).toBe(false);
    }
  });
});

describe('2. carte enregistrée : initialisation, persistance, échecs', () => {
  it('premier lancement : carte créée une seule fois depuis les produits actuels, jamais écrasée ensuite', () => {
    const m = memory();
    open(m.kv);
    const first = m.map.get(K.carte)!;
    expect(JSON.parse(first)).toEqual({ v: 1, products: demoCatalog.products });
    const s = open(m.kv, NS, 'b');
    ok(s.updateCatalogProduct('reine', productToInput({ ...demoCatalog.products[1], price: 1290 })));
    const edited = m.map.get(K.carte);
    m.writes.length = 0;
    open(m.kv, NS, 'c');
    expect(m.writes).not.toContain(K.carte);
    expect(m.map.get(K.carte)).toBe(edited);
  });

  it('ajout, modification, désactivation, réactivation : persistés, conservés au rechargement et à la clôture du service', () => {
    const m = memory();
    const s = open(m.kv);
    const created = ok(s.addCatalogProduct(input()));
    expect(created.id).toMatch(/^.*prd_/);
    ok(s.updateCatalogProduct(created.id, input({ price: '14,00' })));
    ok(s.setCatalogProductActive('margarita', false));
    s.closeService();
    s.openService();
    const reloaded = open(m.kv, NS, 'r').getCatalog().products;
    expect(reloaded.find((p) => p.id === created.id)?.price).toBe(1400);
    expect(reloaded.find((p) => p.id === 'margarita')?.active).toBe(false);
    const r = open(m.kv, NS, 'r2');
    ok(r.setCatalogProductActive('margarita', true));
    expect(open(m.kv, NS, 'r3').getCatalog().products.find((p) => p.id === 'margarita')?.active).toBe(true);
  });

  it('aucun produit supprimé, aucun identifiant réutilisé (même après désactivation)', () => {
    const s = open(memory().kv);
    const a = ok(s.addCatalogProduct(input()));
    ok(s.setCatalogProductActive(a.id, false));
    const b = ok(s.addCatalogProduct(input()));
    expect(b.id).not.toBe(a.id);
    expect(s.getCatalog().products.filter((p) => p.id === a.id)).toHaveLength(1);
    expect(s.getCatalog().products.length).toBe(demoCatalog.products.length + 2);
  });

  it('réactivation refusée si un produit actif porte déjà ce nom dans la catégorie', () => {
    const s = open(memory().kv);
    ok(s.setCatalogProductActive('reine', false));
    ok(s.addCatalogProduct(input({ name: 'Reine' })));
    const r = s.setCatalogProductActive('reine', true);
    expect(r.ok).toBe(false);
  });

  it('stockage qui refuse l’écriture : rien n’est présenté comme enregistré, la carte affichée reste celle du rechargement', () => {
    const m = memory();
    const s = open(m.kv);
    const before = s.getCatalog();
    m.failOn((k) => k === K.carte);
    for (const r of [s.addCatalogProduct(input()), s.updateCatalogProduct('reine', input({ name: 'Reine', price: '99' })), s.setCatalogProductActive('reine', false)]) {
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/n’a pas été appliquée/);
    }
    expect(s.getCatalog()).toBe(before);
    m.failOn(() => false);
    expect(open(m.kv, NS, 'r').getCatalog().products).toEqual(before.products);
  });

  it('modification de la carte : n’écrit QUE la clé carte (historique et panier intacts)', () => {
    const m = memory();
    const s = open(m.kv);
    const doc = m.map.get(K.doc);
    const cart = m.map.get(K.cart);
    m.writes.length = 0;
    ok(s.addCatalogProduct(input()));
    ok(s.setCatalogProductActive('reine', false));
    expect(new Set(m.writes)).toEqual(new Set([K.carte]));
    expect([m.map.get(K.doc), m.map.get(K.cart)]).toEqual([doc, cart]);
  });

  it('« Réinitialiser les données de démonstration » conserve la carte', () => {
    const m = memory();
    const s = open(m.kv);
    const created = ok(s.addCatalogProduct(input()));
    s.resetDemoData();
    expect(s.getCatalog().products.some((p) => p.id === created.id)).toBe(true);
    expect(open(m.kv, NS, 'r').getCatalog().products.some((p) => p.id === created.id)).toBe(true);
  });

  it('données principales illisibles (mode protégé) : la carte ne peut pas être modifiée, rien n’est écrit', () => {
    const m = memory({ [K.doc]: '{corrompu' });
    const s = open(m.kv);
    expect(s.isStorageLocked()).toBe(true);
    expect(m.map.has(K.carte)).toBe(false);
    expect(s.addCatalogProduct(input()).ok).toBe(false);
    expect(m.map.has(K.carte)).toBe(false);
  });

  it('carte illisible : conservée intacte, aucune nouvelle sélection (pas de carte de démonstration), commandes consultables', () => {
    const base = memory();
    open(base.kv);
    const m = memory({ ...Object.fromEntries(base.map), [K.carte]: '{"v":1,"products":[{"id":"x"' });
    const s = open(m.kv, NS, 'i');
    expect(s.getCatalogError()).toMatch(/Carte des produits illisible/);
    expect(s.getPersistError()).toMatch(/Carte des produits illisible/);
    expect(s.getCatalog().products).toEqual([]);
    expect(s.addProduct('reine').ok).toBe(false);
    expect(s.addCatalogProduct(input()).ok).toBe(false);
    expect(s.getData().orders.length).toBeGreaterThan(0);
    expect(s.startEditOrder(s.getData().orders[0].id).ok).toBe(true);
    // La ligne existante reste personnalisable / diminuable, pas augmentable.
    const line = s.getData().cart.lines[0];
    expect(s.setLineQuantity(line.id, line.quantity + 1).ok).toBe(false);
    expect(m.map.get(K.carte)).toBe('{"v":1,"products":[{"id":"x"');
    // La sauvegarde copie la carte illisible telle quelle (récupérable).
    expect(readAppKeys(m.kv, NS)[K.carte]).toBe('{"v":1,"products":[{"id":"x"');
  });
});

describe('3. nouvelles sélections : produits actifs seulement', () => {
  it('produit désactivé : refusé à l’ajout, en personnalisation d’une nouvelle ligne et en récompense', () => {
    const s = open(memory().kv);
    ok(s.setCatalogProductActive('margarita', false));
    expect(s.addProduct('margarita')).toMatchObject({ ok: false, error: expect.stringMatching(/désactivé/) });
    expect(s.addConfiguredLine('margarita', {}).ok).toBe(false);
    const jean = s.getData().customers[0];
    s.selectCustomer(jean.id);
    ok(s.addProduct('reine'));
    expect(s.addReward('pizza', 'margarita').ok).toBe(false);
    expect(s.addReward('pizza', 'reine').ok).toBe(true); // éligible et actif
  });
});

describe('4. panier : lignes figées, repères, fusion stricte', () => {
  it('les nouvelles lignes figent leur composition ; une ancienne ligne n’en reçoit jamais', () => {
    const reine = demoCatalog.products.find((p) => p.id === 'reine')!;
    const line = createLine(reine, 'l1');
    expect(line.ingredients).toEqual(reine.ingredients);
    const old = { ...line, ingredients: undefined, removedIngredients: ['Champignons'] };
    delete (old as { ingredients?: string[] }).ingredients;
    const changed: Product = { ...reine, ingredients: ['Tomate', 'Jambon'] };
    const after = updateLine({ ...emptyCartFor(), lines: [old] }, 'l1', { removedIngredients: ['Champignons'], note: 'x' }, changed).lines[0];
    expect(after.removedIngredients).toEqual(['Champignons']); // retrait enregistré conservé
    expect('ingredients' in after).toBe(false); // rien de fabriqué
  });

  it('prix modifié : le produit ajouté forme une NOUVELLE ligne au nouveau prix, l’ancienne ne change pas', () => {
    const s = open(memory().kv);
    ok(s.addProduct('reine'));
    ok(s.updateCatalogProduct('reine', productToInput({ ...demoCatalog.products[1], price: 1350 })));
    ok(s.addProduct('reine'));
    const lines = s.getData().cart.lines.filter((l) => l.productId === 'reine');
    expect(lines.map((l) => [l.unitPrice, l.quantity])).toEqual([
      [1200, 1],
      [1350, 1],
    ]);
    expect(lineCatalogState(lines[0], s.product('reine'))).toEqual({ kind: 'modifie', price: 1350, name: 'Reine' });
    expect(lineCatalogState(lines[1], s.product('reine'))).toEqual({ kind: 'ok' });
  });

  it('fusion : toujours bloquée par supplément, retrait, note, récompense ; et maintenant par une fiche différente', () => {
    const reine = demoCatalog.products.find((p) => p.id === 'reine')!;
    const a = createLine(reine, 'a');
    expect(sameSelection(a, createLine(reine, 'b'))).toBe(true);
    expect(sameSelection(a, createLine({ ...reine, name: 'Reine maison' }, 'b'))).toBe(false);
    expect(sameSelection(a, createLine({ ...reine, ingredients: ['Tomate'] }, 'b'))).toBe(false);
    const s = open(memory().kv);
    ok(s.addConfiguredLine('reine', { addedToppings: [{ id: 'oeuf', name: 'Œuf', price: 100 }] }));
    ok(s.addConfiguredLine('reine', { removedIngredients: ['Champignons'] }));
    ok(s.addConfiguredLine('reine', { note: 'Bien cuite' }));
    ok(s.addProduct('reine'));
    ok(s.addProduct('reine'));
    expect(s.getData().cart.lines.map((l) => l.quantity)).toEqual([1, 1, 1, 2]);
  });

  it('personnaliser une ligne après modification de la fiche : nom, prix, catégorie et composition restent ceux de la ligne', () => {
    const s = open(memory().kv);
    ok(s.addProduct('reine'));
    const line = s.getData().cart.lines[0];
    ok(s.updateCatalogProduct('reine', { ...productToInput(s.product('reine')!), name: 'Reine 2', price: '15', category: 'dessert', description: 'x' }));
    ok(s.updateLine(line.id, { removedIngredients: ['Champignons'], addedToppings: [{ id: 'oeuf', name: 'Œuf', price: 100 }] }));
    const after = s.getData().cart.lines[0];
    expect(after).toMatchObject({ name: 'Reine', unitPrice: 1200, category: 'pizza', removedIngredients: ['Champignons'] });
    expect(after.addedToppings).toHaveLength(1);
    expect(after.ingredients).toEqual(line.ingredients);
  });

  it('produit désactivé déjà dans le panier : augmentation refusée ; diminution, suppression et personnalisation possibles', () => {
    const s = open(memory().kv);
    ok(s.addProduct('reine'));
    ok(s.addProduct('reine'));
    ok(s.addProduct('coca-33'));
    ok(s.setCatalogProductActive('reine', false));
    const line = s.getData().cart.lines[0];
    expect(s.setLineQuantity(line.id, 3)).toMatchObject({ ok: false, error: expect.stringMatching(/Quantité inchangée/) });
    expect(s.getData().cart.lines[0].quantity).toBe(2);
    expect(s.setLineQuantity(line.id, 1).ok).toBe(true);
    expect(s.updateLine(line.id, { note: 'Bien cuite' }).ok).toBe(true);
    s.removeLine(line.id);
    expect(s.getData().cart.lines.map((l) => l.productId)).toEqual(['coca-33']);
  });
});

describe('4 bis. personnalisation d’une ligne de produit désactivé (bug Samsung, aperçu 9a)', () => {
  it('quantité augmentée par la personnalisation : refusée par le store, ligne inchangée ; diminution et autres réglages possibles', () => {
    const s = open(memory().kv, NS, 'q');
    ok(s.addProduct('margarita'));
    ok(s.addProduct('margarita'));
    ok(s.setCatalogProductActive('margarita', false));
    const id = s.getData().cart.lines[0].id;
    // Scénario constaté : quantité réduite à 1, puis « + » dans la personnalisation et « Enregistrer ».
    expect(s.setLineQuantity(id, 1).ok).toBe(true);
    const before = s.getData().cart.lines[0];
    const refused = s.updateLine(id, { quantity: 2, removedIngredients: ['Basilic'], note: 'Bien cuite' });
    expect(refused).toMatchObject({ ok: false, error: expect.stringMatching(/désactivé.*Quantité inchangée/) });
    expect(s.getData().cart.lines[0]).toEqual(before);
    // Mêmes réglages sans augmentation : acceptés, quantité conservée.
    ok(s.updateLine(id, { quantity: 1, removedIngredients: ['Basilic'], note: 'Bien cuite' }));
    expect(s.getData().cart.lines[0]).toMatchObject({ quantity: 1, removedIngredients: ['Basilic'], note: 'Bien cuite', unitPrice: 1000 });
    // Diminution par la personnalisation : possible.
    ok(s.addProduct('reine'));
    ok(s.setCatalogProductActive('margarita', true));
    ok(s.setLineQuantity(id, 3));
    ok(s.setCatalogProductActive('margarita', false));
    ok(s.updateLine(id, { quantity: 2, note: 'Bien cuite' }));
    expect(s.getData().cart.lines[0].quantity).toBe(2);
  });

  it('même refus pour un produit absent de la carte ou une carte illisible', () => {
    const base = memory();
    const s0 = open(base.kv, NS, 'r');
    ok(s0.addProduct('reine'));
    s0.flushPendingWrites();
    const lineId = s0.getData().cart.lines[0].id;
    for (const carte of ['{"v":1,"products":[]}', '{coupé']) {
      const m = memory({ ...Object.fromEntries(base.map), [K.carte]: carte });
      const s = open(m.kv, NS, 'u');
      expect(s.updateLine(lineId, { quantity: 2 }).ok, carte).toBe(false);
      expect(s.getData().cart.lines[0].quantity, carte).toBe(1);
      expect(s.updateLine(lineId, { quantity: 1, note: 'ok' }).ok, carte).toBe(true);
    }
  });

  it('interface : le « + » de la personnalisation est plafonné à la quantité de la ligne', () => {
    const modal = readFileSync(new URL('../src/components/catalog/CustomizeModal.tsx', import.meta.url), 'utf8');
    expect(modal).toContain('max={canIncrease ? undefined : line?.quantity}');
    expect(modal).toContain('isActive(product)');
  });
});

describe('aller-retour de catégorie après enregistrement et rechargement', () => {
  it.each(['margarita', 'reine'])('%s conserve ingrédients, familles et historique', (id) => {
    const m = memory();
    let s = open(m.kv);
    s.selectCustomer(s.getData().customers[0].id);
    ok(s.addProduct(id));
    const order = ok(s.validateCart());
    const original = s.product(id)!;
    ok(s.updateCatalogProduct(id, { ...productToInput(original), category: 'dessert', description: 'Dessert test' }));
    s = open(m.kv);
    expect(s.product(id)!.ingredients).toBeUndefined();
    expect(s.product(id)!.tags).toBeUndefined();
    ok(s.updateCatalogProduct(id, { ...productToInput(s.product(id)!), category: 'pizza' }));
    s = open(m.kv);
    expect(s.product(id)).toMatchObject({ ingredients: original.ingredients, tags: original.tags });
    expect(s.getData().orders.find((o) => o.id === order.id)).toEqual(order);
    ok(s.startEditOrder(order.id));
    const saved = ok(s.validateCart());
    expect(saved.lines).toEqual(order.lines);
    expect(saved.totals).toEqual(order.totals);
    ok(s.updateCatalogProduct(id, { ...productToInput(s.product(id)!), category: 'dessert' }));
    expect(open(m.kv).product(id)?.description).toBe('Dessert test');
  });

  it('conserve description et alcool après Boisson → Pizza → Dessert → Boisson', () => {
    const m = memory();
    let s = open(m.kv);
    const drink = ok(s.addCatalogProduct(input({ name: 'Boisson test', category: 'boisson', description: '33 cl', alcohol: true })));
    for (const category of ['pizza', 'dessert', 'boisson'] as const) {
      ok(s.updateCatalogProduct(drink.id, { ...productToInput(s.product(drink.id)!), category }));
      s = open(m.kv);
    }
    expect(s.product(drink.id)).toMatchObject({ description: '33 cl', alcohol: true });
  });
});

describe('5. ancienne commande rouverte : aucun contenu actualisé', () => {
  it('produit modifié, recatégorisé puis désactivé : la commande rouverte et réenregistrée garde lignes et totaux', () => {
    const s = open(memory().kv);
    const c = s.getData().customers[0];
    s.selectCustomer(c.id);
    ok(s.addProduct('reine'));
    ok(s.addConfiguredLine('margarita', { removedIngredients: ['Basilic'] }));
    const order = ok(s.validateCart());
    ok(s.updateCatalogProduct('reine', { ...productToInput(s.product('reine')!), name: 'Reine XL', price: '19,90' }));
    ok(s.updateCatalogProduct('margarita', { ...productToInput(s.product('margarita')!), ingredients: ['Tomate', 'Mozzarella'] }));
    ok(s.setCatalogProductActive('reine', false));
    ok(s.startEditOrder(order.id));
    expect(s.getData().cart.lines).toEqual(order.lines);
    // Personnalisation de la margarita : son retrait « Basilic » reste possible (composition figée).
    const marg = s.getData().cart.lines.find((l) => l.productId === 'margarita')!;
    ok(s.updateLine(marg.id, { removedIngredients: ['Basilic'], note: 'Coupée en 8' }));
    const saved = ok(s.validateCart());
    expect(saved.lines.find((l) => l.productId === 'reine')).toEqual(order.lines.find((l) => l.productId === 'reine'));
    expect(saved.lines.find((l) => l.productId === 'margarita')).toMatchObject({ name: 'Margarita', unitPrice: 1000, removedIngredients: ['Basilic'], note: 'Coupée en 8' });
    expect(saved.totals).toEqual(order.totals);
  });
});

describe('6. fidélité et statistiques : jamais modifiées rétroactivement', () => {
  function scenario(changeCatalog: boolean) {
    const s = open(memory().kv, NS, changeCatalog ? 'x' : 'y');
    const c = s.getData().customers[0];
    s.selectCustomer(c.id);
    ok(s.addProduct('reine'));
    ok(s.addProduct('royale'));
    ok(s.addReward('pizza', 'margarita'));
    const order = ok(s.validateCart());
    if (changeCatalog) {
      // Désactivation de la pizza offerte et passage de la Reine en « dessert » APRÈS l'enregistrement.
      ok(s.setCatalogProductActive('margarita', false));
      ok(s.updateCatalogProduct('reine', { ...productToInput(s.product('reine')!), category: 'dessert', description: 'x' }));
    }
    // Encaissement de l'ancienne commande après le changement de carte.
    ok(s.markOrderPaid(order.id, 'carte'));
    const d = s.getData();
    const period = availablePeriods('service', d.services, false)[0];
    const stats = computePeriodStats(period, d.orders, d.services, T0.toISOString());
    return {
      balance: computeBalance(d.loyaltyEvents, c.id, d.settings.loyalty),
      events: d.loyaltyEvents.map((e) => [e.type, e.delta, e.reason]),
      order: d.orders.find((o) => o.id === order.id)!,
      stats: { ca: stats.paid, pizzas: stats.pizzas, desserts: stats.desserts, recompenses: stats.rewards, classement: stats.ranking },
    };
  }

  it('encaissement d’une ancienne commande après désactivation et changement de catégorie : mêmes droits que sans changement', () => {
    const control = scenario(false);
    const changed = scenario(true);
    expect(changed.events).toEqual(control.events);
    expect(changed.balance).toEqual(control.balance);
    expect(changed.order.lines.map((l) => [l.productId, l.category, l.reward, l.unitPrice])).toEqual(
      control.order.lines.map((l) => [l.productId, l.category, l.reward, l.unitPrice]),
    );
    expect(changed.stats).toEqual(control.stats); // ventes historiques jamais renommées ni recatégorisées
  });
});

describe('7. sauvegarde et restauration avec la carte', () => {
  async function exportOf(kv: StorageAccess) {
    return backupToText(await createBackup(kv, { now: T0, origin: ORIGIN, namespace: NS }));
  }
  async function analysis(text: string, target = NS): Promise<AnalyzedBackup> {
    const a = await analyzeBackupText(text, target);
    if (!a.ok) throw new Error(a.problems.map((p) => p.message).join(' / '));
    return a;
  }
  const planFor = (a: AnalyzedBackup): RestorePlan => ({ mode: 'fichier', docText: a.docText, cartText: emptyCartText(), carte: a.fileCarteText ?? 'conserver' });

  /** État A : carte avec un produit « Diavola » ; état B : autre carte (« Calabrese »), panier contenant ce produit. */
  function states() {
    const A = memory();
    const sa = open(A.kv, NS, 'a');
    ok(sa.addCatalogProduct(input()));
    const B = memory();
    const sb = open(B.kv, NS, 'b');
    const calabrese = ok(sb.addCatalogProduct(input({ name: 'Calabrese', price: '14' })));
    ok(sb.addProduct(calabrese.id));
    ok(sb.addProduct('reine'));
    ok(sb.updateCatalogProduct('reine', { ...productToInput(sb.product('reine')!), price: '12,80' })); // ligne « fiche modifiée »
    sb.flushPendingWrites();
    return { A, B, calabrese };
  }

  it('export : la carte est incluse (format et résumé inchangés) ; restauration : carte du fichier contrôlée puis écrite', async () => {
    const { A, B } = states();
    const text = await exportOf(A.kv);
    const file = JSON.parse(text) as BackupFile;
    expect(Object.keys(file.stockage)).toEqual([K.doc, K.carte, K.cart]);
    expect(file.formatSauvegarde).toBe(1);
    const a = await analysis(text);
    expect(a.fileCarte).toEqual({ produits: demoCatalog.products.length + 1, desactives: 0 });
    expect((await performRestore(B.kv, planFor(a), { now: T0, origin: ORIGIN, keys: K })).ok).toBe(true);
    expect(B.map.get(K.carte)).toBe(A.map.get(K.carte));
    expect(B.map.get(K.doc)).toBe(A.map.get(K.doc));
    expect(open(B.kv, NS, 'z').getCatalog().products.some((p) => p.name === 'Diavola')).toBe(true);
  });

  it('carte invalide dans un fichier : refusé', async () => {
    const { A } = states();
    A.map.set(K.carte, '{"v":1,"products":[{"id":"a","name":"A","category":"pizza","price":12.5}]}');
    const r = await analyzeBackupText(await exportOf(A.kv), NS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems[0]).toMatchObject({ kind: 'structure', message: expect.stringMatching(/Carte des produits du fichier invalide/) });
  });

  it('ancienne sauvegarde SANS carte : acceptée, carte actuelle conservée (clé non touchée)', async () => {
    const { A, B } = states();
    A.map.delete(K.carte); // fichier d'une version antérieure à la carte modifiable
    const a = await analysis(await exportOf(A.kv));
    expect(a.fileCarteText).toBeNull();
    const carteB = B.map.get(K.carte);
    expect(dryRunLoad(a.docText, emptyCartText(), carteB ?? null)).toMatchObject({ ok: true, carteError: null });
    B.writes.length = 0;
    expect((await performRestore(B.kv, planFor(a), { now: T0, origin: ORIGIN, keys: K })).ok).toBe(true);
    expect(B.writes).not.toContain(K.carte);
    expect(B.map.get(K.carte)).toBe(carteB);
  });

  it('retour arrière : carte et panier d’avant, y compris un produit absent de la carte restaurée et une ligne à fiche modifiée', async () => {
    const { A, B, calabrese } = states();
    const before = B.keys();
    await performRestore(B.kv, planFor(await analysis(await exportOf(A.kv))), { now: T0, origin: ORIGIN, keys: K });
    // Après restauration : carte A (sans Calabrese), panier vide.
    const restored = open(B.kv, NS, 'm');
    expect(restored.product(calabrese.id)).toBeUndefined();
    expect(restored.getData().cart.lines).toEqual([]);
    const plan = planFromSafetyCopy(B.map.get(K.safety)!, K)!;
    expect((await performRestore(B.kv, plan, { now: T0, origin: ORIGIN, keys: K })).ok).toBe(true);
    expect(B.keys()).toEqual(before);
    const back = open(B.kv, NS, 'n');
    const [cal, reine] = back.getData().cart.lines;
    expect(lineCatalogState(cal, back.product(cal.productId))).toEqual({ kind: 'ok' });
    expect(reine.unitPrice).toBe(1200);
    expect(lineCatalogState(reine, back.product('reine'))).toEqual({ kind: 'modifie', price: 1280, name: 'Reine' });
  });

  it('interruption à CHAQUE étape du remplacement des trois clés : au démarrage, état complet d’avant ou d’après', async () => {
    const later = T0.getTime() + JOURNAL_FRESH_MS + 1;
    // Écritures de l'opération : 0 copie, 1 trace, 2 panier, 3 carte, 4 données, 5 suppression de la trace.
    for (let crashAt = 2; crashAt <= 5; crashAt++) {
      const { A, B } = states();
      const before = B.keys();
      const a = await analysis(await exportOf(A.kv));
      let n = 0;
      let dead = false;
      B.failOn(() => {
        if (dead) return true;
        if (n++ === crashAt) dead = true;
        return dead;
      });
      await performRestore(B.kv, planFor(a), { now: T0, origin: ORIGIN, keys: K });
      B.failOn(() => false); // redémarrage : le stockage fonctionne de nouveau
      const result = recoverInterruptedRestore(B.kv, later, K);
      const after = B.keys();
      if (crashAt === 5) {
        expect(result.state, `panne ${crashAt}`).toBe('terminee');
        expect(after[K.doc]).toBe(a.docText);
        expect(after[K.carte]).toBe(a.fileCarteText);
      } else {
        expect(result.state, `panne ${crashAt}`).toBe('retablie');
        expect(after, `panne ${crashAt}`).toEqual(before);
      }
      expect(B.map.has(K.journal)).toBe(false);
      expect(open(B.kv, NS, `p${crashAt}`).getPersistError()).toBeNull();
    }
  });

  it('prévisualisation : un fichier de production avec carte est réécrit dans la carte de la prévisualisation seulement', async () => {
    const { A } = states();
    const prodFile = await exportOf(A.kv);
    const AP = restoreKeys('ferrari-manager-apercu-i3');
    const m = memory({ [K.carte]: 'CARTE-PROD', [K.doc]: 'PROD' });
    open(m.kv, 'ferrari-manager-apercu-i3', 'v');
    const a = await analysis(prodFile, 'ferrari-manager-apercu-i3');
    expect((await performRestore(m.kv, planFor(a), { now: T0, origin: ORIGIN, keys: AP })).ok).toBe(true);
    expect(m.map.get(AP.carte)).toBe(A.map.get(K.carte));
    expect([m.map.get(K.carte), m.map.get(K.doc)]).toEqual(['CARTE-PROD', 'PROD']);
  });
});

describe('8. interface (contrat)', () => {
  const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

  it('écran de restauration : carte remplacée ou conservée, annoncée explicitement', () => {
    const card = read('src/components/settings/RestoreCard.tsx');
    expect(card).toContain('Ce fichier ne contient pas de carte des produits (sauvegarde antérieure) : la carte actuelle');
    expect(card).toContain('remplacée par celle du fichier');
  });

  it('sélections : la carte, la recherche et les récompenses ne proposent que les produits actifs', () => {
    expect(read('src/components/catalog/CatalogPanel.tsx')).toContain('catalog.products.filter(isActive)');
    expect(read('src/components/layout/TopBar.tsx')).toContain('isActive(p) &&');
    expect(read('src/domain/loyalty.ts')).toContain('if (product.active === false) return false;');
  });
});

function emptyCartFor() {
  return { draftId: 'd', editingOrderId: null, customerId: null, counterName: '', mode: 'emporter' as const, requestedTime: null, lines: [], note: '' };
}
