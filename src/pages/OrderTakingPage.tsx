import { useEffect, useRef, useState } from 'react';
import { CustomerPanel } from '../components/customer/CustomerPanel';
import { CatalogPanel } from '../components/catalog/CatalogPanel';
import { OrderPanel } from '../components/order/OrderPanel';
import { useAppSelector } from '../state/StoreContext';
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
  // Sélection fine : taper une note (cart.note) ne re-rend pas cette page ni ses trois colonnes.
  const lines = useAppSelector((d) => d.cart.lines);
  const mode = useAppSelector((d) => d.cart.mode);
  const customerId = useAppSelector((d) => d.cart.customerId);
  const customers = useAppSelector((d) => d.customers);
  const deliveryFee = useAppSelector((d) => d.settings.deliveryFee);
  const [pane, setPane] = useState<Pane>('carte');
  // En mode onglets : une fois le client choisi, on passe directement à la carte.
  const previousCustomer = useRef(customerId);
  useEffect(() => {
    if (customerId && customerId !== previousCustomer.current) setPane((p) => (p === 'client' ? 'carte' : p));
    previousCustomer.current = customerId;
  }, [customerId]);
  const customer = customerId ? customers.find((c) => c.id === customerId) : undefined;
  const totals = computeTotals(lines, mode, { deliveryFee });

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
          Commande ({itemCount(lines)})
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
