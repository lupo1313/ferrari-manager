import logo from '../../assets/logo-ferrari.webp';
import monogram from '../../assets/monogram-ferrari.webp';
import { Icon, type IconName } from '../ui/Icon';
import type { Route } from '../../state/useRoute';
import type { SidebarState } from './disposition';

interface NavItem {
  route: Route;
  label: string;
  icon: IconName;
  /** Module facultatif : l'entrée n'apparaît que si le module est affiché (Paramètres). */
  optional?: true;
}

const ITEMS: NavItem[] = [
  { route: 'prise', label: 'Nouvelle commande', icon: 'newOrder' },
  { route: 'commandes', label: 'Commandes', icon: 'orders' },
  { route: 'clients', label: 'Clients', icon: 'user' },
  { route: 'fidelite', label: 'Fidélité', icon: 'heart' },
  { route: 'statistiques', label: 'Statistiques', icon: 'chart', optional: true },
  { route: 'parametres', label: 'Paramètres', icon: 'settings' },
];

interface SidebarProps {
  route: Route;
  onNavigate: (route: Route) => void;
  activeOrders: number;
  editingOrderNumber: number | null;
  /** Module Statistiques affiché (Paramètres → Modules facultatifs). */
  statisticsEnabled: boolean;
  /** Ouverte : logo et libellés ; réduite : monogramme et icônes seules. */
  state: SidebarState;
  /** Fenêtre étroite : barre toujours réduite, sans bouton. */
  forced: boolean;
  onToggle: () => void;
  /** Prévisualisation seulement : taille réelle de la fenêtre (px CSS). */
  viewport?: { width: number; height: number; ratio: number };
}

export function Sidebar({ route, onNavigate, activeOrders, editingOrderNumber, statisticsEnabled, state, forced, onToggle, viewport }: SidebarProps) {
  const items = ITEMS.filter((item) => !item.optional || statisticsEnabled);
  const open = state === 'ouverte';
  return (
    <nav className="sidebar" aria-label="Navigation principale">
      <div className="sidebar__brand">
        {open ? (
          <img className="sidebar__logo" src={logo} alt="Pizzeria Ferrari" width={462} height={160} />
        ) : (
          <img className="sidebar__monogram" src={monogram} alt="Pizzeria Ferrari" width={512} height={512} />
        )}
      </div>
      <ul className="sidebar__list" id="sidebar-navigation">
        {items.map((item) => {
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
                    <span className="badge sidebar__badge" aria-hidden="true">
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
      <div className="sidebar__bottom">
        {/* Un seul bouton dans les deux états : le focus clavier reste dessus après un appui. */}
        {!forced && (
          <button
            type="button"
            className="sidebar__toggle"
            aria-expanded={open}
            aria-controls="sidebar-navigation"
            aria-label={open ? 'Réduire le menu' : 'Déplier le menu'}
            title={open ? 'Réduire le menu' : 'Déplier le menu'}
            onClick={onToggle}
          >
            <Icon name={open ? 'chevronLeft' : 'chevronRight'} size={22} />
            <span className="sidebar__label">Réduire le menu</span>
          </button>
        )}
        {open && (
          <p className="sidebar__foot">
            Version de test
            <br />
            Données fictives
          </p>
        )}
        {viewport && (
          <p className="sidebar__viewport" title="Taille réelle de la fenêtre (pixels CSS) et densité de l'écran">
            {viewport.width}×{viewport.height}
            <br />
            {viewport.ratio.toLocaleString('fr-FR', { maximumFractionDigits: 2 })}x
          </p>
        )}
      </div>
    </nav>
  );
}
