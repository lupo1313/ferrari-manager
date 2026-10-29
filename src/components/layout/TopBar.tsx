import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../ui/Icon';
import { useAppData, useStore } from '../../state/StoreContext';
import { useToast } from '../ui/Toast';
import { customerFullName, formatPhone, searchCustomers } from '../../domain/customers';
import { formatPrice } from '../../domain/money';
import type { Product } from '../../domain/types';

function fold(text: string) {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 15_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

interface TopBarProps {
  onGoToOrderTaking: () => void;
  onEndService: () => void;
}

export function TopBar({ onGoToOrderTaking, onEndService }: TopBarProps) {
  const store = useStore();
  const data = useAppData();
  const toast = useToast();
  const now = useClock();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    const q = query.trim();
    if (!q) return { customers: [], products: [] as Product[] };
    const customers = searchCustomers(data.customers, q, 5);
    const folded = fold(q);
    const products = /^[\d\s.+-]+$/.test(q)
      ? []
      : store.catalog.products.filter((p) => fold(`${p.name} ${p.description ?? ''}`).includes(folded)).slice(0, 6);
    return { customers, products };
  }, [query, data.customers, store.catalog.products]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, []);

  const close = () => {
    setQuery('');
    setOpen(false);
  };

  const date = now.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'long' });
  const time = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const hasResults = results.customers.length + results.products.length > 0;

  return (
    <header className="topbar">
      <div className="global-search" ref={boxRef}>
        <Icon name="search" className="global-search__icon" />
        <input
          className="global-search__input"
          type="search"
          placeholder="Rechercher une pizza, un produit ou un client…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          aria-label="Recherche globale"
          enterKeyHint="search"
        />
        {query && (
          <button type="button" className="icon-btn global-search__clear" onClick={close} aria-label="Effacer la recherche">
            <Icon name="close" size={18} />
          </button>
        )}
        {open && query.trim() && (
          <div className="search-results" role="listbox">
            {!hasResults && <p className="search-results__empty">Aucun résultat pour « {query.trim()} ».</p>}
            {results.customers.length > 0 && (
              <div className="search-results__group">
                <p className="search-results__title">Clients</p>
                {results.customers.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className="search-results__item"
                    onClick={() => {
                      const r = store.selectCustomer(c.id);
                      if (r.ok && r.value.removedRewards > 0) toast('Récompenses du client précédent retirées de la commande.', 'info');
                      toast(`${customerFullName(c)} sélectionné`, 'success');
                      onGoToOrderTaking();
                      close();
                    }}
                  >
                    <Icon name="user" size={18} />
                    <span className="search-results__main">{customerFullName(c)}</span>
                    <span className="search-results__meta">{formatPhone(c.phone)}</span>
                  </button>
                ))}
              </div>
            )}
            {results.products.length > 0 && (
              <div className="search-results__group">
                <p className="search-results__title">Produits · toucher pour ajouter</p>
                {results.products.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="search-results__item"
                    onClick={() => {
                      store.addProduct(p.id);
                      toast(`${p.name} ajouté`, 'success');
                      onGoToOrderTaking();
                      close();
                    }}
                  >
                    <Icon name={p.category === 'pizza' ? 'pizza' : p.category === 'boisson' ? 'cup' : 'cake'} size={18} />
                    <span className="search-results__main">{p.name}</span>
                    <span className="search-results__meta price">{formatPrice(p.price)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <span className="pill pill--muted topbar__test" title="Version de test : ne pas saisir de véritables données clients">
        <Icon name="info" size={14} /> Version de test
      </span>

      <div className="topbar__clock" aria-label="Date et heure">
        <span className="topbar__date">{date}</span>
        <span className="topbar__time">{time}</span>
      </div>

      <button type="button" className="service-btn" onClick={onEndService} title="Clôturer le service">
        <span className="service-btn__dot" aria-hidden="true" />
        <span className="service-btn__label">
          Service
          <small>Fin de service</small>
        </span>
      </button>
    </header>
  );
}
