import { useState } from 'react';
import { Icon } from '../ui/Icon';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { useToast } from '../ui/Toast';
import { ProductFormModal } from './ProductFormModal';
import { useCatalog, useStore } from '../../state/StoreContext';
import { CATEGORY_LABELS, PRODUCT_CATEGORIES, isActive } from '../../domain/catalog';
import { formatPrice } from '../../domain/money';
import type { Product, ProductCategory } from '../../domain/types';

type Filter = 'actifs' | 'desactives' | 'tous';

const CATEGORY_TITLES: Record<ProductCategory, string> = { pizza: 'Pizzas', boisson: 'Boissons', dessert: 'Desserts' };

/**
 * Paramètres → Carte des produits (intervention 9a) : ajout, modification, désactivation et réactivation.
 * Aucun produit n'est supprimé ; les changements ne valent que pour les nouvelles sélections.
 */
export function CatalogManager({ onBack }: { onBack: () => void }) {
  const store = useStore();
  const toast = useToast();
  const catalog = useCatalog();
  const error = store.getCatalogError();
  const locked = store.isStorageLocked();
  const [category, setCategory] = useState<ProductCategory>('pizza');
  const [filter, setFilter] = useState<Filter>('actifs');
  const [form, setForm] = useState<{ product?: Product } | null>(null);
  const [deactivating, setDeactivating] = useState<Product | null>(null);

  const inCategory = catalog.products.filter((p) => p.category === category);
  const shown = inCategory.filter((p) => (filter === 'tous' ? true : filter === 'actifs' ? isActive(p) : !isActive(p)));
  const count = (c: ProductCategory) => catalog.products.filter((p) => p.category === c && isActive(p)).length;
  const inactiveCount = inCategory.filter((p) => !isActive(p)).length;
  const editable = !error && !locked;

  const setActive = (p: Product, active: boolean) => {
    const r = store.setCatalogProductActive(p.id, active);
    toast(r.ok ? (active ? `${p.name} réactivé : de nouveau proposé.` : `${p.name} désactivé : retiré des nouvelles sélections.`) : r.error, r.ok ? 'success' : 'error');
  };

  return (
    <div className="page">
      <header className="page__header">
        <div>
          <button type="button" className="btn btn--ghost catalog-manager__back" onClick={onBack}>
            <Icon name="chevronLeft" /> Paramètres
          </button>
          <h1 className="page__title">Carte des produits</h1>
          <p className="muted">
            Les modifications s’appliquent aux prochaines sélections. Paniers et commandes déjà enregistrés gardent leurs libellés, prix et
            compositions. Aucun produit n’est supprimé : un produit désactivé reste visible dans l’historique. Suppléments : inchangés.
          </p>
        </div>
        <button type="button" className="btn btn--success" onClick={() => setForm({})} disabled={!editable}>
          <Icon name="plus" /> Ajouter un produit
        </button>
      </header>

      {error && (
        <p className="notice notice--error" role="alert">
          <Icon name="alert" size={18} /> {error}
        </p>
      )}
      {locked && !error && (
        <p className="notice notice--error" role="alert">
          <Icon name="alert" size={18} /> Données locales non chargées : la carte ne peut pas être modifiée.
        </p>
      )}

      <div className="page__toolbar catalog-manager__toolbar">
        <div className="segmented" role="tablist" aria-label="Catégorie">
          {PRODUCT_CATEGORIES.map((c) => (
            <button key={c} type="button" role="tab" className="segmented__item" aria-selected={category === c} onClick={() => setCategory(c)}>
              {CATEGORY_TITLES[c]} <span className="catalog-manager__count">{count(c)}</span>
            </button>
          ))}
        </div>
        <div className="segmented" role="group" aria-label="Afficher">
          {(
            [
              ['actifs', 'Actifs'],
              ['desactives', `Désactivés (${inactiveCount})`],
              ['tous', 'Tous'],
            ] as const
          ).map(([id, label]) => (
            <button key={id} type="button" className="segmented__item" aria-pressed={filter === id} onClick={() => setFilter(id)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <section className="table-card">
        <table className="data-table catalog-table">
          <thead>
            <tr>
              <th scope="col">{CATEGORY_LABELS[category]}</th>
              <th scope="col">Prix</th>
              <th scope="col">État</th>
              <th scope="col" className="data-table__actions">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr>
                <td colSpan={4} className="data-table__empty">
                  {filter === 'desactives' ? 'Aucun produit désactivé dans cette catégorie.' : 'Aucun produit à afficher.'}
                </td>
              </tr>
            )}
            {shown.map((p) => {
              const active = isActive(p);
              return (
                <tr key={p.id} className={active ? undefined : 'is-inactive'}>
                  <td>
                    <span className="data-table__strong">{p.name}</span>
                    {p.alcohol && <span className="pill pill--muted catalog-table__tag">Alcool</span>}
                    {p.description && <span className="catalog-table__desc">{p.description}</span>}
                  </td>
                  <td className="price">{formatPrice(p.price)}</td>
                  <td>
                    <span className={`pill ${active ? 'pill--success' : 'pill--muted'}`}>{active ? 'Actif' : 'Désactivé'}</span>
                  </td>
                  <td className="data-table__actions">
                    <button type="button" className="btn" onClick={() => setForm({ product: p })} disabled={!editable}>
                      <Icon name="pencil" /> Modifier
                    </button>
                    {active ? (
                      <button type="button" className="btn btn--danger-soft" onClick={() => setDeactivating(p)} disabled={!editable}>
                        Désactiver
                      </button>
                    ) : (
                      <button type="button" className="btn btn--success" onClick={() => setActive(p, true)} disabled={!editable}>
                        Réactiver
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {form && <ProductFormModal product={form.product} initialCategory={category} onClose={() => setForm(null)} />}
      {deactivating && (
        <ConfirmDialog
          title={`Désactiver « ${deactivating.name} » ?`}
          confirmLabel="Désactiver"
          onCancel={() => setDeactivating(null)}
          onConfirm={() => {
            setActive(deactivating, false);
            setDeactivating(null);
          }}
          message="Il ne sera plus proposé pour les nouvelles commandes ni comme récompense. Il reste visible dans les commandes, paniers et statistiques existants, et peut être réactivé à tout moment."
        />
      )}
    </div>
  );
}
