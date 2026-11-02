import { describe, expect, it, vi } from 'vitest';
import { buildDemoData } from '../src/data/seed';
import { demoCatalog } from '../src/data/catalog';
import { createAppStore } from '../src/state/store';
import { createKeyValueRepository } from '../src/storage/repository';
import { sequentialIds } from './helpers';
import { closedState, closureBlockers, exportsConfirmed } from '../src/domain/closure';
import { computeBalance, customerLoyaltyStatus, rewardsRemainingForCart } from '../src/domain/loyalty';
import { emptyCart } from '../src/domain/cart';
import { createLine } from '../src/domain/cart';
import { markPaid } from '../src/domain/payment';
import { serviceReport } from '../src/domain/serviceReport';
import { buildServicePdf } from '../src/services/servicePdf';
import { checkClosureTabs, closureKey, commitClosure, prepareClosure, recoverClosure } from '../src/storage/closure';
import { analyzeBackupText, performRestore, restoreKeys, type StorageAccess } from '../src/storage/restore';
import { createBackup, backupToText, readAppKeys } from '../src/storage/export';
import { dryRunLoad } from '../src/state/restoreDryRun';
import type { TabPresence } from '../src/storage/tabs';
const NS = 'ferrari-manager', K = restoreKeys(NS), AT = new Date('2026-11-01T22:30:00Z');
const yes = { report: true, backup: true }, no = { report: false, backup: false };
function memory() {
  const map = new Map<string, string>(); let n = 0, fail: (key: string, n: number) => boolean = () => false;
  const kv: StorageAccess = { get length() { return map.size; }, key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => map.get(k) ?? null, setItem: (k, v) => { if (fail(k, ++n)) throw Error('quota'); map.set(k, v); },
    removeItem: (k) => { if (fail(k, ++n)) throw Error('quota'); map.delete(k); } };
  return { map, kv, failOn: (fn: typeof fail) => { n = 0; fail = fn; } };
}
function settled() {
  const data = buildDemoData(demoCatalog, new Date('2026-11-01T18:00:00Z'), sequentialIds());
  data.orders = data.orders.map((o) => markPaid({ ...o, status: 'terminee' }, 'carte', AT.toISOString()));
  return data;
}
function open(m: ReturnType<typeof memory>, seed = settled) {
  return createAppStore({ repo: createKeyValueRepository(m.kv), catalog: demoCatalog, seed, now: () => AT, newId: sequentialIds() });
}
async function fixture() {
  const m = memory(), store = open(m);
  m.map.set(K.safety, 'ancienne copie avec commandes');
  const p = await prepareClosure(m.kv, store.getData(), AT, 'cloture-test', NS);
  return { m, store, p };
}

describe('10 : blocages et fidélité', () => {
  it.each(['a_preparer', 'en_preparation', 'prete', 'impayee', 'legacy', 'ecart', 'archive-impayee'] as const)('refuse %s, même dans les archives', (kind) => {
    const d = settled(), o = d.orders[0];
    if (kind === 'legacy' || kind === 'impayee' || kind === 'archive-impayee') {
      o.payment = { status: 'a_encaisser', method: null, paidAt: null, ...(kind === 'legacy' ? { legacy: true } : {}) };
      if (kind === 'archive-impayee') o.archivedAt = AT.toISOString();
    } else if (kind === 'ecart') o.payment.tenders = [{ kind: 'carte', amount: 1 }];
    else o.status = kind;
    expect(closureBlockers(d).blocked).toBe(true);
    expect(() => closedState(d, AT.toISOString(), 'c')).toThrow();
  });
  it.each(['editingOrderId', 'lines', 'note', 'customerId', 'counterName', 'requestedTime'] as const)('bloque un panier avec %s sans le vider', (field) => {
    const d = settled();
    if (field === 'lines') d.cart.lines = [createLine(demoCatalog.products[0], 'l')]; else d.cart[field] = 'en-cours';
    const before = JSON.stringify(d); expect(closureBlockers(d).blocked).toBe(true); expect(JSON.stringify(d)).toBe(before);
  });
  it('conserve exactement progression, points signés, récompenses utilisées/disponibles et dette', () => {
    const d = settled(), id = d.customers[0].id;
    d.loyaltyEvents.push({ id: 'neg', at: AT.toISOString(), customerId: id, orderId: d.orders[0].id, type: 'points', delta: -2, reason: 'commande_modifiee' },
      { id: 'used', at: AT.toISOString(), customerId: id, orderId: d.orders[0].id, type: 'rewards_used', delta: 12, reason: 'recompense_reservee' });
    const before = d.customers.map((c) => computeBalance(d.loyaltyEvents, c.id, d.settings.loyalty));
    const after = closedState(d, AT.toISOString(), 'c');
    expect(after.customers.map((c) => computeBalance(after.loyaltyEvents, c.id, after.settings.loyalty))).toEqual(before);
    expect(after.loyaltyEvents.map((e) => ({ id: e.id, delta: e.delta, at: e.at, reason: e.reason }))).toEqual(d.loyaltyEvents.map((e) => ({ id: e.id, delta: e.delta, at: e.at, reason: e.reason })));
    expect(after.loyaltyEvents.every((e) => e.orderId === null)).toBe(true);
    expect(customerLoyaltyStatus(after.loyaltyEvents, after.orders, id).reserved).toBe(0);
    expect(rewardsRemainingForCart(after.loyaltyEvents, { ...emptyCart('x'), customerId: id }, after.settings.loyalty)).toBe(before[0].available - before[0].debt);
    expect(d.orders.length).toBeGreaterThan(0); // pure, ne modifie jamais la source
  });
});

describe('10 : choix des deux exports et confirmations', () => {
  it.each([[false, false], [true, false], [false, true], [true, true]])('PDF %s / JSON %s', async (report, backup) => {
    const { m, p } = await fixture(); const choices = { report, backup };
    expect(exportsConfirmed(choices, choices, choices)).toBe(true);
    expect(commitClosure(m.kv, p, choices, choices, choices, true).ok).toBe(true);
    const restored = open(m).getData();
    expect(restored.orders).toEqual([]); expect(restored.serviceOpen).toBe(false); expect(restored.cart.lines).toEqual([]);
    expect(restored.customers).toEqual(p.after.customers); expect(restored.settings).toEqual(p.after.settings);
    expect(m.map.has(K.safety)).toBe(false); expect(m.map.has(closureKey(NS))).toBe(false);
  });
  it.each(['generation', 'enregistrement', 'confirmation'] as const)('absence de %s : aucune écriture ni suppression', async (missing) => {
    const { m, p } = await fixture(); const before = [...m.map];
    expect(commitClosure(m.kv, p, yes, missing === 'generation' ? no : yes, missing === 'enregistrement' ? no : yes, missing !== 'confirmation').ok).toBe(false);
    expect([...m.map]).toEqual(before);
  });
  it('annulation après génération : aucune donnée ni copie de sécurité modifiée', async () => {
    const m = memory(), s = open(m), before = [...m.map]; await prepareClosure(m.kv, s.getData(), AT, 'c', NS);
    expect([...m.map]).toEqual(before);
  });
  it('état affiché obsolète : une nouvelle commande en stockage ne peut pas être supprimée par cette préparation', async () => {
    const m = memory(), s = open(m); const raw = JSON.parse(m.map.get(K.doc)!);
    raw.orders.push({ ...raw.orders[0], id: 'nouvelle', number: 50, status: 'a_preparer' }); m.map.set(K.doc, JSON.stringify(raw));
    const before = [...m.map];
    await expect(prepareClosure(m.kv, s.getData(), AT, 'c', NS)).rejects.toThrow(/correspondent plus/);
    expect([...m.map]).toEqual(before);
  });
  it('ancien panier inclus dans le document principal : absent de la reprise, sans perte du reste', async () => {
    const m = memory(), s = open(m); const d = JSON.parse(m.map.get(K.doc)!);
    d.cart = { ...s.getData().cart, note: 'ancien brouillon' }; m.map.set(K.doc, JSON.stringify(d));
    const p = await prepareClosure(m.kv, s.getData(), AT, 'c', NS);
    expect(JSON.parse(p.docText).cart).toBeUndefined(); expect(JSON.parse(p.cartText).note).toBe('');
  });
  it('échec de génération de la sauvegarde : aucune suppression', async () => {
    const m = memory(), s = open(m), before = [...m.map];
    const spy = vi.spyOn(crypto.subtle, 'digest').mockRejectedValueOnce(new Error('export impossible'));
    await expect(prepareClosure(m.kv, s.getData(), AT, 'c', NS)).rejects.toThrow('export impossible'); spy.mockRestore();
    expect([...m.map]).toEqual(before);
  });
});

describe('10 : clôture atomique et interruptions', () => {
  it.each([1, 2])('échec avant validation (écriture %i) : rien retiré', async (step) => {
    const { m, p } = await fixture(), before = readAppKeys(m.kv, NS); m.failOn((_k, n) => n === step);
    expect(commitClosure(m.kv, p, no, no, no, true)).toMatchObject({ ok: false, committed: false });
    expect(readAppKeys(m.kv, NS)).toEqual(before); expect(m.map.get(K.safety)).toBe('ancienne copie avec commandes');
  });
  it.each([3, 4, 5])('interruption après validation (écriture %i) : reprise sans réintroduire les commandes', async (step) => {
    const { m, p } = await fixture(); let dead = false;
    m.failOn((_k, n) => { if (n === step) dead = true; return dead; });
    expect(commitClosure(m.kv, p, no, no, no, true)).toMatchObject({ ok: false, committed: true });
    expect(JSON.parse(m.map.get(K.doc)!).orders).toEqual([]);
    expect(open(m).isStorageLocked()).toBe(true); // état partiel jamais chargé
    m.failOn(() => false); expect(recoverClosure(m.kv, NS)).toBe('completed');
    const d = open(m).getData(); expect(d.orders).toEqual([]); expect(d.loyaltyEvents).toEqual(p.after.loyaltyEvents);
    expect(m.map.has(K.safety)).toBe(false); expect(recoverClosure(m.kv, NS)).toBe('none');
  });
  it('interruption avant validation : reprise annulée sans toucher à la source ni à la copie', async () => {
    const { m, p } = await fixture(), before = readAppKeys(m.kv, NS); let dead = false;
    m.failOn((_k, n) => { if (n === 2) dead = true; return dead; });
    expect(commitClosure(m.kv, p, no, no, no, true)).toMatchObject({ ok: false, committed: false });
    expect(m.map.has(closureKey(NS))).toBe(true); m.failOn(() => false);
    expect(recoverClosure(m.kv, NS)).toBe('cancelled'); expect(readAppKeys(m.kv, NS)).toEqual(before);
    expect(m.map.get(K.safety)).toBe('ancienne copie avec commandes');
  });
  it('restauration refusée pendant une clôture, sans altérer sa trace', async () => {
    const { m, p } = await fixture(); m.map.set(closureKey(NS), 'trace en cours'); const before = [...m.map];
    expect((await performRestore(m.kv, { mode: 'fichier', docText: p.docText, cartText: p.cartText, carte: 'conserver' }, { now: AT, origin: 'test', keys: K })).ok).toBe(false);
    expect([...m.map]).toEqual(before);
  });
  it('double validation et rechargement : aucun doublon de fidélité', async () => {
    const { m, p } = await fixture(); expect(commitClosure(m.kv, p, no, no, no, true).ok).toBe(true);
    const before = [...m.map]; expect(commitClosure(m.kv, p, no, no, no, true).ok).toBe(false); expect([...m.map]).toEqual(before);
    expect(open(m).getData().loyaltyEvents).toEqual(p.after.loyaltyEvents);
  });
  it('changement après préparation : refus ; journal étranger jamais effacé', async () => {
    const { m, p } = await fixture(); m.map.set(K.cart, JSON.stringify({ ...p.after.cart, note: 'autre onglet' }));
    const before = [...m.map]; expect(commitClosure(m.kv, p, no, no, no, true).ok).toBe(false); expect([...m.map]).toEqual(before);
    m.map.set(closureKey(NS), 'journal étranger'); expect(commitClosure(m.kv, p, no, no, no, true).ok).toBe(false);
    expect(m.map.get(closureKey(NS))).toBe('journal étranger'); expect(recoverClosure(m.kv, NS)).toBe('blocked');
  });
  it.each([true, null])('autres onglets %s : blocage sûr', async (others) => {
    const presence = { otherTabs: async () => others } as TabPresence;
    await expect(checkClosureTabs(presence)).rejects.toThrow();
  });
  it('aucun autre onglet : contrôle accepté ; absence de canal refusée', async () => {
    await expect(checkClosureTabs({ otherTabs: async () => false } as TabPresence)).resolves.toBeUndefined();
    await expect(checkClosureTabs(null)).rejects.toThrow();
  });
  it('ancien store ouvert : refuse ses écritures après la clôture, y compris panier et carte', async () => {
    const { m, p, store } = await fixture(); expect(commitClosure(m.kv, p, no, no, no, true).ok).toBe(true); const before = [...m.map];
    expect(store.updateSettings({ ticketWidthMm: 58 }).ok).toBe(false);
    expect(store.addCatalogTopping({ name: 'Truffe', price: '2' }).ok).toBe(false);
    store.setOrderNote('obsolète'); store.flushPendingWrites(); expect([...m.map]).toEqual(before);
  });
});

describe('10 : sauvegarde de reprise et lendemain', () => {
  it('récompense réservée puis consommée : reprise exacte et utilisation unique de la récompense restante le lendemain', async () => {
    const m = memory(), s = open(m);
    const client = s.getData().customers.find((c) => c.lastName === 'Benali')!;
    const balance = (store: typeof s) => computeBalance(store.getData().loyaltyEvents, client.id, store.getData().settings.loyalty);
    s.selectCustomer(client.id); s.addProduct('reine');
    expect(s.addReward('pizza', 'margarita').ok).toBe(true);
    const first = s.validateCart(); expect(first.ok).toBe(true); if (!first.ok) return;
    expect(customerLoyaltyStatus(s.getData().loyaltyEvents, s.getData().orders, client.id).reserved).toBe(1);
    expect(closureBlockers(s.getData()).blocked).toBe(true);
    expect(s.markOrderPaid(first.value.id, 'carte').ok).toBe(true);
    expect(s.setOrderStatus(first.value.id, 'terminee').ok).toBe(true);
    expect(balance(s)).toMatchObject({ totalPoints: 24, rewardsUsed: 1, available: 1, progress: 4 });
    const before = s.getData().customers.map((c) => computeBalance(s.getData().loyaltyEvents, c.id, s.getData().settings.loyalty));
    const p = await prepareClosure(m.kv, s.getData(), AT, 'cycle-recompense', NS);
    expect(commitClosure(m.kv, p, yes, yes, yes, true).ok).toBe(true);
    const a = await analyzeBackupText(p.backupText, NS); expect(a.ok).toBe(true); if (!a.ok) return;
    const target = memory();
    expect((await performRestore(target.kv, { mode: 'fichier', docText: a.docText, cartText: null, carte: a.fileCarteText!, supplements: a.fileSupplementsText! }, { now: AT, origin: 'test', keys: K })).ok).toBe(true);
    let n = 0;
    const next = createAppStore({ repo: createKeyValueRepository(target.kv), catalog: demoCatalog, seed: settled,
      now: () => new Date('2026-11-02T18:00:00Z'), newId: (prefix) => `${prefix}_lendemain_${++n}` });
    expect(next.getData().customers).toEqual(p.after.customers);
    expect(next.getData().customers.map((c) => computeBalance(next.getData().loyaltyEvents, c.id, next.getData().settings.loyalty))).toEqual(before);
    expect(next.openService().ok).toBe(true);
    next.selectCustomer(client.id); next.addProduct('reine');
    expect(next.addReward('pizza', 'margarita').ok).toBe(true);
    const second = next.validateCart(); expect(second.ok).toBe(true); if (!second.ok) return;
    expect(second.value.number).toBe(1);
    expect(next.markOrderPaid(second.value.id, 'carte').ok).toBe(true);
    expect(next.markOrderPaid(second.value.id, 'carte').ok).toBe(true);
    expect(balance(next)).toMatchObject({ totalPoints: 25, rewardsUsed: 2, available: 0, progress: 5 });
    next.selectCustomer(client.id); next.addProduct('reine');
    expect(next.addReward('pizza', 'margarita').ok).toBe(false);
    expect(balance(open(target))).toEqual(balance(next));
  });
  it('restauration sur état vierge : fermé, sans commandes, produits/suppléments/clients et fidélité exacts', async () => {
    const { m, p } = await fixture(); const beforeCatalog = m.map.get(K.carte), beforeToppings = m.map.get(K.supplements);
    const a = await analyzeBackupText(p.backupText, NS); expect(a.ok).toBe(true); if (!a.ok) return;
    const target = memory();
    expect((await performRestore(target.kv, { mode: 'fichier', docText: a.docText, cartText: null, carte: a.fileCarteText!, supplements: a.fileSupplementsText! }, { now: AT, origin: 'test', keys: K })).ok).toBe(true);
    const s = open(target), d = s.getData(); expect(d.serviceOpen).toBe(false); expect(d.orders).toEqual([]); expect(d.cart.lines).toEqual([]);
    expect(d.loyaltyEvents).toEqual(p.after.loyaltyEvents); expect(d.customers).toEqual(p.after.customers);
    expect(target.map.get(K.carte)).toBe(beforeCatalog); expect(target.map.get(K.supplements)).toBe(beforeToppings);
    expect(s.openService().ok).toBe(true); expect(s.getData().serviceOpen).toBe(true); expect(s.getData().counters.nextOrderNumber).toBe(1);
    expect(s.getData().orders).toEqual([]); expect(open(target).getData().loyaltyEvents).toEqual(p.after.loyaltyEvents);
  });
  it('sauvegarde complète habituelle inchangée et anciennes sauvegardes compatibles sans reprise implicite', async () => {
    const m = memory(), s = open(m), oldOrders = s.getData().orders;
    m.map.delete(K.carte); m.map.delete(K.supplements);
    const text = backupToText(await createBackup(m.kv, { now: AT, origin: 'test', namespace: NS }));
    const a = await analyzeBackupText(text, NS); expect(a.ok).toBe(true); if (!a.ok) return;
    const dry = dryRunLoad(a.docText, a.fileCartText); expect(dry.ok).toBe(true); if (!dry.ok) return;
    expect(dry.data.orders).toEqual(oldOrders); expect(dry.data.serviceOpen).toBe(true);
  });
});

describe('10 : bilan PDF distinct des données de récupération', () => {
  it('ventes, vrais montants confirmés, cadeaux, annulations et suppléments distingués, prix historiques conservés', () => {
    const d = settled(), original = d.orders[0];
    d.orders = [{ ...original, payment: { ...original.payment, tenders: [{ kind: 'especes', amount: 100 }, { kind: 'carte', amount: original.totals.total - 100 }] } },
      { ...original, id: 'annulee', number: 50, status: 'annulee' }];
    const report = serviceReport(d, AT.toISOString());
    expect(report.some((l) => l.text === 'Espèces' && l.right === '1,00 €')).toBe(true);
    expect(report.some((l) => l.text.includes('Cadeaux fidélité'))).toBe(true);
    expect(report.some((l) => l.text.includes('N° 50') && l.text.includes('marquée encaissée'))).toBe(true);
    expect(report.some((l) => l.text.includes('remboursement non suivi'))).toBe(true);
    expect(report.some((l) => l.text.includes('2 commandes et tout'))).toBe(true);
  });
  it('PDF multipage valide : offsets et longueurs de streams exacts, accents français et euro encodés', () => {
    const bytes = buildServicePdf('Pizzeria Ferrari', Array.from({ length: 150 }, (_, i) => ({ text: 'Œuf à la crème ' + i, right: '12,80 €' })));
    const pdf = new TextDecoder().decode(bytes);
    expect(pdf.startsWith('%PDF-1.4')).toBe(true); expect(pdf.endsWith('%%EOF\n')).toBe(true);
    const xref = Number(pdf.match(/startxref\n(\d+)/)![1]); expect(pdf.slice(xref, xref + 4)).toBe('xref');
    expect(Number(pdf.match(/\/Type \/Pages \/Count (\d+)/)![1])).toBeGreaterThan(1);
    expect(pdf).toContain('\\214uf'); expect(pdf).toContain('\\200');
  });
});
