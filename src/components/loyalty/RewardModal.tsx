import { useState } from 'react';
import { Modal } from '../ui/Modal';
import { Icon } from '../ui/Icon';
import { useAppData, useStore } from '../../state/StoreContext';
import { useToast } from '../ui/Toast';
import { eligibleRewardProducts } from '../../domain/loyalty';
import { formatPrice } from '../../domain/money';
import { ONE_REWARD_PER_ORDER, paidPizzaCount, rewardLineCount, REWARD_NEEDS_PAID_PIZZA } from '../../domain/cart';
import type { RewardKind } from '../../domain/types';

interface RewardModalProps {
  customerName: string;
  onClose: () => void;
}

export function RewardModal({ customerName, onClose }: RewardModalProps) {
  const store = useStore();
  const data = useAppData();
  const toast = useToast();
  const [kind, setKind] = useState<RewardKind>('pizza');
  const [selected, setSelected] = useState<string | null>(null);
  const rules = data.settings.loyalty;
  const products = eligibleRewardProducts(store.catalog, kind, rules);
  const remaining = store.rewardsRemaining();
  const product = selected ? store.product(selected) : undefined;
  const needsPaidPizza = paidPizzaCount(data.cart.lines) === 0;
  const alreadyHasReward = rewardLineCount(data.cart.lines) > 0;

  const confirm = () => {
    if (!product) return;
    const r = store.addReward(kind, product.id);
    if (!r.ok) {
      toast(r.error, 'error');
      return;
    }
    toast(`${product.name} offert ajouté à la commande`, 'success');
    onClose();
  };

  return (
    <Modal
      title="Choisir le cadeau fidélité"
      subtitle={`${customerName} · ${remaining} récompense${remaining > 1 ? 's' : ''} utilisable${remaining > 1 ? 's' : ''}`}
      onClose={onClose}
      size="lg"
      footer={
        <>
          <button type="button" className="btn btn--lg" onClick={onClose}>
            Plus tard
          </button>
          <button type="button" className="btn btn--lg btn--gold" onClick={confirm} disabled={!product || remaining < 1 || needsPaidPizza || alreadyHasReward}>
            <Icon name="gift" /> Ajouter le cadeau
          </button>
        </>
      }
    >
      <div className="segmented reward-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          className="segmented__item"
          aria-selected={kind === 'pizza'}
          onClick={() => {
            setKind('pizza');
            setSelected(null);
          }}
        >
          <Icon name="pizza" /> Pizza offerte
        </button>
        <button
          type="button"
          role="tab"
          className="segmented__item"
          aria-selected={kind === 'boisson'}
          onClick={() => {
            setKind('boisson');
            setSelected(null);
          }}
        >
          <Icon name="cup" /> Grande bouteille
        </button>
      </div>

      {products.length === 0 ? (
        <div className="empty">
          <p className="empty__title">Aucun produit éligible</p>
          <p>Configurez la liste dans Paramètres → Fidélité.</p>
        </div>
      ) : (
        <div className="reward-grid">
          {products.map((p) => (
            <button
              key={p.id}
              type="button"
              className="reward-option"
              aria-pressed={selected === p.id}
              onClick={() => setSelected(p.id)}
            >
              <span className="reward-option__name">{p.name}</span>
              <span className="reward-option__desc">{p.description}</span>
              <span className="reward-option__value">Valeur {formatPrice(p.price)}</span>
              {selected === p.id && (
                <span className="reward-option__check">
                  <Icon name="check" size={16} />
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {alreadyHasReward && (
        <p className="notice notice--error reward-needs-pizza" role="alert">
          {ONE_REWARD_PER_ORDER}
        </p>
      )}
      {needsPaidPizza && (
        <p className="notice notice--error reward-needs-pizza" role="alert">
          {REWARD_NEEDS_PAID_PIZZA} Ajoutez d’abord la pizza achetée par le client.
        </p>
      )}

      <div className="reward-effect">
        <Icon name="info" />
        <div>
          {product ? (
            <p>
              <strong>Effet sur la commande :</strong> + 1 × {product.name} offert (0,00 € au lieu de {formatPrice(product.price)}), en
              plus des produits déjà choisis : aucune pizza de la commande ne devient gratuite.
              {kind === 'pizza' && ' Les suppléments éventuels restent payants.'} La récompense est réservée à l’enregistrement et consommée à
              l’encaissement ; il en restera {remaining - 1}.
            </p>
          ) : (
            <p>Sélectionnez un produit. Une récompense donne droit à un seul cadeau : une pizza ou une grande bouteille.</p>
          )}
          <p className="muted">Non échangeable contre du vin, des boissons alcoolisées, des desserts ou des suppléments.</p>
        </div>
      </div>
    </Modal>
  );
}
