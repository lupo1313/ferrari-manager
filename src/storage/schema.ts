import type { Cart, Customer, LoyaltyEvent, Order, Payment, ServiceRecord, Settings } from '../domain/types';
import { emptyCart } from '../domain/cart';
import { asPaymentPlan, legacyPayment } from '../domain/payment';
import { serviceIdFromStart } from '../domain/service';

export const SCHEMA_VERSION = 1;

/** Ensemble des données persistées de l'application. */
export interface AppData {
  schemaVersion: typeof SCHEMA_VERSION;
  customers: Customer[];
  orders: Order[];
  loyaltyEvents: LoyaltyEvent[];
  settings: Settings;
  counters: { nextOrderNumber: number };
  cart: Cart;
  serviceStartedAt: string;
  /** Service ouvert (prise de commandes autorisée) ou fermé par le gérant. */
  serviceOpen: boolean;
  serviceClosedAt: string | null;
  /**
   * Historique des services, du plus ancien au plus récent ; le dernier est le service en cours
   * (ou le dernier clôturé). Les champs serviceStartedAt / serviceOpen / serviceClosedAt restent
   * la référence de l'état ouvert/fermé et sont tenus à jour en parallèle (compatibilité).
   */
  services: ServiceRecord[];
}

const isServiceRecord = (v: unknown): v is ServiceRecord =>
  isObject(v) && typeof v.id === 'string' && typeof v.openedAt === 'string' && (v.closedAt === null || typeof v.closedAt === 'string');

/**
 * Historique des services relu du stockage, complété EN MÉMOIRE uniquement :
 * - anciennes données sans historique : un service est reconstitué à partir de serviceStartedAt ;
 * - historique en retard sur l'état du service (ancienne version utilisée entre-temps) : rattrapé.
 * L'identifiant reconstitué dépend de la date d'ouverture : il est identique à chaque chargement.
 */
export function normalizeServices(
  raw: unknown,
  state: { startedAt: string; storedStartedAt: boolean; open: boolean; closedAt: string | null },
): ServiceRecord[] {
  const services = Array.isArray(raw) ? raw.filter(isServiceRecord).map((s) => ({ id: s.id, openedAt: s.openedAt, closedAt: s.closedAt })) : [];
  const closedAt = state.open ? null : state.closedAt ?? state.startedAt;
  const last = services[services.length - 1];
  if (!last || last.openedAt !== state.startedAt) {
    if (last && !last.closedAt) services[services.length - 1] = { ...last, closedAt: state.startedAt };
    const id = state.storedStartedAt ? serviceIdFromStart(state.startedAt) : 'svc-initial';
    services.push({ id, openedAt: state.startedAt, closedAt });
  } else if (last.closedAt !== closedAt) {
    // L'état ouvert/fermé fait foi ; une date de clôture déjà connue est gardée.
    services[services.length - 1] = { ...last, closedAt: state.open ? null : last.closedAt ?? closedAt };
  }
  return services;
}

export type NormalizeResult = { ok: true; data: AppData } | { ok: false; reason: string };

export interface NormalizeDefaults {
  settings: Settings;
  newCartId: () => string;
  nowIso: string;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

const ADDRESS_DETAILS = ['building', 'floor', 'intercom', 'doorCode'] as const;

const PAYMENT_STATUSES: readonly unknown[] = ['a_encaisser', 'encaissee'];
const PAYMENT_METHODS: readonly unknown[] = ['especes', 'carte', 'non_precise', null];

/** Bloc paiement complet et cohérent ; sinon la commande est traitée comme d'avant le suivi des paiements. */
function isValidPayment(p: unknown): p is Payment {
  return (
    isObject(p) &&
    PAYMENT_STATUSES.includes(p.status) &&
    PAYMENT_METHODS.includes(p.method ?? null) &&
    (p.paidAt === null || typeof p.paidAt === 'string')
  );
}

/**
 * Valide les données relues du stockage et complète les champs manquants par des valeurs par défaut.
 * Pas de système de migration : une version inconnue ou une structure illisible est refusée
 * (les données d'origine ne sont alors pas touchées, voir createAppStore).
 */
export function normalizeAppData(raw: unknown, defaults: NormalizeDefaults): NormalizeResult {
  if (!isObject(raw)) return { ok: false, reason: 'format illisible' };
  if (raw.schemaVersion !== SCHEMA_VERSION) {
    return { ok: false, reason: `version de données inconnue (${String(raw.schemaVersion)}, attendue ${SCHEMA_VERSION})` };
  }
  for (const key of ['customers', 'orders', 'loyaltyEvents'] as const) {
    if (!Array.isArray(raw[key])) return { ok: false, reason: `liste « ${key} » absente ou invalide` };
  }
  // Commandes enregistrées avant le suivi des paiements : statut de paiement INCONNU.
  // Ni supposées encaissées, ni dépouillées de leurs points : marquées « legacy » (voir Payment.legacy).
  // Complété à la lecture seulement : rien n'est réécrit tant que la commande n'est pas modifiée.
  const orders = (raw.orders as Order[]).map((o) => (isObject(o) && !isValidPayment(o.payment) ? { ...o, payment: legacyPayment() } : o));
  // Fiches créées avant l'intervention 5 : repères de livraison vides, complétés en mémoire seulement.
  const customers = (raw.customers as Customer[]).map((c) =>
    isObject(c) && ADDRESS_DETAILS.some((k) => typeof c[k] !== 'string')
      ? { ...c, ...Object.fromEntries(ADDRESS_DETAILS.map((k) => [k, typeof c[k] === 'string' ? c[k] : ''])) }
      : c,
  );

  // Paramètres : les nouveaux réglages ajoutés au code prennent leur valeur par défaut.
  const s = isObject(raw.settings) ? raw.settings : {};
  const d = defaults.settings;
  // `awardOn` (ancien réglage du moment de crédit) n'existe plus : la règle est fixe (crédit à l'encaissement).
  const { awardOn: _awardOn, ...storedLoyalty } = isObject(s.loyalty) ? s.loyalty : {};
  void _awardOn;
  // `deliveryFee` (ancien réglage des frais de livraison) n'existe plus : la livraison est toujours offerte.
  const { deliveryFee: _deliveryFee, ...storedSettings } = s;
  void _deliveryFee;
  const settings: Settings = {
    ...d,
    ...storedSettings,
    pizzeria: { ...d.pizzeria, ...(isObject(s.pizzeria) ? s.pizzeria : {}) },
    loyalty: { ...d.loyalty, ...storedLoyalty },
    // Modules facultatifs : affichés sauf choix explicite de les masquer.
    modules: { statistiques: isObject(s.modules) && s.modules.statistiques === false ? false : d.modules.statistiques },
  } as Settings;

  // Panier : brouillon en cours, complété champ par champ (les lignes saisies sont conservées).
  const cart: Cart = { ...emptyCart(defaults.newCartId()), ...(isObject(raw.cart) ? raw.cart : {}) } as Cart;
  if (!Array.isArray(cart.lines)) cart.lines = [];
  cart.paymentPlan = asPaymentPlan(cart.paymentPlan);

  // Compteur absent : on repart après le plus grand numéro encore affiché, pour éviter les doublons.
  const counters = isObject(raw.counters) && typeof raw.counters.nextOrderNumber === 'number'
    ? { nextOrderNumber: raw.counters.nextOrderNumber }
    : { nextOrderNumber: Math.max(0, ...orders.filter((o) => !o.archivedAt).map((o) => o.number)) + 1 };

  const storedStartedAt = typeof raw.serviceStartedAt === 'string';
  const serviceStartedAt = storedStartedAt ? (raw.serviceStartedAt as string) : defaults.nowIso;
  // Anciennes données sans état ouvert/fermé : « ouvert », c'est-à-dire le comportement d'avant (rien n'est réécrit).
  const serviceOpen = typeof raw.serviceOpen === 'boolean' ? raw.serviceOpen : true;
  const serviceClosedAt = typeof raw.serviceClosedAt === 'string' ? raw.serviceClosedAt : null;

  return {
    ok: true,
    data: {
      schemaVersion: SCHEMA_VERSION,
      customers,
      orders,
      loyaltyEvents: raw.loyaltyEvents as LoyaltyEvent[],
      settings,
      counters,
      cart,
      serviceStartedAt,
      serviceOpen,
      serviceClosedAt,
      services: normalizeServices(raw.services, { startedAt: serviceStartedAt, storedStartedAt, open: serviceOpen, closedAt: serviceClosedAt }),
    },
  };
}
