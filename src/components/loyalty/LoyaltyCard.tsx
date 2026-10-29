import { Icon } from '../ui/Icon';
import type { LoyaltyBalance } from '../../domain/loyalty';

interface LoyaltyCardProps {
  balance: LoyaltyBalance;
  pizzasPerReward: number;
  /** Récompenses déjà ajoutées à la commande en cours. */
  rewardsInCart: number;
  /** Récompenses encore ajoutables (peut être 0). */
  remaining: number;
  /** Pizzas payantes de la commande en cours (crédités à la validation). */
  pendingPoints: number;
  onUseReward: () => void;
}

/**
 * Affiche séparément les récompenses disponibles et la progression vers la suivante,
 * pour éviter tout « 10/10 » ambigu.
 */
export function LoyaltyCard({ balance, pizzasPerReward, rewardsInCart, remaining, pendingPoints, onUseReward }: LoyaltyCardProps) {
  const hasReward = balance.available > 0;
  return (
    <section className={`loyalty-card ${hasReward ? 'loyalty-card--ready' : ''}`} aria-label="Fidélité">
      <div className="loyalty-card__head">
        <span className="loyalty-card__icon">
          <Icon name="gift" size={24} />
        </span>
        <div>
          <p className="loyalty-card__title">
            {hasReward
              ? `${balance.available} récompense${balance.available > 1 ? 's' : ''} disponible${balance.available > 1 ? 's' : ''}`
              : 'Aucune récompense disponible'}
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
        <p className="loyalty-card__pending">+{pendingPoints} pizza{pendingPoints > 1 ? 's' : ''} comptée{pendingPoints > 1 ? 's' : ''} à la validation</p>
      )}
      {balance.debt > 0 && (
        <p className="loyalty-card__warn">
          <Icon name="alert" size={16} /> Une récompense a été utilisée sur des points ensuite annulés : la prochaine récompense gagnée la compensera.
        </p>
      )}

      <button type="button" className="btn btn--gold btn--block" onClick={onUseReward} disabled={remaining < 1}>
        <Icon name="gift" size={20} />
        {rewardsInCart > 0 && remaining < 1 ? 'Récompense ajoutée' : 'Utiliser une récompense'}
      </button>
      {rewardsInCart > 0 && (
        <p className="loyalty-card__note">
          {rewardsInCart} récompense{rewardsInCart > 1 ? 's' : ''} dans la commande, consommée{rewardsInCart > 1 ? 's' : ''} à la validation.
        </p>
      )}
    </section>
  );
}
