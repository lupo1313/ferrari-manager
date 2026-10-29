import { useState } from 'react';
import { Icon } from '../ui/Icon';
import { formatPrice } from '../../domain/money';
import type { Product } from '../../domain/types';

interface ProductCardProps {
  product: Product;
  quantityInCart: number;
  onAdd: () => void;
  onCustomize?: () => void;
}

export function ProductCard({ product, quantityInCart, onAdd, onCustomize }: ProductCardProps) {
  const [pulse, setPulse] = useState(0);
  const add = () => {
    onAdd();
    setPulse((n) => n + 1);
  };
  return (
    <article className={`product-card ${quantityInCart > 0 ? 'product-card--in-cart' : ''}`}>
      <button type="button" className="product-card__main" onClick={add} aria-label={`Ajouter ${product.name}, ${formatPrice(product.price)}`}>
        <span className="product-card__name">
          {product.name}
          {product.alcohol && <span className="pill pill--muted product-card__tag">Alcool</span>}
        </span>
        {product.description && <span className="product-card__desc">{product.description}</span>}
        <span className="product-card__price price">{formatPrice(product.price)}</span>
      </button>
      <div className="product-card__actions">
        {onCustomize && (
          <button
            type="button"
            className="product-card__options"
            onClick={onCustomize}
            aria-label={`Personnaliser ${product.name}`}
            title="Personnaliser (ingrédients, suppléments, note)"
          >
            <Icon name="pencil" size={18} />
          </button>
        )}
        <button
          key={pulse}
          type="button"
          className={`product-card__add ${pulse ? 'is-pulsing' : ''}`}
          onClick={add}
          aria-label={`Ajouter ${product.name}`}
        >
          <Icon name="plus" size={22} />
        </button>
      </div>
      {quantityInCart > 0 && (
        <span className="product-card__qty" aria-label={`${quantityInCart} dans la commande`}>
          × {quantityInCart}
        </span>
      )}
    </article>
  );
}
