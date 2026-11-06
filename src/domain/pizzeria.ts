import type { Settings } from './types';

export const TICKET_TEXT_LIMITS = { siret: 32, rcs: 100, vatNumber: 32, additionalMentions: 500, ticketFooter: 250 } as const;
/** Facultatifs, absents des anciens fichiers. Lecture défensive sans réécriture du stockage. */
export function normalizePizzeria(value: Settings['pizzeria']): Settings['pizzeria'] {
  const next = { ...value };
  for (const key of Object.keys(TICKET_TEXT_LIMITS) as (keyof typeof TICKET_TEXT_LIMITS)[]) {
    if (key in next) next[key] = typeof next[key] === 'string' ? next[key] : '';
  }
  return next;
}
/** Texte affiché par React (jamais du HTML), lignes vides omises. */
export function ticketCompanyLines(p: Settings['pizzeria']): string[] {
  const clean = normalizePizzeria(p);
  return [clean.siret?.trim() && 'SIRET : ' + clean.siret.trim(), clean.rcs?.trim() && 'RCS : ' + clean.rcs.trim(),
    clean.vatNumber?.trim() && 'TVA : ' + clean.vatNumber.trim(), clean.additionalMentions?.trim()]
    .filter((line): line is string => Boolean(line));
}
