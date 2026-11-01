import { useMemo, useState } from 'react';
import { Modal } from '../ui/Modal';
import { Icon } from '../ui/Icon';
import { Stepper } from '../ui/Stepper';
import { unavailableTopping } from '../../domain/toppings';
import { useCatalog, useStore } from '../../state/StoreContext';
import { useToast } from '../ui/Toast';
import { formatPrice } from '../../domain/money';
import { lineTotal } from '../../domain/pricing';
import { createLine, lineIngredients } from '../../domain/cart';
import { isActive } from '../../domain/catalog';
import type { LineTopping, OrderLine, Product } from '../../domain/types';

const QUICK_NOTES = ['Bien cuite', 'Peu cuite', 'Non coupée', 'Coupée en 8', 'Sauce à part'];

type CustomizeModalProps =
  /** Nouvelle ligne à partir de la fiche actuelle. */
  | { product: Product; line?: undefined; onClose: () => void }
  /**
   * Ligne existante : modifiée à partir d'ELLE-MÊME (nom, prix, catégorie, composition figés), même si la
   * fiche a changé, a été désactivée ou retirée. `product` ne sert qu'aux anciennes lignes sans composition.
   */
  | { product?: Product; line: OrderLine; onClose: () => void };

export function CustomizeModal({ product, line, onClose }: CustomizeModalProps) {
  const title = line ? line.name : product.name;
  const ingredients = line ? lineIngredients(line, product) : product.ingredients ?? [];
  const store = useStore();
  const toast = useToast();
  const catalog = useCatalog();
  const [removed, setRemoved] = useState<string[]>(line?.removedIngredients ?? []);
  const [toppings, setToppings] = useState<LineTopping[]>(line?.addedToppings ?? []);
  const [quantity, setQuantity] = useState(line?.quantity ?? 1);
  const [note, setNote] = useState(line?.note ?? '');
  const isReward = Boolean(line?.reward);
  // Ligne existante d'un produit désactivé, absent ou d'une carte illisible : quantité non augmentable
  // (augmenter serait une nouvelle sélection, refusée aussi par le store) ; diminuer reste possible.
  const canIncrease = !line || (!store.getCatalogError() && product !== undefined && isActive(product) && !unavailableTopping({ addedToppings: toppings }, catalog.toppings));
  // Copies déjà choisies en priorité : jamais de changement visuel de nom/prix lors d'une modification de fiche.
  const toppingChoices = [...(store.getCatalogError() ? [] : catalog.toppings.filter(isActive)).map((t) => toppings.find((x) => x.id === t.id) ?? t),
    ...toppings.filter((t) => store.getCatalogError() || !catalog.toppings.some((current) => current.id === t.id && isActive(current)))];

  const preview = useMemo(
    () =>
      line
        ? { ...line, quantity, addedToppings: toppings, removedIngredients: removed, note }
        : createLine(product, 'preview', { quantity, addedToppings: toppings, removedIngredients: removed, note }),
    [product, quantity, toppings, removed, note, line],
  );

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
    toast(line ? `${title} modifiée` : `${quantity} × ${title} ajoutée`, 'success');
    onClose();
  };

  return (
    <Modal
      title={title}
      subtitle={isReward ? 'Pizza offerte (fidélité) · les suppléments restent payants' : `Prix de base ${formatPrice(line ? line.unitPrice : product.price)}`}
      onClose={onClose}
      size="lg"
      footer={
        <>
          {!isReward && <Stepper value={quantity} onChange={setQuantity} label="quantité" max={canIncrease ? undefined : line?.quantity} />}
          {!isReward && !canIncrease && <span className="customize__limit">Quantité non augmentable</span>}
          <button type="button" className="btn btn--lg btn--success customize__save" onClick={save} data-autofocus>
            <Icon name={line ? 'check' : 'plus'} />
            {line ? 'Enregistrer' : 'Ajouter'} · {formatPrice(lineTotal(preview))}
          </button>
        </>
      }
    >
      {ingredients.length > 0 && (
        <section className="customize__section">
          <h3 className="customize__title">
            Ingrédients <span className="muted">· toucher pour retirer (sans changement de prix)</span>
          </h3>
          <div className="chip-grid">
            {ingredients.map((ingredient) => {
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
          {toppingChoices.map((t) => {
            const active = toppings.some((x) => x.id === t.id);
            const unavailable = !!store.getCatalogError() || !catalog.toppings.some((current) => current.id === t.id && isActive(current));
            return (
              <button
                key={t.id}
                type="button"
                className={`chip chip--topping ${active ? 'chip--active' : ''} ${unavailable ? 'chip--unavailable' : ''}`}
                aria-pressed={active}
                onClick={() => toggleTopping(line?.addedToppings.find((old) => old.id === t.id) ?? { id: t.id, name: t.name, price: t.price })}
              >
                <span>{t.name}</span>
                <span className="price">+{formatPrice(t.price)}</span>
                {unavailable && <span className="chip__availability">Indisponible · retirer</span>}
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
