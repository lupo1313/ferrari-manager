import { STORAGE_NAMESPACE } from './repository';
import type { SidebarState } from '../components/layout/disposition';

/**
 * Préférences d'affichage propres à l'appareil (intervention 7), séparées des données métier.
 *
 * La clé est volontairement HORS du préfixe `<espace>:` des données : elle n'entre jamais dans la
 * sauvegarde JSON, n'est jamais écrasée par une restauration ni effacée par « Réinitialiser », et
 * le store ne la lit ni ne l'écrit. Production et prévisualisation gardent chacune la leur.
 */
export function interfaceKey(namespace: string): string {
  return `${namespace}-interface`;
}

export const INTERFACE_KEY = interfaceKey(STORAGE_NAMESPACE);

interface PreferenceStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const VERSION = 1;

/** Préférence de la barre latérale ; null si absente ou illisible (aucune réécriture dans ce cas). */
export function readSidebarPreference(store: PreferenceStore | null, key = INTERFACE_KEY): SidebarState | null {
  try {
    const raw = store?.getItem(key);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return null;
    const state = (value as { barreLaterale?: unknown }).barreLaterale;
    return state === 'ouverte' || state === 'reduite' ? state : null;
  } catch {
    return null;
  }
}

/** Enregistre le choix manuel ; false si le stockage refuse (navigation privée…) : le choix reste alors en mémoire. */
export function writeSidebarPreference(store: PreferenceStore | null, state: SidebarState, key = INTERFACE_KEY): boolean {
  if (!store) return false;
  try {
    store.setItem(key, JSON.stringify({ v: VERSION, barreLaterale: state }));
    return true;
  } catch {
    return false;
  }
}

export function browserPreferenceStore(): PreferenceStore | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
