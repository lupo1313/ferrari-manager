import { useState } from 'react';
import { Icon } from '../ui/Icon';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { useToast } from '../ui/Toast';
import { useCatalog, useStore } from '../../state/StoreContext';
import { isActive } from '../../domain/catalog';
import { formatPrice } from '../../domain/money';
import type { Topping } from '../../domain/types';
import { ToppingFormModal } from './ToppingFormModal';

export function ToppingManager({ onBack }: { onBack: () => void }) {
  const store = useStore(); const catalog = useCatalog(); const toast = useToast();
  const [filter, setFilter] = useState<'actifs' | 'desactives' | 'tous'>('actifs');
  const [form, setForm] = useState<{ topping?: Topping } | null>(null);
  const [deactivating, setDeactivating] = useState<Topping | null>(null);
  const editable = !store.isStorageLocked() && !store.getCatalogError();
  const shown = catalog.toppings.filter((t) => filter === 'tous' || (filter === 'actifs' ? isActive(t) : !isActive(t)));
  const setActive = (t: Topping, active: boolean) => {
    const r = store.setCatalogToppingActive(t.id, active);
    toast(r.ok ? t.name + (active ? ' réactivé.' : ' désactivé.') : r.error, r.ok ? 'success' : 'error');
  };
  return <div className="page">
    <header className="page__header"><div>
      <button type="button" className="btn btn--ghost catalog-manager__back" onClick={onBack}><Icon name="chevronLeft" />Paramètres</button>
      <h1 className="page__title">Suppléments</h1>
      <p className="muted">Les changements concernent les prochaines sélections. Paniers et commandes gardent leurs noms et prix enregistrés.</p>
    </div><button type="button" className="btn btn--success" disabled={!editable} onClick={() => setForm({})}><Icon name="plus" />Ajouter un supplément</button></header>
    {!editable && <p className="notice notice--error" role="alert">{store.getCatalogError() ?? 'Données locales non chargées : modification impossible.'}</p>}
    <div className="page__toolbar catalog-manager__toolbar"><div className="segmented" role="group" aria-label="Afficher les suppléments">
      {([['actifs', 'Actifs'], ['desactives', 'Désactivés'], ['tous', 'Tous']] as const).map(([id, label]) =>
        <button key={id} type="button" className="segmented__item" aria-pressed={filter === id} onClick={() => setFilter(id)}>
          {label} ({catalog.toppings.filter((t) => id === 'tous' || (id === 'actifs' ? isActive(t) : !isActive(t))).length})
        </button>)}
    </div></div>
    <section className="table-card"><table className="data-table catalog-table"><thead><tr>
      <th scope="col">Supplément</th><th scope="col">Prix</th><th scope="col">État</th><th scope="col" className="data-table__actions">Actions</th>
    </tr></thead><tbody>
      {shown.length === 0 && <tr><td colSpan={4} className="data-table__empty">Aucun supplément à afficher.</td></tr>}
      {shown.map((t) => <tr key={t.id} className={isActive(t) ? undefined : 'is-inactive'}>
        <td className="data-table__strong">{t.name}</td><td className="price">{formatPrice(t.price)}</td>
        <td><span className={'pill ' + (isActive(t) ? 'pill--success' : 'pill--muted')}>{isActive(t) ? 'Actif' : 'Désactivé'}</span></td>
        <td className="data-table__actions"><button type="button" className="btn" disabled={!editable} onClick={() => setForm({ topping: t })}><Icon name="pencil" />Modifier</button>
          {isActive(t) ? <button type="button" className="btn btn--danger-soft" disabled={!editable} onClick={() => setDeactivating(t)}>Désactiver</button>
            : <button type="button" className="btn btn--success" disabled={!editable} onClick={() => setActive(t, true)}>Réactiver</button>}
        </td></tr>)}
    </tbody></table></section>
    {form && <ToppingFormModal topping={form.topping} onClose={() => setForm(null)} />}
    {deactivating && <ConfirmDialog title={'Désactiver « ' + deactivating.name + ' » ?'} confirmLabel="Désactiver"
      onCancel={() => setDeactivating(null)} onConfirm={() => { setActive(deactivating, false); setDeactivating(null); }}
      message="Ce supplément ne pourra plus être ajouté ni augmenté avec une ligne existante. Les suppléments déjà présents restent consultables et retirables. Aucune suppression définitive." />}
  </div>;
}
