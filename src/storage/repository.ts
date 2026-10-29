import type { Cart, Customer, LoyaltyEvent, Order, Settings } from '../domain/types';
import type { AppData } from './schema';

/**
 * Données durables (historique, clients, fidélité, paramètres) : tout sauf le panier.
 * Le panier est un brouillon, enregistré à part (voir saveCart).
 */
export type PersistedData = Omit<AppData, 'cart'>;

/** Enregistrement d'une commande et des événements de fidélité qu'elle génère : indissociables. */
export interface OrderChange {
  order: Order;
  /** Événements à AJOUTER au journal (déjà calculés par le domaine, jamais modifiés ensuite). */
  newEvents: LoyaltyEvent[];
  /** Nouveau compteur de numérotation, uniquement à la création d'une commande. */
  nextOrderNumber?: number;
}

/** Fin de service : commandes archivées, compteur et nouveau début de service. */
export interface ServiceClosure {
  archivedOrders: Order[];
  nextOrderNumber: number;
  serviceStartedAt: string;
}

/** Résultat d'une lecture. `cart` est null si aucun panier n'est enregistré à part. */
export type LoadResult =
  | { kind: 'empty' }
  | { kind: 'data'; value: unknown; cart: unknown | null }
  | { kind: 'error'; error: string };

/**
 * Persistance par opération métier.
 *
 * Chaque méthode correspond à une écriture que la V2 enverra au serveur (une requête ou une
 * transaction). Contrat commun : une méthode qui lève une exception n'a RIEN enregistré.
 *
 * V1 (localStorage, synchrone) : les données durables sont un seul document JSON, réécrit à chaque
 * opération (localStorage ne sait pas modifier une partie d'une valeur). Le panier, modifié en
 * permanence pendant la saisie, a sa propre clé et ne réécrit jamais l'historique.
 * V2 (Supabase) : mêmes opérations, en asynchrone ; seul le store devra attendre leur résultat.
 */
export interface AppRepository {
  /** Ne lève jamais d'exception : une erreur de lecture est renvoyée comme résultat. */
  load(): LoadResult;
  saveOrderWithLoyalty(change: OrderChange): void;
  upsertCustomer(customer: Customer): void;
  saveSettings(settings: Settings): void;
  closeService(closure: ServiceClosure): void;
  saveCart(cart: Cart): void;
  /** Remplace tout (premier lancement, réinitialisation explicite). */
  replaceAll(data: PersistedData, cart: Cart): void;
  clear(): void;
}

export const STORAGE_KEY = 'ferrari-manager:v1';
export const CART_KEY = 'ferrari-manager:v1:panier';

/** Interprète le texte stocké. Un JSON corrompu est une erreur, jamais « rien d'enregistré ». */
export function parseStored(raw: string | null): { kind: 'empty' } | { kind: 'data'; value: unknown } | { kind: 'error'; error: string } {
  if (raw === null || raw === '') return { kind: 'empty' };
  try {
    return { kind: 'data', value: JSON.parse(raw) };
  } catch {
    return { kind: 'error', error: 'données illisibles (JSON corrompu)' };
  }
}

/** Accès brut clé/valeur : localStorage en production, une Map en test. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * Implémentation locale. Elle garde en mémoire le dernier document écrit avec succès et lui applique
 * chaque opération : si l'écriture échoue, ce document n'est pas modifié (rien n'a été enregistré).
 */
export function createKeyValueRepository(kv: KeyValueStore, key = STORAGE_KEY, cartKey = CART_KEY): AppRepository {
  /** Dernier contenu durable connu (lu ou écrit). null tant que rien n'a été chargé. */
  let doc: Record<string, unknown> | null = null;

  function writeDoc(next: Record<string, unknown>) {
    // Le panier n'est jamais réécrit avec l'historique (ancien format : il y figurait).
    const { cart: _legacyCart, ...durable } = next;
    void _legacyCart;
    kv.setItem(key, JSON.stringify(durable));
    doc = durable;
  }

  function current(): Record<string, unknown> {
    if (!doc) throw new Error('Données non chargées : écriture refusée.');
    return doc;
  }

  const list = <T>(name: string) => (current()[name] as T[]) ?? [];

  return {
    load() {
      let raw: string | null;
      let rawCart: string | null;
      try {
        raw = kv.getItem(key);
        rawCart = kv.getItem(cartKey);
      } catch {
        // Stockage bloqué (navigation privée, réglages du navigateur).
        return { kind: 'error', error: 'stockage local inaccessible' };
      }
      const main = parseStored(raw);
      if (main.kind !== 'data') return main;
      if (main.value && typeof main.value === 'object') doc = main.value as Record<string, unknown>;
      // Panier illisible : brouillon perdu, mais l'historique reste chargé.
      const cart = parseStored(rawCart);
      return { kind: 'data', value: main.value, cart: cart.kind === 'data' ? cart.value : null };
    },

    saveOrderWithLoyalty({ order, newEvents, nextOrderNumber }) {
      const orders = list<Order>('orders');
      const exists = orders.some((o) => o.id === order.id);
      const known = new Set(list<LoyaltyEvent>('loyaltyEvents').map((e) => e.id));
      writeDoc({
        ...current(),
        orders: exists ? orders.map((o) => (o.id === order.id ? order : o)) : [...orders, order],
        // Ajout seulement : un événement déjà présent n'est jamais ajouté deux fois.
        loyaltyEvents: [...list<LoyaltyEvent>('loyaltyEvents'), ...newEvents.filter((e) => !known.has(e.id))],
        ...(nextOrderNumber !== undefined ? { counters: { nextOrderNumber } } : {}),
      });
    },

    upsertCustomer(customer) {
      const customers = list<Customer>('customers');
      const exists = customers.some((c) => c.id === customer.id);
      writeDoc({
        ...current(),
        customers: exists ? customers.map((c) => (c.id === customer.id ? customer : c)) : [...customers, customer],
      });
    },

    saveSettings(settings) {
      writeDoc({ ...current(), settings });
    },

    closeService({ archivedOrders, nextOrderNumber, serviceStartedAt }) {
      const byId = new Map(archivedOrders.map((o) => [o.id, o]));
      writeDoc({
        ...current(),
        orders: list<Order>('orders').map((o) => byId.get(o.id) ?? o),
        counters: { nextOrderNumber },
        serviceStartedAt,
      });
    },

    saveCart(cart) {
      kv.setItem(cartKey, JSON.stringify(cart));
    },

    replaceAll(data, cart) {
      // Historique d'abord : si le panier échoue ensuite, il sera simplement vide au rechargement.
      writeDoc({ ...data });
      kv.setItem(cartKey, JSON.stringify(cart));
    },

    clear() {
      doc = null;
      for (const k of [key, cartKey]) {
        try {
          kv.removeItem(k);
        } catch {
          /* rien à faire */
        }
      }
    },
  };
}

export function createLocalStorageRepository(key = STORAGE_KEY, cartKey = CART_KEY): AppRepository {
  return createKeyValueRepository(
    {
      getItem: (k) => window.localStorage.getItem(k),
      setItem: (k, v) => window.localStorage.setItem(k, v),
      removeItem: (k) => window.localStorage.removeItem(k),
    },
    key,
    cartKey,
  );
}

/**
 * Stockage en mémoire pour les tests : même implémentation que la production, sur une Map.
 * `initial` = contenu durable (ancien format accepté, panier compris) ; `initialRaw` / `initialCartRaw` = textes bruts quelconques.
 * `failOn` permet de simuler une écriture qui échoue (quota plein) sur une clé.
 */
export function createMemoryRepository(initial: unknown = null, initialRaw?: string, initialCartRaw?: string) {
  const store = new Map<string, string>();
  if (initialRaw !== undefined) store.set(STORAGE_KEY, initialRaw);
  else if (initial) store.set(STORAGE_KEY, JSON.stringify(initial));
  if (initialCartRaw !== undefined) store.set(CART_KEY, initialCartRaw);
  const control = { saves: 0, cartSaves: 0, failOn: null as null | 'doc' | 'cart' | 'all' };
  const kv: KeyValueStore = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => {
      const isCart = k === CART_KEY;
      if (control.failOn === 'all' || (control.failOn === 'cart' && isCart) || (control.failOn === 'doc' && !isCart)) {
        throw new Error('QuotaExceededError');
      }
      store.set(k, v);
      if (isCart) control.cartSaves++;
      else control.saves++;
    },
    removeItem: (k) => void store.delete(k),
  };
  return {
    ...createKeyValueRepository(kv),
    control,
    /** Contenu brut de la clé principale (historique) et de la clé du panier. */
    raw: () => store.get(STORAGE_KEY) ?? null,
    rawCart: () => store.get(CART_KEY) ?? null,
    /** Nombre d'écritures réussies de l'historique (hors panier). */
    get saves() {
      return control.saves;
    },
  };
}
