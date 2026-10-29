import { Icon } from '../ui/Icon';
import type { LoyaltyBalance } from '../../domain/loyalty';

interface LoyaltyCardProps {
  balance: LoyaltyBalance;
  pizzasPerReward: number;
  /** Récompenses déjà ajoutées à la commande en cours. */
  rewardsInCart: number;
  /** Récompenses encore ajoutables (peut être 0). */
  remaining: number;
  /** Pizzas payantes de la commande en cours (créditées à l'encaissement). */
  pendingPoints: number;
  /** Récompenses prises par d'autres commandes enregistrées, pas encore encaissées. */
  reserved: number;
  reservingOrders: number[];
  /** Pizzas des autres commandes enregistrées, en attente d'encaissement. */
  pendingPizzas: number;
  /** Aucune pizza payante dans la commande en cours : le cadeau n'est pas encore utilisable. */
  needsPaidPizza: boolean;
  onUseReward: () => void;
}

const s = (n: number) => (n > 1 ? 's' : '');

/**
 * Affiche séparément les récompenses disponibles, réservées et la progression vers la suivante,
 * pour éviter tout « 10/10 » ambigu.
 */
export function LoyaltyCard({
  balance,
  pizzasPerReward,
  rewardsInCart,
  remaining,
  pendingPoints,
  reserved,
  reservingOrders,
  pendingPizzas,
  needsPaidPizza,
  onUseReward,
}: LoyaltyCardProps) {
  const hasReward = balance.available > 0;
  const canUse = remaining >= 1 && !needsPaidPizza;
  return (
    <section className={`loyalty-card ${hasReward ? 'loyalty-card--ready' : ''}`} aria-label="Fidélité">
      <div className="loyalty-card__head">
        <span className="loyalty-card__icon">
          <Icon name="gift" size={24} />
        </span>
        <div>
          <p className="loyalty-card__title">
            {hasReward ? `${balance.available} récompense${s(balance.available)} disponible${s(balance.available)}` : 'Aucune récompense disponible'}
          </p>
          <p className="loyalty-card__sub">
            {balance.progress} / {pizzasPerReward} pizzas vers la prochaine
          </p>
        </div>
      </div>

      <div
        className="loyalty-card__bar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={pizzasPerReward}
        aria-valuenow={balance.progress}
        aria-label="Progression vers la prochaine récompense"
      >
        {Array.from({ length: pizzasPerReward }, (_, i) => (
          <span key={i} className={i < balance.progress ? 'is-on' : ''} />
        ))}
      </div>

      {pendingPoints > 0 && (
        <p className="loyalty-card__pending">
          +{pendingPoints} pizza{s(pendingPoints)} comptée{s(pendingPoints)} à l’encaissement
        </p>
      )}
      {pendingPizzas > 0 && (
        <p className="loyalty-card__note">
          {pendingPizzas} pizza{s(pendingPizzas)} d’autres commandes en attente d’encaissement
        </p>
      )}
      {reserved > 0 && (
        <p className="loyalty-card__note">
          {reserved} récompense{s(reserved)} réservée{s(reserved)} (n° {reservingOrders.join(', ')}, non encaissée{s(reservingOrders.length)})
        </p>
      )}
      {balance.debt > 0 && (
        <p className="loyalty-card__warn">
          <Icon name="alert" size={16} /> Une récompense a été utilisée sur des points ensuite annulés : la prochaine récompense gagnée la compensera.
        </p>
      )}

      <button type="button" className="btn btn--gold btn--block" onClick={onUseReward} disabled={!canUse}>
        <Icon name="gift" size={20} />
        {rewardsInCart > 0 && remaining < 1 ? 'Récompense ajoutée' : 'Utiliser une récompense'}
      </button>
      {remaining >= 1 && needsPaidPizza && (
        <p className="loyalty-card__note">Ajoutez d’abord une pizza payante : le cadeau s’ajoute à un achat.</p>
      )}
      {rewardsInCart > 0 && (
        <p className="loyalty-card__note">
          {rewardsInCart} récompense{s(rewardsInCart)} dans la commande : réservée{s(rewardsInCart)} à l’enregistrement, consommée
          {s(rewardsInCart)} à l’encaissement.
        </p>
      )}
    </section>
  );
}
