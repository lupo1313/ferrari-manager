import { useMemo, useState } from 'react';
import { Modal } from '../ui/Modal';
import { Icon } from '../ui/Icon';
import { Stepper } from '../ui/Stepper';
import { useStore } from '../../state/StoreContext';
import { useToast } from '../ui/Toast';
import { formatPrice } from '../../domain/money';
import { lineTotal } from '../../domain/pricing';
import { createLine } from '../../domain/cart';
import type { LineTopping, OrderLine, Product } from '../../domain/types';

const QUICK_NOTES = ['Bien cuite', 'Peu cuite', 'Non coupée', 'Coupée en 8', 'Sauce à part'];

interface CustomizeModalProps {
  product: Product;
  /** Ligne existante à modifier ; sinon, une nouvelle ligne est ajoutée. */
  line?: OrderLine;
  onClose: () => void;
}

export function CustomizeModal({ product, line, onClose }: CustomizeModalProps) {
  const store = useStore();
  const toast = useToast();
  const [removed, setRemoved] = useState<string[]>(line?.removedIngredients ?? []);
  const [toppings, setToppings] = useState<LineTopping[]>(line?.addedToppings ?? []);
  const [quantity, setQuantity] = useState(line?.quantity ?? 1);
  const [note, setNote] = useState(line?.note ?? '');
  const isReward = Boolean(line?.reward);

  const preview = useMemo(() => {
    const draft = createLine(product, 'preview', { quantity, addedToppings: toppings, removedIngredients: removed, note }, line?.reward ?? null);
    // Une ligne existante garde son prix figé.
    return line ? { ...draft, unitPrice: line.unitPrice } : draft;
  }, [product, quantity, toppings, removed, note, line]);

  const toggleIngredient = (ingredient: string) =>
    setRemoved((list) => (list.includes(ingredient) ? list.filter((i) => i !== ingredient) : [...list, ingredient]));

  const toggleTopping = (t: LineTopping) =>
    setToppings((list) => (list.some((x) => x.id === t.id) ? list.filter((x) => x.id !== t.id) : [...list, t]));

  const addQuickNote = (text: string) =>
    setNote((current) => (current.toLowerCase().includes(text.toLowerCase()) ? current : current ? `${current}, ${text}` : text));

  const save = () => {
    const options = { quantity, addedToppings: toppings, removedIngredients: removed, note };
    const r = line ? store.updateLine(line.id, options) : store.addConfiguredLine(product.id, options);
    if (!r.ok) {
      toast(r.error, 'error');
      return;
    }
    toast(line ? `${product.name} modifiée` : `${quantity} × ${product.name} ajoutée`, 'success');
    onClose();
  };

  return (
    <Modal
      title={product.name}
      subtitle={isReward ? 'Pizza offerte (fidélité) · les suppléments restent payants' : `Prix de base ${formatPrice(line?.unitPrice ?? product.price)}`}
      onClose={onClose}
      size="lg"
      footer={
        <>
          {!isReward && <Stepper value={quantity} onChange={setQuantity} label="quantité" />}
          <button type="button" className="btn btn--lg btn--success customize__save" onClick={save} data-autofocus>
            <Icon name={line ? 'check' : 'plus'} />
            {line ? 'Enregistrer' : 'Ajouter'} · {formatPrice(lineTotal(preview))}
          </button>
        </>
      }
    >
      {product.ingredients && product.ingredients.length > 0 && (
        <section className="customize__section">
          <h3 className="customize__title">
            Ingrédients <span className="muted">· toucher pour retirer (sans changement de prix)</span>
          </h3>
          <div className="chip-grid">
            {product.ingredients.map((ingredient) => {
              const isRemoved = removed.includes(ingredient);
              return (
                <button
                  key={ingredient}
                  type="button"
                  className={`chip ${isRemoved ? 'chip--removed' : ''}`}
                  aria-pressed={isRemoved}
                  onClick={() => toggleIngredient(ingredient)}
                >
                  {isRemoved ? <Icon name="close" size={16} /> : <Icon name="check" size={16} />}
                  {isRemoved ? `Sans ${ingredient.toLowerCase()}` : ingredient}
                </button>
              );
            })}
          </div>
        </section>
      )}

      <section className="customize__section">
        <h3 className="customize__title">Suppléments</h3>
        <div className="chip-grid chip-grid--toppings">
          {store.catalog.toppings.map((t) => {
            const active = toppings.some((x) => x.id === t.id);
            return (
              <button
                key={t.id}
                type="button"
                className={`chip chip--topping ${active ? 'chip--active' : ''}`}
                aria-pressed={active}
                onClick={() => toggleTopping({ id: t.id, name: t.name, price: t.price })}
              >
                <span>{t.name}</span>
                <span className="price">+{formatPrice(t.price)}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="customize__section">
        <h3 className="customize__title">Note de préparation</h3>
        <div className="chip-grid">
          {QUICK_NOTES.map((n) => (
            <button key={n} type="button" className="chip chip--ghost" onClick={() => addQuickNote(n)}>
              <Icon name="plus" size={14} /> {n}
            </button>
          ))}
        </div>
        <textarea
          className="textarea"
          value={note}
          onChange={(e) => setNote(e.target.value.slice(0, 160))}
          placeholder="Ex. : bien cuite, coupée en 8…"
          rows={2}
        />
      </section>
    </Modal>
  );
}
