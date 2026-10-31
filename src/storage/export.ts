import { STORAGE_KEY, STORAGE_NAMESPACE, parseStored } from './repository';

/**
 * Sauvegarde des données locales dans un fichier JSON (lecture seule).
 *
 * Le contenu de chaque clé est copié tel quel, à l'octet près : c'est lui qui servira à une future
 * restauration, sans dépendre du format interne de l'application. Rien n'est normalisé, réécrit ou supprimé.
 */

/** Ce dont l'export a besoin : uniquement de la lecture (aucune méthode d'écriture n'est exposée). */
export interface ReadableStore {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
}

export const BACKUP_TYPE = 'ferrari-manager-sauvegarde';
export const BACKUP_FORMAT = 1;

/** Repères lisibles pour vérifier à l'œil que le fichier est complet. */
export interface BackupSummary {
  /** false si les données principales sont absentes ou illisibles (elles sont tout de même copiées). */
  lisible: boolean;
  versionSchema: number | null;
  clients: number;
  commandes: number;
  commandesEnCours: number;
  commandesArchivees: number;
  commandesEncaissees: number;
  evenementsFidelite: number;
  prochainNumero: number | null;
  serviceOuvert: boolean | null;
  panierEnregistre: boolean;
  derniereCommande: string | null;
}

export interface BackupFile {
  type: typeof BACKUP_TYPE;
  formatSauvegarde: typeof BACKUP_FORMAT;
  application: 'Ferrari Manager';
  exporteLe: string;
  origine: string;
  espaceDeStockage: string;
  /** Contenu brut de chaque clé de l'application, sans aucune transformation. */
  stockage: Record<string, string>;
  /** Longueur et empreinte SHA-256 de chaque clé (null si le navigateur ne sait pas la calculer). */
  integrite: Record<string, { longueur: number; sha256: string | null }>;
  resume: BackupSummary;
}

export type BackupCheck = { ok: true; backup: BackupFile } | { ok: false; error: string };

/** Accès au stockage du navigateur, sans jamais lever d'exception (mode privé, stockage bloqué). */
export function browserStorage(): ReadableStore | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Toutes les clés de l'application (`<espace>:…`), y compris le panier. Les autres sites de l'origine sont ignorés. */
export function readAppKeys(store: ReadableStore, namespace = STORAGE_NAMESPACE): Record<string, string> {
  const prefix = `${namespace}:`;
  const keys: string[] = [];
  for (let i = 0; i < store.length; i++) {
    const k = store.key(i);
    if (k !== null && k.startsWith(prefix)) keys.push(k);
  }
  const out: Record<string, string> = {};
  for (const k of keys.sort()) {
    const v = store.getItem(k);
    if (v !== null) out[k] = v;
  }
  return out;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Résumé calculé sur les données brutes, sans les normaliser. */
export function summarize(stockage: Record<string, string>, docKey = STORAGE_KEY): BackupSummary {
  const parsed = parseStored(stockage[docKey] ?? null);
  const doc = parsed.kind === 'data' && isObject(parsed.value) ? parsed.value : null;
  const orders = list(doc?.orders).filter(isObject);
  const dates = orders.map((o) => o.createdAt).filter((d): d is string => typeof d === 'string').sort();
  return {
    lisible: doc !== null,
    versionSchema: typeof doc?.schemaVersion === 'number' ? doc.schemaVersion : null,
    clients: list(doc?.customers).length,
    commandes: orders.length,
    commandesEnCours: orders.filter((o) => !o.archivedAt).length,
    commandesArchivees: orders.filter((o) => Boolean(o.archivedAt)).length,
    commandesEncaissees: orders.filter((o) => isObject(o.payment) && o.payment.status === 'encaissee').length,
    evenementsFidelite: list(doc?.loyaltyEvents).length,
    prochainNumero: isObject(doc?.counters) && typeof doc.counters.nextOrderNumber === 'number' ? doc.counters.nextOrderNumber : null,
    serviceOuvert: typeof doc?.serviceOpen === 'boolean' ? doc.serviceOpen : null,
    panierEnregistre: Object.keys(stockage).some((k) => k !== docKey && k.endsWith(':panier')),
    derniereCommande: dates.length ? dates[dates.length - 1] : null,
  };
}

/** Empreinte SHA-256 en hexadécimal ; null si l'API n'est pas disponible (page non sécurisée). */
export async function sha256(text: string): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** `namespace` : espace à copier (par défaut celui du build ; la copie de sécurité de la restauration le précise). */
export async function createBackup(store: ReadableStore, options: { now: Date; origin: string; namespace?: string }): Promise<BackupFile> {
  const namespace = options.namespace ?? STORAGE_NAMESPACE;
  const stockage = readAppKeys(store, namespace);
  const integrite: BackupFile['integrite'] = {};
  for (const [k, v] of Object.entries(stockage)) integrite[k] = { longueur: v.length, sha256: await sha256(v) };
  return {
    type: BACKUP_TYPE,
    formatSauvegarde: BACKUP_FORMAT,
    application: 'Ferrari Manager',
    exporteLe: options.now.toISOString(),
    origine: options.origin,
    espaceDeStockage: namespace,
    stockage,
    integrite,
    resume: summarize(stockage, `${namespace}:v1`),
  };
}

export function backupToText(backup: BackupFile): string {
  return JSON.stringify(backup, null, 2);
}

/** Nom du fichier avec la date et l'heure locales, ex. ferrari-manager-sauvegarde-2026-10-30-14h05-09.json */
export function backupFileName(now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `ferrari-manager-sauvegarde-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}-${p(now.getHours())}h${p(now.getMinutes())}-${p(now.getSeconds())}.json`;
}

/**
 * Vérifie un fichier de sauvegarde : structure, longueur et empreinte de chaque clé, résumé recalculé.
 * Utilisée juste après la création du fichier (sur le texte exact téléchargé) et réutilisable pour relire un fichier.
 */
export async function verifyBackupText(text: string): Promise<BackupCheck> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'Fichier illisible (JSON incomplet ou corrompu).' };
  }
  if (!isObject(raw) || raw.type !== BACKUP_TYPE || raw.formatSauvegarde !== BACKUP_FORMAT) {
    return { ok: false, error: 'Ce fichier n’est pas une sauvegarde Ferrari Manager reconnue.' };
  }
  if (!isObject(raw.stockage) || !isObject(raw.integrite) || !isObject(raw.resume)) return { ok: false, error: 'Sauvegarde incomplète.' };
  const stockage = raw.stockage as Record<string, unknown>;
  const integrite = raw.integrite as Record<string, unknown>;
  const keys = Object.keys(stockage);
  if (keys.length !== Object.keys(integrite).length) return { ok: false, error: 'Liste des données incohérente.' };
  for (const k of keys) {
    const v = stockage[k];
    const check = integrite[k];
    if (typeof v !== 'string' || !isObject(check)) return { ok: false, error: `Donnée « ${k} » incomplète.` };
    if (check.longueur !== v.length) return { ok: false, error: `Donnée « ${k} » tronquée.` };
    if (typeof check.sha256 === 'string') {
      const actual = await sha256(v);
      if (actual !== null && actual !== check.sha256) return { ok: false, error: `Donnée « ${k} » modifiée (empreinte différente).` };
    }
  }
  const docKey = `${typeof raw.espaceDeStockage === 'string' ? raw.espaceDeStockage : STORAGE_NAMESPACE}:v1`;
  if (JSON.stringify(summarize(stockage as Record<string, string>, docKey)) !== JSON.stringify(raw.resume)) {
    return { ok: false, error: 'Le résumé ne correspond pas au contenu.' };
  }
  return { ok: true, backup: raw as unknown as BackupFile };
}

/** Le fichier contient-il exactement ce que le navigateur a enregistré à cet instant ? */
export function matchesStorage(backup: BackupFile, store: ReadableStore): boolean {
  return JSON.stringify(backup.stockage) === JSON.stringify(readAppKeys(store, backup.espaceDeStockage));
}
