import { useState, type FormEvent } from 'react';
import { Modal } from '../ui/Modal';
import { Icon } from '../ui/Icon';
import { useToast } from '../ui/Toast';
import { useStore } from '../../state/StoreContext';
import { toppingToInput, type ToppingErrors } from '../../domain/toppings';
import type { Topping } from '../../domain/types';

export function ToppingFormModal({ topping, onClose }: { topping?: Topping; onClose: () => void }) {
  const store = useStore();
  const toast = useToast();
  const [input, setInput] = useState(() => topping ? toppingToInput(topping) : { name: '', price: '' });
  const [errors, setErrors] = useState<ToppingErrors>({});
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const result = topping ? store.updateCatalogTopping(topping.id, input) : store.addCatalogTopping(input);
    if (!result.ok) { setErrors(result.toppingErrors ?? {}); toast(result.error, 'error'); return; }
    toast(topping ? 'Supplément modifié pour les prochaines sélections.' : 'Supplément ajouté.', 'success');
    onClose();
  };
  return <Modal title={topping ? 'Modifier le supplément' : 'Nouveau supplément'}
    subtitle="Les suppléments déjà sélectionnés gardent leur nom et leur prix enregistrés."
    onClose={onClose} dismissOnBackdrop={false}
    footer={<><button type="button" className="btn btn--lg" onClick={onClose}>Annuler</button>
      <button type="submit" form="topping-form" className="btn btn--lg btn--success"><Icon name="check" />{topping ? 'Enregistrer' : 'Ajouter le supplément'}</button></>}>
    <form id="topping-form" className="form-grid" onSubmit={submit} noValidate>
      <label className="field"><span className="field__label">Nom *</span>
        <input className={'input' + (errors.name ? ' input--invalid' : '')} value={input.name} maxLength={60} autoComplete="off" data-autofocus
          onChange={(e) => setInput({ ...input, name: e.target.value })} />
        {errors.name && <span className="field__error">{errors.name}</span>}
      </label>
      <label className="field"><span className="field__label">Prix (€) *</span>
        <input className={'input' + (errors.price ? ' input--invalid' : '')} value={input.price} inputMode="decimal" autoComplete="off" placeholder="1,50"
          onChange={(e) => setInput({ ...input, price: e.target.value })} />
        {errors.price && <span className="field__error">{errors.price}</span>}
      </label>
    </form>
  </Modal>;
}
