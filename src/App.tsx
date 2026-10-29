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
import { useAppData, usePersistError } from './state/StoreContext';
import { useRoute } from './state/useRoute';
import { isActiveOrder } from './domain/orders';

export function App() {
  const data = useAppData();
  const persistError = usePersistError();
  const [route, navigate] = useRoute();
  const [endService, setEndService] = useState(false);

  const activeOrders = data.orders.filter(isActiveOrder).length;
  const editing = data.cart.editingOrderId ? data.orders.find((o) => o.id === data.cart.editingOrderId) : undefined;
  const goToOrderTaking = () => navigate('prise');

  return (
    <div className="app">
      <Sidebar route={route} onNavigate={navigate} activeOrders={activeOrders} editingOrderNumber={editing?.number ?? null} />
      <main className="main">
        <TopBar onGoToOrderTaking={goToOrderTaking} onEndService={() => setEndService(true)} />
        {persistError && (
          <p className="notice notice--error app__persist" role="alert">
            <Icon name="alert" size={18} /> {persistError}
          </p>
        )}
        {route === 'prise' && <OrderTakingPage />}
        {route === 'commandes' && <OrdersPage onGoToOrderTaking={goToOrderTaking} onEndService={() => setEndService(true)} />}
        {route === 'clients' && <ClientsPage onGoToOrderTaking={goToOrderTaking} />}
        {route === 'fidelite' && <LoyaltyPage />}
        {route === 'parametres' && <SettingsPage />}
      </main>
      {endService && <EndServiceDialog onClose={() => setEndService(false)} />}
    </div>
  );
}
