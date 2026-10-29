import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';
import type { AppStore } from './store';

const StoreContext = createContext<AppStore | null>(null);

export function StoreProvider({ store, children }: { store: AppStore; children: ReactNode }) {
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function useStore(): AppStore {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useStore doit être utilisé dans <StoreProvider>');
  return store;
}

/** Données persistées, re-rendu à chaque modification. */
export function useAppData() {
  const store = useStore();
  return useSyncExternalStore(store.subscribe, store.getData);
}

export function usePersistError() {
  const store = useStore();
  return useSyncExternalStore(store.subscribe, store.getPersistError);
}
