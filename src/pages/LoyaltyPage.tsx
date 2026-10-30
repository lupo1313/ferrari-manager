import { useAppData, useStore } from '../state/StoreContext';
import { computeBalance, customerLoyaltyStatus, eligibleRewardProducts, LOYALTY_REASON_LABELS } from '../domain/loyalty';
import { customerFullName } from '../domain/customers';
import { formatDateTime } from '../domain/time';
import { Icon } from '../components/ui/Icon';

export function LoyaltyPage() {
  const store = useStore();
  const data = useAppData();
  const rules = data.settings.loyalty;
  const nameOf = (id: string) => {
    const c = data.customers.find((x) => x.id === id);
    return c ? customerFullName(c) : 'Client supprimé';
  };
  const journal = [...data.loyaltyEvents].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 150);
  const pizzas = eligibleRewardProducts(store.catalog, 'pizza', rules);
  const drinks = eligibleRewardProducts(store.catalog, 'boisson', rules);

  return (
    <div className="page">
      <header className="page__header">
        <div>
          <h1 className="page__title">Fidélité</h1>
          <p className="muted">Soldes recalculés à partir du journal. Rien n’est modifié à la main.</p>
        </div>
      </header>

      <div className="loyalty-layout">
        <section className="card rules-card">
          <h2 className="card__title">
            <Icon name="gift" /> Règle du programme
          </h2>
          <p className="rules-card__rule">
            <strong>{rules.pizzasPerReward} pizzas payantes</strong> = 1 récompense
          </p>
          <ul className="rules-list">
            <li>Pizzas payantes créditées à l’encaissement de la commande, retirées si elle est annulée.</li>
            <li>Une pizza offerte ne rapporte aucun point.</li>
            <li>Le cadeau s’ajoute à une commande contenant au moins une pizza payante.</li>
            <li>La récompense se garde : elle n’est utilisée que sur choix explicite, réservée à l’enregistrement, consommée à l’encaissement.</li>
            <li>Exclus : vin, boissons alcoolisées, desserts, suppléments.</li>
          </ul>
          <h3 className="card__subtitle">Pizzas éligibles</h3>
          <p>{pizzas.map((p) => p.name).join(', ') || 'Aucune'}</p>
          <h3 className="card__subtitle">Grandes bouteilles éligibles</h3>
          <p>{drinks.map((p) => p.name).join(', ') || 'Aucune'}</p>
          <p className="muted rules-card__foot">Listes modifiables dans Paramètres.</p>
        </section>

        <section className="table-card">
          <h2 className="card__title table-card__title">Soldes clients</h2>
          <table className="data-table">
            <thead>
              <tr>
                <th>Client</th>
                <th>Pizzas comptées</th>
                <th>Prochaine récompense</th>
                <th>En attente d’encaissement</th>
                <th>Disponibles</th>
                <th>Réservées</th>
                <th>Utilisées</th>
              </tr>
            </thead>
            <tbody>
              {data.customers.map((c) => {
                const b = computeBalance(data.loyaltyEvents, c.id, rules);
                const st = customerLoyaltyStatus(data.loyaltyEvents, data.orders, c.id);
                return (
                  <tr key={c.id}>
                    <td className="data-table__strong">{customerFullName(c)}</td>
                    <td>{b.totalPoints}</td>
                    <td>
                      {b.progress}/{rules.pizzasPerReward} <span className="muted">(encore {b.pointsToNext})</span>
                    </td>
                    <td>{st.pendingPizzas > 0 ? `${st.pendingPizzas} pizza${st.pendingPizzas > 1 ? 's' : ''}` : '—'}</td>
                    <td>{b.available > 0 ? <span className="pill pill--gold">{b.available}</span> : '0'}</td>
                    <td>{st.reserved > 0 ? `${st.reserved} (n° ${st.reservingOrders.join(', ')})` : '0'}</td>
                    <td>
                      {b.rewardsUsed - st.reserved}
                      {b.debt > 0 && <span className="pill pill--muted"> dette {b.debt}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      </div>

      <section className="table-card">
        <h2 className="card__title table-card__title">Journal des événements (test)</h2>
        <table className="data-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Client</th>
              <th>Événement</th>
              <th>Origine</th>
              <th>Variation</th>
            </tr>
          </thead>
          <tbody>
            {journal.map((e) => (
              <tr key={e.id}>
                <td>{formatDateTime(e.at)}</td>
                <td>{nameOf(e.customerId)}</td>
                <td>{LOYALTY_REASON_LABELS[e.reason]}</td>
                <td className="muted">{e.label ?? '—'}</td>
                <td className={`delta ${e.type === 'points' ? (e.delta > 0 ? 'delta--up' : 'delta--down') : e.delta > 0 ? 'delta--down' : 'delta--up'}`}>
                  {e.type === 'points'
                    ? `${e.delta > 0 ? '+' : ''}${e.delta} pizza${Math.abs(e.delta) > 1 ? 's' : ''}`
                    : `${e.delta > 0 ? '−' : '+'}${Math.abs(e.delta)} récompense`}
                </td>
              </tr>
            ))}
            {journal.length === 0 && (
              <tr>
                <td colSpan={5} className="muted data-table__empty">
                  Aucun événement.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
