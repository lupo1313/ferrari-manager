import type { Cart, Customer, CustomerSnapshot, DeliveryAddressInput, OrderMode } from './types';
import { CUSTOMER_FIELD_LIMITS } from './customers';

/**
 * Adresse de livraison d'une commande, distincte de l'adresse habituelle de la fiche client.
 *
 * Par défaut, la commande est livrée à l'adresse habituelle. Le gérant peut la remplacer pour une seule
 * commande (client chez un ami, au bureau…) sans jamais toucher à la fiche. Sur la commande enregistrée,
 * l'adresse effective est celle de la copie client (CustomerSnapshot), comme avant : rien d'autre ne change
 * pour les tickets, l'historique ou les anciennes versions de l'application.
 */

export const DELIVERY_ADDRESS_FIELDS = ['address', 'postalCode', 'city', 'building', 'floor', 'intercom', 'doorCode', 'complement', 'instructions'] as const;

export type DeliveryAddressErrors = Partial<Record<keyof DeliveryAddressInput, string>>;

/** Adresse (et consignes) d'une fiche ou d'une copie de commande ; champs absents des anciennes données = vides. */
export function addressOf(c: Customer | CustomerSnapshot): DeliveryAddressInput {
  const out = {} as DeliveryAddressInput;
  for (const k of DELIVERY_ADDRESS_FIELDS) {
    const v = (c as unknown as Record<string, unknown>)[k];
    out[k] = typeof v === 'string' ? v : '';
  }
  return out;
}

/** Formulaire d'adresse ponctuelle vierge (seule la ville est proposée). */
export function emptyDeliveryAddress(city = 'Marseille'): DeliveryAddressInput {
  const out = {} as DeliveryAddressInput;
  for (const k of DELIVERY_ADDRESS_FIELDS) out[k] = '';
  out.city = city.trim() || 'Marseille';
  return out;
}

export function cleanDeliveryAddress(input: DeliveryAddressInput): DeliveryAddressInput {
  const out = {} as DeliveryAddressInput;
  for (const k of DELIVERY_ADDRESS_FIELDS) out[k] = (input[k] ?? '').trim();
  if (!out.city) out.city = 'Marseille';
  return out;
}

export function sameDeliveryAddress(a: DeliveryAddressInput, b: DeliveryAddressInput): boolean {
  const x = cleanDeliveryAddress(a);
  const y = cleanDeliveryAddress(b);
  return DELIVERY_ADDRESS_FIELDS.every((k) => x[k] === y[k]);
}

/** Relit une adresse ponctuelle (stockage) ; null si absente ou incomplète. */
export function asDeliveryAddress(v: unknown): DeliveryAddressInput | null {
  if (typeof v !== 'object' || v === null) return null;
  const r = v as Record<string, unknown>;
  if (typeof r.address !== 'string' || typeof r.postalCode !== 'string') return null;
  const out = {} as DeliveryAddressInput;
  for (const k of DELIVERY_ADDRESS_FIELDS) out[k] = typeof r[k] === 'string' ? (r[k] as string) : '';
  return out;
}

/** Même exigences qu'une livraison : rue et code postal, longueurs des champs de la fiche client. */
export function validateDeliveryAddress(input: DeliveryAddressInput): DeliveryAddressErrors {
  const errors: DeliveryAddressErrors = {};
  if (!input.address.trim()) errors.address = 'Indiquez le numéro et la rue.';
  if (!/^\d{5}$/.test(input.postalCode.trim())) errors.postalCode = 'Code postal invalide (5 chiffres).';
  for (const k of DELIVERY_ADDRESS_FIELDS) {
    const max = CUSTOMER_FIELD_LIMITS[k];
    if (max && (input[k] ?? '').trim().length > max) errors[k] = `${max} caractères maximum.`;
  }
  return errors;
}

/** Adresse de livraison effective de la saisie en cours : ponctuelle si renseignée, sinon habituelle. */
export function effectiveDeliveryAddress(cart: Pick<Cart, 'deliveryAddress'>, customer: Customer | null): DeliveryAddressInput | null {
  if (!customer) return null;
  return asDeliveryAddress(cart.deliveryAddress) ?? addressOf(customer);
}

/** Copie client de la commande : l'adresse ponctuelle remplace l'adresse et les consignes habituelles. */
export function snapshotWithDeliveryAddress(snapshot: CustomerSnapshot, mode: OrderMode, override: unknown): CustomerSnapshot {
  const a = mode === 'livraison' ? asDeliveryAddress(override) : null;
  return a ? { ...snapshot, ...cleanDeliveryAddress(a), addressOverridden: true } : snapshot;
}
