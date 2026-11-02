import { closedState, closureBlockers, exportsConfirmed, type ClosureChoices, type ClosureReceipts } from '../domain/closure';
import type { AppData } from './schema';
import { normalizeAppData } from './schema';
import { backupToText, createBackup, readAppKeys } from './export';
import { analyzeBackupText, checksum, restoreKeys, type StorageAccess } from './restore';
import { STORAGE_NAMESPACE } from './repository';
import type { TabPresence } from './tabs';

export const closureKey = (namespace = STORAGE_NAMESPACE) => `${namespace}-cloture-en-cours`;
export interface ClosurePreparation {
  id: string; at: string; namespace: string; before: Record<string, string>;
  after: AppData; docText: string; cartText: string; backupText: string;
}
interface Journal {
  v: 1; at: string; beforeLength: number; beforeHash: string; docText: string; cartText: string;
}

export async function prepareClosure(kv: StorageAccess, data: AppData, at: Date, id: string, namespace = STORAGE_NAMESPACE): Promise<ClosurePreparation> {
  const keys = restoreKeys(namespace);
  if (kv.getItem(keys.journal) !== null || kv.getItem(closureKey(namespace)) !== null) throw new Error('Une restauration ou une clôture est déjà en cours. Rechargez la page.');
  if (closureBlockers(data).blocked) throw new Error('Des éléments restent à résoudre.');
  const before = readAppKeys(kv, namespace);
  const raw = JSON.parse(before[keys.doc]);
  const loaded = normalizeAppData({ ...raw, cart: before[keys.cart] ? JSON.parse(before[keys.cart]) : raw.cart }, {
    settings: data.settings, newCartId: () => data.cart.draftId, nowIso: at.toISOString(),
  });
  const canonical = (value: unknown): string => JSON.stringify(value, (_key, v) =>
    v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);
  if (!loaded.ok || canonical(loaded.data) !== canonical(data)) throw new Error('Les données affichées ne correspondent plus au stockage. Rechargez la page.');
  const after = closedState(data, at.toISOString(), id);
  const { cart, ...durable } = after;
  const { cart: _legacyCart, ...rawDurable } = raw;
  void _legacyCart;
  const docText = JSON.stringify({ ...rawDurable, ...durable, cloture: { id, at: at.toISOString() } });
  const cartText = JSON.stringify(cart);
  const map = new Map(Object.entries({ ...before, [keys.doc]: docText, [keys.cart]: cartText }));
  const virtual = { get length() { return map.size; }, key: (i: number) => [...map.keys()][i] ?? null, getItem: (k: string) => map.get(k) ?? null };
  const backupText = backupToText(await createBackup(virtual, { now: at, origin: windowOrigin(), namespace }));
  const checked = await analyzeBackupText(backupText, namespace);
  if (!checked.ok) throw new Error('Sauvegarde de reprise invalide : ' + checked.problems.map((p) => p.message).join(' '));
  if (JSON.stringify(before) !== JSON.stringify(readAppKeys(kv, namespace))) throw new Error('Les données ont changé. Recommencez la préparation.');
  return { id, at: at.toISOString(), namespace, before, after, docText, cartText, backupText };
}
function windowOrigin() { return typeof window === 'undefined' ? 'test-local' : window.location.origin + window.location.pathname; }

/** Après l'écriture principale, on termine toujours le nettoyage, jamais un retour aux anciennes commandes. */
function finish(kv: StorageAccess, j: Journal, namespace: string) {
  const keys = restoreKeys(namespace);
  kv.setItem(keys.cart, j.cartText);
  if (kv.getItem(keys.cart) !== j.cartText) throw new Error('Panier non relu.');
  // L'ancienne copie de restauration pourrait réintroduire les commandes retirées : elle est explicitement supprimée.
  kv.removeItem(keys.safety);
  if (kv.getItem(keys.safety) !== null) throw new Error('Copie non supprimée.');
  kv.removeItem(closureKey(namespace));
  if (kv.getItem(closureKey(namespace)) !== null) throw new Error('Trace non supprimée.');
}
export type ClosureOutcome = { ok: true } | { ok: false; committed: boolean; error: string };
export function commitClosure(kv: StorageAccess, p: ClosurePreparation, choices: ClosureChoices, generated: ClosureReceipts, saved: ClosureReceipts, finalConfirmed: boolean): ClosureOutcome {
  let committed = false;
  let ownJournal = false;
  const key = closureKey(p.namespace), keys = restoreKeys(p.namespace);
  try {
    if (!finalConfirmed || !exportsConfirmed(choices, generated, saved)) throw new Error('Confirmez chaque fichier demandé et la suppression finale.');
    if (kv.getItem(key) !== null || kv.getItem(keys.journal) !== null) throw new Error('Une opération est déjà en cours. Rechargez la page.');
    if (JSON.stringify(readAppKeys(kv, p.namespace)) !== JSON.stringify(p.before)) throw new Error('Les données ont changé depuis la préparation. Aucune suppression : recommencez.');
    const beforeDoc = p.before[keys.doc];
    const j: Journal = { v: 1, at: p.at, beforeLength: beforeDoc.length, beforeHash: checksum(beforeDoc), docText: p.docText, cartText: p.cartText };
    kv.setItem(key, JSON.stringify(j));
    ownJournal = true;
    if (kv.getItem(key) !== JSON.stringify(j)) throw new Error('Trace de clôture non relue.');
    if (JSON.stringify(readAppKeys(kv, p.namespace)) !== JSON.stringify(p.before)) throw new Error('Données modifiées par un autre onglet.');
    kv.setItem(keys.doc, p.docText); // POINT DE VALIDATION ATOMIQUE : clients et fidélité dans le même document.
    committed = true;
    if (kv.getItem(keys.doc) !== p.docText) throw new Error('État fermé non relu.');
    finish(kv, j, p.namespace);
    return { ok: true };
  } catch (e) {
    if (!committed && ownJournal) {
      try { kv.removeItem(key); } catch { /* La reprise annulera la trace sans toucher aux données. */ }
    }
    return { ok: false, committed, error: committed
      ? 'État fermé enregistré. Nettoyage à terminer : rechargez la page. Les clients et la fidélité sont conservés.'
      : (e instanceof Error ? e.message : 'Clôture impossible. Aucune suppression.') };
  }
}

export function recoverClosure(kv: StorageAccess, namespace = STORAGE_NAMESPACE): 'none' | 'cancelled' | 'completed' | 'blocked' {
  const key = closureKey(namespace), keys = restoreKeys(namespace);
  try {
    const text = kv.getItem(key);
    if (text === null) return 'none';
    const j = JSON.parse(text) as Journal;
    if (j.v !== 1 || typeof j.docText !== 'string' || typeof j.cartText !== 'string' || typeof j.beforeHash !== 'string') return 'blocked';
    const target = JSON.parse(j.docText), cart = JSON.parse(j.cartText);
    if (target.serviceOpen !== false || !Array.isArray(target.orders) || target.orders.length ||
      !Array.isArray(cart.lines) || cart.lines.length || cart.editingOrderId !== null) return 'blocked';
    const actual = kv.getItem(keys.doc);
    if (actual === j.docText) { finish(kv, j, namespace); return 'completed'; }
    if (actual !== null && actual.length === j.beforeLength && checksum(actual) === j.beforeHash) {
      kv.removeItem(key); return 'cancelled';
    }
    return 'blocked';
  } catch { return 'blocked'; }
}

/** Vérification impossible = refus. La fermeture destructive ne repose jamais sur un simple avertissement. */
export async function checkClosureTabs(presence: TabPresence | null): Promise<void> {
  const others = await (presence?.otherTabs() ?? Promise.resolve(null));
  if (others !== false) throw new Error(others ? 'Fermez les autres onglets ou fenêtres Ferrari Manager avant de clôturer.' : 'Vérification des autres onglets impossible sur ce navigateur : clôture bloquée.');
}
