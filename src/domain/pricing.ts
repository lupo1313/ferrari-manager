import type { Cents, OrderLine, OrderTotals } from './types';

/**
 * Règles de tarification.
 * - Les suppléments ajoutés sont payants, y compris sur une pizza offerte par la fidélité
 *   (la récompense couvre la pizza, pas ses suppléments).
 * - Les ingrédients retirés ne modifient pas le prix (aucune règle de remise configurée en V1).
 * - Le total est toujours recalculé à partir des lignes : il n'est jamais saisi.
 */

export function toppingsTotal(line: OrderLine): Cents {
  return line.addedToppings.reduce((sum, t) => sum + t.price, 0);
}

/** Prix d'une unité de la ligne, suppléments compris. */
export function lineUnitTotal(line: OrderLine): Cents {
  const base = line.reward ? 0 : line.unitPrice;
  return base + toppingsTotal(line);
}

export function lineTotal(line: OrderLine): Cents {
  return lineUnitTotal(line) * line.quantity;
}

export function subtotal(lines: OrderLine[]): Cents {
  return lines.reduce((sum, line) => sum + lineTotal(line), 0);
}

/** Montant offert par les lignes fidélité (affichage uniquement). */
export function rewardSavings(lines: OrderLine[]): Cents {
  return lines.filter((l) => l.reward).reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);
}

/**
 * Règle définitive du gérant : la livraison est toujours offerte (0 €, sans exception).
 * Aucun réglage ne peut la rendre payante. Les anciennes commandes gardent leurs frais figés.
 */
export const DELIVERY_FEE: Cents = 0;

export function computeTotals(lines: OrderLine[]): OrderTotals {
  const sub = subtotal(lines);
  return { subtotal: sub, deliveryFee: DELIVERY_FEE, total: sub + DELIVERY_FEE };
}
