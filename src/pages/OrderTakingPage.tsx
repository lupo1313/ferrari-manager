import { useEffect, useRef, useState } from 'react';
import { CustomerPanel } from '../components/customer/CustomerPanel';
import { CatalogPanel } from '../components/catalog/CatalogPanel';
import { OrderPanel } from '../components/order/OrderPanel';
import { useAppSelector } from '../state/StoreContext';
import { itemCount } from '../domain/cart';
import { computeTotals } from '../domain/pricing';
import { formatPrice } from '../domain/money';
import { computeBalance } from '../domain/loyalty';
import { Icon } from '../components/ui/Icon';
import { customerFullName, formatPhone } from '../domain/customers';

type Pane = 'client' | 'carte' | 'commande';

/**
 * Écran principal : client | catalogue | commande.
 * Sur écran étroit, les trois colonnes deviennent des onglets plutôt que d'être réduites.
 */
export function OrderTakingPage() {
  // Sélection fine : taper une note (cart.note) ne re-rend pas cette page ni ses trois colonnes.
  const lines = useAppSelector((d) => d.cart.lines);
  const customerId = useAppSelector((d) => d.cart.customerId);
  const loyaltyEvents = useAppSelector((d) => d.loyaltyEvents);
  const loyaltyRules = useAppSelector((d) => d.settings.loyalty);
  const customers = useAppSelector((d) => d.customers);
  const [collapsedCustomer, setCollapsedCustomer] = useState<string | null>(null);
  const collapsed = Boolean(customerId && collapsedCustomer === customerId);
  const [pane, setPane] = useState<Pane>('carte');
  // En mode onglets : une fois le client choisi, on passe directement à la carte.
  const previousCustomer = useRef(customerId);
  useEffect(() => {
    if (customerId && customerId !== previousCustomer.current) setPane((p) => (p === 'client' ? 'carte' : p));
    if (customerId !== previousCustomer.current) setCollapsedCustomer(null);
    previousCustomer.current = customerId;
  }, [customerId]);
  const customer = customerId ? customers.find((c) => c.id === customerId) : undefined;
  const balance = customer ? computeBalance(loyaltyEvents, customer.id, loyaltyRules) : null;
  const totals = computeTotals(lines);

  return (
    <div className="workspace" data-pane={pane} data-client-collapsed={collapsed}>
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
        {customer && (
          <button type="button" className="btn client-fold" aria-expanded={!collapsed} aria-controls="order-customer-panel"
            onClick={() => setCollapsedCustomer(collapsed ? null : customer.id)}>
            <Icon name={collapsed ? 'chevronRight' : 'chevronLeft'} /> {collapsed ? 'Déplier' : 'Replier le client'}
          </button>
        )}
        {customer && collapsed && <div className="client-compact">
          <Icon name="user" size={26} /><strong>{customerFullName(customer)}</strong>
          <span>{formatPhone(customer.phone)}</span>
          <span>{balance?.progress} / {loyaltyRules.pizzasPerReward} pizzas<br />{balance?.available} récompense(s) disponible(s)</span>
          <span className="muted">Déplier pour consulter la fiche et utiliser la fidélité.</span>
        </div>}
        <div id="order-customer-panel" className="client-full"><CustomerPanel /></div>
      </div>
      <div className="workspace__col workspace__col--carte">
        <CatalogPanel />
      </div>
      <div className="workspace__col workspace__col--commande">
        <OrderPanel onShowCatalog={() => setPane('carte')} />
      </div>
    </div>
  );
}
