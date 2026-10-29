import { useState, type FormEvent, type InputHTMLAttributes } from 'react';
import { Modal } from '../ui/Modal';
import { useStore } from '../../state/StoreContext';
import { useToast } from '../ui/Toast';
import {
  customerFullName,
  customerToInput,
  EMPTY_CUSTOMER_INPUT,
  type CustomerFieldErrors,
  type CustomerInput,
} from '../../domain/customers';
import type { Customer } from '../../domain/types';

interface CustomerFormModalProps {
  customer?: Customer;
  initialPhone?: string;
  /** Sélectionne la fiche créée dans la commande en cours. */
  selectOnCreate?: boolean;
  onClose: () => void;
  onSaved?: (customer: Customer) => void;
}

export function CustomerFormModal({ customer, initialPhone, selectOnCreate = true, onClose, onSaved }: CustomerFormModalProps) {
  const store = useStore();
  const toast = useToast();
  const [input, setInput] = useState<CustomerInput>(() =>
    customer ? customerToInput(customer) : { ...EMPTY_CUSTOMER_INPUT, phone: initialPhone ?? '' },
  );
  const [errors, setErrors] = useState<CustomerFieldErrors>({});
  const [duplicateId, setDuplicateId] = useState<string | null>(null);

  const set = (field: keyof CustomerInput) => (value: string) => {
    setInput((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
    if (field === 'phone') setDuplicateId(null);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const result = customer ? store.updateCustomer(customer.id, input) : store.createCustomer(input, { select: selectOnCreate });
    if (!result.ok) {
      setErrors(result.fieldErrors ?? {});
      setDuplicateId(result.existingCustomerId ?? null);
      return;
    }
    toast(customer ? 'Fiche client mise à jour' : `Fiche créée : ${customerFullName(result.value)}`, 'success');
    onSaved?.(result.value);
    onClose();
  };

  const duplicate = duplicateId ? store.getData().customers.find((c) => c.id === duplicateId) : undefined;

  const field = (name: keyof CustomerInput, label: string, props: InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="field">
      <span className="field__label">{label}</span>
      <input
        className={`input ${errors[name] ? 'input--invalid' : ''}`}
        value={input[name]}
        onChange={(e) => set(name)(e.target.value)}
        aria-invalid={Boolean(errors[name])}
        {...props}
      />
      {errors[name] && <span className="field__error">{errors[name]}</span>}
    </label>
  );

  return (
    <Modal
      title={customer ? 'Modifier la fiche client' : 'Nouveau client'}
      subtitle={customer ? 'Les commandes déjà enregistrées conservent les informations d’origine.' : 'Données fictives uniquement dans cette version de test.'}
      onClose={onClose}
      dismissOnBackdrop={false}
      footer={
        <>
          <button type="button" className="btn btn--lg" onClick={onClose}>
            Annuler
          </button>
          <button type="submit" form="customer-form" className="btn btn--lg btn--success">
            {customer ? 'Enregistrer' : 'Créer la fiche'}
          </button>
        </>
      }
    >
      <form id="customer-form" className="form-grid" onSubmit={submit} noValidate>
        {field('phone', 'Téléphone *', { inputMode: 'tel', autoComplete: 'off', placeholder: '06 12 34 56 78' })}
        <div />
        {duplicate && (
          <div className="form-grid__full notice notice--warning">
            <span>
              Ce numéro appartient déjà à <strong>{customerFullName(duplicate)}</strong>.
            </span>
            {!customer && (
              <button
                type="button"
                className="btn btn--sm"
                onClick={() => {
                  store.selectCustomer(duplicate.id);
                  toast(`${customerFullName(duplicate)} sélectionné`, 'success');
                  onClose();
                }}
              >
                Utiliser cette fiche
              </button>
            )}
          </div>
        )}
        {field('lastName', 'Nom *', { autoComplete: 'off', autoCapitalize: 'words' })}
        {field('firstName', 'Prénom', { autoComplete: 'off', autoCapitalize: 'words' })}
        <div className="form-grid__full">{field('address', 'Adresse de livraison', { autoComplete: 'off', placeholder: 'N° et rue' })}</div>
        {field('postalCode', 'Code postal', { inputMode: 'numeric', autoComplete: 'off', maxLength: 5 })}
        {field('city', 'Ville', { autoComplete: 'off' })}
        <div className="form-grid__full">
          {field('complement', 'Complément d’adresse', { autoComplete: 'off', placeholder: 'Étage, code, interphone…' })}
        </div>
        <label className="field form-grid__full">
          <span className="field__label">Instructions / notes client</span>
          <textarea
            className={`textarea ${errors.instructions ? 'input--invalid' : ''}`}
            value={input.instructions}
            onChange={(e) => set('instructions')(e.target.value)}
            placeholder="Ex. : sonner deux fois, allergie…"
            rows={3}
          />
          {errors.instructions && <span className="field__error">{errors.instructions}</span>}
        </label>
      </form>
    </Modal>
  );
}
