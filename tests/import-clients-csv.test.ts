import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildCustomer, EMPTY_CUSTOMER_INPUT } from '../src/domain/customers';
import { buildCustomersCsv, CSV_HEADERS } from '../src/domain/customersCsv';
import { analyzeCustomersCsv, IMPORT_MAX_BYTES, IMPORT_MAX_ROWS, parseCsv } from '../src/domain/customersImport';
import { createMemoryRepository } from '../src/storage/repository';
import { createTestStore } from './helpers';

const HEADER = CSV_HEADERS.join(';');
const line = (...c: string[]) => c.join(';');
const csv = (...rows: string[]) => `﻿${[HEADER, ...rows].join('\r\n')}\r\n`;
const make = (over: Partial<typeof EMPTY_CUSTOMER_INPUT>, id = 'x1') =>
  buildCustomer({ ...EMPTY_CUSTOMER_INPUT, firstName: 'Zoé', lastName: 'Bernard', phone: '0611223399', ...over }, id, '2026-01-01T00:00:00Z');

describe('import CSV : lecture', () => {
  it('guillemets, point-virgule et retour à la ligne dans un champ, UTF-8 avec BOM', () => {
    const p = parseCsv('a;"b;c";"d ""e""\nf"\r\n1;2;3\r\n');
    expect(p).toEqual({ ok: true, rows: [['a', 'b;c', 'd "e"\nf'], ['1', '2', '3']] });
    expect(parseCsv('a;"oups')).toMatchObject({ ok: false });
  });

  it('CSV valide : un client ajouté, accents conservés, numéro avec espaces normalisé', () => {
    const a = analyzeCustomersCsv(csv(line('Séguéla', 'Hélène', '06 12 34 56 78', '3 rue d’Endoume', '13007', 'Marseille', 'B', '2', '12', 'A4', 'Porte gauche')), []);
    expect(a.fatal).toBeNull();
    expect(a.toAdd).toHaveLength(1);
    expect(a.toAdd[0]).toMatchObject({ lastName: 'Séguéla', firstName: 'Hélène', phone: '0612345678', building: 'B', doorCode: 'A4', complement: 'Porte gauche', instructions: '' });
  });

  it('champs entre guillemets avec « ; » et retour à la ligne', () => {
    const a = analyzeCustomersCsv(csv(line('Roy', 'Max', '0699887766', '"12 rue A; bis"', '13001', 'Marseille', '', '', '', '', '"ligne 1\nligne 2"')), []);
    expect(a.toAdd[0].address).toBe('12 rue A; bis');
    expect(a.toAdd[0].complement).toBe('ligne 1\nligne 2');
  });

  it('CSV vide, sans client, mauvais séparateur, colonnes manquantes ou en trop : refusé sans rien proposer', () => {
    expect(analyzeCustomersCsv('', []).fatal).toMatch(/vide/);
    expect(analyzeCustomersCsv(`﻿${HEADER}\r\n`, []).fatal).toMatch(/aucun client/);
    expect(analyzeCustomersCsv('Nom,Prénom,Téléphone\r\nA,B,0611223344\r\n', []).fatal).toMatch(/point-virgule/);
    const missing = analyzeCustomersCsv('Nom;Prénom;Téléphone\r\nA;B;0611223344\r\n', []);
    expect(missing.fatal).toMatch(/Manquantes/);
    expect(missing.toAdd).toEqual([]);
    expect(analyzeCustomersCsv(`${HEADER};Fidélité\r\n`, []).fatal).toMatch(/En trop : Fidélité/);
  });

  it('encodage non UTF-8 (caractère de remplacement) refusé', () => {
    expect(analyzeCustomersCsv(csv(line('S�gu', 'A', '0611223344', '', '', '', '', '', '', '', '')), []).fatal).toMatch(/UTF-8/);
  });

  it('limites : taille du fichier et nombre de lignes', () => {
    expect(analyzeCustomersCsv('x', [], IMPORT_MAX_BYTES + 1).fatal).toMatch(/volumineux/);
    const rows = Array.from({ length: IMPORT_MAX_ROWS + 1 }, (_, i) => line('N', 'P', `06${String(10000000 + i)}`, '', '', '', '', '', '', '', ''));
    expect(analyzeCustomersCsv(csv(...rows), []).fatal).toMatch(/trop long/);
  });

  it('lignes invalides refusées sans fiche incomplète ; erreurs lisibles avec numéro de ligne', () => {
    const a = analyzeCustomersCsv(
      csv(
        line('Ok', 'Ok', '0611223301', '', '', '', '', '', '', '', ''),
        line('', '', '0611223302', '', '', '', '', '', '', '', ''), // ni nom ni prénom
        line('Tel', 'Faux', '12345', '', '', '', '', '', '', '', ''),
        line('CP', 'Faux', '0611223303', 'rue', 'ABCDE', '', '', '', '', '', ''),
        'Court;Ligne;0611223304',
        line('Ctl', 'Char', '0611223305', 'rue\u0007', '', '', '', '', '', '', ''),
      ),
      [],
    );
    expect(a.toAdd).toHaveLength(1);
    expect(a.invalid).toBe(5);
    expect(a.errors[0]).toMatch(/^Ligne 3 :/);
    expect(a.errors.join(' ')).toMatch(/Ligne 6 : 3 colonnes au lieu de 11/);
  });

  it('doublons : déjà enregistrés (numéro normalisé) et répétés dans le fichier', () => {
    const existing = [make({ phone: '0612345678' }, 'e1')];
    const a = analyzeCustomersCsv(
      csv(
        line('Nouveau', 'A', '06 12 34 56 78', '', '', '', '', '', '', '', ''), // déjà enregistré
        line('Un', 'B', '0699000001', '', '', '', '', '', '', '', ''),
        line('Deux', 'B', '06.99.00.00.01', '', '', '', '', '', '', '', ''), // répété dans le fichier
        line('Trois', 'C', '+33 6 99 00 00 02', '', '', '', '', '', '', '', ''),
      ),
      existing,
    );
    expect(a).toMatchObject({ duplicatesExisting: 1, duplicatesInFile: 1, invalid: 0, total: 4 });
    expect(a.toAdd.map((c) => c.phone)).toEqual(['0699000001', '0699000002']);
  });

  it('formules du fichier : texte uniquement, la protection de l’export est retirée', () => {
    const a = analyzeCustomersCsv(csv(line("'=1+1", 'X', "'+33612345678", '', '', '', '', '', '', '', '')), []);
    expect(a.toAdd[0].lastName).toBe('=1+1');
    expect(a.toAdd[0].phone).toBe('0612345678');
  });

  it('aucune note personnelle, fidélité ni commande dans ce qui est lu', () => {
    const a = analyzeCustomersCsv(csv(line('A', 'B', '0611223344', '', '', '', '', '', '', '', '')), []);
    expect(Object.keys(a.toAdd[0]).sort()).toEqual(
      ['address', 'building', 'city', 'complement', 'doorCode', 'firstName', 'floor', 'instructions', 'intercom', 'lastName', 'phone', 'postalCode'].sort(),
    );
    expect(a.toAdd[0].instructions).toBe('');
  });
});

describe('import CSV : enregistrement', () => {
  const exported = (names: string[]) => buildCustomersCsv(names.map((n, i) => make({ lastName: n, phone: `06112233${String(10 + i)}` }, `id${i}`)));

  it('ajoute les nouveaux clients, nouvel identifiant, aucune fidélité ni commande, rien d’autre modifié', () => {
    const { store } = createTestStore();
    const before = store.getData();
    const analysis = analyzeCustomersCsv(exported(['Alpha', 'Beta']), before.customers);
    const r = store.importCustomers(analysis.toAdd);
    expect(r).toEqual({ ok: true, value: { added: 2 } });
    const after = store.getData();
    expect(after.customers).toHaveLength(before.customers.length + 2);
    expect(after.customers.slice(0, before.customers.length)).toEqual(before.customers);
    const added = after.customers.slice(before.customers.length);
    expect(added.every((c) => c.id.startsWith('cus_') && !['id0', 'id1'].includes(c.id) && c.instructions === '')).toBe(true);
    expect(after.orders).toEqual(before.orders);
    expect(after.loyaltyEvents).toEqual(before.loyaltyEvents);
    expect(after.settings).toEqual(before.settings);
    expect(after.services).toEqual(before.services);
  });

  it('réimportation du même fichier : tout est ignoré, rien n’est ajouté', () => {
    const { store } = createTestStore();
    const file = exported(['Alpha', 'Beta']);
    store.importCustomers(analyzeCustomersCsv(file, store.getData().customers).toAdd);
    const count = store.getData().customers.length;
    const again = analyzeCustomersCsv(file, store.getData().customers);
    expect(again).toMatchObject({ duplicatesExisting: 2, toAdd: [] });
    expect(store.importCustomers(again.toAdd)).toEqual({ ok: true, value: { added: 0 } });
    expect(store.getData().customers).toHaveLength(count);
  });

  it('ne réécrit jamais une fiche existante, même avec un numéro identique', () => {
    const { store, customer } = createTestStore();
    const jean = customer('Dupont');
    const file = buildCustomersCsv([{ ...jean, lastName: 'Autre', address: 'ailleurs' }]);
    const a = analyzeCustomersCsv(file, store.getData().customers);
    expect(a.duplicatesExisting).toBe(1);
    store.importCustomers(a.toAdd);
    expect(store.getData().customers.find((c) => c.id === jean.id)).toEqual(jean);
  });

  it('échec de persistance : atomique, aucune fiche ajoutée, mémoire et stockage inchangés', () => {
    const repo = createMemoryRepository();
    const { store } = createTestStore(repo);
    const rawBefore = repo.raw();
    const before = store.getData().customers;
    repo.control.failOn = 'doc';
    const r = store.importCustomers(analyzeCustomersCsv(exported(['Alpha', 'Beta']), before).toAdd);
    expect(r.ok).toBe(false);
    expect(store.getData().customers).toEqual(before);
    expect(repo.raw()).toBe(rawBefore);
    repo.control.failOn = null;
    expect(store.importCustomers(analyzeCustomersCsv(exported(['Alpha', 'Beta']), before).toAdd)).toEqual({ ok: true, value: { added: 2 } });
  });

  it('le store revalide : fiche invalide ou doublon glissé dans la liste = tout refusé', () => {
    const { store } = createTestStore();
    const base = { ...EMPTY_CUSTOMER_INPUT, lastName: 'A', phone: '0611223344' };
    const n = store.getData().customers.length;
    expect(store.importCustomers([base, { ...base, phone: '123' }]).ok).toBe(false);
    expect(store.importCustomers([base, { ...base, lastName: 'B' }]).ok).toBe(false);
    expect(store.getData().customers).toHaveLength(n);
  });

  it('import écrit en une seule opération du dépôt', () => {
    const repo = createMemoryRepository();
    const { store } = createTestStore(repo);
    const saves = repo.saves;
    store.importCustomers(analyzeCustomersCsv(exported(['A', 'B', 'C']), store.getData().customers).toAdd);
    expect(repo.saves).toBe(saves + 1);
  });
});

describe('page Clients : export conservé, import ajouté', () => {
  const page = readFileSync(new URL('../src/pages/ClientsPage.tsx', import.meta.url), 'utf8');
  it('boutons Exporter, Importer et Nouveau client, dans cet ordre', () => {
    const i = [page.indexOf('Exporter les clients'), page.indexOf('Importer les clients'), page.indexOf('Nouveau client')];
    expect(i.every((x) => x > 0)).toBe(true);
    expect(i).toEqual([...i].sort((a, b) => a - b));
    expect(page).toContain('buildCustomersCsv(data.customers)');
    expect(page).not.toMatch(/localStorage/);
  });
  it('fenêtre : confirmation explicite, nombres réellement calculés, annulation sans écriture', () => {
    const dialog = readFileSync(new URL('../src/components/customer/CustomerImportDialog.tsx', import.meta.url), 'utf8');
    expect(dialog).toContain('Importation des clients');
    expect(dialog).toContain('store.importCustomers(analysis.toAdd)');
    expect(dialog).not.toMatch(/localStorage/);
    expect(dialog.indexOf('onClick={onClose}')).toBeLessThan(dialog.indexOf('onClick={confirm}'));
  });
});
