import { useEffect, useState } from 'react';

export type Route = 'prise' | 'commandes' | 'clients' | 'fidelite' | 'parametres';

const ROUTES: Route[] = ['prise', 'commandes', 'clients', 'fidelite', 'parametres'];

function readHash(): Route {
  const value = window.location.hash.replace(/^#\/?/, '');
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
    window.location.hash = next === 'prise' ? '/' : `/${next}`;
  };
  return [route, navigate];
}
