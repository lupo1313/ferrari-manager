import type { Cart, Customer, LoyaltyEvent, Order, Settings } from '../domain/types';
import { emptyCart } from '../domain/cart';

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
}

export type NormalizeResult = { ok: true; data: AppData } | { ok: false; reason: string };

export interface NormalizeDefaults {
  settings: Settings;
  newCartId: () => string;
  nowIso: string;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

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
  const orders = raw.orders as Order[];

  // Paramètres : les nouveaux réglages ajoutés au code prennent leur valeur par défaut.
  const s = isObject(raw.settings) ? raw.settings : {};
  const d = defaults.settings;
  const settings: Settings = {
    ...d,
    ...s,
    pizzeria: { ...d.pizzeria, ...(isObject(s.pizzeria) ? s.pizzeria : {}) },
    loyalty: { ...d.loyalty, ...(isObject(s.loyalty) ? s.loyalty : {}) },
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
    },
  };
}
