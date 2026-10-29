import type { Cart, Customer, LoyaltyEvent, Order, Settings } from '../domain/types';

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

/** Vérification minimale de forme avant d'accepter des données relues du stockage. */
export function isAppData(value: unknown): value is AppData {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    v.schemaVersion === SCHEMA_VERSION &&
    Array.isArray(v.customers) &&
    Array.isArray(v.orders) &&
    Array.isArray(v.loyaltyEvents) &&
    typeof v.settings === 'object' &&
    v.settings !== null &&
    typeof v.cart === 'object' &&
    v.cart !== null &&
    typeof (v.counters as { nextOrderNumber?: unknown } | undefined)?.nextOrderNumber === 'number'
  );
}
