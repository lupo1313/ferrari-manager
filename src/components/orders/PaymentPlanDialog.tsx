import { useState } from 'react';
import { Modal } from '../ui/Modal';
import { Icon } from '../ui/Icon';
import { TenderSplit, emptySplit, partsFromSplit, splitFromParts } from './TenderSplit';
import { formatPrice } from '../../domain/money';
import { asPaymentPlan, planProblem, TENDER_KINDS, TENDER_LABELS } from '../../domain/payment';
import type { Cents, PaymentPlan, TenderKind } from '../../domain/types';

interface PaymentPlanDialogProps {
  /** Ex. « Commande en cours », « Commande n° 12 ». */
  title: string;
  total: Cents;
  plan: PaymentPlan | null | undefined;
  /** Renvoie un message d'erreur si l'enregistrement est refusé. */
  onSave: (plan: PaymentPlan | null) => string | null;
  onClose: () => void;
}

type Choice = 'aucun' | TenderKind | 'mixte';

/**
 * Paiement PRÉVU (intention du client, utile au livreur) : jamais un encaissement.
 * Une répartition mixte peut rester incomplète : le reste s'affiche « non affecté ».
 */
export function PaymentPlanDialog({ title, total, plan, onSave, onClose }: PaymentPlanDialogProps) {
  const current = asPaymentPlan(plan);
  const [choice, setChoice] = useState<Choice>(current ? (current.type === 'unique' ? current.kind : 'mixte') : 'aucun');
  const [draft, setDraft] = useState(() => (current?.type === 'mixte' ? splitFromParts(current.parts) : emptySplit()));
  const [error, setError] = useState<string | null>(null);

  const parts = partsFromSplit(draft);
  const next: PaymentPlan | null =
    choice === 'aucun' ? null : choice === 'mixte' ? (parts && parts.some((p) => p.amount > 0) ? { type: 'mixte', parts } : null) : { type: 'unique', kind: choice };
  const problem = choice === 'mixte' ? (!parts ? 'Montant invalide.' : next ? planProblem(next, total) : 'Indiquez au moins un montant.') : null;

  const save = () => {
    if (problem) return;
    const r = onSave(next);
    if (r) setError(r);
    else onClose();
  };

  const options: { value: Choice; label: string }[] = [
    { value: 'aucun', label: 'Non renseigné' },
    ...TENDER_KINDS.map((k) => ({ value: k as Choice, label: TENDER_LABELS[k] })),
    { value: 'mixte', label: 'Paiement mixte' },
  ];

  return (
    <Modal
      title="Paiement prévu"
      subtitle={`${title} · ${formatPrice(total)}`}
      onClose={onClose}
      size="sm"
      footer={
        <>
          <button type="button" className="btn btn--lg" onClick={onClose}>
            Annuler
          </button>
          <button type="button" className="btn btn--lg btn--dark" onClick={save} disabled={problem !== null}>
            <Icon name="check" /> Enregistrer
          </button>
        </>
      }
    >
      <div className="plan-options" role="radiogroup" aria-label="Moyen de paiement prévu">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={choice === o.value}
            className="plan-option"
            onClick={() => {
              setChoice(o.value);
              setError(null);
            }}
          >
            <span className="plan-option__radio" aria-hidden="true" />
            {o.label}
          </button>
        ))}
      </div>
      {choice === 'mixte' && <TenderSplit total={total} draft={draft} onChange={setDraft} />}
      {(error || (problem && choice === 'mixte' && parts && next)) && <p className="field__error">{error ?? problem}</p>}
      <p className="muted payment-hint">
        Information pour la cuisine et le livreur : la commande reste « À encaisser » tant que l’encaissement n’est pas confirmé.
      </p>
    </Modal>
  );
}
