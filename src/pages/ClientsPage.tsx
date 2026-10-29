import { useMemo, useState } from 'react';
import { Icon } from '../components/ui/Icon';
import { useToast } from '../components/ui/Toast';
import { CustomerFormModal } from '../components/customer/CustomerFormModal';
import { useAppData, useStore } from '../state/StoreContext';
import { customerFullName, formatPhone, searchCustomers } from '../domain/customers';
import { computeBalance } from '../domain/loyalty';
import type { Customer } from '../domain/types';

export function ClientsPage({ onGoToOrderTaking }: { onGoToOrderTaking: () => void }) {
  const store = useStore();
  const data = useAppData();
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [form, setForm] = useState<{ customer?: Customer } | null>(null);
  const rules = data.settings.loyalty;

  const list = useMemo(() => {
    const base = query.trim() ? searchCustomers(data.customers, query, 200) : data.customers;
    return [...base].sort((a, b) => customerFullName(a).localeCompare(customerFullName(b), 'fr'));
  }, [data.customers, query]);

  return (
    <div className="page">
      <header className="page__header">
        <div>
          <h1 className="page__title">Clients</h1>
          <p className="muted">{data.customers.length} fiches (fictives). Un numéro de téléphone = une fiche.</p>
        </div>
        <button type="button" className="btn btn--primary" onClick={() => setForm({})}>
          <Icon name="plus" /> Nouveau client
        </button>
      </header>
      <div className="page__toolbar">
        <div className="page-search page-search--wide">
          <Icon name="search" size={18} />
          <input
            className="input"
            type="search"
            placeholder="Téléphone ou nom"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Rechercher un client"
          />
        </div>
      </div>

      <div className="table-card">
        <table className="data-table">
          <thead>
            <tr>
              <th>Client</th>
              <th>Téléphone</th>
              <th>Adresse</th>
              <th>Fidélité</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {list.map((c) => {
              const b = computeBalance(data.loyaltyEvents, c.id, rules);
              return (
                <tr key={c.id}>
                  <td className="data-table__strong">{customerFullName(c)}</td>
                  <td>{formatPhone(c.phone)}</td>
                  <td>{c.address ? `${c.address}, ${c.postalCode} ${c.city}` : <span className="muted">Non renseignée</span>}</td>
                  <td>
                    {b.available > 0 && <span className="pill pill--gold">{b.available} récompense{b.available > 1 ? 's' : ''}</span>}{' '}
                    <span className="muted">
                      {b.progress}/{rules.pizzasPerReward}
                    </span>
                  </td>
                  <td className="data-table__actions">
                    <button type="button" className="btn btn--sm" onClick={() => setForm({ customer: c })}>
                      <Icon name="pencil" size={18} /> Modifier
                    </button>
                    <button
                      type="button"
                      className="btn btn--sm btn--dark"
                      onClick={() => {
                        store.selectCustomer(c.id);
                        toast(`${customerFullName(c)} sélectionné`, 'success');
                        onGoToOrderTaking();
                      }}
                    >
                      Commander <Icon name="arrowRight" size={18} />
                    </button>
                  </td>
                </tr>
              );
            })}
            {list.length === 0 && (
              <tr>
                <td colSpan={5} className="muted data-table__empty">
                  Aucun client ne correspond.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {form && <CustomerFormModal customer={form.customer} selectOnCreate={false} onClose={() => setForm(null)} />}
    </div>
  );
}
