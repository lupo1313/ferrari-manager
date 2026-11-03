import { CSV_HEADERS } from './customersCsv';
import { findCustomerByPhone, normalizePhone, validateCustomerInput, type CustomerInput } from './customers';
import type { Customer } from './types';

/**
 * Import CSV des clients : lecture et contrôle d'un fichier produit par « Exporter les clients ».
 * Fonctions pures : rien n'est enregistré ici. Le contenu du fichier n'est jamais interprété comme du code
 * (texte uniquement). Seuls les 11 champs de coordonnées sont lus ; jamais de fidélité, commandes, etc.
 */

export const IMPORT_MAX_BYTES = 2 * 1024 * 1024;
export const IMPORT_MAX_ROWS = 5000;
const MAX_CELL = 400;

export type CsvParse = { ok: true; rows: string[][] } | { ok: false; error: string };

/** Lecteur CSV (RFC 4180) à séparateur « ; » : guillemets, « ; » et retours à la ligne dans les champs. */
export function parseCsv(text: string): CsvParse {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let touched = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && cell === '') {
      quoted = true;
      touched = true;
    } else if (ch === ';') {
      row.push(cell);
      cell = '';
      touched = true;
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      if (touched || cell !== '') rows.push([...row, cell]);
      row = [];
      cell = '';
      touched = false;
      if (rows.length > IMPORT_MAX_ROWS + 1) return { ok: false, error: `Fichier trop long : ${IMPORT_MAX_ROWS} clients au maximum.` };
    } else {
      cell += ch;
      touched = true;
    }
  }
  if (quoted) return { ok: false, error: 'Guillemet non fermé : le fichier est incomplet ou abîmé.' };
  if (touched || cell !== '') rows.push([...row, cell]);
  return { ok: true, rows };
}

/** Annule la protection ajoutée à l'export (apostrophe devant = + - @) : le texte d'origine est retrouvé. */
function unguard(cell: string): string {
  return /^'[=+\-@\t\r]/.test(cell) ? cell.slice(1) : cell;
}

export interface ImportAnalysis {
  /** Erreur bloquante (fichier inutilisable) : rien à importer. */
  fatal: string | null;
  /** Nouveaux clients, prêts à être créés (déjà contrôlés, sans doublon). */
  toAdd: CustomerInput[];
  duplicatesExisting: number;
  duplicatesInFile: number;
  invalid: number;
  /** Premières erreurs à afficher (« Ligne 7 : … »). */
  errors: string[];
  /** Lignes de données lues (hors en-tête). */
  total: number;
}

const EMPTY: ImportAnalysis = { fatal: null, toAdd: [], duplicatesExisting: 0, duplicatesInFile: 0, invalid: 0, errors: [], total: 0 };
const fatal = (message: string): ImportAnalysis => ({ ...EMPTY, toAdd: [], errors: [], fatal: message });
const MAX_ERRORS = 8;

/** Analyse du texte d'un fichier CSV face aux clients déjà enregistrés. Ne modifie rien. */
export function analyzeCustomersCsv(text: string, existing: readonly Customer[], fileBytes = text.length): ImportAnalysis {
  if (fileBytes > IMPORT_MAX_BYTES) return fatal(`Fichier trop volumineux (${Math.round(IMPORT_MAX_BYTES / 1024 / 1024)} Mo maximum).`);
  if (text.includes('�')) return fatal('Encodage illisible : enregistrez le fichier en UTF-8 (celui de « Exporter les clients »).');
  const parsed = parseCsv(text.replace(/^﻿/, ''));
  if (!parsed.ok) return fatal(parsed.error);
  if (parsed.rows.length === 0) return fatal('Le fichier est vide.');
  const [header, ...body] = parsed.rows;
  if (header.length === 1 && header[0].includes(',')) return fatal('Séparateur point-virgule attendu : utilisez le fichier produit par « Exporter les clients ».');
  const names = header.map((h) => h.trim());
  const missing = CSV_HEADERS.filter((h) => !names.includes(h));
  const unknown = names.filter((h) => !(CSV_HEADERS as readonly string[]).includes(h));
  if (missing.length || unknown.length || names.length !== CSV_HEADERS.length) {
    return fatal(`Colonnes inattendues : les 11 colonnes de l'export sont attendues. ${missing.length ? `Manquantes : ${missing.join(', ')}. ` : ''}${unknown.length ? `En trop : ${unknown.join(', ')}.` : ''}`.trim());
  }
  if (body.length === 0) return fatal('Le fichier ne contient aucun client.');
  if (body.length > IMPORT_MAX_ROWS) return fatal(`Fichier trop long : ${IMPORT_MAX_ROWS} clients au maximum.`);

  const col = (row: string[], name: string) => unguard(row[names.indexOf(name)] ?? '').trim();
  const out: ImportAnalysis = { ...EMPTY, toAdd: [], errors: [], total: body.length };
  const seen = new Set<string>();
  const addError = (message: string) => {
    if (out.errors.length < MAX_ERRORS) out.errors.push(message);
  };
  body.forEach((row, index) => {
    const line = index + 2; // numéro de ligne dans un tableur (l'en-tête est la ligne 1)
    if (row.length !== names.length) {
      out.invalid++;
      addError(`Ligne ${line} : ${row.length} colonnes au lieu de ${names.length}.`);
      return;
    }
    if (row.some((c) => c.length > MAX_CELL)) {
      out.invalid++;
      addError(`Ligne ${line} : un champ dépasse ${MAX_CELL} caractères.`);
      return;
    }
    const input: CustomerInput = {
      lastName: col(row, 'Nom'),
      firstName: col(row, 'Prénom'),
      phone: col(row, 'Téléphone'),
      address: col(row, 'Adresse'),
      postalCode: col(row, 'Code postal'),
      city: col(row, 'Ville'),
      building: col(row, 'Bâtiment'),
      floor: col(row, 'Étage'),
      intercom: col(row, 'Interphone'),
      doorCode: col(row, 'Digicode'),
      complement: col(row, "Complément d'adresse"),
      instructions: '', // jamais importé : les notes personnelles ne font pas partie du fichier
    };
    // Caractères de contrôle : jamais acceptés dans une fiche (hors retour à la ligne d'un complément).
    if (Object.values(input).some((v) => /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(v))) {
      out.invalid++;
      addError(`Ligne ${line} : caractères non autorisés.`);
      return;
    }
    const problems = Object.values(validateCustomerInput(input));
    if (problems.length) {
      out.invalid++;
      addError(`Ligne ${line} : ${problems[0]}`);
      return;
    }
    const phone = normalizePhone(input.phone);
    if (findCustomerByPhone(existing as Customer[], phone)) {
      out.duplicatesExisting++;
      return;
    }
    if (seen.has(phone)) {
      out.duplicatesInFile++;
      return;
    }
    seen.add(phone);
    out.toAdd.push({ ...input, phone });
  });
  return out;
}
