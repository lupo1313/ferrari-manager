/**
 * Barre latérale et disposition de la prise de commande (intervention 7).
 * Interface uniquement : aucune règle métier ici. Les valeurs reprennent celles du CSS
 * (layout.css, catalog.css) ; un test vérifie qu'elles restent identiques.
 */

export type SidebarState = 'ouverte' | 'reduite';

/** Largeur de la barre latérale selon son état (px CSS). */
export const SIDEBAR_WIDTH: Record<SidebarState, number> = { ouverte: 176, reduite: 72 };

/** Fenêtre plus étroite : barre toujours réduite, bouton masqué (téléphones, fenêtre en moitié d'écran). */
export const FORCED_REDUCED_BELOW = 900;

/** Fenêtre large : colonnes Client et Commande dans leur grande taille ; barre ouverte par défaut. */
export const WIDE_WINDOW_MIN = 1400;

/**
 * Colonnes Client et Commande : leur largeur dépend de la fenêtre, jamais de l'état de la barre,
 * pour que le panier ne bouge pas quand on replie ou déplie le menu. Seule la Carte récupère l'espace.
 */
export const COLUMN_WIDTHS = {
  large: { client: 300, commande: 380 },
  compact: { client: 268, commande: 340 },
} as const;

/** Marges de l'espace de prise de commande en trois colonnes (padding latéral, écart entre colonnes). */
export const WORKSPACE_PADDING = 16;
export const WORKSPACE_GAP = 12;

/**
 * Carte confortable : au moins deux cartes produit par ligne (grille `minmax(190px, 1fr)`, écart 10 px),
 * en comptant les bordures du panneau (2), ses marges intérieures (2 × 16) et une barre de défilement
 * classique de Windows (17).
 */
export const PRODUCT_CARD_MIN = 190;
export const PRODUCT_GAP = 10;
export const CATALOG_CHROME = 2 + 2 * 16 + 17;
export const CARTE_MIN = CATALOG_CHROME + 2 * PRODUCT_CARD_MIN + PRODUCT_GAP;

/** Client et Carte en onglets, Commande visible (même largeur qu'en trois colonnes) : seuil repris de l'ancienne mise en page. */
export const ONGLETS_CARTE_MIN = 870;

/**
 * - `colonnes` : Client | Carte | Commande ;
 * - `onglets-carte` : Client et Carte en onglets, Commande visible ;
 * - `onglets` : une seule section à la fois (trois onglets).
 */
export type Disposition = 'colonnes' | 'onglets-carte' | 'onglets';

export function columnWidths(windowWidth: number) {
  return windowWidth >= WIDE_WINDOW_MIN ? COLUMN_WIDTHS.large : COLUMN_WIDTHS.compact;
}

/** Largeur de la colonne Carte en trois colonnes, pour une largeur disponible (à côté de la barre). */
export function carteWidth(available: number, windowWidth: number): number {
  const { client, commande } = columnWidths(windowWidth);
  return available - 2 * WORKSPACE_PADDING - 2 * WORKSPACE_GAP - client - commande;
}

/** Nombre de cartes produit par ligne dans une colonne Carte de cette largeur. */
export function productsPerRow(carte: number): number {
  const grid = carte - CATALOG_CHROME;
  return Math.max(1, Math.floor((grid + PRODUCT_GAP) / (PRODUCT_CARD_MIN + PRODUCT_GAP)));
}

/**
 * Disposition selon la place réellement disponible (largeur de la zone principale, barre déduite).
 * Trois colonnes seulement si la Carte garde au moins deux cartes produit par ligne.
 */
export function dispositionFor(available: number, windowWidth: number): Disposition {
  if (carteWidth(available, windowWidth) >= CARTE_MIN) return 'colonnes';
  if (available >= ONGLETS_CARTE_MIN) return 'onglets-carte';
  return 'onglets';
}

export function isSidebarForced(windowWidth: number): boolean {
  return windowWidth < FORCED_REDUCED_BELOW;
}

/** Sans préférence enregistrée : l'apparence d'avant (logo à partir de 1400 px, monogramme en dessous). */
export function defaultSidebarState(windowWidth: number): SidebarState {
  return windowWidth >= WIDE_WINDOW_MIN ? 'ouverte' : 'reduite';
}

/**
 * État affiché de la barre. La préférence (choix manuel) n'est jamais modifiée par le repli automatique :
 * celui-ci ne vaut que jusqu'à la prochaine action manuelle ou au rechargement.
 */
export function displayedSidebarState(input: { preference: SidebarState | null; autoCollapsed: boolean; windowWidth: number }): SidebarState {
  if (isSidebarForced(input.windowWidth) || input.autoCollapsed) return 'reduite';
  return input.preference ?? defaultSidebarState(input.windowWidth);
}

/** Appui sur le bouton : la préférence prend l'état inverse de l'état affiché, le repli automatique est levé. */
export function sidebarAfterToggle(displayed: SidebarState): { preference: SidebarState; autoCollapsed: false } {
  return { preference: displayed === 'ouverte' ? 'reduite' : 'ouverte', autoCollapsed: false };
}

export interface CartIdentity {
  customerId: string | null;
  editingOrderId: string | null;
}

/**
 * Repli automatique : le client de la commande vient de changer pour un client (pas un retrait),
 * en dehors de l'ouverture d'une commande à modifier. Couvre la liste, la recherche, « Commander »
 * depuis Clients, une fiche créée ou retrouvée par son numéro, « Abandonner et commander ».
 */
export function shouldAutoCollapse(previous: CartIdentity, next: CartIdentity): boolean {
  return next.customerId !== null && next.customerId !== previous.customerId && next.editingOrderId === null;
}
