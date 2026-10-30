/**
 * Disposition des cartes de commande en colonnes de hauteur libre.
 * Deux colonnes sur la tablette en paysage ; une troisième seulement si chaque carte garde
 * au moins CARD_MIN_WIDTH de large (lisibilité des produits et des adresses).
 */
export const CARD_MIN_WIDTH = 380;
export const GRID_GAP = 14;

export function columnCount(width: number, max = 3): number {
  let n = 1;
  while (n < max && (n + 1) * CARD_MIN_WIDTH + n * GRID_GAP <= width) n++;
  return n;
}

/**
 * Répartit les cartes de gauche à droite puis de haut en bas (1 et 2 en haut, 3 et 4 dessous…) :
 * l'ordre de traitement (plus anciennes en premier) se lit comme avant, sans hauteur imposée.
 */
export function distributeColumns<T>(items: T[], columns: number): T[][] {
  const result: T[][] = Array.from({ length: Math.max(1, columns) }, () => []);
  items.forEach((item, i) => result[i % result.length].push(item));
  return result;
}
