import { memo, useEffect, useMemo, useState } from 'react';
import { Icon } from '../ui/Icon';
import { useAppSelector, useStore } from '../../state/StoreContext';
import { useToast } from '../ui/Toast';
import { CustomerFormModal } from './CustomerFormModal';
import { LoyaltyCard } from '../loyalty/LoyaltyCard';
import { RewardModal } from '../loyalty/RewardModal';
import {
  customerFullName,
  formatPhone,
  hasDeliveryAddress,
  isValidPhone,
  normalizePhone,
  searchCustomers,
} from '../../domain/customers';
import { computeBalance, countEarningPizzas, customerLoyaltyStatus } from '../../domain/loyalty';
import { paidPizzaCount, rewardLineCount } from '../../domain/cart';
import { isPaid } from '../../domain/payment';
import { formatPrice } from '../../domain/money';
import { formatDate } from '../../domain/time';
import { STATUS_LABELS } from '../../domain/orders';
import type { Customer } from '../../domain/types';

type FormState = { mode: 'create'; phone?: string } | { mode: 'edit'; customer: Customer } | null;

/** memo + sélection fine : la saisie de la note de commande ne re-rend pas la colonne client. */
export const CustomerPanel = memo(function CustomerPanel() {
  const store = useStore();
  const customers = useAppSelector((d) => d.customers);
  const customerId = useAppSelector((d) => d.cart.customerId);
  // Modification d'une commande : le client reste celui de la commande (pas de recherche ni de changement).
  const editingNumber = useAppSelector((d) => (d.cart.editingOrderId ? d.orders.find((o) => o.id === d.cart.editingOrderId)?.number ?? null : null));
  const locked = editingNumber !== null;
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [keyboard, setKeyboard] = useState<'tel' | 'text'>('tel');
  const [form, setForm] = useState<FormState>(null);
  const [rewardOpen, setRewardOpen] = useState(false);

  const customer = customerId ? customers.find((c) => c.id === customerId) ?? null : null;
  const results = useMemo(() => searchCustomers(customers, query), [customers, query]);
  const normalizedQuery = normalizePhone(query);
  const canCreateFromQuery = /^[\d\s.+-]+$/.test(query.trim()) && isValidPhone(normalizedQuery) && results.length === 0;

  const select = (c: Customer) => {
    const r = store.selectCustomer(c.id);
    if (r.ok && r.value.removedRewards > 0) toast('Les récompenses du client précédent ont été retirées de la commande.', 'info');
    if (r.ok && r.value.addressReset) toast('Adresse ponctuelle retirée : adresse habituelle du nouveau client utilisée.', 'info');
    setQuery('');
  };

  const submitSearch = () => {
    if (results.length === 1) select(results[0]);
    else if (canCreateFromQuery) setForm({ mode: 'create', phone: query });
  };

  return (
    <section className="panel customer-panel" aria-label="Client">
      <header className="panel__header">
        <h2 className="panel__title">
          <Icon name="user" size={22} /> Client
        </h2>
        {!locked && (
          <button type="button" className="btn btn--sm" onClick={() => setForm({ mode: 'create' })}>
            <Icon name="plus" size={18} /> Nouveau client
          </button>
        )}
      </header>

      <div className="panel__body scroll-y">
        {locked ? (
          <p className="notice customer-locked" role="status">
            <Icon name="pencil" size={18} />
            <span>
              Client de la commande n° {editingNumber}, conservé pendant la modification. Pour servir un autre client, enregistrez ou
              abandonnez d’abord la modification.
            </span>
          </p>
        ) : (
          <>
            <form
              className="customer-search"
              role="search"
              onSubmit={(e) => {
                e.preventDefault();
                submitSearch();
              }}
            >
              <div className="customer-search__field">
                <Icon name={keyboard === 'tel' ? 'phone' : 'user'} size={18} />
                <input
                  className="customer-search__input"
                  type="search"
                  inputMode={keyboard}
                  placeholder={keyboard === 'tel' ? 'Téléphone' : 'Nom du client'}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  aria-label="Rechercher un client par téléphone ou par nom"
                  autoComplete="off"
                  enterKeyHint="search"
                />
                {query && (
                  <button type="button" className="customer-search__clear" onClick={() => setQuery('')} aria-label="Effacer">
                    <Icon name="close" size={18} />
                  </button>
                )}
              </div>
              <button type="submit" className="customer-search__go" aria-label="Rechercher">
                <Icon name="search" />
              </button>
            </form>
            <div className="customer-search__modes" role="group" aria-label="Type de recherche">
              <button type="button" aria-pressed={keyboard === 'tel'} onClick={() => setKeyboard('tel')}>
                Par téléphone
              </button>
              <button type="button" aria-pressed={keyboard === 'text'} onClick={() => setKeyboard('text')}>
                Par nom
              </button>
            </div>

            {query.trim() && (
              <div className="customer-results">
                {results.map((c) => (
                  <button key={c.id} type="button" className="customer-result" onClick={() => select(c)}>
                    <span className="customer-result__name">{customerFullName(c)}</span>
                    <span className="customer-result__meta">
                      {formatPhone(c.phone)}
                      {c.address && ` · ${c.address}`}
                    </span>
                  </button>
                ))}
                {results.length === 0 && (
                  <div className="customer-results__empty">
                    <p>Aucun client trouvé.</p>
                    {canCreateFromQuery && (
                      <button type="button" className="btn btn--sm btn--dark" onClick={() => setForm({ mode: 'create', phone: query })}>
                        <Icon name="plus" size={18} /> Créer une fiche avec ce numéro
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {customer ? (
          <SelectedCustomer
            key={customer.id}
            customer={customer}
            locked={locked}
            onEdit={() => setForm({ mode: 'edit', customer })}
            onUseReward={() => setRewardOpen(true)}
          />
        ) : (
          !query.trim() && <CounterState />
        )}
      </div>

      {form && (
        <CustomerFormModal
          customer={form.mode === 'edit' ? form.customer : undefined}
          initialPhone={form.mode === 'create' ? form.phone : undefined}
          onClose={() => setForm(null)}
          onSaved={() => setQuery('')}
        />
      )}
      {rewardOpen && customer && <RewardModal customerName={customerFullName(customer)} onClose={() => setRewardOpen(false)} />}
    </section>
  );
});

function CounterState() {
  const store = useStore();
  const counterName = useAppSelector((d) => d.cart.counterName);
  return (
    <div className="counter-state">
      <div className="empty">
        <span className="empty__icon">
          <Icon name="store" size={26} />
        </span>
        <p className="empty__title">Aucun client sélectionné</p>
        <p>Recherchez par téléphone ou par nom. Sans fiche, la commande est enregistrée au comptoir (à emporter, sans fidélité).</p>
      </div>
      <label className="field">
        <span className="field__label">Nom pour le comptoir (facultatif)</span>
        <input
          className="input"
          value={counterName}
          onChange={(e) => store.setCounterName(e.target.value)}
          placeholder="Ex. : Paul"
          autoComplete="off"
        />
      </label>
    </div>
  );
}

interface SelectedCustomerProps {
  customer: Customer;
  /** Modification en cours : le client ne peut pas être retiré de la commande. */
  locked: boolean;
  onEdit: () => void;
  onUseReward: () => void;
}

function SelectedCustomer({ customer, locked, onEdit, onUseReward }: SelectedCustomerProps) {
  const store = useStore();
  const settings = useAppSelector((d) => d.settings);
  const loyaltyEvents = useAppSelector((d) => d.loyaltyEvents);
  const orders = useAppSelector((d) => d.orders);
  const lines = useAppSelector((d) => d.cart.lines);
  const editingOrderId = useAppSelector((d) => d.cart.editingOrderId);
  const toast = useToast();
  const [tab, setTab] = useState<'infos' | 'historique'>('infos');
  const [notes, setNotes] = useState(customer.instructions);
  useEffect(() => setNotes(customer.instructions), [customer.instructions]);

  const rules = settings.loyalty;
  const balance = computeBalance(loyaltyEvents, customer.id, rules);
  const rewardsInCart = rewardLineCount(lines);
  const remaining = store.rewardsRemaining();
  const editedOrder = editingOrderId ? orders.find((o) => o.id === editingOrderId) : undefined;
  // Commande encaissée en cours de modification : l'écart est crédité à l'enregistrement, pas « à l'encaissement ».
  const pendingPoints = editedOrder && isPaid(editedOrder) ? 0 : countEarningPizzas(lines);
  // Autres commandes du client : la commande en cours de modification est représentée par le panier.
  const status = customerLoyaltyStatus(
    loyaltyEvents,
    orders.filter((o) => o.id !== editingOrderId),
    customer.id,
  );
  const history = orders
    .filter((o) => o.customerId === customer.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 6);
  const notesDirty = notes.trim() !== customer.instructions;

  return (
    <>
      <article className="customer-card">
        <div className="customer-card__top">
          <div>
            <h3 className="customer-card__name">
              {customerFullName(customer)}
              {balance.rewardsEarned > 0 && <Icon name="star" size={18} className="customer-card__star" aria-label="Client fidèle" />}
            </h3>
            <a className="customer-card__phone" href={`tel:${customer.phone}`}>
              <Icon name="phone" size={16} /> {formatPhone(customer.phone)}
            </a>
          </div>
          <div className="customer-card__actions">
            <button type="button" className="icon-btn" onClick={onEdit} aria-label="Modifier la fiche">
              <Icon name="pencil" />
            </button>
            {!locked && (
              <button type="button" className="icon-btn" onClick={() => store.selectCustomer(null)} aria-label="Retirer le client de la commande">
                <Icon name="close" />
              </button>
            )}
          </div>
        </div>

        <div className="tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'infos'} onClick={() => setTab('infos')}>
            Infos
          </button>
          <button type="button" role="tab" aria-selected={tab === 'historique'} onClick={() => setTab('historique')}>
            Historique ({orders.filter((o) => o.customerId === customer.id).length})
          </button>
        </div>

        {tab === 'infos' ? (
          <div className="customer-card__infos">
            {hasDeliveryAddress(customer) ? (
              <p className="info-row">
                <Icon name="pin" size={18} />
                <span>
                  {customer.address}
                  <br />
                  {customer.postalCode} {customer.city}
                </span>
              </p>
            ) : (
              <p className="info-row info-row--muted">
                <Icon name="pin" size={18} />
                <span>Pas d’adresse : livraison impossible sans compléter la fiche.</span>
              </p>
            )}
            {customer.complement && (
              <p className="info-row">
                <Icon name="building" size={18} />
                <span>{customer.complement}</span>
              </p>
            )}
          </div>
        ) : (
          <ul className="customer-history">
            {history.length === 0 && <li className="muted">Aucune commande enregistrée.</li>}
            {history.map((o) => (
              <li key={o.id}>
                <span>
                  {formatDate(o.createdAt)} · n° {o.number}
                </span>
                <span className={`status-dot status-dot--${o.status}`}>{STATUS_LABELS[o.status]}</span>
                <span className="price">{formatPrice(o.totals.total)}</span>
              </li>
            ))}
          </ul>
        )}
      </article>

      <LoyaltyCard
        balance={balance}
        pizzasPerReward={rules.pizzasPerReward}
        rewardsInCart={rewardsInCart}
        remaining={remaining}
        pendingPoints={pendingPoints}
        reserved={status.reserved}
        reservingOrders={status.reservingOrders}
        pendingPizzas={status.pendingPizzas}
        needsPaidPizza={paidPizzaCount(lines) === 0}
        onUseReward={onUseReward}
      />

      <section className="client-notes">
        <h3 className="client-notes__title">
          <Icon name="pencil" size={18} /> Notes client
        </h3>
        <textarea
          className="textarea"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Instructions de livraison, préférences…"
          rows={2}
          maxLength={300}
        />
        {notesDirty && (
          <div className="client-notes__actions">
            <button type="button" className="btn btn--sm btn--ghost" onClick={() => setNotes(customer.instructions)}>
              Annuler
            </button>
            <button
              type="button"
              className="btn btn--sm btn--dark"
              onClick={() => {
                const r = store.updateCustomerInstructions(customer.id, notes);
                toast(r.ok ? 'Note client enregistrée' : r.error, r.ok ? 'success' : 'error');
              }}
            >
              Enregistrer la note
            </button>
          </div>
        )}
      </section>
    </>
  );
}
