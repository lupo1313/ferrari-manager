import { describe, expect, it } from 'vitest';
import { createAppStore } from '../src/state/store';
import {
  CART_KEY,
  createKeyValueRepository,
  DEFAULT_STORAGE_NAMESPACE,
  STORAGE_KEY,
  storageNamespace,
  type KeyValueStore,
} from '../src/storage/repository';
import { demoCatalog } from '../src/data/catalog';
import { buildDemoData } from '../src/data/seed';
import type { IdFactory } from '../src/domain/ids';

/** Un seul localStorage partagé, comme deux sites sur la même origine (lupo1313.github.io). */
function sharedStorage() {
  const map = new Map<string, string>();
  const kv: KeyValueStore = {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
  return { map, kv };
}

function storeFor(kv: KeyValueStore, ns: string, prefix: string) {
  let n = 0;
  const newId: IdFactory = (p) => `${p}_${prefix}${++n}`;
  return createAppStore({
    repo: createKeyValueRepository(kv, `${ns}:v1`, `${ns}:v1:panier`),
    catalog: demoCatalog,
    seed: buildDemoData,
    now: () => new Date('2026-10-30T19:00:00'),
    newId,
  });
}

describe('prévisualisation : stockage isolé de la version actuelle', () => {
  it('le build normal garde exactement les clés actuelles', () => {
    expect(STORAGE_KEY).toBe('ferrari-manager:v1');
    expect(CART_KEY).toBe('ferrari-manager:v1:panier');
  });

  it('espace de noms invalide ou absent : retour aux clés par défaut', () => {
    expect(storageNamespace(undefined)).toBe(DEFAULT_STORAGE_NAMESPACE);
    expect(storageNamespace('')).toBe(DEFAULT_STORAGE_NAMESPACE);
    expect(storageNamespace('Ferrari Manager!')).toBe(DEFAULT_STORAGE_NAMESPACE);
    expect(storageNamespace('ferrari-manager-apercu-i3')).toBe('ferrari-manager-apercu-i3');
  });

  it('même origine : la prévisualisation ne lit ni n’écrase les données de la version actuelle', () => {
    const { map, kv } = sharedStorage();
    // Version actuelle : une commande enregistrée.
    const prod = storeFor(kv, 'ferrari-manager', 'p');
    prod.addProduct('reine');
    expect(prod.validateCart().ok).toBe(true);
    const prodBefore = map.get('ferrari-manager:v1');
    const prodCartBefore = map.get('ferrari-manager:v1:panier');

    // Prévisualisation sur le même stockage : elle démarre sur la démo, sans voir la commande.
    const apercu = storeFor(kv, 'ferrari-manager-apercu-i3', 'a');
    expect(apercu.getData().orders).toHaveLength(2);
    apercu.addProduct('royale');
    apercu.validateCart();
    apercu.resetDemoData(); // même la réinitialisation ne touche que ses propres clés

    expect(map.get('ferrari-manager:v1')).toBe(prodBefore);
    expect(map.get('ferrari-manager:v1:panier')).toBe(prodCartBefore);
    expect(storeFor(kv, 'ferrari-manager', 'q').getData().orders).toHaveLength(3);
    expect([...map.keys()].sort()).toEqual([
      'ferrari-manager-apercu-i3:v1',
      'ferrari-manager-apercu-i3:v1:panier',
      'ferrari-manager:v1',
      'ferrari-manager:v1:panier',
    ]);
  });

  it('protections conservées : un JSON corrompu dans la prévisualisation n’est pas écrasé et n’affecte pas l’autre version', () => {
    const { map, kv } = sharedStorage();
    map.set('ferrari-manager-apercu-i3:v1', '{"schemaVersion":1,"orders":[');
    const apercu = storeFor(kv, 'ferrari-manager-apercu-i3', 'a');
    expect(apercu.getPersistError()).toBeTruthy();
    expect(map.get('ferrari-manager-apercu-i3:v1')).toBe('{"schemaVersion":1,"orders":[');
    const prod = storeFor(kv, 'ferrari-manager', 'p');
    expect(prod.getPersistError()).toBeNull();
  });
});
