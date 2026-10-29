import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';
import type { AppStore } from './store';
import type { AppData } from '../storage/schema';

const StoreContext = createContext<AppStore | null>(null);

export function StoreProvider({ store, children }: { store: AppStore; children: ReactNode }) {
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function useStore(): AppStore {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useStore doit être utilisé dans <StoreProvider>');
  return store;
}

/** Toutes les données : le composant est re-rendu à chaque modification (panier compris). */
export function useAppData() {
  const store = useStore();
  return useSyncExternalStore(store.subscribe, store.getData);
}

/**
 * Abonnement à une partie des données seulement : le composant n'est re-rendu que si la valeur
 * sélectionnée change. Le sélecteur doit renvoyer une valeur existante (ex. data.cart.lines)
 * ou une valeur simple (nombre, texte), jamais un nouvel objet créé à chaque appel.
 */
export function useAppSelector<T>(selector: (data: AppData) => T): T {
  const store = useStore();
  return useSyncExternalStore(store.subscribe, () => selector(store.getData()));
}

export function usePersistError() {
  const store = useStore();
  return useSyncExternalStore(store.subscribe, store.getPersistError);
}
