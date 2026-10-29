import { describe, expect, it } from 'vitest';
import {
  buildCustomer,
  EMPTY_CUSTOMER_INPUT,
  findCustomerByPhone,
  formatPhone,
  normalizePhone,
  searchCustomers,
  validateCustomerInput,
} from '../src/domain/customers';

const jean = buildCustomer(
  { ...EMPTY_CUSTOMER_INPUT, firstName: 'Jean', lastName: 'Dupont', phone: '06 12 34 56 78', address: '15 rue de Rome', postalCode: '13001' },
  'c1',
  '2026-01-01T00:00:00Z',
);
const helene = buildCustomer(
  { ...EMPTY_CUSTOMER_INPUT, firstName: 'Hélène', lastName: 'Ségur', phone: '0698765432' },
  'c2',
  '2026-01-01T00:00:00Z',
);

describe('clients', () => {
  it('normalise et formate le téléphone', () => {
    expect(normalizePhone('+33 6 12-34.56.78')).toBe('0612345678');
    expect(normalizePhone('0033612345678')).toBe('0612345678');
    expect(formatPhone('0612345678')).toBe('06 12 34 56 78');
  });

  it('valide les champs saisis', () => {
    const errors = validateCustomerInput({ ...EMPTY_CUSTOMER_INPUT, phone: '0612', postalCode: '130' });
    expect(errors.lastName).toBeDefined();
    expect(errors.phone).toBeDefined();
    expect(errors.postalCode).toBeDefined();
    expect(validateCustomerInput({ ...EMPTY_CUSTOMER_INPUT, lastName: 'Dupont', phone: '06 12 34 56 78' })).toEqual({});
  });

  it('recherche par téléphone (partiel, avec espaces)', () => {
    expect(searchCustomers([jean, helene], '06 12 34')).toEqual([jean]);
    expect(searchCustomers([jean, helene], '+33 6 98')).toEqual([helene]);
  });

  it('recherche par nom sans accents', () => {
    expect(searchCustomers([jean, helene], 'helene seg')).toEqual([helene]);
    expect(searchCustomers([jean, helene], 'dupont')).toEqual([jean]);
  });

  it('détecte un doublon de téléphone quel que soit le format', () => {
    expect(findCustomerByPhone([jean, helene], '06.12.34.56.78')).toBe(jean);
    expect(findCustomerByPhone([jean, helene], '0612345678', 'c1')).toBeUndefined();
  });
});
