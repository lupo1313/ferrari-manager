import type { Cart, Customer, LoyaltyEvent, Order, Payment, Settings } from '../domain/types';
import { emptyCart } from '../domain/cart';
import { legacyPayment } from '../domain/payment';

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
}

export type NormalizeResult = { ok: true; data: AppData } | { ok: false; reason: string };

export interface NormalizeDefaults {
  settings: Settings;
  newCartId: () => string;
  nowIso: string;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

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

  // Paramètres : les nouveaux réglages ajoutés au code prennent leur valeur par défaut.
  const s = isObject(raw.settings) ? raw.settings : {};
  const d = defaults.settings;
  // `awardOn` (ancien réglage du moment de crédit) n'existe plus : la règle est fixe (crédit à l'encaissement).
  const { awardOn: _awardOn, ...storedLoyalty } = isObject(s.loyalty) ? s.loyalty : {};
  void _awardOn;
  const settings: Settings = {
    ...d,
    ...s,
    pizzeria: { ...d.pizzeria, ...(isObject(s.pizzeria) ? s.pizzeria : {}) },
    loyalty: { ...d.loyalty, ...storedLoyalty },
  } as Settings;

  // Panier : brouillon en cours, complété champ par champ (les lignes saisies sont conservées).
  const cart: Cart = { ...emptyCart(defaults.newCartId()), ...(isObject(raw.cart) ? raw.cart : {}) } as Cart;
  if (!Array.isArray(cart.lines)) cart.lines = [];

  // Compteur absent : on repart après le plus grand numéro encore affiché, pour éviter les doublons.
  const counters = isObject(raw.counters) && typeof raw.counters.nextOrderNumber === 'number'
    ? { nextOrderNumber: raw.counters.nextOrderNumber }
    : { nextOrderNumber: Math.max(0, ...orders.filter((o) => !o.archivedAt).map((o) => o.number)) + 1 };

  return {
    ok: true,
    data: {
      schemaVersion: SCHEMA_VERSION,
      customers: raw.customers as Customer[],
      orders,
      loyaltyEvents: raw.loyaltyEvents as LoyaltyEvent[],
      settings,
      counters,
      cart,
      serviceStartedAt: typeof raw.serviceStartedAt === 'string' ? raw.serviceStartedAt : defaults.nowIso,
      // Anciennes données sans état ouvert/fermé : « ouvert », c'est-à-dire le comportement d'avant (rien n'est réécrit).
      serviceOpen: typeof raw.serviceOpen === 'boolean' ? raw.serviceOpen : true,
      serviceClosedAt: typeof raw.serviceClosedAt === 'string' ? raw.serviceClosedAt : null,
    },
  };
}
