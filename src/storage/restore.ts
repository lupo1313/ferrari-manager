import type { Customer, LoyaltyEvent, Order } from '../domain/types';
import { subtotal } from '../domain/pricing';
import { normalizePhone } from '../domain/customers';
import { TENDER_KINDS } from '../domain/payment';
import { LOYALTY_REASON_LABELS } from '../domain/loyalty';
import { DEFAULT_STORAGE_NAMESPACE, STORAGE_NAMESPACE, parseStored, storageNamespace } from './repository';
import { BACKUP_FORMAT, BACKUP_TYPE, backupToText, createBackup, readAppKeys, sha256, summarize, type BackupFile, type ReadableStore } from './export';
import { SCHEMA_VERSION, normalizeServices } from './schema';

/**
 * Restauration d'une sauvegarde JSON (intervention 8). Stockage local uniquement.
 *
 * Formats pris en charge : uniquement ceux produits par « Sauvegarder mes données » (export.ts),
 * `type: "ferrari-manager-sauvegarde"`, `formatSauvegarde: 1`, en deux variantes réellement produites :
 * - avec empreinte SHA-256 de chaque clé (page en https ou localhost : production, prévisualisation) ;
 * - sans empreinte (toutes à null) : page en http sur le réseau local (`npm run dev:tablette`), où le
 *   navigateur ne fournit pas le calcul SHA-256. Seule la longueur est alors contrôlée.
 * Une empreinte présente mais fausse, ou un mélange des deux variantes, est toujours refusé.
 *
 * Écriture : seules les deux clés métier du build en cours sont écrites (jamais un nom de clé lu dans
 * le fichier), après une copie de sécurité relue et une trace d'opération qui permet de reprendre ou
 * d'annuler au démarrage une restauration interrompue entre deux écritures.
 */

export interface RestoreKeys {
  namespace: string;
  doc: string;
  cart: string;
  /** Copie complète de l'état avant la dernière restauration (format d'export), hors des clés métier. */
  safety: string;
  /** Trace de l'opération en cours, supprimée quand les deux clés sont écrites et relues. */
  journal: string;
  /** Message à afficher après le rechargement (sessionStorage, propre à l'onglet). */
  notice: string;
}

export function restoreKeys(namespace = STORAGE_NAMESPACE): RestoreKeys {
  return {
    namespace,
    doc: `${namespace}:v1`,
    cart: `${namespace}:v1:panier`,
    safety: `${namespace}-copie-avant-restauration`,
    journal: `${namespace}-restauration-en-cours`,
    notice: `${namespace}-avis-restauration`,
  };
}

/** Fichier plus gros : refusé avant lecture détaillée (le stockage local est limité à environ 5 Mo). */
export const MAX_BACKUP_CHARS = 4_000_000;

/** Une trace plus récente que ce délai peut appartenir à une restauration en cours dans un autre onglet. */
export const JOURNAL_FRESH_MS = 15_000;

export type ProblemKind = 'fichier' | 'structure' | 'reference';
export interface Problem {
  kind: ProblemKind;
  message: string;
}

/** Contenu réel des données (après lecture normale par l'application). */
export interface RestoreFacts {
  clients: number;
  commandes: number;
  commandesEnCours: number;
  commandesArchivees: number;
  commandesEncaissees: number;
  commandesPaiementNonSuivi: number;
  services: number;
  serviceOuvert: boolean;
  prochainNumero: number;
  derniereCommande: string | null;
  evenementsFidelite: number;
  pizzasComptees: number;
  recompensesDisponibles: number;
  clientsEnDette: number;
}

/** Panier présent dans un fichier ou une copie (jamais repris par une restauration ordinaire). */
export interface CartFacts {
  articles: number;
  modificationCommande: number | null;
}

export interface AnalyzedBackup {
  ok: true;
  exporteLe: string | null;
  origine: string | null;
  espace: string;
  provenance: 'production' | 'previsualisation';
  empreinte: 'sha256' | 'absente';
  docText: string;
  /** Texte du panier du fichier, ou null s'il n'y en avait pas. */
  fileCartText: string | null;
  fileCart: CartFacts | null;
  /** Clés du fichier qui ne sont ni les données ni le panier : ignorées. */
  ignoredKeys: string[];
  /** Situations normales signalées (non bloquantes). */
  notes: string[];
}

export type Analysis = AnalyzedBackup | { ok: false; problems: Problem[] };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown, min: number) => typeof v === 'number' && Number.isInteger(v) && v >= min;
const isDate = (v: unknown) => typeof v === 'string' && v !== '' && !Number.isNaN(Date.parse(v));
const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

const ORDER_STATUSES: readonly unknown[] = ['a_preparer', 'en_preparation', 'prete', 'terminee', 'annulee'];
const ORDER_MODES: readonly unknown[] = ['livraison', 'emporter'];
const EVENT_TYPES: readonly unknown[] = ['points', 'rewards_used'];

/** Une même sauvegarde peut-elle être restaurée dans cet espace ? (production : la sienne ; prévisualisation : la sienne ou la production) */
export function acceptsNamespace(target: string, source: string): boolean {
  if (source === target) return true;
  return target !== DEFAULT_STORAGE_NAMESPACE && source === DEFAULT_STORAGE_NAMESPACE;
}

const MAX_LISTED = 8;
function limit(problems: Problem[]): Problem[] {
  if (problems.length <= MAX_LISTED) return problems;
  return [...problems.slice(0, MAX_LISTED), { kind: problems[MAX_LISTED].kind, message: `… et ${problems.length - MAX_LISTED} autre(s) problème(s).` }];
}

/**
 * Contrôles des données principales : structure (types, valeurs permises, montants cohérents) puis
 * références (client, commande, service). Les montants sont contrôlés sur les valeurs ENREGISTRÉES
 * (prix figés sur chaque ligne, frais de livraison historiques), jamais sur la carte actuelle :
 * sous-total = somme des lignes (règle inchangée depuis la V1), total = sous-total + frais.
 */
export function validateDocument(raw: unknown): { problems: Problem[]; notes: string[] } {
  const problems: Problem[] = [];
  const notes: string[] = [];
  const structure = (message: string) => problems.push({ kind: 'structure', message });
  const reference = (message: string) => problems.push({ kind: 'reference', message });

  if (!isObject(raw)) return { problems: [{ kind: 'structure', message: 'Données principales illisibles.' }], notes };
  if (raw.schemaVersion !== SCHEMA_VERSION) {
    return { problems: [{ kind: 'structure', message: `Version de données ${String(raw.schemaVersion)} non prise en charge (attendue : ${SCHEMA_VERSION}).` }], notes };
  }
  for (const key of ['customers', 'orders', 'loyaltyEvents'] as const) {
    if (!Array.isArray(raw[key]) || !(raw[key] as unknown[]).every(isObject)) {
      return { problems: [{ kind: 'structure', message: `Liste « ${key} » absente ou invalide.` }], notes };
    }
  }
  if (raw.settings !== undefined && !isObject(raw.settings)) structure('Paramètres invalides.');
  if (raw.counters !== undefined && !(isObject(raw.counters) && isInt(raw.counters.nextOrderNumber, 1))) structure('Compteur de numéros invalide.');

  // Clients
  const customers = raw.customers as Record<string, unknown>[];
  const customerIds = new Set<string>();
  const phones = new Map<string, string>();
  customers.forEach((c, i) => {
    const who = nonEmpty(c.id) ? `Client ${c.id}` : `Client n° ${i + 1}`;
    if (!nonEmpty(c.id)) return structure(`${who} : identifiant manquant.`);
    if (customerIds.has(c.id)) return structure(`${who} : identifiant en double.`);
    customerIds.add(c.id);
    if (typeof c.firstName !== 'string' || typeof c.lastName !== 'string' || typeof c.phone !== 'string') return structure(`${who} : nom ou téléphone invalide.`);
    const phone = normalizePhone(c.phone);
    if (!phone) return structure(`${who} : téléphone vide.`);
    if (phones.has(phone)) return structure(`${who} : même téléphone que le client ${phones.get(phone)} (doublon refusé par l’application).`);
    phones.set(phone, c.id);
  });

  // Services (complétés comme au chargement normal, pour reconnaître un service reconstitué)
  if (raw.services !== undefined) {
    const list = Array.isArray(raw.services) ? raw.services : null;
    const ids = new Set<string>();
    if (!list) structure('Historique des services invalide.');
    else
      list.forEach((s, i) => {
        if (!isObject(s) || !nonEmpty(s.id) || !isDate(s.openedAt) || !(s.closedAt === null || isDate(s.closedAt))) return structure(`Service n° ${i + 1} invalide.`);
        if (ids.has(s.id)) structure(`Service ${s.id} en double.`);
        ids.add(s.id);
      });
  }
  if (raw.serviceStartedAt !== undefined && !isDate(raw.serviceStartedAt)) structure('Date d’ouverture du service invalide.');
  if (raw.serviceOpen !== undefined && typeof raw.serviceOpen !== 'boolean') structure('État du service invalide.');
  const storedStartedAt = typeof raw.serviceStartedAt === 'string';
  const startedAt = storedStartedAt ? (raw.serviceStartedAt as string) : new Date(0).toISOString();
  const serviceIds = new Set(
    normalizeServices(raw.services, {
      startedAt,
      storedStartedAt,
      open: typeof raw.serviceOpen === 'boolean' ? raw.serviceOpen : true,
      closedAt: typeof raw.serviceClosedAt === 'string' ? raw.serviceClosedAt : null,
    }).map((s) => s.id),
  );

  // Commandes
  const orders = raw.orders as Record<string, unknown>[];
  const orderIds = new Set<string>();
  const activeNumbers = new Map<number, string>();
  let legacyPayments = 0;
  let historicFees = 0;
  orders.forEach((o, i) => {
    const who = nonEmpty(o.id) ? `Commande ${isInt(o.number, 1) ? `n° ${o.number as number} ` : ''}(${o.id})` : `Commande n° ${i + 1} de la liste`;
    if (!nonEmpty(o.id)) return structure(`${who} : identifiant manquant.`);
    if (orderIds.has(o.id)) return structure(`${who} : identifiant en double.`);
    orderIds.add(o.id);
    if (!isInt(o.number, 1)) return structure(`${who} : numéro invalide.`);
    if (!isDate(o.createdAt)) return structure(`${who} : date de création invalide.`);
    if (!ORDER_STATUSES.includes(o.status)) return structure(`${who} : statut inconnu (${String(o.status)}).`);
    if (!ORDER_MODES.includes(o.mode)) return structure(`${who} : mode inconnu (${String(o.mode)}).`);
    if (!(o.archivedAt === null || o.archivedAt === undefined || isDate(o.archivedAt))) return structure(`${who} : date d’archivage invalide.`);
    if (!o.archivedAt) {
      const same = activeNumbers.get(o.number as number);
      if (same) return structure(`${who} : même numéro qu’une autre commande affichée (${same}).`);
      activeNumbers.set(o.number as number, o.id);
    }
    if (!Array.isArray(o.lines) || !o.lines.every(isObject)) return structure(`${who} : lignes invalides.`);
    for (const l of o.lines as Record<string, unknown>[]) {
      if (!nonEmpty(l.productId) || typeof l.name !== 'string') return structure(`${who} : produit invalide.`);
      if (!isInt(l.unitPrice, 0) || !isInt(l.quantity, 1)) return structure(`${who} : prix ou quantité invalide (« ${String(l.name)} »).`);
      if (!Array.isArray(l.addedToppings) || !l.addedToppings.every((t) => isObject(t) && isInt(t.price, 0))) {
        return structure(`${who} : suppléments invalides (« ${String(l.name)} »).`);
      }
    }
    const t = o.totals;
    if (!isObject(t) || !isInt(t.subtotal, 0) || !isInt(t.deliveryFee, 0) || !isInt(t.total, 0)) return structure(`${who} : montants invalides (centimes entiers attendus).`);
    if (t.subtotal !== subtotal(o.lines as unknown as Order['lines'])) return structure(`${who} : sous-total différent de la somme de ses lignes.`);
    if (t.total !== (t.subtotal as number) + (t.deliveryFee as number)) return structure(`${who} : total différent du sous-total plus les frais.`);
    if ((t.deliveryFee as number) > 0) historicFees++;
    const p = o.payment;
    if (isObject(p) && p.tenders !== undefined) {
      if (!Array.isArray(p.tenders) || !p.tenders.every((x) => isObject(x) && TENDER_KINDS.includes(x.kind as never) && isInt(x.amount, 0))) {
        return structure(`${who} : détail de l’encaissement invalide.`);
      }
    }
    if (!isObject(p) || (p.status !== 'a_encaisser' && p.status !== 'encaissee')) legacyPayments++;
    if (o.customerId !== null && o.customerId !== undefined && !(typeof o.customerId === 'string' && customerIds.has(o.customerId))) {
      return reference(`${who} : client ${String(o.customerId)} introuvable.`);
    }
    if (o.serviceId !== undefined && !(typeof o.serviceId === 'string' && serviceIds.has(o.serviceId))) {
      return reference(`${who} : service ${String(o.serviceId)} introuvable.`);
    }
  });

  // Fidélité
  const eventIds = new Set<string>();
  (raw.loyaltyEvents as Record<string, unknown>[]).forEach((e, i) => {
    const who = nonEmpty(e.id) ? `Événement de fidélité ${e.id}` : `Événement de fidélité n° ${i + 1}`;
    if (!nonEmpty(e.id)) return structure(`${who} : identifiant manquant.`);
    if (eventIds.has(e.id)) return structure(`${who} : identifiant en double.`);
    eventIds.add(e.id);
    if (!EVENT_TYPES.includes(e.type) || !Number.isInteger(e.delta) || !(typeof e.reason === 'string' && e.reason in LOYALTY_REASON_LABELS) || !isDate(e.at)) {
      return structure(`${who} : contenu invalide.`);
    }
    if (!(typeof e.customerId === 'string' && customerIds.has(e.customerId))) return reference(`${who} : client ${String(e.customerId)} introuvable.`);
    if (e.orderId !== null && e.orderId !== undefined && !(typeof e.orderId === 'string' && orderIds.has(e.orderId))) {
      return reference(`${who} : commande ${String(e.orderId)} introuvable.`);
    }
  });

  if (legacyPayments) notes.push(`${legacyPayments} commande(s) au paiement non suivi (anciennes données), restaurées telles quelles.`);
  if (historicFees) notes.push(`${historicFees} commande(s) avec des frais de livraison historiques, conservés tels quels.`);
  return { problems: limit(problems), notes };
}

/** Panier d'un fichier, pour l'annoncer (il n'est jamais repris par une restauration ordinaire). */
export function describeCart(cartText: string | null, orders: Pick<Order, 'id' | 'number'>[]): CartFacts | null {
  if (cartText === null) return null;
  const parsed = parseStored(cartText);
  if (parsed.kind !== 'data' || !isObject(parsed.value)) return null;
  const cart = parsed.value;
  const lines = Array.isArray(cart.lines) ? cart.lines : [];
  const editing = typeof cart.editingOrderId === 'string' ? orders.find((o) => o.id === cart.editingOrderId) : undefined;
  const articles = lines.reduce((n: number, l) => n + (isObject(l) && isInt(l.quantity, 1) ? (l.quantity as number) : 0), 0);
  return { articles, modificationCommande: editing ? editing.number : null };
}

/**
 * Lecture et contrôle complet d'un fichier, sans aucune écriture.
 * `target` : espace de stockage du build (les données seront écrites dans SES clés, quel que soit le fichier).
 */
export async function analyzeBackupText(text: string, target = STORAGE_NAMESPACE): Promise<Analysis> {
  const refuse = (message: string, kind: ProblemKind = 'fichier'): Analysis => ({ ok: false, problems: [{ kind, message }] });
  if (text.length > MAX_BACKUP_CHARS) return refuse('Fichier trop volumineux pour une sauvegarde Ferrari Manager.');
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return refuse('Fichier illisible (JSON incomplet ou corrompu).');
  }
  if (!isObject(raw) || raw.type !== BACKUP_TYPE) return refuse('Ce fichier n’est pas une sauvegarde Ferrari Manager.');
  if (raw.formatSauvegarde !== BACKUP_FORMAT) return refuse(`Format de sauvegarde ${String(raw.formatSauvegarde)} non pris en charge (attendu : ${BACKUP_FORMAT}).`);
  if (!isObject(raw.stockage) || !isObject(raw.integrite) || !isObject(raw.resume)) return refuse('Sauvegarde incomplète.');
  const espace = raw.espaceDeStockage;
  if (typeof espace !== 'string' || storageNamespace(espace) !== espace) return refuse('Espace de stockage du fichier invalide.');
  if (!acceptsNamespace(target, espace)) {
    return refuse('Sauvegarde de la prévisualisation : elle ne peut pas être restaurée dans la version de production.');
  }

  // Intégrité : longueur de chaque clé, et empreinte SHA-256 quand le fichier en contient (toutes ou aucune).
  const stockage = raw.stockage;
  const integrite = raw.integrite;
  const keys = Object.keys(stockage);
  if (keys.length !== Object.keys(integrite).length || keys.some((k) => !(k in integrite))) return refuse('Liste des données incohérente.');
  const hashes = keys.map((k) => (isObject(integrite[k]) ? (integrite[k] as Record<string, unknown>).sha256 : undefined));
  const withHash = hashes.every((h) => typeof h === 'string');
  if (!withHash && !hashes.every((h) => h === null)) return refuse('Empreintes de contrôle incohérentes.');
  for (const k of keys) {
    const v = stockage[k];
    const check = integrite[k] as Record<string, unknown>;
    if (typeof v !== 'string') return refuse(`Donnée « ${k} » incomplète.`);
    if (check.longueur !== v.length) return refuse(`Donnée « ${k} » tronquée.`);
    if (withHash) {
      const actual = await sha256(v);
      if (actual === null) return refuse('Ce navigateur ne permet pas de vérifier l’empreinte du fichier (page non sécurisée).');
      if (actual !== check.sha256) return refuse(`Donnée « ${k} » modifiée (empreinte différente).`);
    }
  }
  const docKey = `${espace}:v1`;
  const cartKey = `${espace}:v1:panier`;
  if (JSON.stringify(summarize(stockage as Record<string, string>, docKey)) !== JSON.stringify(raw.resume)) {
    return refuse('Le résumé ne correspond pas au contenu.');
  }

  const docText = stockage[docKey];
  if (typeof docText !== 'string' || docText === '') return refuse('Le fichier ne contient pas les données principales.');
  const parsed = parseStored(docText);
  if (parsed.kind !== 'data') return refuse('Données principales illisibles dans le fichier.', 'structure');
  const { problems, notes } = validateDocument(parsed.value);
  if (problems.length) return { ok: false, problems };

  const fileCartText = typeof stockage[cartKey] === 'string' ? (stockage[cartKey] as string) : null;
  const orders = ((parsed.value as Record<string, unknown>).orders as Order[]).map((o) => ({ id: o.id, number: o.number }));
  const ignoredKeys = keys.filter((k) => k !== docKey && k !== cartKey);
  if (ignoredKeys.length) notes.push(`${ignoredKeys.length} donnée(s) inconnue(s) du fichier ignorée(s).`);
  if (!withHash) notes.push('Fichier sans empreinte (exporté depuis une page non sécurisée) : longueurs et contenu contrôlés.');
  return {
    ok: true,
    exporteLe: isDate(raw.exporteLe) ? (raw.exporteLe as string) : null,
    origine: typeof raw.origine === 'string' ? raw.origine : null,
    espace,
    provenance: espace === DEFAULT_STORAGE_NAMESPACE ? 'production' : 'previsualisation',
    empreinte: withHash ? 'sha256' : 'absente',
    docText,
    fileCartText,
    fileCart: describeCart(fileCartText, orders),
    ignoredKeys,
    notes,
  };
}

/* ---------- Écriture ---------- */

/** Somme de contrôle rapide et synchrone (FNV-1a 32 bits) : sert à savoir au démarrage si une écriture a abouti. */
export function checksum(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

interface Fingerprint {
  longueur: number;
  somme: string;
}
const fingerprint = (text: string | null): Fingerprint | null => (text === null ? null : { longueur: text.length, somme: checksum(text) });
const sameAs = (text: string | null, f: Fingerprint | null) =>
  text === null ? f === null : f !== null && text.length === f.longueur && checksum(text) === f.somme;

/**
 * Trace persistante de l'opération : présente du début des écritures jusqu'à leur relecture.
 * Au démarrage, elle permet de terminer (tout est écrit) ou d'annuler (retour à la copie de sécurité).
 */
export interface RestoreJournal {
  v: 1;
  debut: string;
  mode: RestoreMode;
  cible: { donnees: Fingerprint; panier: Fingerprint | null };
}

/**
 * - `fichier` : restauration ordinaire, données du fichier et panier VIDE (aucune modification reprise) ;
 * - `copie` : retour arrière complet à la copie de sécurité (données ET panier d'avant la restauration).
 */
export type RestoreMode = 'fichier' | 'copie';

export interface RestorePlan {
  mode: RestoreMode;
  docText: string;
  /** null : la clé du panier est supprimée (l'état copié n'en avait pas). */
  cartText: string | null;
}

export type StorageAccess = ReadableStore & {
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export type RestoreOutcome =
  | { ok: true }
  /** Rien n'a changé dans les données (la copie de sécurité a pu être renouvelée). */
  | { ok: false; changed: false; error: string }
  /** Échec du retour arrière immédiat : la trace reste, le démarrage suivant rétablira l'état copié. */
  | { ok: false; changed: true; error: string };

function writeOrRemove(kv: StorageAccess, key: string, text: string | null) {
  if (text === null) kv.removeItem(key);
  else kv.setItem(key, text);
}

/** Copie de sécurité enregistrée (texte d'une sauvegarde complète), ou null. */
export function readSafetyCopy(kv: Pick<ReadableStore, 'getItem'>, keys = restoreKeys()): string | null {
  try {
    return kv.getItem(keys.safety);
  } catch {
    return null;
  }
}

/**
 * Remplace les deux clés métier par le plan, de façon récupérable :
 * 1. copie de sécurité de l'état actuel (format d'export complet, panier et modification compris), écrite puis relue ;
 * 2. trace de l'opération ; 3. panier ; 4. données (étape décisive) ; 5. relecture ; 6. trace supprimée.
 * Un échec avant l'étape 3 ne change rien ; un échec ensuite est annulé immédiatement depuis l'état copié en mémoire,
 * et, si cette annulation échoue aussi, au démarrage suivant grâce à la trace.
 */
export async function performRestore(
  kv: StorageAccess,
  plan: RestorePlan,
  options: { now: Date; origin: string; keys?: RestoreKeys },
): Promise<RestoreOutcome> {
  const keys = options.keys ?? restoreKeys();
  const unchanged = (error: string): RestoreOutcome => ({ ok: false, changed: false, error });

  // 1. Copie de sécurité : état complet actuel, au format d'une sauvegarde, puis relue et vérifiée.
  let before: Record<string, string>;
  let copyText: string;
  try {
    before = readAppKeys(kv, keys.namespace);
    copyText = backupToText(await createBackup(kv, { now: options.now, origin: options.origin, namespace: keys.namespace }));
  } catch {
    return unchanged('Copie de sécurité impossible : stockage inaccessible. Rien n’a été modifié.');
  }
  try {
    kv.setItem(keys.safety, copyText);
  } catch {
    return unchanged('Copie de sécurité impossible (stockage plein ou bloqué) : restauration annulée, rien n’a été modifié.');
  }
  if (readSafetyCopy(kv, keys) !== copyText) return unchanged('La copie de sécurité n’a pas pu être relue : restauration annulée, rien n’a été modifié.');
  const copy = (await analyzeBackupCopy(copyText, keys.namespace)) as BackupFile | null;
  if (!copy) return unchanged('La copie de sécurité est incomplète : restauration annulée, rien n’a été modifié.');

  // À partir d'ici, tout est synchrone : aucun autre code de cette page ne peut s'intercaler.
  if (JSON.stringify(readAppKeys(kv, keys.namespace)) !== JSON.stringify(before)) {
    return unchanged('Les données ont changé pendant la préparation : restauration annulée. Réessayez.');
  }
  const previousDoc = before[keys.doc] ?? null;
  const previousCart = before[keys.cart] ?? null;
  const journal: RestoreJournal = {
    v: 1,
    debut: options.now.toISOString(),
    mode: plan.mode,
    cible: { donnees: fingerprint(plan.docText) as Fingerprint, panier: fingerprint(plan.cartText) },
  };
  try {
    kv.setItem(keys.journal, JSON.stringify(journal));
  } catch {
    return unchanged('Restauration impossible (stockage plein ou bloqué) : rien n’a été modifié.');
  }
  // Ce qui a réellement été écrit : seul cela est annulé en cas d'échec.
  let wroteCart = false;
  let wroteDoc = false;
  try {
    writeOrRemove(kv, keys.cart, plan.cartText);
    wroteCart = true;
    kv.setItem(keys.doc, plan.docText);
    wroteDoc = true;
    if (kv.getItem(keys.doc) !== plan.docText || kv.getItem(keys.cart) !== plan.cartText) throw new Error('relecture');
  } catch {
    try {
      if (wroteDoc) writeOrRemove(kv, keys.doc, previousDoc);
      if (wroteCart) writeOrRemove(kv, keys.cart, previousCart);
      kv.removeItem(keys.journal);
      return unchanged('Restauration impossible (stockage plein ou bloqué) : les données précédentes ont été remises en place.');
    } catch {
      return { ok: false, changed: true, error: 'Restauration interrompue. Rechargez la page : l’état précédent sera rétabli depuis la copie de sécurité.' };
    }
  }
  try {
    kv.removeItem(keys.journal);
  } catch {
    // Trace restée : au démarrage, les clés correspondent à la cible, elle sera simplement supprimée.
  }
  return { ok: true };
}

/** Copie de sécurité relue : sauvegarde complète et intègre de CET espace, sinon null. */
async function analyzeBackupCopy(text: string, namespace: string): Promise<BackupFile | null> {
  try {
    const raw = JSON.parse(text) as BackupFile;
    if (raw.type !== BACKUP_TYPE || raw.espaceDeStockage !== namespace || !isObject(raw.stockage)) return null;
    for (const [k, v] of Object.entries(raw.stockage)) {
      const check = raw.integrite?.[k];
      if (typeof v !== 'string' || !check || check.longueur !== v.length) return null;
      if (check.sha256 !== null) {
        const actual = await sha256(v);
        if (actual !== null && actual !== check.sha256) return null;
      }
    }
    return raw;
  } catch {
    return null;
  }
}

/** Plan de retour arrière : données ET panier exactement comme dans la copie de sécurité. */
export function planFromSafetyCopy(copyText: string, keys = restoreKeys()): RestorePlan | null {
  try {
    const raw = JSON.parse(copyText) as BackupFile;
    if (raw.type !== BACKUP_TYPE || raw.espaceDeStockage !== keys.namespace || !isObject(raw.stockage)) return null;
    const docText = raw.stockage[keys.doc];
    if (typeof docText !== 'string') return null;
    const cartText = raw.stockage[keys.cart];
    return { mode: 'copie', docText, cartText: typeof cartText === 'string' ? cartText : null };
  } catch {
    return null;
  }
}

export type RecoveryResult =
  | { state: 'aucune' }
  /** Trace récente : une restauration est peut-être en cours dans un autre onglet. Ne rien toucher. */
  | { state: 'en-cours' }
  /** Les deux clés avaient bien été écrites : seule la trace restait. */
  | { state: 'terminee' }
  /** Écriture incomplète : état d'avant la restauration rétabli depuis la copie de sécurité. */
  | { state: 'retablie' }
  /** Écriture incomplète et copie inutilisable : rien n'est modifié, la trace est gardée. */
  | { state: 'echec'; error: string };

/**
 * Au démarrage, AVANT de charger les données : termine ou annule une restauration interrompue entre
 * deux écritures (fermeture, panne, rechargement), pour ne jamais charger un état partiel.
 */
export function recoverInterruptedRestore(kv: StorageAccess, nowMs: number, keys = restoreKeys()): RecoveryResult {
  let journalText: string | null;
  try {
    journalText = kv.getItem(keys.journal);
  } catch {
    return { state: 'aucune' };
  }
  if (journalText === null) return { state: 'aucune' };
  let journal: RestoreJournal | null = null;
  try {
    const parsed = JSON.parse(journalText) as RestoreJournal;
    if (parsed && parsed.v === 1 && isObject(parsed.cible)) journal = parsed;
  } catch {
    journal = null;
  }
  if (journal) {
    const started = Date.parse(journal.debut);
    if (!Number.isNaN(started) && nowMs - started < JOURNAL_FRESH_MS && nowMs >= started) return { state: 'en-cours' };
    if (sameAs(kv.getItem(keys.doc), journal.cible.donnees) && sameAs(kv.getItem(keys.cart), journal.cible.panier)) {
      try {
        kv.removeItem(keys.journal);
      } catch {
        /* sans conséquence : la prochaine vérification conclura de même */
      }
      return { state: 'terminee' };
    }
  }
  const copyText = readSafetyCopy(kv, keys);
  const plan = copyText ? planFromSafetyCopy(copyText, keys) : null;
  // Vérification synchrone (longueurs) : le calcul SHA-256 du navigateur est asynchrone.
  const copy = plan && copyText ? (JSON.parse(copyText) as BackupFile) : null;
  const intact = copy !== null && Object.entries(copy.stockage).every(([k, v]) => typeof v === 'string' && copy.integrite?.[k]?.longueur === v.length);
  if (!plan || !intact) return { state: 'echec', error: 'Restauration interrompue et copie de sécurité inutilisable : données laissées en l’état.' };
  try {
    kv.setItem(keys.doc, plan.docText);
    writeOrRemove(kv, keys.cart, plan.cartText);
    kv.removeItem(keys.journal);
    return { state: 'retablie' };
  } catch {
    return { state: 'echec', error: 'Restauration interrompue : l’état précédent n’a pas pu être rétabli (stockage plein ou bloqué).' };
  }
}

/* ---------- Résumé lisible ---------- */

export function factsFrom(data: {
  customers: Customer[];
  orders: Order[];
  loyaltyEvents: LoyaltyEvent[];
  services: unknown[];
  serviceOpen: boolean;
  counters: { nextOrderNumber: number };
}, balance: (customerId: string) => { totalPoints: number; available: number; debt: number }): RestoreFacts {
  const dates = data.orders.map((o) => o.createdAt).sort();
  let points = 0;
  let rewards = 0;
  let debt = 0;
  for (const c of data.customers) {
    const b = balance(c.id);
    points += b.totalPoints;
    rewards += b.available;
    if (b.debt > 0) debt++;
  }
  return {
    clients: data.customers.length,
    commandes: data.orders.length,
    commandesEnCours: data.orders.filter((o) => !o.archivedAt).length,
    commandesArchivees: data.orders.filter((o) => Boolean(o.archivedAt)).length,
    commandesEncaissees: data.orders.filter((o) => o.payment.status === 'encaissee' && !o.payment.legacy).length,
    commandesPaiementNonSuivi: data.orders.filter((o) => o.payment.legacy).length,
    services: data.services.length,
    serviceOuvert: data.serviceOpen,
    prochainNumero: data.counters.nextOrderNumber,
    derniereCommande: dates.length ? dates[dates.length - 1] : null,
    evenementsFidelite: data.loyaltyEvents.length,
    pizzasComptees: points,
    recompensesDisponibles: rewards,
    clientsEnDette: debt,
  };
}
