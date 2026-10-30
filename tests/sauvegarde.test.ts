import { describe, expect, it } from 'vitest';
import { createTestStore } from './helpers';
import { CART_KEY, STORAGE_KEY, createMemoryRepository } from '../src/storage/repository';
import {
  BACKUP_TYPE,
  backupFileName,
  backupToText,
  createBackup,
  matchesStorage,
  readAppKeys,
  sha256,
  verifyBackupText,
  type ReadableStore,
} from '../src/storage/export';

/** Stockage espion : toute tentative d'écriture lève une erreur et chaque accès est noté. */
function spyStorage(entries: Record<string, string>) {
  const keys = Object.keys(entries);
  const used = new Set<string>();
  const writes: string[] = [];
  const target = {
    get length() {
      return keys.length;
    },
    key: (i: number) => keys[i] ?? null,
    getItem: (k: string) => entries[k] ?? null,
    setItem: (k: string) => {
      writes.push(`setItem ${k}`);
      throw new Error('écriture interdite');
    },
    removeItem: (k: string) => {
      writes.push(`removeItem ${k}`);
      throw new Error('suppression interdite');
    },
    clear: () => {
      writes.push('clear');
      throw new Error('effacement interdit');
    },
  };
  const store = new Proxy(target, {
    get(t, p, r) {
      used.add(String(p));
      return Reflect.get(t, p, r);
    },
  }) as ReadableStore;
  return { store, used, writes };
}

/** Données réelles du store : une commande encaissée, une annulée, un service fermé, un panier en cours. */
function realData() {
  const t = createTestStore();
  const jean = t.customer('Dupont');
  t.store.selectCustomer(jean.id);
  t.store.addProduct('reine');
  t.store.addProduct('royale');
  const a = t.store.validateCart();
  if (!a.ok) throw new Error(a.error);
  t.store.markOrderPaid(a.value.id, 'carte');
  t.store.addProduct('margarita');
  const b = t.store.validateCart();
  if (!b.ok) throw new Error(b.error);
  t.store.cancelOrder(b.value.id);
  t.store.closeService();
  t.store.addProduct('calzone'); // panier en cours, non validé
  t.store.flushPendingWrites();
  const doc = t.repo.raw()!;
  const cart = t.repo.rawCart()!;
  return { t, doc, cart };
}

const now = new Date('2026-10-30T14:05:09');
const origin = 'https://lupo1313.github.io/ferrari-manager/';

describe('sauvegarde des données locales', () => {
  it('copie à l’identique les clés de l’application, et seulement elles', async () => {
    const { doc, cart } = realData();
    const { store } = spyStorage({
      [STORAGE_KEY]: doc,
      [CART_KEY]: cart,
      'ferrari-manager-apercu-i3:v1': '{"aperçu":true}',
      'autre-site:reglages': 'x',
    });
    const backup = await createBackup(store, { now, origin });
    expect(backup.type).toBe(BACKUP_TYPE);
    expect(backup.exporteLe).toBe(now.toISOString());
    expect(backup.stockage).toEqual({ [STORAGE_KEY]: doc, [CART_KEY]: cart });
    expect(backup.integrite[STORAGE_KEY]).toEqual({ longueur: doc.length, sha256: await sha256(doc) });
  });

  it('aucune écriture : seules la lecture des clés et des valeurs sont utilisées', async () => {
    const { doc, cart } = realData();
    const spy = spyStorage({ [STORAGE_KEY]: doc, [CART_KEY]: cart });
    const backup = await createBackup(spy.store, { now, origin });
    await verifyBackupText(backupToText(backup));
    expect(matchesStorage(backup, spy.store)).toBe(true);
    expect(spy.writes).toEqual([]);
    expect([...spy.used].every((p) => ['length', 'key', 'getItem'].includes(p))).toBe(true);
  });

  it('l’état de l’application et son stockage restent identiques après l’export', async () => {
    const { t, doc, cart } = realData();
    const before = { data: t.store.getData(), saves: t.repo.control.saves, cartSaves: t.repo.control.cartSaves };
    await createBackup(spyStorage({ [STORAGE_KEY]: doc, [CART_KEY]: cart }).store, { now, origin });
    expect(t.repo.raw()).toBe(doc);
    expect(t.repo.rawCart()).toBe(cart);
    expect(t.repo.control.saves).toBe(before.saves);
    expect(t.repo.control.cartSaves).toBe(before.cartSaves);
    expect(t.store.getData()).toBe(before.data);
  });

  it('résumé fidèle : commandes, encaissements, clients, fidélité, service, panier', async () => {
    const { t, doc, cart } = realData();
    const d = t.store.getData();
    const backup = await createBackup(spyStorage({ [STORAGE_KEY]: doc, [CART_KEY]: cart }).store, { now, origin });
    expect(backup.resume).toMatchObject({
      lisible: true,
      versionSchema: 1,
      clients: d.customers.length,
      commandes: d.orders.length,
      commandesEncaissees: d.orders.filter((o) => o.payment.status === 'encaissee').length,
      evenementsFidelite: d.loyaltyEvents.length,
      prochainNumero: d.counters.nextOrderNumber,
      serviceOuvert: false,
      panierEnregistre: true,
    });
    expect(backup.resume.commandesEnCours + backup.resume.commandesArchivees).toBe(d.orders.length);
  });

  it('suffit à une restauration : le contenu recopié se recharge à l’identique', async () => {
    const { t, doc, cart } = realData();
    const text = backupToText(await createBackup(spyStorage({ [STORAGE_KEY]: doc, [CART_KEY]: cart }).store, { now, origin }));
    const restored = JSON.parse(text).stockage;
    const reloaded = createTestStore(createMemoryRepository(undefined, restored[STORAGE_KEY], restored[CART_KEY])).store;
    expect(reloaded.getPersistError()).toBeNull();
    expect(reloaded.getData()).toEqual(t.store.getData());
  });
});

describe('vérification de l’intégrité du fichier', () => {
  const build = async () => {
    const { doc, cart } = realData();
    return backupToText(await createBackup(spyStorage({ [STORAGE_KEY]: doc, [CART_KEY]: cart }).store, { now, origin }));
  };

  it('fichier intact : accepté', async () => {
    const r = await verifyBackupText(await build());
    expect(r.ok).toBe(true);
  });

  it('fichier tronqué (téléchargement interrompu) : refusé', async () => {
    const text = await build();
    expect((await verifyBackupText(text.slice(0, text.length - 40))).ok).toBe(false);
  });

  it('donnée modifiée, raccourcie ou résumé falsifié : refusé', async () => {
    const original = JSON.parse(await build());
    const altered = structuredClone(original);
    altered.stockage[STORAGE_KEY] = altered.stockage[STORAGE_KEY].replace('Dupont', 'Dupond');
    const r1 = await verifyBackupText(JSON.stringify(altered));
    expect(!r1.ok && r1.error).toContain('modifiée');

    const shortened = structuredClone(original);
    shortened.stockage[CART_KEY] = shortened.stockage[CART_KEY].slice(1);
    const r2 = await verifyBackupText(JSON.stringify(shortened));
    expect(!r2.ok && r2.error).toContain('tronquée');

    const fakeSummary = structuredClone(original);
    fakeSummary.resume.commandes += 1;
    expect((await verifyBackupText(JSON.stringify(fakeSummary))).ok).toBe(false);

    const missingKey = structuredClone(original);
    delete missingKey.stockage[CART_KEY];
    expect((await verifyBackupText(JSON.stringify(missingKey))).ok).toBe(false);
  });

  it('autre fichier JSON : refusé', async () => {
    expect((await verifyBackupText('{"type":"autre"}')).ok).toBe(false);
  });

  it('le fichier ne correspond plus au stockage si les données ont changé entre-temps', async () => {
    const { doc, cart } = realData();
    const backup = await createBackup(spyStorage({ [STORAGE_KEY]: doc, [CART_KEY]: cart }).store, { now, origin });
    expect(matchesStorage(backup, spyStorage({ [STORAGE_KEY]: doc, [CART_KEY]: cart.replace('calzone', 'reine') }).store)).toBe(false);
  });
});

describe('cas particuliers', () => {
  it('données illisibles : copiées telles quelles et signalées, jamais réparées', async () => {
    const broken = '{"schemaVersion":1,"orders":[{"id":';
    const backup = await createBackup(spyStorage({ [STORAGE_KEY]: broken }).store, { now, origin });
    expect(backup.stockage[STORAGE_KEY]).toBe(broken);
    expect(backup.resume.lisible).toBe(false);
    expect((await verifyBackupText(backupToText(backup))).ok).toBe(true);
  });

  it('aucune donnée : sauvegarde vide (l’interface refuse alors de proposer un fichier)', async () => {
    expect(readAppKeys(spyStorage({ 'autre:cle': 'x' }).store)).toEqual({});
  });

  it('nom du fichier avec la date et l’heure locales', () => {
    expect(backupFileName(now)).toBe('ferrari-manager-sauvegarde-2026-10-30-14h05-09.json');
  });
});
