import { createAppStore } from './store';
import { createKeyValueRepository, type KeyValueStore } from '../storage/repository';
import { factsFrom, type RestoreFacts } from '../storage/restore';
import type { AppData } from '../storage/schema';
import { demoCatalog } from '../data/catalog';
import { buildDemoData } from '../data/seed';
import { emptyCart } from '../domain/cart';
import { computeBalance } from '../domain/loyalty';
import { createId } from '../domain/ids';

/** Panier vide d'une restauration ordinaire (aucune modification de commande reprise). */
export function emptyCartText(): string {
  return JSON.stringify(emptyCart(createId('ord')));
}

export function factsOf(data: AppData): RestoreFacts {
  return factsFrom(data, (id) => computeBalance(data.loyaltyEvents, id, data.settings.loyalty));
}

/**
 * Chargement à blanc : le VRAI store de l'application lit les textes à restaurer, en mémoire seulement.
 * Aucune clé du navigateur n'est lue ni écrite (stockage simulé par une Map) et aucun effet n'est branché
 * (pas de son ; l'impression n'est jamais déclenchée par le chargement). Si le store ne chargerait pas
 * ces données normalement (mode protégé), la restauration est refusée.
 */
export function dryRunLoad(docText: string, cartText: string | null): { ok: true; data: AppData; facts: RestoreFacts } | { ok: false; reason: string } {
  const map = new Map<string, string>([['essai:v1', docText]]);
  if (cartText !== null) map.set('essai:v1:panier', cartText);
  const kv: KeyValueStore = {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
  try {
    const store = createAppStore({ repo: createKeyValueRepository(kv, 'essai:v1', 'essai:v1:panier'), catalog: demoCatalog, seed: buildDemoData });
    const error = store.getPersistError();
    if (error) return { ok: false, reason: error };
    const data = store.getData();
    return { ok: true, data, facts: factsOf(data) };
  } catch {
    return { ok: false, reason: 'Données impossibles à charger par l’application.' };
  }
}
