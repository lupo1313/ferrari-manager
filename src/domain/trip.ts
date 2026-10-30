import type { DeliveryTrip, OrderMode } from './types';

/**
 * Trajet de livraison en scooter (distance routière et durée estimée), imprimé sur le ticket livreur seulement.
 * Un trajet n'est valable que pour l'adresse exacte avec laquelle il a été calculé : si l'adresse change,
 * il n'est plus utilisé (jamais d'estimation recopiée sur une autre adresse, jamais de valeur inventée).
 */

export interface DeliveryAddress {
  address: string;
  postalCode: string;
  city: string;
}

/** Clé de validité : adresse, code postal et ville, sans tenir compte de la casse ni des espaces superflus. */
export function deliveryAddressKey(a: DeliveryAddress): string {
  return [a.address, a.postalCode, a.city].map((s) => s.trim().replace(/\s+/g, ' ').toLowerCase()).join('|');
}

/** Raison pour laquelle le trajet ne peut pas être calculé, ou null. */
export function tripAddressProblem(a: DeliveryAddress | null): string | null {
  if (!a) return 'Sélectionnez un client avec une adresse de livraison.';
  if (!a.address.trim() || !/^\d{5}$/.test(a.postalCode.trim())) return 'Adresse incomplète : rue et code postal nécessaires pour calculer le trajet.';
  return null;
}

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

/** Relit un trajet (stockage) ; null s'il est absent ou incohérent. */
export function asDeliveryTrip(v: unknown): DeliveryTrip | null {
  if (typeof v !== 'object' || v === null) return null;
  const t = v as Record<string, unknown>;
  if (t.vehicle !== 'scooter' || !isCount(t.distanceM) || !isCount(t.durationS)) return null;
  if (typeof t.addressKey !== 'string' || typeof t.computedAt !== 'string') return null;
  return {
    vehicle: 'scooter',
    distanceM: t.distanceM,
    durationS: t.durationS,
    addressKey: t.addressKey,
    matchedLabel: typeof t.matchedLabel === 'string' ? t.matchedLabel : '',
    approximate: t.approximate === true,
    computedAt: t.computedAt,
    source: typeof t.source === 'string' ? t.source : '',
  };
}

/** Trajet utilisable pour cette commande : livraison, et calculé pour cette adresse précise. */
export function validTripFor(trip: unknown, mode: OrderMode, address: DeliveryAddress | null): DeliveryTrip | null {
  const t = asDeliveryTrip(trip);
  if (!t || mode !== 'livraison' || !address) return null;
  return t.addressKey === deliveryAddressKey(address) ? t : null;
}

/** 3420 → « 3,4 km » ; moins d'un kilomètre : « 850 m ». */
export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.max(10, Math.round(meters / 10) * 10)} m`;
  return `${(Math.round(meters / 100) / 10).toFixed(1).replace('.', ',')} km`;
}

/** Durée arrondie à la minute supérieure : 512 s → « 9 min », 3900 s → « 1 h 05 ». */
export function formatDuration(seconds: number): string {
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`;
}
