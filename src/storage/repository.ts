import type { AppData } from './schema';

/**
 * Couche de stockage abstraite.
 * V1 : localStorage (ou mémoire pour les tests).
 * V2 : une implémentation Supabase/API respectera la même interface (en asynchrone),
 * sans toucher au domaine ni aux composants.
 */
export interface AppRepository {
  /** Données brutes relues (non validées), ou null si rien n'est enregistré. */
  load(): unknown | null;
  save(data: AppData): void;
  clear(): void;
}

export const STORAGE_KEY = 'ferrari-manager:v1';

export function createLocalStorageRepository(key = STORAGE_KEY): AppRepository {
  return {
    load() {
      try {
        const raw = window.localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
      } catch {
        // JSON corrompu ou stockage bloqué (navigation privée) : on repart des données de démo.
        return null;
      }
    },
    save(data) {
      // Laisse remonter l'erreur (quota, stockage bloqué) : le store l'affiche à l'utilisateur.
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

export function createMemoryRepository(initial: unknown = null): AppRepository & { saves: number } {
  let stored: string | null = initial ? JSON.stringify(initial) : null;
  const repo = {
    saves: 0,
    load: () => (stored ? JSON.parse(stored) : null),
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
