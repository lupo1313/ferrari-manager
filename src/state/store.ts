import type {
  Catalog,
  Customer,
  LoyaltyEvent,
  Order,
  OrderMode,
  OrderStatus,
  Product,
  RewardKind,
  Settings,
} from '../domain/types';
import type { IdFactory } from '../domain/ids';
import { createId } from '../domain/ids';
import type { AppRepository } from '../storage/repository';
import type { AppData } from '../storage/schema';
import { normalizeAppData } from '../storage/schema';
import { defaultSettings } from '../data/defaultSettings';
import {
  addLine,
  addProduct,
  addToppingToLine,
  createLine,
  emptyCart,
  removeLine,
  rewardLineCount,
  setLineQuantity,
  updateLine,
  withoutRewardLines,
  type LineOptions,
} from '../domain/cart';
import {
  applyCustomerInput,
  buildCustomer,
  findCustomerByPhone,
  validateCustomerInput,
  type CustomerFieldErrors,
  type CustomerInput,
} from '../domain/customers';
import { isRewardEligible, netForOrder, reconcileOrderLoyalty, rewardsRemainingForCart } from '../domain/loyalty';
import {
  buildOrder,
  canCancelOrder,
  canChangeStatus,
  canEditOrder,
  closeService,
  orderToCart,
  validateCart,
  withStatus,
} from '../domain/orders';
import { isValidTimeOfDay } from '../domain/time';

export type Result<T = void> =
  | { ok: true; value: T }
  | { ok: false; error: string; fieldErrors?: CustomerFieldErrors; existingCustomerId?: string };

const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = (error: string, extra: Partial<Extract<Result, { ok: false }>> = {}): Result<never> => ({
  ok: false,
  error,
  ...extra,
});

export interface StoreDeps {
  repo: AppRepository;
  catalog: Catalog;
  seed: (catalog: Catalog, now: Date, newId: IdFactory) => AppData;
  now?: () => Date;
  newId?: IdFactory;
}

/**
 * Store applicatif : orchestre le domaine, la persistance et les abonnements React.
 * Toutes les actions sont synchrones et lisent l'état courant : un double appel
 * (double clic) s'exécute sur l'état déjà mis à jour par le premier.
 */
export function createAppStore(deps: StoreDeps) {
  const now = deps.now ?? (() => new Date());
  const newId = deps.newId ?? createId;
  const { catalog, repo } = deps;
  const productById = new Map(catalog.products.map((p) => [p.id, p]));
  const toppingById = new Map(catalog.toppings.map((t) => [t.id, t]));
  const listeners = new Set<() => void>();

  let persistError: string | null = null;
  /**
   * Renseigné quand des données existent mais ne peuvent pas être relues (version inconnue, JSON corrompu,
   * stockage inaccessible). Aucune écriture n'est alors faite : les données d'origine restent intactes
   * tant que l'utilisateur ne choisit pas explicitement « Réinitialiser les données de démonstration ».
   */
  let storageLocked: string | null = null;
  let data: AppData = loadOrSeed();

  function loadOrSeed(): AppData {
    const loaded = repo.load();
    if (loaded.kind === 'data') {
      const normalized = normalizeAppData(loaded.value, {
        settings: defaultSettings,
        newCartId: () => newId('ord'),
        nowIso: now().toISOString(),
      });
      if (normalized.ok) return normalized.data;
      return lockStorage(normalized.reason);
    }
    if (loaded.kind === 'error') return lockStorage(loaded.error);

    // Premier lancement : rien d'enregistré, on installe le jeu de démonstration.
    const seeded = deps.seed(catalog, now(), newId);
    try {
      repo.save(seeded);
    } catch {
      persistError = 'Le stockage local est indisponible : les données ne seront pas conservées.';
    }
    return seeded;
  }

  function lockStorage(reason: string): AppData {
    storageLocked =
      `Données locales non chargées (${reason}). Elles sont conservées intactes et rien ne sera enregistré : ` +
      'les données affichées sont celles de démonstration. Pour repartir de zéro, utilisez Paramètres → Réinitialiser les données de démonstration.';
    persistError = storageLocked;
    return deps.seed(catalog, now(), newId);
  }

  function commit(next: AppData) {
    data = next;
    if (storageLocked) {
      persistError = storageLocked;
      listeners.forEach((l) => l());
      return;
    }
    try {
      repo.save(next);
      persistError = null;
    } catch {
      persistError = 'Sauvegarde locale impossible (stockage plein ou bloqué). Les dernières modifications risquent d’être perdues.';
    }
    listeners.forEach((l) => l());
  }

  const nowIso = () => now().toISOString();
  const findCustomer = (id: string | null) => (id ? data.customers.find((c) => c.id === id) ?? null : null);
  const findOrder = (id: string) => data.orders.find((o) => o.id === id);
  const product = (id: string): Product | undefined => productById.get(id);

  function setCart(cart: AppData['cart']) {
    commit({ ...data, cart });
  }

  /** Applique un changement de commande et réconcilie la fidélité. */
  function commitOrder(order: Order, extra: Partial<AppData> = {}) {
    const exists = data.orders.some((o) => o.id === order.id);
    const orders = exists ? data.orders.map((o) => (o.id === order.id ? order : o)) : [...data.orders, order];
    const newEvents = reconcileOrderLoyalty(data.loyaltyEvents, order, data.settings.loyalty, { nowIso: nowIso(), newId });
    const loyaltyEvents: LoyaltyEvent[] = newEvents.length ? [...data.loyaltyEvents, ...newEvents] : data.loyaltyEvents;
    commit({ ...data, ...extra, orders, loyaltyEvents });
    return newEvents;
  }

  return {
    catalog,
    getData: () => data,
    getPersistError: () => persistError,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    product,
    topping: (id: string) => toppingById.get(id),

    /* ---------- Clients ---------- */

    selectCustomer(customerId: string | null): Result<{ removedRewards: number }> {
      if (customerId && !findCustomer(customerId)) return fail('Client introuvable.');
      if (data.cart.customerId === customerId) return ok({ removedRewards: 0 });
      // Les récompenses appartiennent au client : on les retire si on change de client.
      const removedRewards = rewardLineCount(data.cart.lines);
      const cart = { ...withoutRewardLines(data.cart), customerId, counterName: customerId ? '' : data.cart.counterName };
      setCart(cart);
      return ok({ removedRewards });
    },

    createCustomer(input: CustomerInput, options: { select?: boolean } = {}): Result<Customer> {
      const fieldErrors = validateCustomerInput(input);
      if (Object.keys(fieldErrors).length) return fail('Vérifiez les champs signalés.', { fieldErrors });
      const duplicate = findCustomerByPhone(data.customers, input.phone);
      if (duplicate) {
        return fail('Ce numéro correspond déjà à une fiche client.', {
          fieldErrors: { phone: 'Numéro déjà enregistré.' },
          existingCustomerId: duplicate.id,
        });
      }
      const customer = buildCustomer(input, newId('cus'), nowIso());
      const cart = options.select ? { ...withoutRewardLines(data.cart), customerId: customer.id, counterName: '' } : data.cart;
      commit({ ...data, customers: [...data.customers, customer], cart });
      return ok(customer);
    },

    /** Ne modifie que la fiche : les commandes déjà enregistrées gardent leur copie figée. */
    updateCustomer(customerId: string, input: CustomerInput): Result<Customer> {
      const existing = findCustomer(customerId);
      if (!existing) return fail('Client introuvable.');
      const fieldErrors = validateCustomerInput(input);
      if (Object.keys(fieldErrors).length) return fail('Vérifiez les champs signalés.', { fieldErrors });
      const duplicate = findCustomerByPhone(data.customers, input.phone, customerId);
      if (duplicate) {
        return fail('Ce numéro appartient déjà à une autre fiche.', {
          fieldErrors: { phone: 'Numéro déjà utilisé par une autre fiche.' },
          existingCustomerId: duplicate.id,
        });
      }
      const updated = applyCustomerInput(existing, input, nowIso());
      commit({ ...data, customers: data.customers.map((c) => (c.id === customerId ? updated : c)) });
      return ok(updated);
    },

    updateCustomerInstructions(customerId: string, instructions: string): Result<Customer> {
      const existing = findCustomer(customerId);
      if (!existing) return fail('Client introuvable.');
      if (instructions.trim().length > 300) return fail('300 caractères maximum.');
      const updated = { ...existing, instructions: instructions.trim(), updatedAt: nowIso() };
      commit({ ...data, customers: data.customers.map((c) => (c.id === customerId ? updated : c)) });
      return ok(updated);
    },

    /* ---------- Panier ---------- */

    addProduct(productId: string): Result<Product> {
      const p = product(productId);
      if (!p) return fail('Produit introuvable.');
      setCart(addProduct(data.cart, p, newId('lin')));
      return ok(p);
    },

    addConfiguredLine(productId: string, options: LineOptions): Result<Product> {
      const p = product(productId);
      if (!p) return fail('Produit introuvable.');
      setCart(addLine(data.cart, createLine(p, newId('lin'), options)));
      return ok(p);
    },

    updateLine(lineId: string, options: LineOptions): Result {
      const line = data.cart.lines.find((l) => l.id === lineId);
      const p = line && product(line.productId);
      if (!line || !p) return fail('Ligne introuvable.');
      setCart(updateLine(data.cart, lineId, options, p));
      return ok(undefined);
    },

    addToppingToLine(lineId: string, toppingId: string): Result {
      const t = toppingById.get(toppingId);
      if (!t) return fail('Supplément introuvable.');
      setCart(addToppingToLine(data.cart, lineId, t));
      return ok(undefined);
    },

    setLineQuantity(lineId: string, quantity: number) {
      setCart(setLineQuantity(data.cart, lineId, quantity));
    },

    removeLine(lineId: string) {
      setCart(removeLine(data.cart, lineId));
    },

    setMode(mode: OrderMode) {
      setCart({ ...data.cart, mode });
    },

    setRequestedTime(time: string | null): Result {
      if (time !== null && !isValidTimeOfDay(time)) return fail('Heure invalide.');
      setCart({ ...data.cart, requestedTime: time });
      return ok(undefined);
    },

    setOrderNote(note: string) {
      setCart({ ...data.cart, note: note.slice(0, 300) });
    },

    setCounterName(name: string) {
      setCart({ ...data.cart, counterName: name.slice(0, 40) });
    },

    /** Vide le panier (et abandonne une éventuelle modification en cours). */
    clearCart() {
      setCart(emptyCart(newId('ord')));
    },

    /* ---------- Fidélité ---------- */

    rewardsRemaining(): number {
      return rewardsRemainingForCart(data.loyaltyEvents, data.cart, data.settings.loyalty);
    },

    /** Utilisation explicite d'une récompense : jamais automatique. */
    addReward(kind: RewardKind, productId: string): Result<Product> {
      const customer = findCustomer(data.cart.customerId);
      if (!customer) return fail('Sélectionnez d’abord le client.');
      const p = product(productId);
      if (!p || !isRewardEligible(p, kind, data.settings.loyalty)) return fail('Ce produit n’est pas éligible à la récompense.');
      if (rewardsRemainingForCart(data.loyaltyEvents, data.cart, data.settings.loyalty) < 1) {
        return fail('Aucune récompense disponible pour ce client.');
      }
      setCart({ ...data.cart, lines: [...data.cart.lines, createLine(p, newId('lin'), {}, kind)] });
      return ok(p);
    },

    /* ---------- Commandes ---------- */

    /** Validation idempotente : la même commande ne peut être enregistrée deux fois. */
    validateCart(): Result<Order> {
      const cart = data.cart;
      const customer = findCustomer(cart.customerId);
      const previous = cart.editingOrderId ? findOrder(cart.editingOrderId) : undefined;
      if (cart.editingOrderId && (!previous || !canEditOrder(previous))) {
        return fail('Cette commande ne peut plus être modifiée (statut ou fin de service).');
      }
      if (!cart.editingOrderId && findOrder(cart.draftId)) {
        return fail('Cette commande est déjà enregistrée.');
      }
      const errors = validateCart(cart, {
        customer,
        rewardsRemaining: rewardsRemainingForCart(data.loyaltyEvents, cart, data.settings.loyalty),
      });
      if (errors.length) return fail(errors.join(' '));

      const order = buildOrder(cart, {
        id: cart.draftId,
        number: previous ? previous.number : data.counters.nextOrderNumber,
        nowIso: nowIso(),
        customer,
        settings: data.settings,
        previous,
      });
      commitOrder(order, {
        cart: emptyCart(newId('ord')),
        counters: previous ? data.counters : { nextOrderNumber: data.counters.nextOrderNumber + 1 },
      });
      return ok(order);
    },

    startEditOrder(orderId: string): Result<Order> {
      const order = findOrder(orderId);
      if (!order) return fail('Commande introuvable.');
      if (!canEditOrder(order)) return fail('Cette commande ne peut plus être modifiée.');
      setCart(orderToCart(order));
      return ok(order);
    },

    setOrderStatus(orderId: string, status: OrderStatus): Result<Order> {
      const order = findOrder(orderId);
      if (!order) return fail('Commande introuvable.');
      if (!canChangeStatus(order, status)) return fail('Changement de statut impossible.');
      const updated = withStatus(order, status, nowIso());
      // Une commande terminée ne peut plus être modifiée : on libère le panier s'il l'éditait.
      const cart = data.cart.editingOrderId === orderId && !canEditOrder(updated) ? emptyCart(newId('ord')) : data.cart;
      commitOrder(updated, { cart });
      return ok(updated);
    },

    /** Annulation : retire les points crédités et restitue les récompenses consommées. */
    cancelOrder(orderId: string): Result<{ order: Order; pointsReverted: number; rewardsRestored: number }> {
      const order = findOrder(orderId);
      if (!order) return fail('Commande introuvable.');
      if (!canCancelOrder(order)) return fail('Cette commande ne peut pas être annulée.');
      const cancelled = withStatus(order, 'annulee', nowIso());
      const cart = data.cart.editingOrderId === orderId ? emptyCart(newId('ord')) : data.cart;
      const events = commitOrder(cancelled, { cart });
      const pointsReverted = -events.filter((e) => e.type === 'points').reduce((s, e) => s + e.delta, 0);
      const rewardsRestored = -events.filter((e) => e.type === 'rewards_used').reduce((s, e) => s + e.delta, 0);
      return ok({ order: cancelled, pointsReverted, rewardsRestored });
    },

    /** Ouverture de la fenêtre d'impression : tracée, mais jamais considérée comme une impression réussie. */
    recordPrintRequest(orderId: string) {
      const order = findOrder(orderId);
      if (!order) return;
      const updated = { ...order, printRequests: [...order.printRequests, nowIso()] };
      commit({ ...data, orders: data.orders.map((o) => (o.id === orderId ? updated : o)) });
    },

    /** Points que la commande en cours de modification a déjà crédités (affichage). */
    pointsAlreadyCredited(orderId: string, customerId: string) {
      return netForOrder(data.loyaltyEvents, orderId, customerId).points;
    },

    endService(): Result<{ archived: number; stillActive: number }> {
      const { orders, archived, stillActive } = closeService(data.orders, nowIso());
      commit({
        ...data,
        orders,
        // Numérotation remise à 1 seulement si plus aucune commande n'est en cours (évite les doublons).
        counters: stillActive === 0 ? { nextOrderNumber: 1 } : data.counters,
        serviceStartedAt: nowIso(),
      });
      return ok({ archived, stillActive });
    },

    /* ---------- Paramètres & données ---------- */

    updateSettings(patch: Partial<Settings>): Result<Settings> {
      const next: Settings = { ...data.settings, ...patch, pizzeria: { ...data.settings.pizzeria, ...patch.pizzeria } };
      if (!Number.isInteger(next.deliveryFee) || next.deliveryFee < 0 || next.deliveryFee > 5000) {
        return fail('Frais de livraison invalides (entre 0 et 50 €).');
      }
      if (next.ticketWidthMm !== 58 && next.ticketWidthMm !== 80) return fail('Largeur de ticket invalide.');
      // Les garde-fous d'éligibilité filtrent toute entrée non autorisée (alcool, dessert…).
      next.loyalty = {
        ...next.loyalty,
        pizzasPerReward: data.settings.loyalty.pizzasPerReward,
        eligiblePizzaIds: next.loyalty.eligiblePizzaIds.filter((id) => {
          const p = product(id);
          return p?.category === 'pizza';
        }),
        eligibleDrinkIds: next.loyalty.eligibleDrinkIds.filter((id) => {
          const p = product(id);
          return p?.category === 'boisson' && !p.alcohol;
        }),
      };
      commit({ ...data, settings: next });
      return ok(next);
    },

    /** Efface toutes les données locales et recharge le jeu de démonstration. */
    resetDemoData() {
      // Choix explicite de l'utilisateur : seule action autorisée à remplacer des données illisibles.
      storageLocked = null;
      repo.clear();
      commit(deps.seed(catalog, now(), newId));
    },
  };
}

export type AppStore = ReturnType<typeof createAppStore>;
