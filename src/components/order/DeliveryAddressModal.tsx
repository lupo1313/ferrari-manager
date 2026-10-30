import { useState, type FormEvent, type InputHTMLAttributes } from 'react';
import { Modal } from '../ui/Modal';
import { customerFullName } from '../../domain/customers';
import type { DeliveryAddressErrors } from '../../domain/delivery';
import type { Customer, DeliveryAddressInput } from '../../domain/types';

interface DeliveryAddressModalProps {
  customer: Customer;
  /** Adresse actuellement utilisée pour cette commande (ponctuelle ou habituelle). */
  initial: DeliveryAddressInput;
  /** Renvoie les erreurs de saisie, ou null si l'adresse est enregistrée pour la commande. */
  onSave: (address: DeliveryAddressInput) => DeliveryAddressErrors | null;
  onClose: () => void;
}

/**
 * Adresse de livraison de CETTE commande. Mêmes champs et mêmes contrôles que la fiche client,
 * mais rien n'est écrit dans la fiche : l'adresse habituelle du client reste inchangée.
 */
export function DeliveryAddressModal({ customer, initial, onSave, onClose }: DeliveryAddressModalProps) {
  const [input, setInput] = useState<DeliveryAddressInput>(initial);
  const [errors, setErrors] = useState<DeliveryAddressErrors>({});

  const set = (k: keyof DeliveryAddressInput) => (value: string) => {
    setInput((prev) => ({ ...prev, [k]: value }));
    if (errors[k]) setErrors((prev) => ({ ...prev, [k]: undefined }));
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const r = onSave(input);
    if (r) setErrors(r);
    else onClose();
  };

  const field = (k: keyof DeliveryAddressInput, label: string, props: InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="field">
      <span className="field__label">{label}</span>
      <input
        className={`input ${errors[k] ? 'input--invalid' : ''}`}
        value={input[k]}
        onChange={(e) => set(k)(e.target.value)}
        aria-invalid={Boolean(errors[k])}
        autoComplete="off"
        {...props}
      />
      {errors[k] && <span className="field__error">{errors[k]}</span>}
    </label>
  );

  return (
    <Modal
      title="Adresse de livraison de cette commande"
      subtitle={`Pour cette commande seulement : la fiche de ${customerFullName(customer)} n’est pas modifiée.`}
      onClose={onClose}
      dismissOnBackdrop={false}
      footer={
        <>
          <button type="button" className="btn btn--lg" onClick={onClose}>
            Annuler
          </button>
          <button type="submit" form="delivery-address-form" className="btn btn--lg btn--success">
            Utiliser pour cette commande
          </button>
        </>
      }
    >
      <form id="delivery-address-form" className="form-grid" onSubmit={submit} noValidate>
        <div className="form-grid__full">{field('address', 'Adresse de livraison *', { placeholder: 'N° et rue' })}</div>
        {field('postalCode', 'Code postal *', { inputMode: 'numeric', maxLength: 5 })}
        {field('city', 'Ville')}
        {field('building', 'Bâtiment', { placeholder: 'Ex. B' })}
        {field('floor', 'Étage', { placeholder: 'Ex. 3e' })}
        {field('intercom', 'Interphone', { placeholder: 'Nom ou numéro' })}
        {field('doorCode', 'Digicode', { placeholder: 'Ex. 4512' })}
        <div className="form-grid__full">{field('complement', 'Complément d’adresse', { placeholder: 'Résidence, porte…' })}</div>
        <label className="field form-grid__full">
          <span className="field__label">Consignes de cette livraison</span>
          <textarea
            className={`textarea ${errors.instructions ? 'input--invalid' : ''}`}
            value={input.instructions}
            onChange={(e) => set('instructions')(e.target.value)}
            placeholder="Ex. : sonner chez Martin, 2e porte à gauche…"
            rows={2}
          />
          {errors.instructions && <span className="field__error">{errors.instructions}</span>}
        </label>
      </form>
    </Modal>
  );
}
