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
  /** Complément libre (résidence, porte…). */
  complement: string;
  /** Repères de livraison, chacun facultatif (vides sur les fiches créées avant l'intervention 5). */
  building: string;
  floor: string;
  intercom: string;
  doorCode: string;
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
  /** Absents sur les commandes enregistrées avant l'intervention 5. */
  building?: string;
  floor?: string;
  intercom?: string;
  doorCode?: string;
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
  /** Paiement prévu (intention du client), copié sur la commande à la validation. */
  paymentPlan?: PaymentPlan | null;
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

/**
 * Résumé du moyen d'encaissement. Valeurs FIGÉES : ce sont les seules que la version précédente sait relire
 * (une valeur inconnue y ferait passer la commande en « Paiement non suivi »). Titres-restaurant et paiement
 * mixte sont donc résumés par « non_precise » ; leur détail est dans `tenders`.
 */
export type PaymentMethod = 'especes' | 'carte' | 'non_precise';

/** Moyens de paiement réels. */
export type TenderKind = 'especes' | 'carte' | 'titres_restaurant';

/** Montant réglé (ou prévu) avec un moyen de paiement. */
export interface PaymentPart {
  kind: TenderKind;
  amount: Cents;
}

/**
 * Paiement PRÉVU : comment le client compte payer. Ce n'est jamais un encaissement :
 * aucun effet sur le statut de paiement, la fidélité ni les statistiques.
 * - « unique » : un seul moyen, pour la totalité (suit le total si la commande est modifiée) ;
 * - « mixte » : montants par moyen, éventuellement incomplets (le reste est « non affecté »).
 */
export type PaymentPlan = { type: 'unique'; kind: TenderKind } | { type: 'mixte'; parts: PaymentPart[] };

export interface Payment {
  status: PaymentStatus;
  /** Facultatif : renseigné au moment de l'encaissement (résumé compatible, voir PaymentMethod). */
  method: PaymentMethod | null;
  /**
   * Détail de l'encaissement CONFIRMÉ (un moyen ou paiement mixte), dont la somme était égale au total
   * au moment de la confirmation. Absent sur les encaissements d'avant l'intervention 5 et « Non précisé ».
   */
  tenders?: PaymentPart[];
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
  /** Paiement prévu (absent sur les commandes d'avant l'intervention 5). */
  paymentPlan?: PaymentPlan | null;
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
  /**
   * Service pendant lequel la commande a été créée (voir ServiceRecord). Fixé à la création,
   * jamais modifié ensuite. Absent sur les commandes d'avant le suivi des services.
   */
  serviceId?: string;
}

/* ---------- Services ---------- */

/**
 * Un service, de son ouverture à sa fermeture. Socle de l'historique des services :
 * indépendant de l'affichage des statistiques, qui ne fait que le lire.
 */
export interface ServiceRecord {
  id: string;
  openedAt: string;
  /** null tant que le service est ouvert. */
  closedAt: string | null;
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

export type PaymentSoundKind = 'vente' | 'caisse';

export interface Settings {
  pizzeria: {
    name: string;
    address: string;
    phone: string;
  };
  ticketWidthMm: TicketWidth;
  /** Petit son de confirmation à chaque encaissement réussi. */
  paymentSound: boolean;
  /** Son choisi : « Notification de vente » ou « Caisse enregistreuse ». */
  paymentSoundKind: PaymentSoundKind;
  loyalty: LoyaltyRules;
  /**
   * Modules facultatifs, masquables à tout moment. Les masquer ne supprime aucune donnée :
   * commandes et services sont enregistrés de la même façon, module visible ou non.
   */
  modules: { statistiques: boolean };
}
