export type IdFactory = (prefix: string) => string;

/**
 * Identifiant unique sans dépendance à crypto.randomUUID, indisponible hors contexte sécurisé
 * (ex. tablette qui ouvre l'application via l'IP locale en http).
 */
export const createId: IdFactory = (prefix) => {
  const bytes = new Uint8Array(6);
  globalThis.crypto.getRandomValues(bytes);
  const random = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${prefix}_${Date.now().toString(36)}${random}`;
};
