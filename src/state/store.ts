import type {
  Cart,
  Catalog,
  Customer,
  DeliveryAddressInput,
  DeliveryTrip,
  Order,
  OrderMode,
  OrderStatus,
  PaymentMethod,
  PaymentPart,
  PaymentPlan,
  Product,
  Topping,
  RewardKind,
  Settings,
} from '../domain/types';
import { selectedToppings, unavailableTopping, validateToppingInput, type ToppingInput, type ToppingErrors } from '../domain/toppings';
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
  normalizePhone,
  validateCustomerInput,
  type CustomerFieldErrors,
  type CustomerInput,
} from '../domain/customers';
import { isRewardEligible, netForOrder, reconcileOrderLoyalty, rewardsRemainingForCart } from '../domain/loyalty';
import {
  applyProductInput,
  buildProduct,
  catalogDocument,
  isActive,
  readCatalogDocument, readToppingsDocument,
  setProductActive,
  validateProductInput,
  type ProductErrors,
  type ProductInput,
} from '../domain/catalog';
import {
  buildOrder,
  canCancelOrder,
  canChangeCartCustomer,
  canChangeStatus,
  canEditOrder,
  closeService,
  EDIT_CUSTOMER_LOCKED_MESSAGE,
  orderToCart,
  SERVICE_CLOSED_MESSAGE,
  validateCart,
  withStatus,
} from '../domain/orders';
import { isValidTimeOfDay } from '../domain/time';
import { computeTotals } from '../domain/pricing';
import { asDeliveryTrip, deliveryAddressKey } from '../domain/trip';
import {
  addressOf,
  cleanDeliveryAddress,
  effectiveDeliveryAddress,
  sameDeliveryAddress,
  validateDeliveryAddress,
} from '../domain/delivery';
import { asPaymentPlan, canPlanPayment, cannotMarkPaid, isPaid, markPaid, markUnpaid, planProblem, tendersProblem } from '../domain/payment';
import { closeServiceRecord, currentService, openServiceRecord } from '../domain/service';

export type Result<T = void> =
  | { ok: true; value: T }
  | { ok: false; error: string; fieldErrors?: CustomerFieldErrors; existingCustomerId?: string; productErrors?: ProductErrors; toppingErrors?: ToppingErrors };

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
const PRODUCT_INACTIVE = 'Produit désactivé : il n’est plus proposé pour les nouvelles sélections.';
const CATALOG_SAVE_FAILED = 'Enregistrement de la carte impossible (stockage plein ou bloqué) : la modification n’a pas été appliquée.';

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
  const { repo } = deps;
  /** Carte du code : produits de départ (initialisation unique de la carte enregistrée) et suppléments (intervention 9b). */
  const defaultCatalog = deps.catalog;
  let toppingById = new Map(defaultCatalog.toppings.map((t) => [t.id, t]));
  /** Carte en vigueur : celle enregistrée (clé carte), jamais une autre que celle retrouvée au rechargement. */
  let catalog: Catalog = defaultCatalog;
  let productById = new Map(catalog.products.map((p) => [p.id, p]));
  /**
   * Carte enregistrée illisible : conservée intacte, aucune nouvelle sélection de produit possible (la carte
   * de démonstration n'est jamais utilisée à sa place) jusqu'à la restauration d'une carte valide.
   */
  let catalogError: string | null = null;
  const listeners = new Set<() => void>();

  let docError: string | null = null;
  let cartError: string | null = null;
  /**
   * Renseigné quand des données existent mais ne peuvent pas être relues (version inconnue, JSON corrompu,
   * stockage inaccessible). Aucune écriture n'est alors faite : les données d'origine restent intactes
   * tant que l'utilisateur ne choisit pas explicitement « Réinitialiser les données de démonstration ».
   */
  let storageLocked: string | null = null;
  /**
   * Écritures suspendues (restauration en cours dans cet onglet ou un autre) : plus aucune écriture,
   * pas même le panier enregistré à la fermeture de la page, jusqu'au rechargement ou à la reprise.
   */
  let frozen: string | null = null;
  let cartTimer: ReturnType<typeof setTimeout> | null = null;
  let data: AppData = loadOrSeed();
  initCatalog();
  if (!catalogError) initToppings();

  function setCatalogProducts(products: Product[], toppings: Topping[] = catalog.toppings) {
    catalog = { products, toppings };
    toppingById = new Map(toppings.map((t) => [t.id, t]));
    productById = new Map(products.map((p) => [p.id, p]));
  }

  function initCatalog() {
    const loaded = repo.loadCatalog();
    if (loaded.kind === 'error') return lockCatalog(loaded.error);
    if (loaded.kind === 'data') {
      const read = readCatalogDocument(loaded.value);
      return read.ok ? setCatalogProducts(read.products, read.toppings ?? defaultCatalog.toppings) : lockCatalog(read.reason);
    }
    // Première utilisation de la carte modifiable : initialisée UNE fois depuis les produits actuels.
    // Si l'écriture échoue, la même carte sera recréée au prochain lancement (même contenu).
    setCatalogProducts(defaultCatalog.products);
    if (storageLocked) return;
    try {
      repo.saveCatalog(catalogDocument(defaultCatalog.products));
    } catch {
      /* réessayé au prochain lancement */
    }
  }

  function initToppings() {
    const loaded = repo.loadToppings();
    if (loaded.kind === 'error') return lockCatalog(loaded.error);
    if (loaded.kind === 'data') {
      const read = readToppingsDocument(loaded.value);
      return read.ok ? setCatalogProducts(catalog.products, read.toppings) : lockCatalog(read.reason);
    }
    // Initialisation unique dans sa propre clé ; aucun document existant n'est réécrit.
    if (!storageLocked) {
      try { repo.saveToppings({ v: 1, toppings: catalog.toppings }); }
      catch { /* mêmes valeurs au prochain chargement si le stockage refuse */ }
    }
  }

  function lockCatalog(reason: string) {
    catalogError =
      `Carte des produits illisible (${reason}) : elle est conservée intacte, mais aucun produit ne peut être ajouté à une commande. ` +
      'Restaurez une sauvegarde (Paramètres → Restaurer une sauvegarde). Les commandes existantes restent consultables.';
    setCatalogProducts([], []);
  }

  /** Raison pour laquelle la carte ne peut pas être modifiée, ou null. */
  function catalogWriteBlocked(): string | null {
    if (frozen) return frozen;
    if (storageLocked) return 'Données locales non chargées : la carte ne peut pas être modifiée (rien ne serait conservé).';
    return catalogError;
  }

  /** Écrit d'abord ; la carte affichée ne change que si l'écriture a réussi (sinon rien n'est appliqué). */
  function commitCatalog(products: Product[], toppings?: Topping[]): boolean {
    try {
      if (toppings !== undefined) repo.saveToppings({ v: 1, toppings });
      else repo.saveCatalog(catalogDocument(products));
    } catch {
      return false;
    }
    setCatalogProducts(products, toppings);
    notify();
    return true;
  }

  /** Produit disponible pour une NOUVELLE sélection (ajout, récompense, quantité augmentée). */
  function selectable(productId: string): Result<Product> {
    if (catalogError) return fail(catalogError);
    const p = product(productId);
    if (!p) return fail('Produit absent de la carte actuelle.');
    if (!isActive(p)) return fail(PRODUCT_INACTIVE);
    return ok(p);
  }

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
    const seeded = deps.seed(defaultCatalog, now(), newId);
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
    return deps.seed(defaultCatalog, now(), newId);
  }

  const notify = () => listeners.forEach((l) => l());

  /**
   * Écrit une donnée durable. Renvoie false si l'écriture a échoué : l'appelant ne modifie alors rien
   * et signale l'échec. En mode protégé (données illisibles), rien n'est écrit, volontairement.
   */
  function persist(write: () => void): boolean {
    if (frozen) return false;
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
    if (storageLocked || frozen) return;
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
  const editedOrder = () => (data.cart.editingOrderId ? findOrder(data.cart.editingOrderId) : undefined);
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
    /** Carte en vigueur (change quand le gérant modifie un produit : lire via useCatalog dans l'interface). */
    get catalog() {
      return catalog;
    },
    getCatalog: () => catalog,
    getCatalogError: () => catalogError,
    getData: () => data,
    getPersistError: () => frozen ?? storageLocked ?? catalogError ?? docError ?? cartError,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /** Données illisibles au chargement (mode protégé) : la restauration reste possible pour en sortir. */
    isStorageLocked: () => storageLocked !== null,
    /**
     * Restauration : plus aucune écriture (le panier en attente est abandonné, il figure dans la copie
     * de sécurité). Sert aussi quand une restauration démarre dans un autre onglet.
     */
    suspendWrites(reason: string) {
      if (cartTimer !== null) clearTimeout(cartTimer);
      cartTimer = null;
      frozen = reason;
      notify();
    },
    /** Restauration abandonnée avant toute modification : l'application reprend normalement. */
    resumeWrites() {
      frozen = null;
      notify();
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

    selectCustomer(customerId: string | null): Result<{ removedRewards: number; addressReset: boolean }> {
      if (customerId && !findCustomer(customerId)) return fail('Client introuvable.');
      if (data.cart.customerId === customerId) return ok({ removedRewards: 0, addressReset: false });
      if (!canChangeCartCustomer(data.cart, customerId, editedOrder())) return fail(EDIT_CUSTOMER_LOCKED_MESSAGE);
      // Les récompenses appartiennent au client : on les retire si on change de client.
      const removedRewards = rewardLineCount(data.cart.lines);
      // L'adresse ponctuelle et le trajet appartiennent au client précédent : jamais transférés au nouveau.
      const addressReset = Boolean(data.cart.deliveryAddress);
      const cart = {
        ...withoutRewardLines(data.cart),
        customerId,
        counterName: customerId ? '' : data.cart.counterName,
        deliveryAddress: null,
        deliveryTrip: null,
      };
      setCart(cart);
      return ok({ removedRewards, addressReset });
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
      // Pendant une modification, la fiche est créée mais la commande garde son client d'origine.
      const select = options.select && canChangeCartCustomer(data.cart, customer.id, editedOrder());
      const cart = select
        ? { ...withoutRewardLines(data.cart), customerId: customer.id, counterName: '', deliveryAddress: null, deliveryTrip: null }
        : undefined;
      if (!commitCustomer(customer, cart)) return fail(SAVE_FAILED);
      return ok(customer);
    },

    /**
     * Import CSV : ajoute uniquement de NOUVEAUX clients (numéro inconnu, sans doublon dans la liste), sans
     * fidélité ni commande. Tout est revalidé ici ; une seule écriture : si elle échoue, rien n'est ajouté.
     */
    importCustomers(inputs: CustomerInput[]): Result<{ added: number }> {
      const batch: Customer[] = [];
      const phones = new Set<string>();
      for (const input of inputs) {
        if (Object.keys(validateCustomerInput(input)).length) return fail('Import refusé : une fiche est invalide. Rien n’a été ajouté.');
        const phone = normalizePhone(input.phone);
        if (phones.has(phone) || findCustomerByPhone(data.customers, phone)) return fail('Import refusé : un numéro est déjà enregistré. Rien n’a été ajouté.');
        phones.add(phone);
        batch.push(buildCustomer({ ...input, instructions: '' }, newId('cus'), nowIso()));
      }
      if (batch.length === 0) return ok({ added: 0 });
      if (!persist(() => repo.addCustomers(batch))) return fail(SAVE_FAILED);
      data = { ...data, customers: [...data.customers, ...batch] };
      notify();
      return ok({ added: batch.length });
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
      const s = selectable(productId);
      if (!s.ok) return s;
      setCart(addProduct(data.cart, s.value, newId('lin')));
      return ok(s.value);
    },

    addConfiguredLine(productId: string, options: LineOptions): Result<Product> {
      const s = selectable(productId);
      if (!s.ok) return s;
      const selected = selectedToppings(options.addedToppings ?? [], catalog.toppings);
      if (!selected.ok) return fail(selected.error);
      setCart(addLine(data.cart, createLine(s.value, newId('lin'), { ...options, addedToppings: selected.value })));
      return ok(s.value);
    },

    /**
     * Personnalisation d'une ligne existante : possible même si le produit a été modifié, désactivé ou
     * retiré de la carte (ce n'est pas une nouvelle sélection) ; la ligne garde ses valeurs figées.
     */
    updateLine(lineId: string, options: LineOptions): Result {
      const line = data.cart.lines.find((l) => l.id === lineId);
      if (!line) return fail('Ligne introuvable.');
      const selected = selectedToppings(options.addedToppings ?? line.addedToppings, catalog.toppings, line.addedToppings);
      if (!selected.ok) return fail(selected.error);
      if (options.quantity !== undefined && options.quantity > line.quantity && unavailableTopping({ addedToppings: selected.value }, catalog.toppings)) {
        return fail('Supplément désactivé ou absent : quantité non augmentable. Retirez ce supplément pour augmenter la ligne.');
      }
      // Même règle que setLineQuantity : augmenter la quantité est une nouvelle sélection.
      if (options.quantity !== undefined && options.quantity > line.quantity) {
        const s = selectable(line.productId);
        if (!s.ok) return fail(`${s.error} Quantité inchangée (diminuer ou supprimer reste possible).`);
      }
      setCart(updateLine(data.cart, lineId, { ...options, addedToppings: selected.value }, product(line.productId)));
      return ok(undefined);
    },

    addToppingToLine(lineId: string, toppingId: string): Result {
      const t = toppingById.get(toppingId);
      if (catalogError) return fail(catalogError);
      if (!t || !isActive(t)) return fail('Supplément désactivé ou absent : nouvelle sélection impossible.');
      const line = data.cart.lines.find((l) => l.id === lineId);
      if (!line || line.category !== 'pizza') return fail('Choisissez une ligne de pizza.');
      setCart(addToppingToLine(data.cart, lineId, t));
      return ok(undefined);
    },

    /** Diminuer ou supprimer : toujours possible. Augmenter = nouvelle sélection : refusé pour un produit désactivé ou absent. */
    setLineQuantity(lineId: string, quantity: number): Result {
      const line = data.cart.lines.find((l) => l.id === lineId);
      if (line && quantity > line.quantity) {
        if (unavailableTopping(line, catalog.toppings)) return fail('Supplément désactivé ou absent : quantité non augmentable.');
        const s = selectable(line.productId);
        if (!s.ok) return fail(`${s.error} Quantité inchangée (diminuer ou supprimer reste possible).`);
      }
      setCart(setLineQuantity(data.cart, lineId, quantity));
      return ok(undefined);
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

    /**
     * Trajet calculé pour la commande en cours de saisie. Refusé s'il ne correspond plus à la situation actuelle
     * (client, adresse ou mode changés pendant le calcul) : un trajet n'est jamais rattaché à une autre adresse.
     */
    setCartDeliveryTrip(trip: DeliveryTrip | null): Result {
      if (trip === null) {
        setCart({ ...data.cart, deliveryTrip: null });
        return ok(undefined);
      }
      const valid = asDeliveryTrip(trip);
      const address = effectiveDeliveryAddress(data.cart, findCustomer(data.cart.customerId));
      if (!valid || data.cart.mode !== 'livraison' || !address || valid.addressKey !== deliveryAddressKey(address)) {
        return fail('Le client ou l’adresse a changé pendant le calcul : relancez le calcul du trajet.');
      }
      setCart({ ...data.cart, deliveryTrip: valid });
      return ok(undefined);
    },

    /**
     * Adresse de livraison de la commande en cours (null = adresse habituelle). La fiche client n'est jamais
     * modifiée. Si l'adresse change, le trajet calculé devient caduc immédiatement.
     */
    setCartDeliveryAddress(input: DeliveryAddressInput | null): Result<{ usesHabitual: boolean }> {
      const customer = findCustomer(data.cart.customerId);
      if (!customer) return fail('Sélectionnez d’abord un client.');
      let next: DeliveryAddressInput | null = null;
      if (input) {
        const fieldErrors = validateDeliveryAddress(input);
        if (Object.keys(fieldErrors).length) return fail('Vérifiez les champs signalés.', { fieldErrors });
        const cleaned = cleanDeliveryAddress(input);
        // Identique à l'adresse habituelle : rien de ponctuel à retenir.
        next = sameDeliveryAddress(cleaned, addressOf(customer)) ? null : cleaned;
      }
      const before = effectiveDeliveryAddress(data.cart, customer)!;
      const after = next ?? addressOf(customer);
      const keepTrip = deliveryAddressKey(before) === deliveryAddressKey(after);
      setCart({ ...data.cart, deliveryAddress: next, deliveryTrip: keepTrip ? data.cart.deliveryTrip ?? null : null });
      return ok({ usesHabitual: next === null });
    },

    /** Paiement prévu de la commande en cours de saisie (null = non renseigné). Refusé s'il dépasse le total. */
    setCartPaymentPlan(plan: PaymentPlan | null): Result {
      const valid = asPaymentPlan(plan);
      if (plan !== null && !valid) return fail('Paiement prévu invalide.');
      const problem = valid && planProblem(valid, computeTotals(data.cart.lines).total);
      if (problem) return fail(problem);
      setCart({ ...data.cart, paymentPlan: valid });
      return ok(undefined);
    },

    /** Vide le panier (et abandonne une éventuelle modification en cours). */
    clearCart() {
      setCart(emptyCart(newId('ord')));
    },

    /**
     * Abandonne la modification en cours (la commande enregistrée reste telle quelle : seul le panier est remplacé)
     * et commence une nouvelle commande pour ce client. Refusé si le service est fermé : rien n'est abandonné.
     */
    abandonEditAndStartOrder(customerId: string): Result<Customer> {
      const customer = findCustomer(customerId);
      if (!customer) return fail('Client introuvable.');
      if (!data.serviceOpen) return fail(SERVICE_CLOSED_MESSAGE);
      setCart({ ...emptyCart(newId('ord')), customerId: customer.id });
      return ok(customer);
    },

    /* ---------- Fidélité ---------- */

    rewardsRemaining(): number {
      return rewardsRemainingForCart(data.loyaltyEvents, data.cart, data.settings.loyalty);
    },

    /** Utilisation explicite d'une récompense : jamais automatique. */
    addReward(kind: RewardKind, productId: string): Result<Product> {
      const customer = findCustomer(data.cart.customerId);
      if (!customer) return fail('Sélectionnez d’abord le client.');
      const s = selectable(productId);
      if (!s.ok) return s;
      const p = s.value;
      if (!isRewardEligible(p, kind, data.settings.loyalty)) return fail('Ce produit n’est pas éligible à la récompense.');
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
      setCart(orderToCart(order, findCustomer(order.customerId)));
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
    /**
     * Encaissement confirmé : un moyen (« Non précisé » compris) ou une répartition par moyen, qui doit couvrir
     * exactement le total (pas d'encaissement partiel). Le paiement prévu n'est jamais pris pour un encaissement.
     */
    markOrderPaid(
      orderId: string,
      how: PaymentMethod | PaymentPart[] = 'non_precise',
    ): Result<{ order: Order; pointsCredited: number; alreadyPaid: boolean }> {
      const order = findOrder(orderId);
      if (!order) return fail('Commande introuvable.');
      const blocked = cannotMarkPaid(order);
      if (blocked) return fail(blocked);
      if (Array.isArray(how)) {
        const problem = tendersProblem(how, order.totals.total);
        if (problem) return fail(problem);
      }
      const alreadyPaid = isPaid(order);
      const updated = markPaid(order, how, nowIso());
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
    /** Paiement prévu d'une commande enregistrée (avant de partir en livraison, par exemple). */
    setOrderPaymentPlan(orderId: string, plan: PaymentPlan | null): Result<Order> {
      const order = findOrder(orderId);
      if (!order) return fail('Commande introuvable.');
      if (isPaid(order)) return fail('Commande déjà encaissée : le paiement prévu ne s’applique plus.');
      if (!canPlanPayment(order)) return fail('Paiement prévu impossible pour cette commande.');
      const valid = asPaymentPlan(plan);
      if (plan !== null && !valid) return fail('Paiement prévu invalide.');
      const problem = valid && planProblem(valid, order.totals.total);
      if (problem) return fail(problem);
      if (JSON.stringify(asPaymentPlan(order.paymentPlan)) === JSON.stringify(valid)) return ok(order);
      const updated: Order = { ...order, paymentPlan: valid, updatedAt: nowIso() };
      // Le panier qui modifie cette commande suit le même paiement prévu.
      const cart = data.cart.editingOrderId === orderId ? { ...data.cart, paymentPlan: valid } : undefined;
      if (!commitOrder(updated, { cart })) return fail(SAVE_FAILED);
      return ok(updated);
    },

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

    /* ---------- Suppléments (intervention 9b) ---------- */
    addCatalogTopping(input: ToppingInput): Result<Topping> {
      const blocked = catalogWriteBlocked();
      if (blocked) return fail(blocked);
      const { errors, name, price } = validateToppingInput(input, catalog.toppings);
      if (price === null) return fail('Vérifiez les champs signalés.', { toppingErrors: errors });
      const created: Topping = { id: newId('sup'), name, price, active: true, createdAt: nowIso(), updatedAt: nowIso(), deactivatedAt: null };
      if (!commitCatalog(catalog.products, [...catalog.toppings, created])) return fail(CATALOG_SAVE_FAILED);
      return ok(created);
    },
    updateCatalogTopping(id: string, input: ToppingInput): Result<Topping> {
      const blocked = catalogWriteBlocked();
      if (blocked) return fail(blocked);
      const existing = toppingById.get(id);
      if (!existing) return fail('Supplément introuvable.');
      const { errors, name, price } = validateToppingInput(input, catalog.toppings, id);
      if (price === null) return fail('Vérifiez les champs signalés.', { toppingErrors: errors });
      const updated = { ...existing, name, price, updatedAt: nowIso() };
      if (!commitCatalog(catalog.products, catalog.toppings.map((t) => t.id === id ? updated : t))) return fail(CATALOG_SAVE_FAILED);
      return ok(updated);
    },
    setCatalogToppingActive(id: string, active: boolean): Result<Topping> {
      const blocked = catalogWriteBlocked();
      if (blocked) return fail(blocked);
      const existing = toppingById.get(id);
      if (!existing) return fail('Supplément introuvable.');
      if (active) {
        const { errors } = validateToppingInput({ name: existing.name, price: '1' }, catalog.toppings, id);
        if (errors.name) return fail('Réactivation impossible : ' + errors.name);
      }
      const updated = { ...existing, active, updatedAt: nowIso(), deactivatedAt: active ? null : nowIso() };
      if (!commitCatalog(catalog.products, catalog.toppings.map((t) => t.id === id ? updated : t))) return fail(CATALOG_SAVE_FAILED);
      return ok(updated);
    },

    /* ---------- Carte des produits (intervention 9a) ---------- */

    addCatalogProduct(input: ProductInput): Result<Product> {
      const blocked = catalogWriteBlocked();
      if (blocked) return fail(blocked);
      const { errors, price } = validateProductInput(input, catalog.products);
      if (price === null) return fail('Vérifiez les champs signalés.', { productErrors: errors });
      const created = buildProduct(input, price, newId('prd'), nowIso());
      if (!commitCatalog([...catalog.products, created])) return fail(CATALOG_SAVE_FAILED);
      return ok(created);
    },

    /** Nouvelle fiche pour les PROCHAINES sélections ; paniers et commandes existants inchangés. */
    updateCatalogProduct(productId: string, input: ProductInput): Result<{ product: Product; categoryChanged: boolean }> {
      const blocked = catalogWriteBlocked();
      if (blocked) return fail(blocked);
      const existing = product(productId);
      if (!existing) return fail('Produit introuvable.');
      const { errors, price } = validateProductInput(input, catalog.products, productId);
      if (price === null) return fail('Vérifiez les champs signalés.', { productErrors: errors });
      const updated = applyProductInput(existing, input, price, nowIso());
      if (!commitCatalog(catalog.products.map((p) => (p.id === productId ? updated : p)))) return fail(CATALOG_SAVE_FAILED);
      return ok({ product: updated, categoryChanged: updated.category !== existing.category });
    },

    /** Désactivation / réactivation : jamais de suppression, l'identifiant reste réservé. */
    setCatalogProductActive(productId: string, active: boolean): Result<Product> {
      const blocked = catalogWriteBlocked();
      if (blocked) return fail(blocked);
      const existing = product(productId);
      if (!existing) return fail('Produit introuvable.');
      if (active) {
        const { errors } = validateProductInput(
          { name: existing.name, category: existing.category, price: '1', ingredients: [], tags: [], description: '', alcohol: false },
          catalog.products,
          productId,
        );
        if (errors.name) return fail(`Réactivation impossible : ${errors.name.toLowerCase()}`);
      }
      const updated = setProductActive(existing, active, nowIso());
      if (!commitCatalog(catalog.products.map((p) => (p.id === productId ? updated : p)))) return fail(CATALOG_SAVE_FAILED);
      return ok(updated);
    },

    /** Efface toutes les données locales et recharge le jeu de démonstration (la carte des produits est conservée). */
    resetDemoData() {
      if (frozen) return;
      try { repo.clear(); } catch { docError = DOC_ERROR; notify(); return; }
      // Choix explicite de l'utilisateur : seule action autorisée à remplacer des données illisibles.
      storageLocked = null;
      if (cartTimer !== null) clearTimeout(cartTimer);
      cartTimer = null;
      const seeded = deps.seed(defaultCatalog, now(), newId);
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
