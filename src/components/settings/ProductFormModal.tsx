import { useState, type FormEvent } from 'react';
import { Modal } from '../ui/Modal';
import { Icon } from '../ui/Icon';
import { useToast } from '../ui/Toast';
import { useStore } from '../../state/StoreContext';
import {
  CATEGORY_LABELS,
  PIZZA_TAGS,
  PRODUCT_CATEGORIES,
  PRODUCT_LIMITS,
  TAG_LABELS,
  productToInput,
  type ProductErrors,
  type ProductInput,
} from '../../domain/catalog';
import type { Product, ProductCategory } from '../../domain/types';

interface ProductFormModalProps {
  /** Produit modifié ; absent : nouveau produit. */
  product?: Product;
  initialCategory: ProductCategory;
  onClose: () => void;
}

const emptyInput = (category: ProductCategory): ProductInput => ({
  name: '',
  category,
  price: '',
  ingredients: [],
  tags: [],
  description: '',
  alcohol: false,
});

/**
 * Fiche d'un produit de la carte (intervention 9a). L'enregistrement passe par le store, qui contrôle
 * les champs et n'applique la fiche qu'une fois écrite : un échec n'est jamais présenté comme enregistré.
 */
export function ProductFormModal({ product, initialCategory, onClose }: ProductFormModalProps) {
  const store = useStore();
  const toast = useToast();
  const [input, setInput] = useState<ProductInput>(() => (product ? productToInput(product) : emptyInput(initialCategory)));
  const [errors, setErrors] = useState<ProductErrors>({});
  const [ingredient, setIngredient] = useState('');
  const set = <K extends keyof ProductInput>(key: K, value: ProductInput[K]) => setInput((i) => ({ ...i, [key]: value }));
  const categoryChanged = Boolean(product && input.category !== product.category);

  const addIngredient = () => {
    const value = ingredient.trim();
    if (!value) return;
    if (!input.ingredients.some((i) => i.toLowerCase() === value.toLowerCase())) set('ingredients', [...input.ingredients, value]);
    setIngredient('');
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    // Ingrédient tapé mais pas encore ajouté : il compte.
    const pending = ingredient.trim();
    const final = pending && !input.ingredients.includes(pending) ? { ...input, ingredients: [...input.ingredients, pending] } : input;
    const r = product ? store.updateCatalogProduct(product.id, final) : store.addCatalogProduct(final);
    if (!r.ok) {
      setErrors(r.productErrors ?? {});
      toast(r.error, 'error');
      return;
    }
    toast(product ? 'Fiche enregistrée : elle s’applique aux prochaines sélections.' : 'Produit ajouté à la carte.', 'success');
    onClose();
  };

  return (
    <Modal
      title={product ? 'Modifier le produit' : 'Nouveau produit'}
      subtitle="Paniers et commandes déjà enregistrés gardent leurs libellés, prix et compositions."
      onClose={onClose}
      dismissOnBackdrop={false}
      size="lg"
      footer={
        <>
          <button type="button" className="btn btn--lg" onClick={onClose}>
            Annuler
          </button>
          <button type="submit" form="product-form" className="btn btn--lg btn--success">
            <Icon name="check" /> {product ? 'Enregistrer' : 'Ajouter à la carte'}
          </button>
        </>
      }
    >
      <form id="product-form" className="form-grid" onSubmit={submit} noValidate>
        <div className="field form-grid__full">
          <span className="field__label">Catégorie</span>
          <div className="segmented" role="group" aria-label="Catégorie">
            {PRODUCT_CATEGORIES.map((c) => (
              <button key={c} type="button" className="segmented__item" aria-pressed={input.category === c} onClick={() => set('category', c)}>
                {CATEGORY_LABELS[c]}
              </button>
            ))}
          </div>
          {categoryChanged && (
            <p className="notice notice--warning" role="status">
              Changement de catégorie : les paniers et commandes existants gardent l’ancienne catégorie (fidélité et statistiques inchangées) ; la
              nouvelle ne s’applique qu’aux prochaines sélections.
            </p>
          )}
        </div>

        <label className="field">
          <span className="field__label">Nom *</span>
          <input
            className={`input ${errors.name ? 'input--invalid' : ''}`}
            value={input.name}
            maxLength={PRODUCT_LIMITS.name}
            onChange={(e) => set('name', e.target.value)}
            autoComplete="off"
            data-autofocus
          />
          {errors.name && <span className="field__error">{errors.name}</span>}
        </label>
        <label className="field">
          <span className="field__label">Prix (€) *</span>
          <input
            className={`input ${errors.price ? 'input--invalid' : ''}`}
            value={input.price}
            inputMode="decimal"
            placeholder="12,50"
            onChange={(e) => set('price', e.target.value)}
            autoComplete="off"
          />
          {errors.price && <span className="field__error">{errors.price}</span>}
        </label>

        {input.category === 'pizza' ? (
          <>
            <div className="field form-grid__full">
              <span className="field__label">Ingrédients (retirables à la commande)</span>
              <div className="product-form__adder">
                <input
                  className={`input ${errors.ingredients ? 'input--invalid' : ''}`}
                  value={ingredient}
                  maxLength={PRODUCT_LIMITS.ingredient}
                  placeholder="Ex. : Mozzarella"
                  onChange={(e) => setIngredient(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addIngredient();
                    }
                  }}
                  aria-label="Nouvel ingrédient"
                />
                <button type="button" className="btn" onClick={addIngredient}>
                  <Icon name="plus" /> Ajouter
                </button>
              </div>
              {input.ingredients.length > 0 && (
                <div className="chip-grid">
                  {input.ingredients.map((i) => (
                    <button
                      key={i}
                      type="button"
                      className="chip"
                      onClick={() => set('ingredients', input.ingredients.filter((x) => x !== i))}
                      aria-label={`Retirer ${i}`}
                    >
                      {i} <Icon name="close" size={16} />
                    </button>
                  ))}
                </div>
              )}
              {errors.ingredients && <span className="field__error">{errors.ingredients}</span>}
            </div>
            <div className="field form-grid__full">
              <span className="field__label">Familles (filtres de la carte)</span>
              <div className="chip-grid">
                {PIZZA_TAGS.map((t) => {
                  const on = input.tags.includes(t);
                  return (
                    <button
                      key={t}
                      type="button"
                      className={`chip ${on ? 'chip--active' : ''}`}
                      aria-pressed={on}
                      onClick={() => set('tags', on ? input.tags.filter((x) => x !== t) : [...input.tags, t])}
                    >
                      {on && <Icon name="check" size={16} />} {TAG_LABELS[t]}
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        ) : (
          <label className="field form-grid__full">
            <span className="field__label">Description (contenance, composition…)</span>
            <input
              className={`input ${errors.description ? 'input--invalid' : ''}`}
              value={input.description}
              maxLength={PRODUCT_LIMITS.description}
              placeholder={input.category === 'boisson' ? 'Ex. : Bouteille 1,5 L' : 'Ex. : Mascarpone, café, cacao'}
              onChange={(e) => set('description', e.target.value)}
              autoComplete="off"
            />
            {errors.description && <span className="field__error">{errors.description}</span>}
          </label>
        )}

        {input.category === 'boisson' && (
          <label className="restore-confirm form-grid__full">
            <input type="checkbox" checked={input.alcohol} onChange={(e) => set('alcohol', e.target.checked)} />
            Boisson alcoolisée (jamais proposée en récompense fidélité)
          </label>
        )}
      </form>
    </Modal>
  );
}
