import { Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Sidebar } from './components/layout/Sidebar';
import { TopBar } from './components/layout/TopBar';
import { EndServiceDialog } from './components/orders/EndServiceDialog';
import { Icon } from './components/ui/Icon';
import { OrderTakingPage } from './pages/OrderTakingPage';
import { OrdersPage } from './pages/OrdersPage';
import { ClientsPage } from './pages/ClientsPage';
import { LoyaltyPage } from './pages/LoyaltyPage';
import { SettingsPage } from './pages/SettingsPage';
import { StatistiquesPage } from './modules/statistiques';
import { useAppSelector, usePersistError, useStore } from './state/StoreContext';
import { useToast } from './components/ui/Toast';
import { useRoute } from './state/useRoute';
import { isActiveOrder } from './domain/orders';
import {
  SIDEBAR_WIDTH,
  dispositionFor,
  displayedSidebarState,
  isSidebarForced,
  shouldAutoCollapse,
  sidebarAfterToggle,
  type CartIdentity,
  type SidebarState,
} from './components/layout/disposition';
import { browserPreferenceStore, readSidebarPreference, writeSidebarPreference } from './storage/interface';
import { restoreKeys } from './storage/restore';

/** Prévisualisation seulement : affiche la taille réelle de la fenêtre dans la barre latérale. */
const SHOW_VIEWPORT = import.meta.env.VITE_VIEWPORT_INDICATOR === '1';

function readWindowSize() {
  return { width: window.innerWidth, height: window.innerHeight, ratio: window.devicePixelRatio || 1 };
}

function useWindowSize() {
  const [size, setSize] = useState(readWindowSize);
  useEffect(() => {
    const update = () => setSize(readWindowSize());
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return size;
}

export function App() {
  // Sélection minimale : la saisie dans le panier ne re-rend pas toute l'application.
  const orders = useAppSelector((d) => d.orders);
  const editingOrderId = useAppSelector((d) => d.cart.editingOrderId);
  const customerId = useAppSelector((d) => d.cart.customerId);
  const persistError = usePersistError();
  const [requestedRoute, navigate] = useRoute();
  // Module Statistiques masqué : son adresse ramène à la prise de commande (aucune donnée n'est touchée).
  const statisticsEnabled = useAppSelector((d) => d.settings.modules.statistiques);
  const route = requestedRoute === 'statistiques' && !statisticsEnabled ? 'prise' : requestedRoute;
  const [endService, setEndService] = useState(false);
  const store = useStore();
  const toast = useToast();
  const serviceOpen = useAppSelector((d) => d.serviceOpen);
  // Résultat d'une restauration, affiché une fois après le rechargement automatique.
  useEffect(() => {
    try {
      const key = restoreKeys().notice;
      const message = sessionStorage.getItem(key);
      if (message) {
        sessionStorage.removeItem(key);
        toast(message, 'success');
      }
    } catch {
      /* message seulement */
    }
  }, [toast]);
  /** Service ouvert → fenêtre de fermeture ; service fermé → ouverture immédiate. */
  const onServiceAction = () => {
    if (serviceOpen) {
      setEndService(true);
      return;
    }
    const r = store.openService();
    toast(r.ok ? 'Service ouvert : prise de commandes activée' : r.error, r.ok ? 'success' : 'error');
  };

  // Barre latérale : préférence (choix manuel, mémorisé sur l'appareil) + repli automatique temporaire.
  const windowSize = useWindowSize();
  const [preference, setPreference] = useState<SidebarState | null>(() => readSidebarPreference(browserPreferenceStore()));
  const [autoCollapsed, setAutoCollapsed] = useState(false);
  const sidebar = displayedSidebarState({ preference, autoCollapsed, windowWidth: windowSize.width });
  const sidebarForced = isSidebarForced(windowSize.width);
  const toggleSidebar = () => {
    const next = sidebarAfterToggle(sidebar);
    setPreference(next.preference);
    setAutoCollapsed(next.autoCollapsed);
    writeSidebarPreference(browserPreferenceStore(), next.preference);
  };
  // Repli dans le même rendu que la sélection du client : un seul changement visible, jamais au chargement.
  const previousCart = useRef<CartIdentity>({ customerId, editingOrderId });
  useLayoutEffect(() => {
    const next = { customerId, editingOrderId };
    if (shouldAutoCollapse(previousCart.current, next)) setAutoCollapsed(true);
    previousCart.current = next;
  }, [customerId, editingOrderId]);

  // Place réellement disponible à côté de la barre : la largeur de <main> ne dépend pas de son contenu
  // (colonne minmax(0, 1fr)), changer de disposition ne peut donc pas relancer la mesure.
  const mainRef = useRef<HTMLElement>(null);
  const [available, setAvailable] = useState(() => windowSize.width - SIDEBAR_WIDTH[sidebar]);
  useLayoutEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    const measure = () => setAvailable(el.clientWidth);
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  // Repli, dépliage ou fenêtre redimensionnée : nouvelle mesure avant l'affichage, sans image intermédiaire
  // (et sans dépendre seulement du ResizeObserver, suspendu quand la page est en arrière-plan).
  useLayoutEffect(() => {
    if (mainRef.current) setAvailable(mainRef.current.clientWidth);
  }, [sidebar, windowSize.width]);
  const disposition = dispositionFor(available, windowSize.width);

  const activeOrders = orders.filter(isActiveOrder).length;
  const editing = editingOrderId ? orders.find((o) => o.id === editingOrderId) : undefined;
  const goToOrderTaking = () => navigate('prise');

  return (
    <div className="app" data-sidebar={sidebar} data-disposition={disposition}>
      <Sidebar
        route={route}
        onNavigate={navigate}
        activeOrders={activeOrders}
        editingOrderNumber={editing?.number ?? null}
        statisticsEnabled={statisticsEnabled}
        state={sidebar}
        forced={sidebarForced}
        onToggle={toggleSidebar}
        viewport={SHOW_VIEWPORT ? windowSize : undefined}
      />
      <main className="main" ref={mainRef}>
        <TopBar onGoToOrderTaking={goToOrderTaking} serviceOpen={serviceOpen} onServiceAction={onServiceAction} />
        {persistError && (
          <p className="notice notice--error app__persist" role="alert">
            <Icon name="alert" size={18} /> {persistError}
          </p>
        )}
        {route === 'prise' && <OrderTakingPage />}
        {route === 'commandes' && <OrdersPage onGoToOrderTaking={goToOrderTaking} serviceOpen={serviceOpen} onServiceAction={onServiceAction} />}
        {route === 'clients' && <ClientsPage onGoToOrderTaking={goToOrderTaking} />}
        {route === 'fidelite' && <LoyaltyPage />}
        {route === 'statistiques' && (
          <Suspense fallback={<p className="page muted">Chargement des statistiques…</p>}>
            <StatistiquesPage />
          </Suspense>
        )}
        {route === 'parametres' && <SettingsPage />}
      </main>
      {endService && <EndServiceDialog onClose={() => setEndService(false)} />}
    </div>
  );
}
