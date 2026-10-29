import logo from '../../assets/logo-ferrari.webp';
import monogram from '../../assets/monogram-ferrari.webp';
import { Icon, type IconName } from '../ui/Icon';
import type { Route } from '../../state/useRoute';

interface NavItem {
  route: Route;
  label: string;
  icon: IconName;
}

const ITEMS: NavItem[] = [
  { route: 'prise', label: 'Nouvelle commande', icon: 'newOrder' },
  { route: 'commandes', label: 'Commandes', icon: 'orders' },
  { route: 'clients', label: 'Clients', icon: 'user' },
  { route: 'fidelite', label: 'Fidélité', icon: 'heart' },
  { route: 'parametres', label: 'Paramètres', icon: 'settings' },
];

interface SidebarProps {
  route: Route;
  onNavigate: (route: Route) => void;
  activeOrders: number;
  editingOrderNumber: number | null;
}

export function Sidebar({ route, onNavigate, activeOrders, editingOrderNumber }: SidebarProps) {
  return (
    <nav className="sidebar" aria-label="Navigation principale">
      <div className="sidebar__brand">
        <img className="sidebar__logo" src={logo} alt="Pizzeria Ferrari" width={462} height={160} />
        <img className="sidebar__monogram" src={monogram} alt="Pizzeria Ferrari" width={512} height={512} />
      </div>
      <ul className="sidebar__list">
        {ITEMS.map((item) => {
          const label = item.route === 'prise' && editingOrderNumber ? `Modification n° ${editingOrderNumber}` : item.label;
          return (
            <li key={item.route}>
              <button
                type="button"
                className="sidebar__item"
                aria-current={route === item.route ? 'page' : undefined}
                aria-label={item.route === 'commandes' && activeOrders > 0 ? `${label} (${activeOrders} actives)` : label}
                title={label}
                onClick={() => onNavigate(item.route)}
              >
                <span className="sidebar__icon">
                  <Icon name={item.route === 'prise' && editingOrderNumber ? 'pencil' : item.icon} size={24} />
                  {item.route === 'commandes' && activeOrders > 0 && (
                    <span className="badge sidebar__badge" aria-label={`${activeOrders} commandes actives`}>
                      {activeOrders}
                    </span>
                  )}
                </span>
                <span className="sidebar__label">{label}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="sidebar__foot">
        Version de test
        <br />
        Données fictives
      </p>
    </nav>
  );
}
