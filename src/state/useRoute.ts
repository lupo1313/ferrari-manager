import { useEffect, useState } from 'react';

export type Route = 'prise' | 'commandes' | 'clients' | 'fidelite' | 'statistiques' | 'parametres' | 'carte' | 'supplements';

const ROUTES: Route[] = ['prise', 'commandes', 'clients', 'fidelite', 'statistiques', 'parametres'];

/** Sous-page de Paramètres (intervention 9a) : #/parametres/carte. */
const PATHS: Partial<Record<Route, string>> = { carte: 'parametres/carte', supplements: 'parametres/supplements' };

function readHash(): Route {
  const value = window.location.hash.replace(/^#\/?/, '');
  if (value === PATHS.carte) return 'carte';
  if (value === PATHS.supplements) return 'supplements';
  return (ROUTES as string[]).includes(value) ? (value as Route) : 'prise';
}

/** Navigation par hash (#/commandes) : compatible hébergement statique sans réécriture d'URL. */
export function useRoute(): [Route, (route: Route) => void] {
  const [route, setRoute] = useState<Route>(readHash);
  useEffect(() => {
    const onChange = () => setRoute(readHash());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  const navigate = (next: Route) => {
    window.location.hash = next === 'prise' ? '/' : `/${PATHS[next] ?? next}`;
  };
  return [route, navigate];
}
