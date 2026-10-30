import { useState } from 'react';
import { Sidebar } from './components/layout/Sidebar';
import { TopBar } from './components/layout/TopBar';
import { EndServiceDialog } from './components/orders/EndServiceDialog';
import { Icon } from './components/ui/Icon';
import { OrderTakingPage } from './pages/OrderTakingPage';
import { OrdersPage } from './pages/OrdersPage';
import { ClientsPage } from './pages/ClientsPage';
import { LoyaltyPage } from './pages/LoyaltyPage';
import { SettingsPage } from './pages/SettingsPage';
import { useAppSelector, usePersistError, useStore } from './state/StoreContext';
import { useToast } from './components/ui/Toast';
import { useRoute } from './state/useRoute';
import { isActiveOrder } from './domain/orders';

export function App() {
  // Sélection minimale : la saisie dans le panier ne re-rend pas toute l'application.
  const orders = useAppSelector((d) => d.orders);
  const editingOrderId = useAppSelector((d) => d.cart.editingOrderId);
  const persistError = usePersistError();
  const [route, navigate] = useRoute();
  const [endService, setEndService] = useState(false);
  const store = useStore();
  const toast = useToast();
  const serviceOpen = useAppSelector((d) => d.serviceOpen);
  /** Service ouvert → fenêtre de fermeture ; service fermé → ouverture immédiate. */
  const onServiceAction = () => {
    if (serviceOpen) {
      setEndService(true);
      return;
    }
    const r = store.openService();
    toast(r.ok ? 'Service ouvert : prise de commandes activée' : r.error, r.ok ? 'success' : 'error');
  };

  const activeOrders = orders.filter(isActiveOrder).length;
  const editing = editingOrderId ? orders.find((o) => o.id === editingOrderId) : undefined;
  const goToOrderTaking = () => navigate('prise');

  return (
    <div className="app">
      <Sidebar route={route} onNavigate={navigate} activeOrders={activeOrders} editingOrderNumber={editing?.number ?? null} />
      <main className="main">
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
        {route === 'parametres' && <SettingsPage />}
      </main>
      {endService && <EndServiceDialog onClose={() => setEndService(false)} />}
    </div>
  );
}
