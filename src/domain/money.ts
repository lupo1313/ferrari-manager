import type { Cents } from './types';

const formatter = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });

/** 1250 → "12,50 €" */
export function formatPrice(cents: Cents): string {
  // Intl insère une espace insécable fine : on la normalise pour l'impression thermique.
  return formatter.format(cents / 100).replace(/ | /g, ' ');
}

/** 12.5 → 1250 */
export function euros(amount: number): Cents {
  return Math.round(amount * 100);
}

/** Saisie utilisateur "2,50" ou "2.5" → 250. Renvoie null si invalide. */
export function parseEuros(input: string): Cents | null {
  const normalized = input.trim().replace(/\s|€/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  return euros(Number(normalized));
}
