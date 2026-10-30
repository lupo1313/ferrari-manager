import { useState } from 'react';
import { formatPrice } from '../../domain/money';
import type { ProductCategory } from '../../domain/types';
import type { RankedProduct } from './calculs';

const TABS: { category: ProductCategory; label: string }[] = [
  { category: 'pizza', label: 'Pizzas' },
  { category: 'boisson', label: 'Boissons' },
  { category: 'dessert', label: 'Desserts' },
];

const TOP = 5;

/** Meilleures ventes par famille : top 5 par quantité (par défaut) ou par montant, hors cadeaux fidélité. */
export function BestSellers({ ranking }: { ranking: Record<ProductCategory, RankedProduct[]> }) {
  const [category, setCategory] = useState<ProductCategory>('pizza');
  const [by, setBy] = useState<'quantity' | 'amount'>('quantity');
  const [showAll, setShowAll] = useState(false);

  const value = (r: RankedProduct) => (by === 'quantity' ? r.quantity : r.amount);
  const sorted = [...ranking[category]].sort((a, b) => value(b) - value(a) || a.name.localeCompare(b.name, 'fr'));
  const rows = showAll ? sorted : sorted.slice(0, TOP);
  const max = Math.max(1, ...sorted.map(value));

  return (
    <>
      <div className="stats-panel__head">
        <h2 className="card__title">Les meilleures ventes</h2>
        <div className="segmented stats-by" role="group" aria-label="Classer par">
          <button type="button" className="segmented__item" aria-pressed={by === 'quantity'} onClick={() => setBy('quantity')}>
            Quantité
          </button>
          <button type="button" className="segmented__item" aria-pressed={by === 'amount'} onClick={() => setBy('amount')}>
            Montant
          </button>
        </div>
      </div>
      <div className="stats-tabs" role="tablist" aria-label="Famille de produits">
        {TABS.map((t) => (
          <button
            key={t.category}
            type="button"
            role="tab"
            className="stats-tabs__item"
            aria-selected={category === t.category}
            onClick={() => {
              setCategory(t.category);
              setShowAll(false);
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      {rows.length === 0 ? (
        <p className="muted stats-chart__empty">Aucune vente sur cette période.</p>
      ) : (
        <ol className="stats-rank">
          {rows.map((r, i) => (
            <li key={r.productId} className="stats-rank__row">
              <span className="stats-rank__pos">{String(i + 1).padStart(2, '0')}</span>
              <span className="stats-rank__name">{r.name}</span>
              <span className="stats-rank__bar" aria-hidden="true">
                <span style={{ width: `${(value(r) / max) * 100}%` }} />
              </span>
              <span className="stats-rank__value">{by === 'quantity' ? r.quantity : formatPrice(r.amount)}</span>
            </li>
          ))}
        </ol>
      )}
      <div className="stats-rank__foot">
        <span className="muted">Ventes payantes, hors cadeaux fidélité et annulations{by === 'amount' ? ' · montant hors suppléments' : ''}</span>
        {sorted.length > TOP && (
          <button type="button" className="btn btn--sm btn--ghost" onClick={() => setShowAll((v) => !v)}>
            {showAll ? `Top ${TOP}` : `Voir tout (${sorted.length})`}
          </button>
        )}
      </div>
    </>
  );
}
