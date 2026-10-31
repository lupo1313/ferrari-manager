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
import { paymentSound } from './audio/paymentSound';
import { recoverInterruptedRestore, restoreKeys, type RecoveryResult } from './storage/restore';
import { installTabPresence } from './storage/tabs';

import './styles/tokens.css';
import './styles/base.css';
import './styles/layout.css';
import './styles/customer.css';
import './styles/catalog.css';
import './styles/order.css';
import './styles/pages.css';
import './styles/ticket.css';

// Restauration interrompue entre deux écritures (fermeture, panne) : terminée ou annulée AVANT tout chargement,
// pour ne jamais charger un état partiel.
const restoreKeysOfBuild = restoreKeys();
let recovery: RecoveryResult = { state: 'aucune' };
try {
  recovery = recoverInterruptedRestore(window.localStorage, Date.now(), restoreKeysOfBuild);
} catch {
  // Stockage inaccessible : le store le signalera lui-même.
}

const store = createAppStore({
  repo: createLocalStorageRepository(),
  catalog: demoCatalog,
  seed: buildDemoData,
  // Joué par le store uniquement après un encaissement réellement enregistré (et si le réglage est actif).
  effects: { playPaymentSound: (kind) => void paymentSound.play(kind) },
});

const OTHER_TAB_RESTORE = 'Restauration en cours dans un autre onglet : rien n’est enregistré ici. Rechargez cette page quand elle est terminée.';
if (recovery.state === 'en-cours') store.suspendWrites(OTHER_TAB_RESTORE);
if (recovery.state === 'echec') store.suspendWrites(`${recovery.error} Utilisez Paramètres → Copie de sécurité.`);
if (recovery.state === 'retablie') {
  try {
    sessionStorage.setItem(restoreKeysOfBuild.notice, 'Une restauration avait été interrompue : l’état précédent a été rétabli depuis la copie de sécurité.');
  } catch {
    /* message seulement */
  }
}
// Une restauration démarre dans un autre onglet : plus aucune écriture ici (sinon ses anciennes données écraseraient
// les données restaurées). Double mécanisme : message entre onglets, et trace d’opération vue dans le stockage.
installTabPresence(() => store.suspendWrites(OTHER_TAB_RESTORE));
window.addEventListener('storage', (event) => {
  if (event.key === restoreKeysOfBuild.journal && event.newValue !== null) store.suspendWrites(OTHER_TAB_RESTORE);
});

// Fichiers sonores préparés dès le premier appui (geste utilisateur exigé par les navigateurs).
window.addEventListener('pointerdown', () => paymentSound.preload(), { once: true });

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
