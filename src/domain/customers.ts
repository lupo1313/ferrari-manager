import type { Customer, CustomerSnapshot } from './types';

export interface CustomerInput {
  firstName: string;
  lastName: string;
  phone: string;
  address: string;
  postalCode: string;
  city: string;
  complement: string;
  /** Repères de livraison facultatifs (absents des saisies d'avant l'intervention 5). */
  building?: string;
  floor?: string;
  intercom?: string;
  doorCode?: string;
  instructions: string;
}

export type CustomerFieldErrors = Partial<Record<keyof CustomerInput, string>>;

export const EMPTY_CUSTOMER_INPUT: CustomerInput = {
  firstName: '',
  lastName: '',
  phone: '',
  address: '',
  postalCode: '',
  city: 'Marseille',
  complement: '',
  building: '',
  floor: '',
  intercom: '',
  doorCode: '',
  instructions: '',
};

/** "+33 6 12-34.56.78" → "0612345678" */
export function normalizePhone(raw: string): string {
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('0033')) digits = '0' + digits.slice(4);
  else if (digits.startsWith('33') && digits.length === 11) digits = '0' + digits.slice(2);
  return digits;
}

export function isValidPhone(normalized: string): boolean {
  return /^0[1-9]\d{8}$/.test(normalized);
}

/** "0612345678" → "06 12 34 56 78" */
export function formatPhone(phone: string): string {
  if (!/^\d{10}$/.test(phone)) return phone;
  return phone.replace(/(\d{2})(?=\d)/g, '$1 ');
}

export function customerFullName(c: Pick<Customer, 'firstName' | 'lastName'>): string {
  return `${c.firstName} ${c.lastName}`.trim();
}

export const CUSTOMER_FIELD_LIMITS: Partial<Record<keyof CustomerInput, number>> = {
  firstName: 60,
  lastName: 60,
  address: 160,
  city: 60,
  complement: 160,
  building: 40,
  floor: 40,
  intercom: 40,
  doorCode: 40,
  instructions: 300,
};

export function validateCustomerInput(input: CustomerInput): CustomerFieldErrors {
  const errors: CustomerFieldErrors = {};
  if (!input.lastName.trim() && !input.firstName.trim()) {
    errors.lastName = 'Indiquez au moins un nom ou un prénom.';
  }
  const phone = normalizePhone(input.phone);
  if (!phone) errors.phone = 'Le téléphone est obligatoire.';
  else if (!isValidPhone(phone)) errors.phone = 'Numéro invalide : 10 chiffres attendus (ex. 06 12 34 56 78).';
  if (input.postalCode.trim() && !/^\d{5}$/.test(input.postalCode.trim())) {
    errors.postalCode = 'Code postal invalide (5 chiffres).';
  }
  if (input.postalCode.trim() && !input.address.trim()) {
    errors.address = "Indiquez l'adresse correspondant au code postal.";
  }
  for (const [field, max] of Object.entries(CUSTOMER_FIELD_LIMITS) as [keyof CustomerInput, number][]) {
    if ((input[field] ?? '').trim().length > max) errors[field] = `${max} caractères maximum.`;
  }
  return errors;
}

export function hasDeliveryAddress(c: Pick<Customer, 'address' | 'postalCode'>): boolean {
  return c.address.trim() !== '' && c.postalCode.trim() !== '';
}

function cleanInput(input: CustomerInput) {
  return {
    firstName: input.firstName.trim(),
    lastName: input.lastName.trim(),
    phone: normalizePhone(input.phone),
    address: input.address.trim(),
    postalCode: input.postalCode.trim(),
    city: input.city.trim() || 'Marseille',
    complement: input.complement.trim(),
    building: (input.building ?? '').trim(),
    floor: (input.floor ?? '').trim(),
    intercom: (input.intercom ?? '').trim(),
    doorCode: (input.doorCode ?? '').trim(),
    instructions: input.instructions.trim(),
  };
}

export function buildCustomer(input: CustomerInput, id: string, nowIso: string): Customer {
  return { id, ...cleanInput(input), createdAt: nowIso, updatedAt: nowIso };
}

export function applyCustomerInput(customer: Customer, input: CustomerInput, nowIso: string): Customer {
  return { ...customer, ...cleanInput(input), updatedAt: nowIso };
}

export function customerToInput(c: Customer): CustomerInput {
  return {
    firstName: c.firstName,
    lastName: c.lastName,
    phone: formatPhone(c.phone),
    address: c.address,
    postalCode: c.postalCode,
    city: c.city,
    complement: c.complement,
    building: c.building,
    floor: c.floor,
    intercom: c.intercom,
    doorCode: c.doorCode,
    instructions: c.instructions,
  };
}

/** Prévention des doublons : un numéro = une fiche. */
export function findCustomerByPhone(
  customers: Customer[],
  rawPhone: string,
  excludeId?: string,
): Customer | undefined {
  const phone = normalizePhone(rawPhone);
  if (!phone) return undefined;
  return customers.find((c) => c.phone === phone && c.id !== excludeId);
}

function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * Recherche instantanée : par téléphone si la saisie ne contient que des chiffres
 * (espaces, points, + tolérés), sinon par nom (sans tenir compte des accents).
 */
export function searchCustomers(customers: Customer[], query: string, limit = 8): Customer[] {
  const q = query.trim();
  if (!q) return [];
  const isPhoneQuery = /^[\d\s.+-]+$/.test(q);
  if (isPhoneQuery) {
    let digits = q.replace(/\D/g, '');
    if (digits.startsWith('33') && digits.length > 2) digits = '0' + digits.slice(2);
    if (digits.length < 2) return [];
    return customers
      .filter((c) => c.phone.includes(digits))
      .sort((a, b) => Number(b.phone.startsWith(digits)) - Number(a.phone.startsWith(digits)))
      .slice(0, limit);
  }
  const tokens = fold(q).split(/\s+/).filter(Boolean);
  return customers
    .filter((c) => {
      const haystack = fold(`${c.firstName} ${c.lastName}`);
      return tokens.every((t) => haystack.includes(t));
    })
    .sort((a, b) => customerFullName(a).localeCompare(customerFullName(b), 'fr'))
    .slice(0, limit);
}

export function snapshotCustomer(c: Customer): CustomerSnapshot {
  return {
    id: c.id,
    name: customerFullName(c),
    phone: c.phone,
    address: c.address,
    postalCode: c.postalCode,
    city: c.city,
    complement: c.complement,
    building: c.building,
    floor: c.floor,
    intercom: c.intercom,
    doorCode: c.doorCode,
    instructions: c.instructions,
  };
}
