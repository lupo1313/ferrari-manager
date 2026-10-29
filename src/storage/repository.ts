import type { AppData } from './schema';

/** Résultat d'une lecture : rien d'enregistré, des données brutes (non validées), ou une erreur de lecture. */
export type LoadResult =
  | { kind: 'empty' }
  | { kind: 'data'; value: unknown }
  | { kind: 'error'; error: string };

/**
 * Couche de stockage abstraite.
 * V1 : localStorage (ou mémoire pour les tests).
 * V2 : une implémentation Supabase/API respectera la même interface (en asynchrone),
 * sans toucher au domaine ni aux composants.
 */
export interface AppRepository {
  /** Ne lève jamais d'exception : une erreur de lecture est renvoyée comme résultat. */
  load(): LoadResult;
  /** Lève une exception si l'écriture échoue (quota, stockage bloqué) : le store l'affiche. */
  save(data: AppData): void;
  clear(): void;
}

export const STORAGE_KEY = 'ferrari-manager:v1';

/** Interprète le texte stocké. Un JSON corrompu est une erreur, jamais « rien d'enregistré ». */
export function parseStored(raw: string | null): LoadResult {
  if (raw === null || raw === '') return { kind: 'empty' };
  try {
    return { kind: 'data', value: JSON.parse(raw) };
  } catch {
    return { kind: 'error', error: 'données illisibles (JSON corrompu)' };
  }
}

export function createLocalStorageRepository(key = STORAGE_KEY): AppRepository {
  return {
    load() {
      let raw: string | null;
      try {
        raw = window.localStorage.getItem(key);
      } catch {
        // Stockage bloqué (navigation privée, réglages du navigateur).
        return { kind: 'error', error: 'stockage local inaccessible' };
      }
      return parseStored(raw);
    },
    save(data) {
      window.localStorage.setItem(key, JSON.stringify(data));
    },
    clear() {
      try {
        window.localStorage.removeItem(key);
      } catch {
        /* rien à faire */
      }
    },
  };
}

/** Stockage en mémoire pour les tests. `initialRaw` permet de simuler un contenu brut quelconque. */
export function createMemoryRepository(initial: unknown = null, initialRaw?: string): AppRepository & {
  saves: number;
  raw: () => string | null;
} {
  let stored: string | null = initialRaw ?? (initial ? JSON.stringify(initial) : null);
  const repo = {
    saves: 0,
    raw: () => stored,
    load: () => parseStored(stored),
    save: (data: AppData) => {
      stored = JSON.stringify(data);
      repo.saves++;
    },
    clear: () => {
      stored = null;
    },
  };
  return repo;
}
