/**
 * Types métier de Ferrari Manager.
 * Aucun import React ici : le domaine doit rester testable et réutilisable (V2 : base de données).
 * Tous les montants sont exprimés en centimes (entiers) pour éviter les erreurs d'arrondi.
 */

export type Cents = number;

/* ---------- Catalogue ---------- */

export type ProductCategory = 'pizza' | 'boisson' | 'dessert';

/** Familles de pizzas utilisées pour filtrer le catalogue (une pizza peut en avoir plusieurs). */
export type PizzaTag = 'classique' | 'speciale' | 'blanche' | 'viande' | 'vegetarienne';

export interface Product {
  id: string;
  name: string;
  category: ProductCategory;
  price: Cents;
  /** Texte court affiché sous le nom (composition, contenance…). */
  description?: string;
  /** Ingrédients retirables (pizzas uniquement). */
  ingredients?: string[];
  tags?: PizzaTag[];
  /** Boisson alcoolisée : jamais éligible à une récompense fidélité, quelle que soit la configuration. */
  alcohol?: boolean;
}

/** Supplément ajoutable sur une pizza (ingrédient en plus, payant). */
export interface Topping {
  id: string;
  name: string;
  price: Cents;
}

export interface Catalog {
  products: Product[];
  toppings: Topping[];
}

/* ---------- Clients ---------- */

export interface Customer {
  id: string;
  firstName: string;
  lastName: string;
  /** Téléphone normalisé : 10 chiffres, ex. 0612345678. */
  phone: string;
  address: string;
  postalCode: string;
  city: string;
  /** Étage, code, interphone… */
  complement: string;
  /** Notes permanentes : instructions de livraison, préférences. */
  instructions: string;
  createdAt: string;
  updatedAt: string;
}

/** Copie figée des informations client au moment de la commande (pas de modification rétroactive). */
export interface CustomerSnapshot {
  id: string;
  name: string;
  phone: string;
  address: string;
  postalCode: string;
  city: string;
  complement: string;
  instructions: string;
}

/* ---------- Commandes ---------- */

export type OrderMode = 'livraison' | 'emporter';

export type OrderStatus = 'a_preparer' | 'en_preparation' | 'prete' | 'terminee' | 'annulee';

export type RewardKind = 'pizza' | 'boisson';

export interface LineTopping {
  id: string;
  name: string;
  price: Cents;
}

export interface OrderLine {
  id: string;
  productId: string;
  /** Nom et prix figés au moment de l'ajout. */
  name: string;
  category: ProductCategory;
  unitPrice: Cents;
  quantity: number;
  addedToppings: LineTopping[];
  removedIngredients: string[];
  note: string;
  /** Ligne offerte par le programme de fidélité (quantité toujours 1). */
  reward: RewardKind | null;
}

/** Commande en cours de saisie (persistée localement pour ne rien perdre en cas de rechargement). */
export interface Cart {
  /** Identifiant réservé à la future commande : garantit l'idempotence de la validation. */
  draftId: string;
  /** Renseigné quand on modifie une commande déjà enregistrée. */
  editingOrderId: string | null;
  customerId: string | null;
  /** Nom libre pour une commande comptoir sans fiche client. */
  counterName: string;
  mode: OrderMode;
  /** "HH:MM" ou null pour « dès que possible ». */
  requestedTime: string | null;
  lines: OrderLine[];
  note: string;
}

export interface OrderTotals {
  subtotal: Cents;
  deliveryFee: Cents;
  total: Cents;
}

export interface StatusChange {
  status: OrderStatus;
  at: string;
}

/** Suivi d'encaissement, indépendant du statut de préparation. Ce n'est pas une caisse. */
export type PaymentStatus = 'a_encaisser' | 'encaissee';

export type PaymentMethod = 'especes' | 'carte' | 'non_precise';

export interface Payment {
  status: PaymentStatus;
  /** Facultatif : renseigné au moment de l'encaissement. */
  method: PaymentMethod | null;
  paidAt: string | null;
  /**
   * Commande enregistrée avant le suivi des paiements : statut de paiement inconnu.
   * Ses points avaient été crédités dès l'enregistrement (ancienne règle) : on les conserve
   * tant qu'aucune action explicite (encaissement annulé, annulation) ne change la commande.
   */
  legacy?: boolean;
}

export interface Order {
  id: string;
  /** Numéro court lisible en cuisine (remis à 1 en fin de service). */
  number: number;
  createdAt: string;
  updatedAt: string;
  /** 1 à la création, +1 à chaque modification. */
  revision: number;
  customerId: string | null;
  customer: CustomerSnapshot | null;
  counterName: string;
  mode: OrderMode;
  requestedTime: string | null;
  lines: OrderLine[];
  note: string;
  totals: OrderTotals;
  status: OrderStatus;
  statusHistory: StatusChange[];
  payment: Payment;
  /**
   * Dates d'ouverture de la boîte de dialogue d'impression.
   * Ce n'est PAS une preuve d'impression physique : le navigateur ne le confirme pas.
   */
  printRequests: string[];
  /** Renseigné à la fin de service : la commande quitte l'écran opérationnel mais reste conservée. */
  archivedAt: string | null;
}

/* ---------- Fidélité ---------- */

export type LoyaltyEventType = 'points' | 'rewards_used';

export type LoyaltyReason =
  | 'commande_encaissee'
  | 'encaissement_annule'
  | 'commande_modifiee'
  | 'commande_annulee'
  | 'recompense_reservee'
  | 'recompense_restituee'
  | 'reprise_demo'
  // Raisons des anciennes données (règle « crédit à l'enregistrement ») : conservées pour l'affichage du journal.
  | 'commande_validee'
  | 'statut_modifie'
  | 'recompense_utilisee';

/**
 * Journal de fidélité (append-only). Le solde d'un client est toujours recalculé
 * à partir de ce journal : aucune valeur n'est stockée « en dur », donc pas de dérive possible.
 * - type 'points' : delta de pizzas payantes comptabilisées (crédit à l'encaissement).
 * - type 'rewards_used' : +1 quand une commande enregistrée prend une récompense (réservée tant que
 *   la commande n'est pas encaissée, consommée ensuite), -1 quand elle est restituée.
 */
export interface LoyaltyEvent {
  id: string;
  at: string;
  customerId: string;
  orderId: string | null;
  type: LoyaltyEventType;
  delta: number;
  reason: LoyaltyReason;
  label?: string;
}

/** Règle fixe (validée par le gérant) : les pizzas payantes sont créditées à l'encaissement. */
export interface LoyaltyRules {
  pizzasPerReward: number;
  eligiblePizzaIds: string[];
  eligibleDrinkIds: string[];
}

/* ---------- Paramètres ---------- */

export type TicketWidth = 58 | 80;

export interface Settings {
  pizzeria: {
    name: string;
    address: string;
    phone: string;
  };
  deliveryFee: Cents;
  ticketWidthMm: TicketWidth;
  loyalty: LoyaltyRules;
}
