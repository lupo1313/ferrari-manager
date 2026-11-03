import { useMemo, useRef, useState } from 'react';
import { Icon } from '../components/ui/Icon';
import { CustomerFormModal } from '../components/customer/CustomerFormModal';
import { useOrderForCustomer } from '../components/order/EditInProgressDialog';
import { useAppData } from '../state/StoreContext';
import { customerFullName, formatPhone, searchCustomers } from '../domain/customers';
import { computeBalance } from '../domain/loyalty';
import { buildCustomersCsv, customersCsvFilename } from '../domain/customersCsv';
import { analyzeCustomersCsv, IMPORT_MAX_BYTES, type ImportAnalysis } from '../domain/customersImport';
import { CustomerImportDialog } from '../components/customer/CustomerImportDialog';
import type { Customer } from '../domain/types';

export function ClientsPage({ onGoToOrderTaking }: { onGoToOrderTaking: () => void }) {
  const data = useAppData();
  const [query, setQuery] = useState('');
  const [form, setForm] = useState<{ customer?: Customer } | null>(null);
  const rules = data.settings.loyalty;
  const orderFor = useOrderForCustomer(onGoToOrderTaking);
  const fileInput = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState<{ fileName: string; analysis: ImportAnalysis } | null>(null);

  const list = useMemo(() => {
    const base = query.trim() ? searchCustomers(data.customers, query, 200) : data.customers;
    return [...base].sort((a, b) => customerFullName(a).localeCompare(customerFullName(b), 'fr'));
  }, [data.customers, query]);

  /** Tous les clients enregistrés (jamais le filtre de recherche), téléchargés localement : aucune donnée modifiée. */
  const exportCustomers = () => {
    const url = URL.createObjectURL(new Blob([buildCustomersCsv(data.customers)], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = customersCsvFilename(new Date());
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  /** Lecture locale du fichier choisi, puis récapitulatif : rien n'est enregistré avant la confirmation. */
  const chooseFile = async (file: File | undefined) => {
    if (!file) return;
    let analysis: ImportAnalysis;
    try {
      analysis =
        file.size > IMPORT_MAX_BYTES
          ? analyzeCustomersCsv('', [], file.size)
          : analyzeCustomersCsv(await file.text(), data.customers, file.size);
    } catch {
      analysis = analyzeCustomersCsv('\uFFFD', []);
    }
    setImporting({ fileName: file.name, analysis });
  };

  return (
    <div className="page">
      <header className="page__header">
        <div>
          <h1 className="page__title">Clients</h1>
          <p className="muted">{data.customers.length} fiches (fictives). Un numéro de téléphone = une fiche.</p>
        </div>
        <div className="page__actions">
          <button type="button" className="btn" onClick={exportCustomers} disabled={data.customers.length === 0}>
            <Icon name="file" /> Exporter les clients
          </button>
          <button type="button" className="btn" onClick={() => fileInput.current?.click()}>
            <Icon name="refresh" /> Importer les clients
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            tabIndex={-1}
            aria-label="Fichier CSV des clients"
            onChange={(e) => {
              void chooseFile(e.target.files?.[0]);
              e.target.value = ''; // permet de rechoisir le même fichier
            }}
          />
          <button type="button" className="btn btn--primary" onClick={() => setForm({})}>
            <Icon name="plus" /> Nouveau client
          </button>
        </div>
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
                      onClick={() => orderFor.request(c)}
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

      {orderFor.dialog}
      {importing && <CustomerImportDialog fileName={importing.fileName} analysis={importing.analysis} onClose={() => setImporting(null)} />}
      {form && <CustomerFormModal customer={form.customer} selectOnCreate={false} onClose={() => setForm(null)} />}
    </div>
  );
}
