import { formatPhone } from './customers';
import type { Customer } from './types';

/**
 * Export CSV des coordonnées des clients (Excel en français : UTF-8 avec BOM, séparateur « ; », fins de ligne CRLF).
 * Contient uniquement l'identité et l'adresse : jamais fidélité, commandes, paiements, statistiques ni notes
 * personnelles (`instructions`). Fonction pure : ne lit ni n'écrit aucune donnée.
 */

export const CSV_HEADERS = ['Nom', 'Prénom', 'Téléphone', 'Adresse', 'Code postal', 'Ville', 'Bâtiment', 'Étage', 'Interphone', 'Digicode', "Complément d'adresse"] as const;

const BOM = '﻿';

/**
 * Cellule CSV sûre : une valeur commençant par = + - @ (ou tabulation / retour chariot) serait interprétée
 * comme une formule par Excel ; elle est précédée d'une apostrophe. Guillemets doublés si nécessaire.
 */
export function csvCell(value: string): string {
  let text = value ?? '';
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[";\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function row(customer: Customer): string[] {
  return [
    customer.lastName,
    customer.firstName,
    // « 06 12 34 56 78 » : Excel le garde en texte, le zéro initial est préservé (sans formule).
    formatPhone(customer.phone),
    customer.address,
    customer.postalCode,
    customer.city,
    customer.building,
    customer.floor,
    customer.intercom,
    customer.doorCode,
    customer.complement,
  ];
}

/** Tous les clients fournis, triés par nom puis prénom. */
export function buildCustomersCsv(customers: readonly Customer[]): string {
  const sorted = [...customers].sort((a, b) => `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`, 'fr'));
  const lines = [[...CSV_HEADERS], ...sorted.map(row)].map((cells) => cells.map(csvCell).join(';'));
  return `${BOM}${lines.join('\r\n')}\r\n`;
}

/** ferrari-manager-clients-AAAA-MM-JJ.csv (date locale). */
export function customersCsvFilename(now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `ferrari-manager-clients-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}.csv`;
}
