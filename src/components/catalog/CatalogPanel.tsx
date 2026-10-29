import { useState, type ReactNode } from 'react';
import { Icon, type IconName } from '../ui/Icon';
import { useAppData, useStore } from '../../state/StoreContext';
import { useToast } from '../ui/Toast';
import { ProductCard } from './ProductCard';
import { CustomizeModal } from './CustomizeModal';
import { ToppingTargetModal } from './ToppingTargetModal';
import { quantityOfProduct } from '../../domain/cart';
import { formatPrice } from '../../domain/money';
import type { PizzaTag, Product, Topping } from '../../domain/types';

type CategoryId = 'toutes' | PizzaTag | 'desserts' | 'boissons' | 'supplements';

const CATEGORIES: { id: CategoryId; label: string; icon: IconName }[] = [
  { id: 'toutes', label: 'Toutes', icon: 'pizza' },
  { id: 'classique', label: 'Classiques', icon: 'star' },
  { id: 'speciale', label: 'Spéciales', icon: 'crown' },
  { id: 'blanche', label: 'Blanches', icon: 'drop' },
  { id: 'viande', label: 'Viandes', icon: 'meat' },
  { id: 'vegetarienne', label: 'Végétariennes', icon: 'leaf' },
  { id: 'desserts', label: 'Desserts', icon: 'cake' },
  { id: 'boissons', label: 'Boissons', icon: 'cup' },
  { id: 'supplements', label: 'Suppléments', icon: 'plusCircle' },
];

const STRIP_SIZE = 5;

export function CatalogPanel() {
  const store = useStore();
  const data = useAppData();
  const toast = useToast();
  const [category, setCategory] = useState<CategoryId>('toutes');
  const [customizing, setCustomizing] = useState<Product | null>(null);
  const [toppingTarget, setToppingTarget] = useState<Topping | null>(null);

  const products = store.catalog.products;
  const pizzas = products.filter((p) => p.category === 'pizza');
  const drinks = products.filter((p) => p.category === 'boisson');
  const desserts = products.filter((p) => p.category === 'dessert');
  const lines = data.cart.lines;
  const pizzaLines = lines.filter((l) => l.category === 'pizza');

  const add = (p: Product) => {
    const r = store.addProduct(p.id);
    if (!r.ok) toast(r.error, 'error');
  };

  const applyTopping = (t: Topping) => {
    if (pizzaLines.length === 0) {
      toast('Ajoutez d’abord une pizza pour lui appliquer un supplément.', 'info');
      return;
    }
    if (pizzaLines.length === 1) {
      const line = pizzaLines[0];
      if (line.addedToppings.some((x) => x.id === t.id)) {
        toast(`${t.name} est déjà sur ${line.name}.`, 'info');
        return;
      }
      store.addToppingToLine(line.id, t.id);
      toast(`${t.name} ajouté sur ${line.name}`, 'success');
      return;
    }
    setToppingTarget(t);
  };

  const grid = (items: Product[]) => (
    <div className="product-grid">
      {items.map((p) => (
        <ProductCard
          key={p.id}
          product={p}
          quantityInCart={quantityOfProduct(lines, p.id)}
          onAdd={() => add(p)}
          onCustomize={p.category === 'pizza' ? () => setCustomizing(p) : undefined}
        />
      ))}
    </div>
  );

  const toppingChips = (items: Topping[]) =>
    items.map((t) => (
      <button key={t.id} type="button" className="mini-card" onClick={() => applyTopping(t)}>
        <span className="mini-card__name">{t.name}</span>
        <span className="mini-card__price price">{formatPrice(t.price)}</span>
      </button>
    ));

  const productChips = (items: Product[]) =>
    items.map((p) => {
      const qty = quantityOfProduct(lines, p.id);
      return (
        <button key={p.id} type="button" className={`mini-card ${qty ? 'mini-card--in-cart' : ''}`} onClick={() => add(p)}>
          <span className="mini-card__name">{p.name}</span>
          <span className="mini-card__price price">{formatPrice(p.price)}</span>
          {qty > 0 && <span className="mini-card__qty">× {qty}</span>}
        </button>
      );
    });

  const seeAll = (target: CategoryId) => (
    <button type="button" className="mini-card mini-card--more" onClick={() => setCategory(target)}>
      Voir tout <Icon name="chevronRight" size={18} />
    </button>
  );

  const section = (title: string, icon: IconName, content: ReactNode, hint?: string) => (
    <section className="catalog-section">
      <h3 className="catalog-section__title">
        <Icon name={icon} size={22} /> {title}
        {hint && <span className="catalog-section__hint">{hint}</span>}
      </h3>
      {content}
    </section>
  );

  const TOPPING_HINT = 'Touchez pour ajouter sur une pizza de la commande';

  let content: ReactNode;
  switch (category) {
    case 'toutes':
      content = (
        <>
          {section('Nos pizzas', 'pizza', grid(pizzas))}
          {section(
            'Suppléments',
            'plusCircle',
            <div className="mini-strip">
              {toppingChips(store.catalog.toppings.slice(0, STRIP_SIZE))}
              {seeAll('supplements')}
            </div>,
            TOPPING_HINT,
          )}
          {section(
            'Boissons',
            'cup',
            <div className="mini-strip">
              {productChips(drinks.slice(0, STRIP_SIZE))}
              {seeAll('boissons')}
            </div>,
          )}
          {section(
            'Desserts',
            'cake',
            <div className="mini-strip">
              {productChips(desserts.slice(0, STRIP_SIZE))}
              {desserts.length > STRIP_SIZE && seeAll('desserts')}
            </div>,
          )}
        </>
      );
      break;
    case 'boissons':
      content = section('Boissons', 'cup', grid(drinks));
      break;
    case 'desserts':
      content = section('Desserts', 'cake', grid(desserts));
      break;
    case 'supplements':
      content = section('Suppléments', 'plusCircle', <div className="mini-grid">{toppingChips(store.catalog.toppings)}</div>, TOPPING_HINT);
      break;
    default: {
      const label = CATEGORIES.find((c) => c.id === category)?.label ?? '';
      content = section(`Pizzas · ${label}`, 'pizza', grid(pizzas.filter((p) => p.tags?.includes(category))));
    }
  }

  return (
    <section className="panel catalog-panel" aria-label="Catalogue">
      <div className="category-tabs" role="tablist" aria-label="Catégories">
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            type="button"
            role="tab"
            className="category-tab"
            aria-selected={category === c.id}
            onClick={() => setCategory(c.id)}
          >
            <Icon name={c.icon} size={22} />
            <span>{c.label}</span>
          </button>
        ))}
      </div>
      <div className="panel__body scroll-y catalog-panel__body">{content}</div>

      {customizing && <CustomizeModal product={customizing} onClose={() => setCustomizing(null)} />}
      {toppingTarget && <ToppingTargetModal topping={toppingTarget} pizzaLines={pizzaLines} onClose={() => setToppingTarget(null)} />}
    </section>
  );
}
