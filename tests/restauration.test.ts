import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAppStore } from '../src/state/store';
import { createKeyValueRepository } from '../src/storage/repository';
import { backupToText, createBackup, readAppKeys, summarize, type BackupFile } from '../src/storage/export';
import {
  JOURNAL_FRESH_MS,
  MAX_BACKUP_CHARS,
  acceptsNamespace,
  analyzeBackupText,
  checksum,
  performRestore,
  planFromSafetyCopy,
  recoverInterruptedRestore,
  restoreKeys,
  type AnalyzedBackup,
  type RestorePlan,
  type StorageAccess,
} from '../src/storage/restore';
import { dryRunLoad, emptyCartText } from '../src/state/restoreDryRun';
import { demoCatalog } from '../src/data/catalog';
import { buildDemoData } from '../src/data/seed';
import { sequentialIds } from './helpers';

const PROD = 'ferrari-manager';
const APERCU = 'ferrari-manager-apercu-i3';
const P = restoreKeys(PROD);
const ORIGIN = 'https://exemple.test/ferrari-manager/';
const T0 = new Date('2026-10-31T19:00:00Z');

/** Stockage local simulé (comme localStorage), avec écritures qui échouent à la demande. */
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
  return {
    map,
    kv,
    writes,
    failOn: (f: (key: string) => boolean) => (failing = f),
    snapshot: () => JSON.stringify([...map.entries()].sort()),
    business: (ns = PROD) => readAppKeys(kv, ns),
  };
}

function storeOn(kv: StorageAccess, ns = PROD, prefix = 'a') {
  const ids = sequentialIds();
  return createAppStore({
    repo: createKeyValueRepository(kv, `${ns}:v1`, `${ns}:v1:panier`),
    catalog: demoCatalog,
    seed: buildDemoData,
    now: () => T0,
    newId: (p) => ids(`${prefix}${p}`),
  });
}

const pizza = (n: number) => demoCatalog.products.filter((p) => p.category === 'pizza')[n].id;

/** État « A » : commandes encaissée, annulée, service clôturé puis rouvert, panier en cours. */
function stateA(ns = PROD) {
  const m = memory();
  const s = storeOn(m.kv, ns, 'a');
  const [c1, c2] = s.getData().customers;
  s.selectCustomer(c1.id);
  s.addProduct(pizza(0));
  s.addProduct(pizza(1));
  const o1 = s.validateCart();
  if (!o1.ok) throw new Error(o1.error);
  s.markOrderPaid(o1.value.id, 'carte');
  s.setOrderStatus(o1.value.id, 'terminee');
  s.selectCustomer(c2.id);
  s.addProduct(pizza(2));
  const o2 = s.validateCart();
  if (!o2.ok) throw new Error(o2.error);
  s.cancelOrder(o2.value.id);
  s.closeService();
  s.openService();
  s.selectCustomer(c1.id);
  s.addProduct(pizza(3));
  s.setOrderNote('Panier de A');
  s.flushPendingWrites();
  return { m, s };
}

/** État « B » (données actuelles avant restauration) : autre historique et une MODIFICATION en cours. */
function stateB() {
  const m = memory({ [`${PROD}-interface`]: '{"v":1,"barreLaterale":"reduite"}', 'autre-site:cle': 'x', [`${APERCU}:v1`]: '{"apercu":true}' });
  const s = storeOn(m.kv, PROD, 'b');
  const c = s.getData().customers[2];
  s.createCustomer({ lastName: 'Nouvelle', firstName: 'Cliente', phone: '0611223399', address: '', postalCode: '', city: '', complement: '', instructions: '' });
  s.selectCustomer(c.id);
  s.addProduct(pizza(4));
  const o = s.validateCart();
  if (!o.ok) throw new Error(o.error);
  s.startEditOrder(o.value.id);
  s.addProduct(pizza(5));
  s.flushPendingWrites();
  return { m, s, editedOrderId: o.value.id };
}

async function exportOf(kv: StorageAccess, ns = PROD) {
  return backupToText(await createBackup(kv, { now: T0, origin: ORIGIN, namespace: ns }));
}

/** Réécrit un fichier en recalculant longueurs, empreintes et résumé (fichier « valide » mais au contenu choisi). */
async function forge(text: string, edit: (doc: Record<string, unknown> & { [k: string]: any }) => void, ns = PROD) {
  const file = JSON.parse(text) as BackupFile;
  const doc = JSON.parse(file.stockage[`${ns}:v1`]);
  edit(doc);
  const kv = memory({ ...file.stockage, [`${ns}:v1`]: JSON.stringify(doc) });
  return exportOf(kv.kv, ns);
}

async function okAnalysis(text: string, target = PROD): Promise<AnalyzedBackup> {
  const a = await analyzeBackupText(text, target);
  if (!a.ok) throw new Error(a.problems.map((p) => p.message).join(' / '));
  return a;
}

async function refusal(text: string, target = PROD) {
  const a = await analyzeBackupText(text, target);
  expect(a.ok, 'le fichier aurait dû être refusé').toBe(false);
  return a.ok ? [] : a.problems;
}

const fileFor = (a: AnalyzedBackup): RestorePlan => ({ mode: 'fichier', docText: a.docText, cartText: emptyCartText() });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('1. formats pris en charge (exports réellement produits par l’application)', () => {
  it('export avec empreintes SHA-256 (https, localhost) : accepté, données lues à l’octet près', async () => {
    const { m } = stateA();
    const text = await exportOf(m.kv);
    const a = await okAnalysis(text);
    expect(a.empreinte).toBe('sha256');
    expect(a.provenance).toBe('production');
    expect(a.docText).toBe(m.map.get(P.doc));
    expect(a.fileCartText).toBe(m.map.get(P.cart));
    expect(a.fileCart).toEqual({ articles: 1, modificationCommande: null });
    expect(a.exporteLe).toBe(T0.toISOString());
  });

  it('export sans empreinte (page http, `npm run dev:tablette` : le navigateur ne calcule pas SHA-256) : accepté, longueurs contrôlées', async () => {
    const { m } = stateA();
    vi.stubGlobal('crypto', {});
    const text = await exportOf(m.kv);
    vi.unstubAllGlobals();
    expect(Object.values((JSON.parse(text) as BackupFile).integrite).every((i) => i.sha256 === null)).toBe(true);
    const a = await okAnalysis(text);
    expect(a.empreinte).toBe('absente');
    expect(a.notes.join(' ')).toMatch(/sans empreinte/);
  });

  it('empreinte présente mais fausse : toujours refusée ; empreintes mélangées : refusées', async () => {
    const { m } = stateA();
    const file = JSON.parse(await exportOf(m.kv)) as BackupFile;
    const wrong = structuredClone(file);
    wrong.integrite[P.doc].sha256 = '0'.repeat(64);
    expect((await refusal(JSON.stringify(wrong)))[0].message).toMatch(/empreinte différente/);
    const mixed = structuredClone(file);
    mixed.integrite[P.cart].sha256 = null;
    expect((await refusal(JSON.stringify(mixed)))[0].message).toMatch(/incohérentes/);
  });

  it('empreinte présente mais impossible à vérifier sur ce navigateur : refusée', async () => {
    const { m } = stateA();
    const text = await exportOf(m.kv);
    vi.stubGlobal('crypto', {});
    expect((await refusal(text))[0].message).toMatch(/ne permet pas de vérifier/);
  });

  it('anciennes données (avant le suivi des paiements, frais de livraison historiques, sans état de service) : acceptées', async () => {
    const { m } = stateA();
    const legacy = await forge(await exportOf(m.kv), (doc) => {
      for (const o of doc.orders) {
        delete o.payment;
        delete o.serviceId;
        if (o.mode === 'emporter') o.mode = 'livraison';
        o.totals = { subtotal: o.totals.subtotal, deliveryFee: 200, total: o.totals.subtotal + 200 };
      }
      delete doc.services;
      delete doc.serviceOpen;
      delete doc.serviceClosedAt;
      doc.settings.loyalty.awardOn = 'validation';
      doc.settings.deliveryFee = 200;
    });
    const a = await okAnalysis(legacy);
    expect(a.notes.join(' ')).toMatch(/paiement non suivi/);
    expect(a.notes.join(' ')).toMatch(/frais de livraison historiques/);
    const dry = dryRunLoad(a.docText, emptyCartText());
    expect(dry.ok).toBe(true);
    if (dry.ok) expect(dry.facts.commandesPaiementNonSuivi).toBe(dry.facts.commandes);
  });

  it('les contrôles de prix portent sur les valeurs ENREGISTRÉES, jamais sur la carte actuelle', async () => {
    const { m } = stateA();
    const text = await forge(await exportOf(m.kv), (doc) => {
      // Prix d'une ancienne carte, figé sur la ligne : toujours valable.
      const o = doc.orders[0];
      o.lines[0].unitPrice += 350;
      o.totals.subtotal += 350;
      o.totals.total += 350;
    });
    await okAnalysis(text);
  });
});

describe('2. fichiers refusés (rien n’est écrit) : fichier, structure, référence', () => {
  async function base() {
    const { m } = stateA();
    return exportOf(m.kv);
  }

  it('fichier : JSON illisible, autre fichier, format inconnu, tronqué, résumé falsifié, trop volumineux', async () => {
    const text = await base();
    const file = JSON.parse(text) as BackupFile;
    expect((await refusal(text.slice(0, 200)))[0]).toMatchObject({ kind: 'fichier', message: expect.stringMatching(/illisible/) });
    expect((await refusal('{"type":"autre"}'))[0].message).toMatch(/n’est pas une sauvegarde/);
    expect((await refusal(JSON.stringify({ ...file, formatSauvegarde: 2 })))[0].message).toMatch(/Format de sauvegarde 2/);
    const truncated = structuredClone(file);
    truncated.stockage[P.doc] = truncated.stockage[P.doc].slice(0, -5);
    expect((await refusal(JSON.stringify(truncated)))[0].message).toMatch(/tronquée/);
    expect((await refusal(JSON.stringify({ ...file, resume: { ...file.resume, clients: 99 } })))[0].message).toMatch(/résumé/);
    expect((await refusal(' '.repeat(MAX_BACKUP_CHARS + 1)))[0].message).toMatch(/volumineux/);
  });

  it('provenance : prévisualisation refusée en production ; production acceptée dans la prévisualisation', async () => {
    const { m } = stateA(APERCU);
    const apercuFile = await exportOf(m.kv, APERCU);
    expect((await refusal(apercuFile, PROD))[0].message).toMatch(/prévisualisation/);
    expect((await okAnalysis(apercuFile, APERCU)).provenance).toBe('previsualisation');
    expect((await okAnalysis(await base(), APERCU)).provenance).toBe('production');
    expect(acceptsNamespace(PROD, APERCU)).toBe(false);
    expect(acceptsNamespace(APERCU, PROD)).toBe(true);
    expect(acceptsNamespace(APERCU, 'autre-espace')).toBe(false);
    const bad = JSON.parse(await base()) as BackupFile;
    expect((await refusal(JSON.stringify({ ...bad, espaceDeStockage: '../x' })))[0].message).toMatch(/Espace de stockage/);
  });

  it('structure : version, listes, doublons, numéros, statut, dates, montants', async () => {
    const text = await base();
    const cases: [string, (d: any) => void, RegExp][] = [
      ['version', (d) => (d.schemaVersion = 2), /Version de données 2/],
      ['liste', (d) => (d.orders = {}), /orders/],
      ['client en double', (d) => d.customers.push({ ...d.customers[0] }), /identifiant en double/],
      ['téléphone en double', (d) => d.customers.push({ ...d.customers[0], id: 'cus_copie' }), /même téléphone/],
      ['commande en double', (d) => d.orders.push({ ...d.orders[0] }), /identifiant en double/],
      ['numéro affiché en double', (d) => d.orders.push({ ...d.orders[0], id: 'ord_copie', archivedAt: null, number: d.orders.find((o: any) => !o.archivedAt).number }), /même numéro/],
      ['statut', (d) => (d.orders[0].status = 'livree'), /statut inconnu/],
      ['date', (d) => (d.orders[0].createdAt = 'hier'), /date de création/],
      ['montant décimal', (d) => (d.orders[0].totals.total = 10.5), /centimes entiers/],
      ['prix négatif', (d) => (d.orders[0].lines[0].unitPrice = -100), /prix ou quantité/],
      ['sous-total', (d) => (d.orders[0].totals.subtotal += 1), /sous-total/],
      ['total', (d) => (d.orders[0].totals.total += 1), /total différent/],
      ['événement', (d) => (d.loyaltyEvents[0].delta = 1.5), /contenu invalide/],
    ];
    for (const [name, edit, message] of cases) {
      const problems = await refusal(await forge(text, edit));
      expect(problems.map((p) => p.message).join(' / '), name).toMatch(message);
      expect(problems[0].kind, name).toBe('structure');
    }
  });

  it('commandes archivées de services différents : même numéro autorisé (numérotation remise à 1)', async () => {
    const text = await base();
    await okAnalysis(await forge(text, (d) => d.orders.push({ ...d.orders[0], id: 'ord_ancien', archivedAt: '2026-10-01T22:00:00.000Z' })));
  });

  it('références cassées : client, service, commande ou client d’un événement de fidélité', async () => {
    const text = await base();
    const cases: [string, (d: any) => void, RegExp][] = [
      ['client de commande', (d) => (d.orders[0].customerId = 'cus_inconnu'), /client cus_inconnu introuvable/],
      ['service', (d) => (d.orders[0].serviceId = 'svc-inconnu'), /service svc-inconnu introuvable/],
      ['commande d’événement', (d) => (d.loyaltyEvents[0].orderId = 'ord_inconnue'), /commande ord_inconnue introuvable/],
      ['client d’événement', (d) => (d.loyaltyEvents[0].customerId = 'cus_inconnu'), /client cus_inconnu introuvable/],
    ];
    for (const [name, edit, message] of cases) {
      const problems = await refusal(await forge(text, edit));
      expect(problems[0], name).toMatchObject({ kind: 'reference', message: expect.stringMatching(message) });
    }
  });

  it('solde de récompenses négatif (dette) : autorisé par les règles, signalé sans bloquer', async () => {
    const text = await forge(await base(), (d) =>
      d.loyaltyEvents.push({ id: 'dette', at: T0.toISOString(), customerId: d.customers[3].id, orderId: null, type: 'rewards_used', delta: 1, reason: 'recompense_utilisee' }),
    );
    const a = await okAnalysis(text);
    const dry = dryRunLoad(a.docText, emptyCartText());
    expect(dry.ok && dry.facts.clientsEnDette).toBeGreaterThan(0);
  });
});

describe('3. chargement à blanc : aucune écriture, aucun effet', () => {
  it('le vrai store charge les données en mémoire, sans toucher au stockage du navigateur ni jouer de son', async () => {
    const { m } = stateA();
    const a = await okAnalysis(await exportOf(m.kv));
    const sound = vi.fn();
    vi.stubGlobal('localStorage', new Proxy({}, { get: () => { throw new Error('stockage du navigateur lu'); } }));
    vi.stubGlobal('Audio', sound);
    vi.stubGlobal('print', sound);
    const dry = dryRunLoad(a.docText, emptyCartText());
    expect(dry.ok).toBe(true);
    expect(sound).not.toHaveBeenCalled();
    if (dry.ok) {
      expect(dry.data.orders).toEqual(storeOn(m.kv).getData().orders);
      expect(dry.data.cart.lines).toEqual([]);
    }
  });

  it('données que l’application ne chargerait pas : refusées par le chargement à blanc', () => {
    expect(dryRunLoad('{"schemaVersion":1,"customers":[],"orders":"x","loyaltyEvents":[]}', null).ok).toBe(false);
  });
});

describe('4. restauration ordinaire : données du fichier, panier vide, copie de sécurité complète', () => {
  it('données principales identiques au fichier, panier volontairement vide, modification en cours abandonnée', async () => {
    const A = stateA();
    const file = await exportOf(A.m.kv);
    const B = stateB();
    const beforeB = B.m.business();
    const a = await okAnalysis(file);
    const outcome = await performRestore(B.m.kv, fileFor(a), { now: T0, origin: ORIGIN, keys: P });
    expect(outcome).toEqual({ ok: true });

    expect(B.m.map.get(P.doc)).toBe(A.m.map.get(P.doc));
    const cart = JSON.parse(B.m.map.get(P.cart)!);
    expect(cart).toMatchObject({ lines: [], editingOrderId: null, customerId: null, note: '' });
    expect(B.m.map.has(P.journal)).toBe(false);

    const reloaded = storeOn(B.m.kv, PROD, 'r').getData();
    const original = storeOn(A.m.kv, PROD, 'o').getData();
    for (const k of ['customers', 'orders', 'loyaltyEvents', 'settings', 'counters', 'services', 'serviceOpen', 'serviceStartedAt'] as const) {
      expect(reloaded[k], k).toEqual(original[k]);
    }
    expect(reloaded.cart.lines).toEqual([]);
    expect(reloaded.cart.editingOrderId).toBeNull();

    // Copie de sécurité : état B COMPLET (données, panier, modification en cours).
    const copy = JSON.parse(B.m.map.get(P.safety)!) as BackupFile;
    expect(copy.stockage).toEqual(beforeB);
    expect(JSON.parse(copy.stockage[P.cart]).editingOrderId).toBe(B.editedOrderId);
    expect((await analyzeBackupText(B.m.map.get(P.safety)!, PROD)).ok).toBe(true);
  });

  it('seules les clés du build sont écrites : préférence de barre, aperçu et autres sites intacts', async () => {
    const A = stateA();
    const B = stateB();
    B.m.writes.length = 0;
    const others = ['ferrari-manager-interface', 'autre-site:cle', `${APERCU}:v1`].map((k) => [k, B.m.map.get(k)]);
    await performRestore(B.m.kv, fileFor(await okAnalysis(await exportOf(A.m.kv))), { now: T0, origin: ORIGIN, keys: P });
    expect(new Set(B.m.writes)).toEqual(new Set([P.safety, P.journal, P.cart, P.doc]));
    for (const [k, v] of others) expect(B.m.map.get(k!), k).toBe(v);
  });

  it('les noms de clés du fichier ne servent jamais à écrire (clés inconnues ignorées)', async () => {
    const A = stateA();
    A.m.map.set(`${PROD}:piege`, '{"a":1}');
    const file = JSON.parse(await exportOf(A.m.kv)) as BackupFile;
    const a = await okAnalysis(JSON.stringify(file));
    expect(a.ignoredKeys).toEqual([`${PROD}:piege`]);
    const B = stateB();
    await performRestore(B.m.kv, fileFor(a), { now: T0, origin: ORIGIN, keys: P });
    expect(B.m.map.has(`${PROD}:piege`)).toBe(false);
  });

  it('prévisualisation : un fichier de production est réécrit UNIQUEMENT dans les clés de la prévisualisation', async () => {
    const A = stateA();
    const prodFile = await exportOf(A.m.kv);
    const m = memory({ [P.doc]: 'PRODUCTION', [P.cart]: 'PANIER-PROD', [`${PROD}-interface`]: 'pref' });
    const ap = storeOn(m.kv, APERCU, 'p');
    ap.flushPendingWrites();
    const K = restoreKeys(APERCU);
    const outcome = await performRestore(m.kv, fileFor(await okAnalysis(prodFile, APERCU)), { now: T0, origin: ORIGIN, keys: K });
    expect(outcome.ok).toBe(true);
    expect(m.map.get(K.doc)).toBe(A.m.map.get(P.doc));
    expect([m.map.get(P.doc), m.map.get(P.cart), m.map.get(`${PROD}-interface`)]).toEqual(['PRODUCTION', 'PANIER-PROD', 'pref']);
    expect(m.map.has(P.safety)).toBe(false);
  });

  it('la copie de sécurité et la trace ne figurent jamais dans un export', async () => {
    const A = stateA();
    const B = stateB();
    await performRestore(B.m.kv, fileFor(await okAnalysis(await exportOf(A.m.kv))), { now: T0, origin: ORIGIN, keys: P });
    expect(Object.keys((JSON.parse(await exportOf(B.m.kv)) as BackupFile).stockage)).toEqual([P.doc, P.cart]);
  });

  it('restaurer deux fois le même fichier : même résultat', async () => {
    const A = stateA();
    const file = await exportOf(A.m.kv);
    const B = stateB();
    await performRestore(B.m.kv, fileFor(await okAnalysis(file)), { now: T0, origin: ORIGIN, keys: P });
    const first = B.m.map.get(P.doc);
    expect((await performRestore(B.m.kv, fileFor(await okAnalysis(file)), { now: T0, origin: ORIGIN, keys: P })).ok).toBe(true);
    expect(B.m.map.get(P.doc)).toBe(first);
  });
});

describe('5. retour arrière : tout l’état initial, panier et modification compris', () => {
  it('« Revenir à cet état » retrouve exactement les clés d’avant la restauration', async () => {
    const A = stateA();
    const B = stateB();
    const beforeB = B.m.business();
    await performRestore(B.m.kv, fileFor(await okAnalysis(await exportOf(A.m.kv))), { now: T0, origin: ORIGIN, keys: P });
    const afterRestore = B.m.business();
    const copyText = B.m.map.get(P.safety)!;
    const plan = planFromSafetyCopy(copyText, P)!;
    expect(plan.mode).toBe('copie');
    expect(dryRunLoad(plan.docText, plan.cartText).ok).toBe(true);
    expect((await performRestore(B.m.kv, plan, { now: T0, origin: ORIGIN, keys: P })).ok).toBe(true);
    expect(B.m.business()).toEqual(beforeB);
    const back = storeOn(B.m.kv, PROD, 'z').getData();
    expect(back.cart.editingOrderId).toBe(B.editedOrderId);
    expect(back.cart.lines.length).toBeGreaterThan(0);
    // L'état restauré depuis le fichier devient la nouvelle copie (on peut revenir encore).
    expect((JSON.parse(B.m.map.get(P.safety)!) as BackupFile).stockage).toEqual(afterRestore);
  });
});

describe('6. échecs : jamais d’état partiel', () => {
  async function setup() {
    const A = stateA();
    const a = await okAnalysis(await exportOf(A.m.kv));
    const B = stateB();
    return { a, B, before: B.m.business() };
  }

  it('copie de sécurité impossible (stockage plein) : restauration bloquée, rien n’est modifié', async () => {
    const { a, B, before } = await setup();
    const snapshot = B.m.snapshot();
    B.m.failOn((k) => k === P.safety);
    const outcome = await performRestore(B.m.kv, fileFor(a), { now: T0, origin: ORIGIN, keys: P });
    expect(outcome).toMatchObject({ ok: false, changed: false, error: expect.stringMatching(/Copie de sécurité impossible/) });
    expect(B.m.snapshot()).toBe(snapshot);
    expect(B.m.business()).toEqual(before);
  });

  it('trace, panier ou données impossibles à écrire : données d’origine intactes, trace supprimée', async () => {
    for (const key of [P.journal, P.cart, P.doc]) {
      const { a, B, before } = await setup();
      B.m.failOn((k) => k === key);
      const outcome = await performRestore(B.m.kv, fileFor(a), { now: T0, origin: ORIGIN, keys: P });
      expect(outcome, key).toMatchObject({ ok: false, changed: false });
      expect(B.m.business(), key).toEqual(before);
      expect(B.m.map.has(P.journal), key).toBe(false);
    }
  });

  it('données modifiées pendant la préparation : abandon sans écriture', async () => {
    const { a, B } = await setup();
    const pending = performRestore(B.m.kv, fileFor(a), { now: T0, origin: ORIGIN, keys: P });
    B.m.map.set(P.doc, B.m.map.get(P.doc)!.replace('"orders"', '"orders" ')); // autre écriture pendant le calcul des empreintes
    const changed = B.m.map.get(P.doc);
    expect(await pending).toMatchObject({ ok: false, changed: false, error: expect.stringMatching(/ont changé/) });
    expect(B.m.map.get(P.doc)).toBe(changed);
  });

  it('échec en cours d’écriture ET du retour arrière : la trace reste, le démarrage suivant rétablit l’état d’avant', async () => {
    const { a, B, before } = await setup();
    let cartWrites = 0;
    B.m.failOn((k) => k === P.doc || (k === P.cart && ++cartWrites > 1));
    const outcome = await performRestore(B.m.kv, fileFor(a), { now: T0, origin: ORIGIN, keys: P });
    expect(outcome).toMatchObject({ ok: false, changed: true });
    expect(B.m.map.has(P.journal)).toBe(true);
    expect(B.m.business()).not.toEqual(before); // panier vide écrit : état partiel sur le disque
    B.m.failOn(() => false);
    expect(recoverInterruptedRestore(B.m.kv, T0.getTime() + JOURNAL_FRESH_MS + 1, P)).toEqual({ state: 'retablie' });
    expect(B.m.business()).toEqual(before);
    expect(B.m.map.has(P.journal)).toBe(false);
    expect(storeOn(B.m.kv, PROD, 'y').getPersistError()).toBeNull();
  });
});

describe('7. reprise au démarrage (trace d’opération)', () => {
  async function interrupted() {
    const A = stateA();
    const a = await okAnalysis(await exportOf(A.m.kv));
    const B = stateB();
    const before = B.m.business();
    await performRestore(B.m.kv, fileFor(a), { now: T0, origin: ORIGIN, keys: P });
    const done = B.m.business();
    return { A, B, a, before, done };
  }
  const later = T0.getTime() + JOURNAL_FRESH_MS + 1;

  it('aucune trace : rien à faire', () => {
    expect(recoverInterruptedRestore(memory().kv, later, P)).toEqual({ state: 'aucune' });
  });

  it('trace récente : opération peut-être en cours dans un autre onglet, rien n’est touché', async () => {
    const { B } = await interrupted();
    B.m.map.set(P.journal, JSON.stringify({ v: 1, debut: T0.toISOString(), mode: 'fichier', cible: { donnees: { longueur: 1, somme: 'x' }, panier: null } }));
    const snapshot = B.m.snapshot();
    expect(recoverInterruptedRestore(B.m.kv, T0.getTime() + 1000, P)).toEqual({ state: 'en-cours' });
    expect(B.m.snapshot()).toBe(snapshot);
  });

  it('trace restée alors que tout était écrit : opération terminée, seule la trace est supprimée', async () => {
    const { B, done, a } = await interrupted();
    const cart = B.m.map.get(P.cart)!;
    B.m.map.set(P.journal, JSON.stringify({ v: 1, debut: T0.toISOString(), mode: 'fichier', cible: { donnees: { longueur: a.docText.length, somme: checksum(a.docText) }, panier: { longueur: cart.length, somme: checksum(cart) } } }));
    expect(recoverInterruptedRestore(B.m.kv, later, P)).toEqual({ state: 'terminee' });
    expect(B.m.business()).toEqual(done);
    expect(B.m.map.has(P.journal)).toBe(false);
  });

  it('interruption entre le panier et les données : état d’avant rétabli (jamais d’état partiel chargé)', async () => {
    const { B, before, a } = await interrupted();
    // Situation du disque après une coupure : panier vide écrit, données encore anciennes.
    const copy = JSON.parse(B.m.map.get(P.safety)!) as BackupFile;
    B.m.map.set(P.doc, copy.stockage[P.doc]);
    B.m.map.set(P.journal, JSON.stringify({ v: 1, debut: T0.toISOString(), mode: 'fichier', cible: { donnees: { longueur: a.docText.length, somme: checksum(a.docText) }, panier: null } }));
    expect(recoverInterruptedRestore(B.m.kv, later, P)).toEqual({ state: 'retablie' });
    expect(B.m.business()).toEqual(before);
  });

  it('trace illisible : retour à la copie ; copie absente : rien n’est touché, la trace reste', async () => {
    const { B, before } = await interrupted();
    B.m.map.set(P.journal, '{coupé');
    expect(recoverInterruptedRestore(B.m.kv, later, P)).toEqual({ state: 'retablie' });
    expect(B.m.business()).toEqual(before);

    B.m.map.set(P.journal, '{coupé');
    B.m.map.delete(P.safety);
    const snapshot = B.m.snapshot();
    expect(recoverInterruptedRestore(B.m.kv, later, P).state).toBe('echec');
    expect(B.m.snapshot()).toBe(snapshot);
  });
});

describe('8. store : écritures suspendues pendant la restauration', () => {
  it('panier en attente abandonné, aucune écriture (pas même à la fermeture de la page), reprise possible', () => {
    const B = stateB();
    const s = B.s;
    const cartBefore = B.m.map.get(P.cart);
    s.setOrderNote('saisie en cours'); // enregistrement différé
    s.suspendWrites('Restauration en cours');
    s.flushPendingWrites(); // ce que fait la fermeture de la page
    expect(B.m.map.get(P.cart)).toBe(cartBefore);
    expect(s.getPersistError()).toBe('Restauration en cours');
    const docBefore = B.m.map.get(P.doc);
    expect(s.createCustomer({ lastName: 'Bloquée', firstName: '', phone: '0699887766', address: '', postalCode: '', city: '', complement: '', instructions: '' }).ok).toBe(false);
    expect(B.m.map.get(P.doc)).toBe(docBefore);
    s.resumeWrites();
    expect(s.getPersistError()).toBeNull();
    s.setOrderNote('reprise');
    s.flushPendingWrites();
    expect(JSON.parse(B.m.map.get(P.cart)!).note).toBe('reprise');
  });

  it('données illisibles (mode protégé) : la restauration permet d’en sortir', async () => {
    const A = stateA();
    const a = await okAnalysis(await exportOf(A.m.kv));
    const m = memory({ [P.doc]: '{corrompu', [P.cart]: '{}' });
    const locked = storeOn(m.kv);
    expect(locked.isStorageLocked()).toBe(true);
    expect((await performRestore(m.kv, fileFor(a), { now: T0, origin: ORIGIN, keys: P })).ok).toBe(true);
    expect((JSON.parse(m.map.get(P.safety)!) as BackupFile).stockage[P.doc]).toBe('{corrompu');
    const fresh = storeOn(m.kv, PROD, 'f');
    expect(fresh.isStorageLocked()).toBe(false);
    expect(fresh.getData().orders.length).toBe(A.s.getData().orders.length);
  });
});

describe('9. interface (contrat)', () => {
  const card = readFileSync(new URL('../src/components/settings/RestoreCard.tsx', import.meta.url), 'utf8');
  const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');

  it('annonce le remplacement sans fusion, le panier non repris et le panier actuel remplacé', () => {
    expect(card).toContain('seront remplacées par celles du fichier, sans fusion');
    expect(card).toContain('ne sera pas repris');
    expect(card).toContain('sera remplacé par un panier vide');
    expect(card).toContain('Retour arrière complet');
  });

  it('vérifie les autres onglets avant d’écrire, suspend le store, puis recharge', () => {
    const order = ['otherTabs()', 'suspendWrites(', 'announceRestore()', 'performRestore(', 'window.location.reload()'].map((s) => card.indexOf(s));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((x, y) => x - y)).toEqual(order);
  });

  it('au démarrage : reprise d’une restauration interrompue AVANT la création du store', () => {
    expect(main.indexOf('recoverInterruptedRestore(')).toBeGreaterThan(0);
    expect(main.indexOf('recoverInterruptedRestore(')).toBeLessThan(main.indexOf('createAppStore('));
    expect(main).toContain('restoreKeysOfBuild.journal');
  });

  it('résumé de l’export inchangé (compatibilité des fichiers déjà exportés)', async () => {
    const A = stateA();
    const file = JSON.parse(await exportOf(A.m.kv)) as BackupFile;
    expect(Object.keys(file)).toEqual(['type', 'formatSauvegarde', 'application', 'exporteLe', 'origine', 'espaceDeStockage', 'stockage', 'integrite', 'resume']);
    expect(file.resume).toEqual(summarize(file.stockage, P.doc));
  });
});

describe('10. autres onglets de la même application', () => {
  it('un autre onglet ouvert est détecté ; production et prévisualisation ne se voient pas', async () => {
    const { createTabPresence } = await import('../src/storage/tabs');
    const seen = vi.fn();
    const a = createTabPresence(() => undefined, 'essai-onglets');
    expect(await a.otherTabs(50)).toBe(false);
    const b = createTabPresence(seen, 'essai-onglets');
    const other = createTabPresence(() => undefined, 'essai-autre-espace');
    expect(await a.otherTabs(50)).toBe(true);
    a.announceRestore();
    await new Promise((r) => setTimeout(r, 50));
    expect(seen).toHaveBeenCalled(); // l'autre onglet suspend ses écritures
    b.close();
    expect(await a.otherTabs(50)).toBe(false);
    a.close();
    other.close();
  });

  it('un onglet qui s’ouvre pendant la vérification bloque la restauration', async () => {
    const { createTabPresence } = await import('../src/storage/tabs');
    const a = createTabPresence(() => undefined, 'essai-ouverture');
    const pending = a.otherTabs(100);
    const late = createTabPresence(() => undefined, 'essai-ouverture');
    expect(await pending).toBe(true);
    a.close();
    late.close();
  });
});
