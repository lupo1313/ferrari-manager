import type {
  Cart,
  Catalog,
  Customer,
  Order,
  OrderMode,
  OrderStatus,
  PaymentMethod,
  Product,
  RewardKind,
  Settings,
} from '../domain/types';
import type { IdFactory } from '../domain/ids';
import { createId } from '../domain/ids';
import type { AppRepository, PersistedData } from '../storage/repository';
import type { AppData } from '../storage/schema';
import { normalizeAppData } from '../storage/schema';
import { defaultSettings } from '../data/defaultSettings';
import {
  addLine,
  addProduct,
  addToppingToLine,
  createLine,
  emptyCart,
  MAX_REWARDS_PER_ORDER,
  ONE_REWARD_PER_ORDER,
  paidPizzaCount,
  REWARD_NEEDS_PAID_PIZZA,
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
  SERVICE_CLOSED_MESSAGE,
  validateCart,
  withStatus,
} from '../domain/orders';
import { isValidTimeOfDay } from '../domain/time';
import { cannotMarkPaid, isPaid, markPaid, markUnpaid } from '../domain/payment';
import { closeServiceRecord, currentService, openServiceRecord } from '../domain/service';

export type Result<T = void> =
  | { ok: true; value: T }
  | { ok: false; error: string; fieldErrors?: CustomerFieldErrors; existingCustomerId?: string };

const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = (error: string, extra: Partial<Extract<Result, { ok: false }>> = {}): Result<never> => ({
  ok: false,
  error,
  ...extra,
});

/** Délai maximal avant l'enregistrement du panier pendant une saisie de texte (note, nom comptoir). */
export const CART_TEXT_DELAY_MS = 300;

const SAVE_FAILED = 'Enregistrement impossible (stockage plein ou bloqué) : rien n’a été enregistré. Réessayez.';
const DOC_ERROR = 'Sauvegarde locale impossible (stockage plein ou bloqué) : la dernière action n’a pas été enregistrée.';
const CART_ERROR = 'Sauvegarde du panier impossible : la commande en cours de saisie risque d’être perdue au rechargement.';

export interface StoreDeps {
  repo: AppRepository;
  catalog: Catalog;
  seed: (catalog: Catalog, now: Date, newId: IdFactory) => AppData;
  now?: () => Date;
  newId?: IdFactory;
  /** Effets hors données (son). Un effet qui échoue n'annule jamais l'action. */
  effects?: { playPaymentSound?: (kind: Settings['paymentSoundKind']) => void };
}

const withoutCart = ({ cart: _cart, ...rest }: AppData): PersistedData => (void _cart, rest);

/**
 * Store applicatif : orchestre le domaine, la persistance et les abonnements React.
 * Toutes les actions sont synchrones et lisent l'état courant : un double appel
 * (double clic) s'exécute sur l'état déjà mis à jour par le premier.
 *
 * Règle de persistance : une donnée durable (commande, fidélité, client, paramètres) est d'abord
 * écrite ; l'état affiché n'est mis à jour que si l'écriture a réussi. Le panier, simple brouillon,
 * est mis à jour à l'écran immédiatement puis enregistré dans sa propre clé.
 */
export function createAppStore(deps: StoreDeps) {
  const now = deps.now ?? (() => new Date());
  const newId = deps.newId ?? createId;
  const { catalog, repo } = deps;
  const productById = new Map(catalog.products.map((p) => [p.id, p]));
  const toppingById = new Map(catalog.toppings.map((t) => [t.id, t]));
  const listeners = new Set<() => void>();

  let docError: string | null = null;
  let cartError: string | null = null;
  /**
   * Renseigné quand des données existent mais ne peuvent pas être relues (version inconnue, JSON corrompu,
   * stockage inaccessible). Aucune écriture n'est alors faite : les données d'origine restent intactes
   * tant que l'utilisateur ne choisit pas explicitement « Réinitialiser les données de démonstration ».
   */
  let storageLocked: string | null = null;
  let cartTimer: ReturnType<typeof setTimeout> | null = null;
  let data: AppData = loadOrSeed();

  function loadOrSeed(): AppData {
    const loaded = repo.load();
    if (loaded.kind === 'error') return lockStorage(loaded.error);
    if (loaded.kind === 'data') {
      const raw = loaded.value;
      // Panier : sa propre clé ; à défaut, celui de l'ancien format (inclus dans le document principal).
      const legacyCart = raw && typeof raw === 'object' ? (raw as { cart?: unknown }).cart : undefined;
      const merged = raw && typeof raw === 'object' ? { ...raw, cart: loaded.cart ?? legacyCart } : raw;
      const normalized = normalizeAppData(merged, {
        settings: defaultSettings,
        newCartId: () => newId('ord'),
        nowIso: now().toISOString(),
      });
      if (!normalized.ok) return lockStorage(normalized.reason);
      let next = normalized.data;
      let writeCart = loaded.cart === null; // transition depuis l'ancien format
      // Panier déjà validé (la commande a été enregistrée mais pas le panier vidé) : on repart d'un panier vide.
      if (!next.cart.editingOrderId && next.orders.some((o) => o.id === next.cart.draftId)) {
        next = { ...next, cart: emptyCart(newId('ord')) };
        writeCart = true;
      }
      if (writeCart) {
        try {
          repo.saveCart(next.cart);
        } catch {
          cartError = CART_ERROR;
        }
      }
      return next;
    }

    // Premier lancement : rien d'enregistré, on installe le jeu de démonstration.
    const seeded = deps.seed(catalog, now(), newId);
    try {
      repo.replaceAll(withoutCart(seeded), seeded.cart);
    } catch {
      docError = 'Le stockage local est indisponible : les données ne seront pas conservées.';
    }
    return seeded;
  }

  function lockStorage(reason: string): AppData {
    storageLocked =
      `Données locales non chargées (${reason}). Elles sont conservées intactes et rien ne sera enregistré : ` +
      'les données affichées sont celles de démonstration. Pour repartir de zéro, utilisez Paramètres → Réinitialiser les données de démonstration.';
    return deps.seed(catalog, now(), newId);
  }

  const notify = () => listeners.forEach((l) => l());

  /**
   * Écrit une donnée durable. Renvoie false si l'écriture a échoué : l'appelant ne modifie alors rien
   * et signale l'échec. En mode protégé (données illisibles), rien n'est écrit, volontairement.
   */
  function persist(write: () => void): boolean {
    if (storageLocked) return true;
    try {
      write();
      docError = null;
      return true;
    } catch {
      docError = DOC_ERROR;
      notify();
      return false;
    }
  }

  function writeCartNow() {
    if (cartTimer !== null) {
      clearTimeout(cartTimer);
      cartTimer = null;
    }
    if (storageLocked) return;
    try {
      repo.saveCart(data.cart);
      cartError = null;
    } catch {
      cartError = CART_ERROR;
    }
  }

  /**
   * Met à jour le panier à l'écran. Enregistrement immédiat par défaut ; pendant une saisie de texte,
   * regroupé (au plus CART_TEXT_DELAY_MS) et forcé à la mise en arrière-plan / fermeture (flushPendingWrites).
   */
  function setCart(cart: Cart, timing: 'now' | 'deferred' = 'now') {
    data = { ...data, cart };
    if (timing === 'now') writeCartNow();
    else if (cartTimer === null) {
      cartTimer = setTimeout(() => {
        writeCartNow();
        notify();
      }, CART_TEXT_DELAY_MS);
    }
    notify();
  }

  const nowIso = () => now().toISOString();
  const findCustomer = (id: string | null) => (id ? data.customers.find((c) => c.id === id) ?? null : null);
  const findOrder = (id: string) => data.orders.find((o) => o.id === id);
  const product = (id: string): Product | undefined => productById.get(id);

  /**
   * Enregistre une commande et réconcilie la fidélité, en une seule écriture.
   * Renvoie les événements ajoutés, ou null si l'écriture a échoué (rien n'a changé).
   */
  function commitOrder(order: Order, opts: { nextOrderNumber?: number; cart?: Cart } = {}) {
    const newEvents = reconcileOrderLoyalty(data.loyaltyEvents, order, { nowIso: nowIso(), newId });
    if (!persist(() => repo.saveOrderWithLoyalty({ order, newEvents, nextOrderNumber: opts.nextOrderNumber }))) return null;
    const exists = data.orders.some((o) => o.id === order.id);
    data = {
      ...data,
      orders: exists ? data.orders.map((o) => (o.id === order.id ? order : o)) : [...data.orders, order],
      loyaltyEvents: newEvents.length ? [...data.loyaltyEvents, ...newEvents] : data.loyaltyEvents,
      counters: opts.nextOrderNumber !== undefined ? { nextOrderNumber: opts.nextOrderNumber } : data.counters,
    };
    if (opts.cart && opts.cart !== data.cart) setCart(opts.cart);
    else notify();
    return newEvents;
  }

  function commitCustomer(customer: Customer, cart?: Cart): boolean {
    if (!persist(() => repo.upsertCustomer(customer))) return false;
    const exists = data.customers.some((c) => c.id === customer.id);
    data = {
      ...data,
      customers: exists ? data.customers.map((c) => (c.id === customer.id ? customer : c)) : [...data.customers, customer],
    };
    if (cart) setCart(cart);
    else notify();
    return true;
  }

  return {
    catalog,
    getData: () => data,
    getPersistError: () => storageLocked ?? docError ?? cartError,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /** Enregistre immédiatement un panier en attente (mise en arrière-plan, fermeture de l'onglet). */
    flushPendingWrites() {
      if (cartTimer === null) return;
      writeCartNow();
      notify();
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
      const cart = options.select ? { ...withoutRewardLines(data.cart), customerId: customer.id, counterName: '' } : undefined;
      if (!commitCustomer(customer, cart)) return fail(SAVE_FAILED);
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
      if (!commitCustomer(updated)) return fail(SAVE_FAILED);
      return ok(updated);
    },

    updateCustomerInstructions(customerId: string, instructions: string): Result<Customer> {
      const existing = findCustomer(customerId);
      if (!existing) return fail('Client introuvable.');
      if (instructions.trim().length > 300) return fail('300 caractères maximum.');
      const updated = { ...existing, instructions: instructions.trim(), updatedAt: nowIso() };
      if (!commitCustomer(updated)) return fail(SAVE_FAILED);
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
      setCart({ ...data.cart, note: note.slice(0, 300) }, 'deferred');
    },

    setCounterName(name: string) {
      setCart({ ...data.cart, counterName: name.slice(0, 40) }, 'deferred');
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
      // Le cadeau s'ajoute à un achat : au moins une pizza payante doit déjà être dans la commande.
      // Une seule récompense par commande (y compris en modification d'une commande existante).
      if (rewardLineCount(data.cart.lines) >= MAX_REWARDS_PER_ORDER) return fail(ONE_REWARD_PER_ORDER);
      if (paidPizzaCount(data.cart.lines) === 0) return fail(`${REWARD_NEEDS_PAID_PIZZA} Ajoutez d’abord la pizza achetée.`);
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
      // Service fermé : aucune NOUVELLE commande. Corriger une commande existante reste possible.
      if (!cart.editingOrderId && !data.serviceOpen) return fail(SERVICE_CLOSED_MESSAGE);
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
        serviceId: currentService(data.services).id,
        previous,
      });
      const saved = commitOrder(order, {
        cart: emptyCart(newId('ord')),
        nextOrderNumber: previous ? undefined : data.counters.nextOrderNumber + 1,
      });
      // Échec d'écriture : le panier reste intact, l'utilisateur peut réessayer.
      if (!saved) return fail(SAVE_FAILED);
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
      const cart = data.cart.editingOrderId === orderId && !canEditOrder(updated) ? emptyCart(newId('ord')) : undefined;
      if (!commitOrder(updated, { cart })) return fail(SAVE_FAILED);
      return ok(updated);
    },

    /**
     * Encaissement (suivi opérationnel, pas une caisse) : crédite les pizzas payantes du client.
     * Idempotent : une commande déjà encaissée ne recrédite jamais rien (seul le moyen peut être corrigé).
     */
    markOrderPaid(orderId: string, method: PaymentMethod = 'non_precise'): Result<{ order: Order; pointsCredited: number; alreadyPaid: boolean }> {
      const order = findOrder(orderId);
      if (!order) return fail('Commande introuvable.');
      const blocked = cannotMarkPaid(order);
      if (blocked) return fail(blocked);
      const alreadyPaid = isPaid(order);
      const updated = markPaid(order, method, nowIso());
      if (updated === order) return ok({ order, pointsCredited: 0, alreadyPaid });
      const events = commitOrder(updated);
      if (!events) return fail(SAVE_FAILED);
      const pointsCredited = events.filter((e) => e.type === 'points').reduce((s, e) => s + e.delta, 0);
      // Son : uniquement pour une vraie transition vers « Encaissée » enregistrée avec succès.
      if (!alreadyPaid && data.settings.paymentSound) {
        try {
          deps.effects?.playPaymentSound?.(data.settings.paymentSoundKind === 'vente' ? 'vente' : 'caisse');
        } catch {
          /* le son est un confort : son échec n'affecte pas l'encaissement */
        }
      }
      return ok({ order: updated, pointsCredited, alreadyPaid });
    },

    /** Correction d'un encaissement saisi par erreur : la commande repasse « à encaisser », ses pizzas sont retirées. */
    markOrderUnpaid(orderId: string): Result<{ order: Order; pointsReverted: number }> {
      const order = findOrder(orderId);
      if (!order) return fail('Commande introuvable.');
      if (!isPaid(order)) return fail('Cette commande n’est pas encaissée.');
      if (order.status === 'annulee') return fail('Commande annulée : encaissement non modifiable.');
      const updated = markUnpaid(order, nowIso());
      const events = commitOrder(updated);
      if (!events) return fail(SAVE_FAILED);
      const pointsReverted = 0 - events.filter((e) => e.type === 'points').reduce((s, e) => s + e.delta, 0);
      return ok({ order: updated, pointsReverted });
    },

    /**
     * Annulation : retire les pizzas créditées et restitue les récompenses (réservées ou consommées).
     * Commande encaissée : le remboursement éventuel se fait hors de Ferrari Manager.
     */
    cancelOrder(orderId: string): Result<{ order: Order; pointsReverted: number; rewardsRestored: number; wasPaid: boolean }> {
      const order = findOrder(orderId);
      if (!order) return fail('Commande introuvable.');
      if (!canCancelOrder(order)) return fail('Cette commande ne peut pas être annulée.');
      const cancelled = withStatus(order, 'annulee', nowIso());
      const cart = data.cart.editingOrderId === orderId ? emptyCart(newId('ord')) : undefined;
      const events = commitOrder(cancelled, { cart });
      if (!events) return fail(SAVE_FAILED);
      const pointsReverted = 0 - events.filter((e) => e.type === 'points').reduce((s, e) => s + e.delta, 0);
      const rewardsRestored = 0 - events.filter((e) => e.type === 'rewards_used').reduce((s, e) => s + e.delta, 0);
      return ok({ order: cancelled, pointsReverted, rewardsRestored, wasPaid: isPaid(order) });
    },

    /** Ouverture de la fenêtre d'impression : tracée, mais jamais considérée comme une impression réussie. */
    recordPrintRequest(orderId: string) {
      const order = findOrder(orderId);
      if (!order) return;
      const updated = { ...order, printRequests: [...order.printRequests, nowIso()] };
      if (!persist(() => repo.saveOrderWithLoyalty({ order: updated, newEvents: [] }))) return;
      data = { ...data, orders: data.orders.map((o) => (o.id === orderId ? updated : o)) };
      notify();
    },

    /** Points que la commande en cours de modification a déjà crédités (affichage). */
    pointsAlreadyCredited(orderId: string, customerId: string) {
      return netForOrder(data.loyaltyEvents, orderId, customerId).points;
    },

    /**
     * Fermeture du service : archive les commandes soldées, garde les autres, passe à l'état fermé.
     * N'ouvre PAS de nouveau service. Sûre si répétée : un service déjà fermé reste fermé (date d'origine).
     */
    closeService(): Result<{ archived: number; stillActive: number; waitingPayment: number; alreadyClosed: boolean }> {
      const alreadyClosed = !data.serviceOpen;
      const { orders, archived, stillActive, waitingPayment } = closeService(data.orders, nowIso());
      if (alreadyClosed && archived === 0) return ok({ archived, stillActive, waitingPayment, alreadyClosed });
      // Numérotation remise à 1 seulement si plus aucune commande n'est affichée (évite les doublons de numéro).
      const counters = stillActive + waitingPayment === 0 ? { nextOrderNumber: 1 } : data.counters;
      const serviceClosedAt = alreadyClosed ? data.serviceClosedAt ?? nowIso() : nowIso();
      const archivedOrders = orders.filter((o, i) => o !== data.orders[i]);
      // Le bilan du service reste consultable : le service est clôturé dans l'historique, rien n'est effacé.
      const services = closeServiceRecord(data.services, serviceClosedAt);
      const change = {
        archivedOrders,
        nextOrderNumber: counters.nextOrderNumber,
        serviceStartedAt: data.serviceStartedAt,
        serviceOpen: false,
        serviceClosedAt,
        services,
      };
      if (!persist(() => repo.saveService(change))) return fail(SAVE_FAILED);
      data = { ...data, orders, counters, serviceOpen: false, serviceClosedAt, services };
      notify();
      return ok({ archived, stillActive, waitingPayment, alreadyClosed });
    },

    /**
     * Ouverture : nouveau service, ajouté à l'historique (ses chiffres partent de zéro).
     * Commandes, clients, fidélité et services précédents sont conservés tels quels.
     */
    openService(): Result<{ alreadyOpen: boolean }> {
      if (data.serviceOpen) return ok({ alreadyOpen: true });
      const serviceStartedAt = nowIso();
      const services = openServiceRecord(data.services, serviceStartedAt);
      const change = {
        archivedOrders: [],
        nextOrderNumber: data.counters.nextOrderNumber,
        serviceStartedAt,
        serviceOpen: true,
        serviceClosedAt: null,
        services,
      };
      if (!persist(() => repo.saveService(change))) return fail(SAVE_FAILED);
      data = { ...data, serviceStartedAt, serviceOpen: true, serviceClosedAt: null, services };
      notify();
      return ok({ alreadyOpen: false });
    },

    /* ---------- Paramètres & données ---------- */

    updateSettings(patch: Partial<Settings>): Result<Settings> {
      // Un ancien réglage de frais de livraison transmis par erreur est ignoré : la livraison reste offerte.
      const { deliveryFee: _ignoredFee, ...clean } = patch as Partial<Settings> & { deliveryFee?: unknown };
      void _ignoredFee;
      const next: Settings = {
        ...data.settings,
        ...clean,
        pizzeria: { ...data.settings.pizzeria, ...clean.pizzeria },
        modules: { ...data.settings.modules, ...clean.modules },
      };
      next.modules = { statistiques: next.modules.statistiques !== false };
      if (next.ticketWidthMm !== 58 && next.ticketWidthMm !== 80) return fail('Largeur de ticket invalide.');
      next.paymentSound = next.paymentSound !== false;
      if (next.paymentSoundKind !== 'vente' && next.paymentSoundKind !== 'caisse') next.paymentSoundKind = 'caisse';
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
      if (!persist(() => repo.saveSettings(next))) return fail(SAVE_FAILED);
      data = { ...data, settings: next };
      notify();
      return ok(next);
    },

    /** Efface toutes les données locales et recharge le jeu de démonstration. */
    resetDemoData() {
      // Choix explicite de l'utilisateur : seule action autorisée à remplacer des données illisibles.
      storageLocked = null;
      if (cartTimer !== null) clearTimeout(cartTimer);
      cartTimer = null;
      repo.clear();
      const seeded = deps.seed(catalog, now(), newId);
      try {
        repo.replaceAll(withoutCart(seeded), seeded.cart);
        docError = null;
        cartError = null;
      } catch {
        docError = DOC_ERROR;
      }
      data = seeded;
      notify();
    },
  };
}

export type AppStore = ReturnType<typeof createAppStore>;
