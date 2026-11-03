import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildCustomer, EMPTY_CUSTOMER_INPUT } from '../src/domain/customers';
import { buildCustomersCsv, csvCell, CSV_HEADERS, customersCsvFilename } from '../src/domain/customersCsv';
import { buildDemoData } from '../src/data/seed';
import { demoCatalog } from '../src/data/catalog';
import { sequentialIds } from './helpers';

const make = (over: Partial<typeof EMPTY_CUSTOMER_INPUT>, id = 'c1') =>
  buildCustomer({ ...EMPTY_CUSTOMER_INPUT, firstName: 'Jean', lastName: 'Dupont', phone: '0612345678', ...over }, id, '2026-01-01T00:00:00Z');

describe('export CSV des clients', () => {
  it('Excel français : BOM UTF-8, séparateur « ; », CRLF, onze colonnes dans l’ordre demandé', () => {
    const csv = buildCustomersCsv([make({ address: '15 rue de Rome', postalCode: '13001', city: 'Marseille', building: 'B', floor: '3', intercom: 'Dupont', doorCode: '4512', complement: 'Porte gauche' })]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const [header, line, end] = csv.slice(1).split('\r\n');
    expect(header).toBe("Nom;Prénom;Téléphone;Adresse;Code postal;Ville;Bâtiment;Étage;Interphone;Digicode;Complément d'adresse");
    expect(CSV_HEADERS).toHaveLength(11);
    expect(line).toBe('Dupont;Jean;06 12 34 56 78;15 rue de Rome;13001;Marseille;B;3;Dupont;4512;Porte gauche');
    expect(end).toBe('');
  });

  it('téléphone : zéro initial préservé, jamais une formule', () => {
    const line = buildCustomersCsv([make({ phone: '0698765432' })]).split('\r\n')[1];
    expect(line.split(';')[2]).toBe('06 98 76 54 32');
  });

  it('protection contre les formules Excel', () => {
    for (const bad of ['=SOMME(A1:A2)', '+33612345678', '-2+3', '@cmd', '\tx', '\rx']) {
      expect(csvCell(bad).replace(/^"/, '')).toMatch(/^'/);
    }
    expect(csvCell('rue = ok')).toBe('rue = ok');
    expect(buildCustomersCsv([make({ address: '=HYPERLINK("http://x")' })])).toContain(`"'=HYPERLINK(""http://x"")"`);
  });

  it('guillemets, point-virgule et retours à la ligne protégés', () => {
    expect(csvCell('a;b')).toBe('"a;b"');
    expect(csvCell('dit "oui"')).toBe('"dit ""oui"""');
    expect(csvCell('l1\nl2')).toBe('"l1\nl2"');
    expect(csvCell('Étoile')).toBe('Étoile');
  });

  it('jamais les notes personnelles ni aucune autre donnée', () => {
    const c = make({ instructions: 'ALLERGIE-SECRETE' });
    const csv = buildCustomersCsv([c]);
    expect(csv).not.toContain('ALLERGIE-SECRETE');
    expect(csv).not.toContain(c.id);
    expect(csv).not.toContain(c.createdAt);
    expect(csv.split('\r\n')[0].split(';')).toHaveLength(11);
  });

  it('exporte tous les clients, triés, sans toucher aux données', () => {
    const data = buildDemoData(demoCatalog, new Date('2026-11-03T10:00:00'), sequentialIds());
    const before = JSON.stringify(data.customers);
    const csv = buildCustomersCsv(data.customers);
    expect(csv.split('\r\n').length).toBe(data.customers.length + 2);
    expect(JSON.stringify(data.customers)).toBe(before);
    expect(buildCustomersCsv([]).slice(1)).toBe(`${CSV_HEADERS.join(';').replace(/"/g, '')}\r\n`);
  });

  it('nom de fichier ferrari-manager-clients-AAAA-MM-JJ.csv', () => {
    expect(customersCsvFilename(new Date(2026, 10, 3, 23, 59))).toBe('ferrari-manager-clients-2026-11-03.csv');
    expect(customersCsvFilename(new Date(2026, 0, 5))).toBe('ferrari-manager-clients-2026-01-05.csv');
  });

  it('page Clients : bouton à côté de « Nouveau client », export de data.customers (pas du filtre), aucun appel au store', () => {
    const page = readFileSync(new URL('../src/pages/ClientsPage.tsx', import.meta.url), 'utf8');
    expect(page).toContain('Exporter les clients');
    expect(page.indexOf('Exporter les clients')).toBeLessThan(page.indexOf('Nouveau client'));
    expect(page).toContain('buildCustomersCsv(data.customers)');
    expect(page).not.toMatch(/buildCustomersCsv\(list\)|store\./);
  });
});
