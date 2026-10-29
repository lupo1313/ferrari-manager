import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { StoreProvider } from './state/StoreContext';
import { createAppStore } from './state/store';
import { createLocalStorageRepository } from './storage/repository';
import { demoCatalog } from './data/catalog';
import { buildDemoData } from './data/seed';
import { ToastProvider } from './components/ui/Toast';
import { ErrorBoundary } from './components/ui/ErrorBoundary';

import './styles/tokens.css';
import './styles/base.css';
import './styles/layout.css';
import './styles/customer.css';
import './styles/catalog.css';
import './styles/order.css';
import './styles/pages.css';
import './styles/ticket.css';

const store = createAppStore({
  repo: createLocalStorageRepository(),
  catalog: demoCatalog,
  seed: buildDemoData,
});

// Panier en cours de saisie : enregistré sans attendre si la tablette met l'onglet en arrière-plan ou le ferme.
window.addEventListener('pagehide', () => store.flushPendingWrites());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') store.flushPendingWrites();
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <StoreProvider store={store}>
        <ToastProvider>
          <App />
        </ToastProvider>
      </StoreProvider>
    </ErrorBoundary>
  </StrictMode>,
);
