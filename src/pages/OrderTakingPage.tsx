import { useEffect, useRef, useState } from 'react';
import { CustomerPanel } from '../components/customer/CustomerPanel';
import { CatalogPanel } from '../components/catalog/CatalogPanel';
import { OrderPanel } from '../components/order/OrderPanel';
import { useAppData } from '../state/StoreContext';
import { itemCount } from '../domain/cart';
import { computeTotals } from '../domain/pricing';
import { formatPrice } from '../domain/money';
import { customerFullName } from '../domain/customers';

type Pane = 'client' | 'carte' | 'commande';

/**
 * Écran principal : client | catalogue | commande.
 * Sur écran étroit, les trois colonnes deviennent des onglets plutôt que d'être réduites.
 */
export function OrderTakingPage() {
  const data = useAppData();
  const [pane, setPane] = useState<Pane>('carte');
  const cart = data.cart;
  // En mode onglets : une fois le client choisi, on passe directement à la carte.
  const previousCustomer = useRef(cart.customerId);
  useEffect(() => {
    if (cart.customerId && cart.customerId !== previousCustomer.current) setPane((p) => (p === 'client' ? 'carte' : p));
    previousCustomer.current = cart.customerId;
  }, [cart.customerId]);
  const customer = cart.customerId ? data.customers.find((c) => c.id === cart.customerId) : undefined;
  const totals = computeTotals(cart.lines, cart.mode, { deliveryFee: data.settings.deliveryFee });

  return (
    <div className="workspace" data-pane={pane}>
      <div className="pane-tabs" role="tablist" aria-label="Sections de la prise de commande">
        <button type="button" role="tab" aria-selected={pane === 'client'} onClick={() => setPane('client')}>
          Client
          <small>{customer ? customerFullName(customer) : 'Comptoir'}</small>
        </button>
        <button type="button" role="tab" aria-selected={pane === 'carte'} onClick={() => setPane('carte')}>
          Carte
          <small>Pizzas, boissons…</small>
        </button>
        <button type="button" role="tab" aria-selected={pane === 'commande'} onClick={() => setPane('commande')}>
          Commande ({itemCount(cart.lines)})
          <small>{formatPrice(totals.total)}</small>
        </button>
      </div>
      <div className="workspace__col workspace__col--client">
        <CustomerPanel />
      </div>
      <div className="workspace__col workspace__col--carte">
        <CatalogPanel />
      </div>
      <div className="workspace__col workspace__col--commande">
        <OrderPanel />
      </div>
    </div>
  );
}
