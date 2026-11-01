import { describe, expect, it } from 'vitest';
import { createAppStore } from '../src/state/store';
import { createKeyValueRepository } from '../src/storage/repository';
import { demoCatalog } from '../src/data/catalog';
import { buildDemoData } from '../src/data/seed';
import { sequentialIds } from './helpers';
import { validateToppingInput, toppingToInput } from '../src/domain/toppings';
import { readToppingsDocument } from '../src/domain/catalog';
import { buildKitchenTicket, buildDeliveryTicket } from '../src/domain/ticket';
import { computeTotals } from '../src/domain/pricing';
import { computeBalance } from '../src/domain/loyalty';
import { backupToText, createBackup, readAppKeys } from '../src/storage/export';
import { analyzeBackupText, performRestore, planFromSafetyCopy, recoverInterruptedRestore, restoreKeys, JOURNAL_FRESH_MS, type StorageAccess, type RestorePlan } from '../src/storage/restore';
const NS = 'ferrari-manager'; const K = restoreKeys(NS); const NOW = new Date('2026-11-01T20:00:00Z');
const ok = <T,>(r: { ok: true; value: T } | { ok: false; error: string }): T => { if (!r.ok) throw Error(r.error); return r.value; };
function memory(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial)); const writes: string[] = []; let failing: (key: string) => boolean = () => false;
  const kv: StorageAccess = { get length() { return map.size; }, key: (i) => [...map.keys()][i] ?? null, getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => { if (failing(k)) throw Error('quota'); writes.push(k); map.set(k, v); },
    removeItem: (k) => { if (failing(k)) throw Error('quota'); writes.push(k); map.delete(k); } };
  return { map, kv, writes, failOn: (f: (key: string) => boolean) => { failing = f; } };
}
function open(kv: StorageAccess, ns = NS, prefix = 'a') {
  const ids = sequentialIds();
  return createAppStore({ repo: createKeyValueRepository(kv, ns + ':v1', ns + ':v1:panier'), catalog: demoCatalog, seed: buildDemoData,
    now: () => NOW, newId: (p) => ids(prefix + p) });
}
const exportOf = async (m: ReturnType<typeof memory>) => backupToText(await createBackup(m.kv, { now: NOW, origin: 'https://test.local/', namespace: NS }));
async function planOf(m: ReturnType<typeof memory>): Promise<RestorePlan> {
  const a = await analyzeBackupText(await exportOf(m), NS); if (!a.ok) throw Error(JSON.stringify(a.problems));
  return { mode: 'fichier', docText: a.docText, cartText: null, carte: a.fileCarteText ?? 'conserver', supplements: a.fileSupplementsText ?? 'conserver' };
}
const restore = (m: ReturnType<typeof memory>, plan: RestorePlan) => performRestore(m.kv, plan, { now: NOW, origin: 'https://test.local/', keys: K });

describe('9b : fiches et persistance des suppléments', () => {
  it.each(['', 'x'.repeat(61)])('refuse le nom invalide %s', (name) => {
    expect(validateToppingInput({ name, price: '1' }, []).errors.name).toBeTruthy();
  });
  it.each(['0', '0,09', '1000', '-1', '1,234', 'NaN'])('refuse le prix invalide %s', (price) => {
    expect(validateToppingInput({ name: 'Truffe', price }, []).errors.price).toBeTruthy();
  });
  it('ajout et modification : centimes, doublons sans accents/casse, réactivation et identifiants réservés', () => {
    const m = memory(), s = open(m.kv);
    const t = ok(s.addCatalogTopping({ name: '  Crème   fraîche ', price: '1,25' }));
    expect(t).toMatchObject({ name: 'Crème fraîche', price: 125, active: true });
    expect(s.addCatalogTopping({ name: 'CREME FRAICHE', price: '1' }).ok).toBe(false);
    ok(s.setCatalogToppingActive(t.id, false));
    const second = ok(s.addCatalogTopping({ name: 'crème fraîche', price: '2' }));
    expect(second.id).not.toBe(t.id);
    expect(s.setCatalogToppingActive(t.id, true).ok).toBe(false);
    ok(s.updateCatalogTopping(t.id, { name: 'Crème épaisse', price: '1,75' }));
    ok(s.setCatalogToppingActive(t.id, true));
    expect(open(m.kv).topping(t.id)).toMatchObject({ name: 'Crème épaisse', price: 175, active: true });
    expect(s.updateCatalogTopping('absent', { name: 'X', price: '1' }).ok).toBe(false);
  });
  it('ancienne carte 9a : valeurs par défaut en mémoire, aucune réécriture au chargement', () => {
    const m = memory(); open(m.kv);
    const old = JSON.stringify({ v: 1, products: demoCatalog.products }); m.map.set(K.carte, old); m.writes.length = 0;
    expect(open(m.kv).getCatalog().toppings).toEqual(demoCatalog.toppings);
    expect(m.map.get(K.carte)).toBe(old); expect(m.writes).toEqual([]);
  });
  it('échec écriture : ni mémoire ni stockage modifiés ; seule la clé suppléments est écrite en cas de succès', () => {
    const m = memory(), s = open(m.kv); const before = s.getCatalog(); const raw = m.map.get(K.supplements);
    m.writes.length = 0; m.failOn((k) => k === K.supplements);
    expect(s.updateCatalogTopping('oeuf', { name: 'Œuf bio', price: '1,20' }).ok).toBe(false);
    expect(s.addCatalogTopping({ name: 'Truffe', price: '3' }).ok).toBe(false);
    expect(s.setCatalogToppingActive('oeuf', false).ok).toBe(false);
    expect(s.getCatalog()).toBe(before); expect(m.map.get(K.supplements)).toBe(raw);
    m.failOn(() => false); ok(s.updateCatalogTopping('oeuf', { name: 'Œuf bio', price: '1,20' }));
    expect(new Set(m.writes)).toEqual(new Set([K.supplements]));
    s.closeService(); s.openService(); s.resetDemoData();
    expect(open(m.kv).topping('oeuf')?.price).toBe(120);
  });
  it.each([null, [{ id: 'a', name: 'A', price: 1.2 }], [{ id: 'a', name: 'A', price: 100 }, { id: 'a', name: 'B', price: 100 }]])('carte illisible préservée et ajouts bloqués', (toppings) => {
    const m = memory(); open(m.kv); const raw = JSON.stringify({ v: 1, toppings }); m.map.set(K.supplements, raw);
    const s = open(m.kv); expect(s.getCatalogError()).toBeTruthy();
    expect(s.addConfiguredLine('reine', { addedToppings: [{ id: 'oeuf', name: 'Œuf', price: 100 }] }).ok).toBe(false);
    expect(s.addCatalogTopping({ name: 'Truffe', price: '3' }).ok).toBe(false); expect(m.map.get(K.supplements)).toBe(raw);
    expect(readToppingsDocument(JSON.parse(raw)).ok).toBe(false);
  });
  it('stockage protégé et restauration en cours : modifications des suppléments refusées', () => {
    const m = memory({ [K.doc]: '{cassé' }); const s = open(m.kv);
    expect(s.addCatalogTopping({ name: 'Truffe', price: '3' }).ok).toBe(false);
    const normal = open(memory().kv); normal.suspendWrites('Restauration');
    expect(normal.setCatalogToppingActive('oeuf', false).ok).toBe(false);
  });
});

describe('9b : lignes figées et refus des contournements', () => {
  it('nouveau nom/prix seulement aux prochaines sélections ; copies existantes préservées même pendant la personnalisation', () => {
    const m = memory(), s = open(m.kv); ok(s.addProduct('reine')); const id = s.getData().cart.lines[0].id;
    ok(s.addToppingToLine(id, 'oeuf')); const old = s.getData().cart.lines[0];
    ok(s.updateCatalogTopping('oeuf', { name: 'Œuf bio', price: '1,80' }));
    ok(s.updateLine(id, { note: 'Bien cuite', addedToppings: [{ id: 'oeuf', name: 'faux', price: 0 }] }));
    expect(s.getData().cart.lines[0].addedToppings).toEqual(old.addedToppings);
    ok(s.addConfiguredLine('reine', { addedToppings: [{ id: 'oeuf', name: 'faux', price: 0 }] }));
    expect(s.getData().cart.lines[1].addedToppings[0]).toEqual({ id: 'oeuf', name: 'Œuf bio', price: 180 });
    expect(computeTotals(s.getData().cart.lines).total).toBe(2680);
    s.flushPendingWrites(); expect(open(m.kv).getData().cart.lines).toEqual(s.getData().cart.lines);
  });
  it('désactivé : refus ajout direct, nouvelle personnalisation, augmentation panier ou personnalisation ; diminution/retrait possibles', () => {
    const s = open(memory().kv); ok(s.addProduct('reine')); const id = s.getData().cart.lines[0].id;
    ok(s.setLineQuantity(id, 2)); ok(s.addToppingToLine(id, 'oeuf')); ok(s.setCatalogToppingActive('oeuf', false));
    const before = s.getData().cart.lines;
    expect(s.addToppingToLine(id, 'oeuf').ok).toBe(false);
    expect(s.addConfiguredLine('reine', { addedToppings: [{ id: 'oeuf', name: 'Œuf', price: 100 }] }).ok).toBe(false);
    expect(s.setLineQuantity(id, 3).ok).toBe(false);
    expect(s.updateLine(id, { quantity: 3, addedToppings: before[0].addedToppings }).ok).toBe(false);
    expect(s.getData().cart.lines).toBe(before);
    ok(s.updateLine(id, { quantity: 1, note: 'Bien cuite', addedToppings: before[0].addedToppings }));
    expect(s.getData().cart.lines[0].addedToppings).toEqual(before[0].addedToppings);
    ok(s.updateLine(id, { quantity: 2, addedToppings: [] })); // sans supplément désactivé : augmentation autorisée
    expect(s.getData().cart.lines[0]).toMatchObject({ quantity: 2, addedToppings: [] });
    ok(s.setCatalogToppingActive('oeuf', true)); ok(s.addToppingToLine(id, 'oeuf'));
    s.removeLine(id); expect(s.getData().cart.lines).toEqual([]);
  });
  it('supplément absent de la carte : copie visible et retirable, quantité non augmentable', () => {
    const m = memory(), s = open(m.kv); ok(s.addProduct('reine')); const id = s.getData().cart.lines[0].id; ok(s.addToppingToLine(id, 'oeuf')); s.flushPendingWrites();
    m.map.set(K.supplements, JSON.stringify({ v: 1, toppings: [] })); const r = open(m.kv);
    expect(r.setLineQuantity(id, 2).ok).toBe(false); expect(r.updateLine(id, { quantity: 2 }).ok).toBe(false);
    ok(r.updateLine(id, { note: 'Bien cuite' })); expect(r.getData().cart.lines[0].addedToppings[0].price).toBe(100);
    ok(r.updateLine(id, { addedToppings: [] })); expect(r.getData().cart.lines[0].addedToppings).toEqual([]);
  });
  it('commande historique rouverte : lignes, totaux, tickets et fidélité conservés après renommage/prix/désactivation', () => {
    const s = open(memory().kv); const client = s.getData().customers[0]; s.selectCustomer(client.id); s.setMode('livraison'); ok(s.addProduct('reine'));
    const id = s.getData().cart.lines[0].id; ok(s.addToppingToLine(id, 'oeuf')); const order = ok(s.validateCart());
    const kitchen = buildKitchenTicket(order, s.getData().settings), delivery = buildDeliveryTicket(order, s.getData().settings);
    const balance = computeBalance(s.getData().loyaltyEvents, client.id, s.getData().settings.loyalty);
    ok(s.updateCatalogTopping('oeuf', { name: 'Œuf bio', price: '1,80' })); ok(s.setCatalogToppingActive('oeuf', false));
    ok(s.startEditOrder(order.id)); expect(s.getData().cart.lines).toEqual(order.lines); const saved = ok(s.validateCart());
    expect(saved.lines).toEqual(order.lines); expect(saved.totals).toEqual(order.totals);
    expect(buildKitchenTicket(saved, s.getData().settings)).toEqual({ ...kitchen, revisionLabel: 'MODIFIÉE (version 2)' }); expect(buildDeliveryTicket(saved, s.getData().settings)).toEqual({ ...delivery, revisionLabel: 'MODIFIÉE (version 2)' });
    expect(computeBalance(s.getData().loyaltyEvents, client.id, s.getData().settings.loyalty)).toEqual(balance);
  });
  it('pizza offerte : supplément toujours payant et aucune modification du crédit des pizzas', () => {
    const s = open(memory().kv); s.selectCustomer(s.getData().customers[0].id); ok(s.addProduct('reine')); ok(s.addReward('pizza', 'margarita'));
    const gift = s.getData().cart.lines.find((l) => l.reward)!; ok(s.addToppingToLine(gift.id, 'oeuf'));
    expect(computeTotals(s.getData().cart.lines).total).toBe(1300);
  });
});

describe('9b : sauvegardes, restauration et isolation', () => {
  it('nouvelle sauvegarde : liste et états restaurés, historique à son ancien prix ; retour à la copie complet', async () => {
    const a = memory(), s = open(a.kv); ok(s.addProduct('reine')); ok(s.addToppingToLine(s.getData().cart.lines[0].id, 'oeuf')); const order = ok(s.validateCart());
    ok(s.updateCatalogTopping('oeuf', { name: 'Œuf bio', price: '1,80' })); ok(s.setCatalogToppingActive('oeuf', false));
    const b = memory(), sb = open(b.kv, NS, 'b'); const extra = ok(sb.addCatalogTopping({ name: 'Truffe', price: '3' })); const before = readAppKeys(b.kv, NS);
    const plan = await planOf(a); expect((await restore(b, plan)).ok).toBe(true); const restored = open(b.kv);
    expect(restored.topping('oeuf')).toMatchObject({ price: 180, active: false });
    expect(restored.getData().orders.find((o) => o.id === order.id)?.totals.total).toBe(1300);
    expect((await restore(b, planFromSafetyCopy(b.map.get(K.safety)!, K)!)).ok).toBe(true);
    expect(readAppKeys(b.kv, NS)).toEqual(before); expect(open(b.kv).topping(extra.id)).toBeDefined();
  });
  it.each(['sans-carte', 'carte-9a'])('ancienne sauvegarde %s : suppléments actuels conservés et information explicite', async (variant) => {
    const a = memory(); open(a.kv); a.map.delete(K.supplements); if (variant === 'sans-carte') a.map.delete(K.carte);
    else a.map.set(K.carte, JSON.stringify({ v: 1, products: demoCatalog.products }));
    const b = memory(), s = open(b.kv, NS, 'b'); const added = ok(s.addCatalogTopping({ name: 'Truffe', price: '3' }));
    const aText = await exportOf(a); const analyzed = await analyzeBackupText(aText, NS); expect(analyzed.ok).toBe(true);
    if (!analyzed.ok) return; expect(analyzed.notes.join(' ')).toMatch(/suppléments actuels seront conservés/);
    expect((await restore(b, await planOf(a))).ok).toBe(true);
    expect(open(b.kv).topping(added.id)).toEqual(added);
  });
  it('liste illisible dans une sauvegarde : refus ; ancien fichier et carte actuelle illisible : aucune écriture', async () => {
    const a = memory(); open(a.kv); a.map.set(K.supplements, JSON.stringify({ v: 1, toppings: 'cassé' }));
    expect((await analyzeBackupText(await exportOf(a), NS)).ok).toBe(false);

  });
  it('reprise après interruption : les suppléments retrouvent les valeurs complètes d’avant', async () => {
    const a = memory(); ok(open(a.kv).updateCatalogTopping('oeuf', { name: 'Œuf source', price: '1,50' })); const b = memory(), s = open(b.kv, NS, 'b'); ok(s.updateCatalogTopping('oeuf', { name: 'Œuf bio', price: '2' })); const before = readAppKeys(b.kv, NS);
    let n = 0, dead = false; b.failOn(() => { if (n++ === 5) dead = true; return dead; });
    await restore(b, await planOf(a)); b.failOn(() => false);
    expect(recoverInterruptedRestore(b.kv, NOW.getTime() + JOURNAL_FRESH_MS + 1, K).state).toBe('retablie');
    expect(readAppKeys(b.kv, NS)).toEqual(before); expect(open(b.kv).topping('oeuf')?.price).toBe(200);
  });
  it('prévisualisation : aucune clé de production touchée et paramètres de produit 9a préservés', () => {
    const m = memory(); open(m.kv); const before = readAppKeys(m.kv, NS); const s = open(m.kv, 'ferrari-manager-apercu-i3');
    ok(s.updateCatalogTopping('oeuf', { name: 'Œuf bio', price: '2' }));
    expect(readAppKeys(m.kv, NS)).toEqual(before);
    expect(open(m.kv, 'ferrari-manager-apercu-i3').getCatalog().products).toEqual(demoCatalog.products);
    expect(toppingToInput(s.topping('oeuf')!)).toEqual({ name: 'Œuf bio', price: '2,00' });
  });
});


describe('9b : isolation et atomicité des quatre clés', () => {
  it('une réécriture des produits par 9a préserve les réglages des suppléments', () => {
    const m = memory(), s = open(m.kv);
    ok(s.updateCatalogTopping('oeuf', { name: 'Œuf bio', price: '1,80' }));
    const raw = m.map.get(K.supplements);
    m.map.set(K.carte, JSON.stringify({ v: 1, products: demoCatalog.products }));
    expect(open(m.kv).topping('oeuf')).toMatchObject({ name: 'Œuf bio', price: 180 });
    expect(m.map.get(K.supplements)).toBe(raw);
  });
  it.each([2, 3, 4, 5])('panne à l’écriture %i : retour immédiat exact des quatre clés', async (step) => {
    const a = memory(), sa = open(a.kv);
    ok(sa.updateCatalogTopping('oeuf', { name: 'Œuf fichier', price: '1,50' }));
    const b = memory(), sb = open(b.kv, NS, 'b');
    ok(sb.updateCatalogTopping('oeuf', { name: 'Œuf actuel', price: '2' }));
    const before = readAppKeys(b.kv, NS); let n = 0;
    b.failOn(() => ++n === step);
    expect(await restore(b, await planOf(a))).toMatchObject({ ok: false, changed: false });
    expect(readAppKeys(b.kv, NS)).toEqual(before);
  });
  it('ancienne sauvegarde : clé suppléments illisible conservée exactement, sans écriture', async () => {
    const a = memory(); open(a.kv); a.map.delete(K.supplements); const b = memory(); open(b.kv);
    b.map.set(K.supplements, '{cassé');
    expect((await restore(b, await planOf(a))).ok).toBe(true);
    expect(b.map.get(K.supplements)).toBe('{cassé');
    expect(open(b.kv).getCatalogError()).toBeTruthy();
  });
});
