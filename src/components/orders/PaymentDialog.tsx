import { useState } from 'react';
import { Modal } from '../ui/Modal';
import { Icon } from '../ui/Icon';
import { TenderSplit, emptySplit, partsFromSplit, splitFromParts } from './TenderSplit';
import { formatPrice } from '../../domain/money';
import { orderDisplayName } from '../../domain/orders';
import { asPaymentPlan, planBreakdown, planLabel, TENDER_KINDS, TENDER_LABELS, tendersProblem } from '../../domain/payment';
import type { Order, PaymentMethod, PaymentPart } from '../../domain/types';

interface PaymentDialogProps {
  order: Order;
  onConfirm: (how: PaymentMethod | PaymentPart[]) => void;
  onClose: () => void;
}

/**
 * Confirmation d'un encaissement réel. Un moyen unique se confirme en un appui ; le paiement mixte demande
 * des montants dont la somme égale exactement le total. Le paiement prévu n'est qu'un raccourci : il n'est
 * jamais confirmé sans appui.
 */
export function PaymentDialog({ order, onConfirm, onClose }: PaymentDialogProps) {
  const total = order.totals.total;
  const plan = asPaymentPlan(order.paymentPlan);
  const planned = plan ? planBreakdown(plan, total) : null;
  const plannedComplete = planned && planned.parts.length > 0 && planned.unassigned === 0 && planned.excess === 0 ? planned.parts : null;
  const [mixed, setMixed] = useState(false);
  const [draft, setDraft] = useState(() => (planned && planned.parts.length > 1 ? splitFromParts(planned.parts) : emptySplit()));
  const parts = partsFromSplit(draft);
  const problem = parts ? tendersProblem(parts, total) : 'Montant invalide.';

  return (
    <Modal
      title={`Encaisser la commande n° ${order.number}`}
      subtitle={`${orderDisplayName(order)} · ${formatPrice(total)}`}
      onClose={onClose}
      size="sm"
      footer={
        mixed ? (
          <>
            <button type="button" className="btn btn--lg" onClick={() => setMixed(false)}>
              Retour
            </button>
            <button type="button" className="btn btn--lg btn--success" disabled={problem !== null} onClick={() => parts && onConfirm(parts)}>
              <Icon name="check" /> Confirmer l’encaissement
            </button>
          </>
        ) : undefined
      }
    >
      {mixed ? (
        <>
          <p className="muted payment-hint">Montants réellement encaissés. La somme doit être égale au total : pas d’encaissement partiel.</p>
          <TenderSplit total={total} draft={draft} onChange={setDraft} />
          {problem && parts && <p className="field__error">{problem}</p>}
        </>
      ) : (
        <>
          {plan && (
            <p className="payment-planned">
              Paiement prévu : <strong>{planLabel(plan, total)}</strong>
            </p>
          )}
          <div className="payment-methods">
            {plannedComplete && plannedComplete.length > 1 && (
              <button type="button" className="payment-method payment-method--planned" onClick={() => onConfirm(plannedComplete)}>
                <Icon name="check" size={20} />
                Confirmer comme prévu
              </button>
            )}
            {TENDER_KINDS.map((kind) => (
              <button
                key={kind}
                type="button"
                className={`payment-method ${plan?.type === 'unique' && plan.kind === kind ? 'payment-method--planned' : ''}`}
                onClick={() => onConfirm([{ kind, amount: total }])}
              >
                <Icon name="check" size={20} />
                {TENDER_LABELS[kind]}
                <span className="payment-method__amount">{formatPrice(total)}</span>
              </button>
            ))}
            <button type="button" className="payment-method" onClick={() => setMixed(true)}>
              <Icon name="plusCircle" size={20} />
              Paiement mixte…
            </button>
            <button type="button" className="payment-method payment-method--quiet" onClick={() => onConfirm('non_precise')}>
              <Icon name="check" size={20} />
              Non précisé
            </button>
          </div>
          <p className="muted payment-hint">
            Suivi uniquement : le paiement se fait sur la caisse habituelle. Les pizzas payantes sont ajoutées à la fidélité du client à
            l’encaissement.
          </p>
        </>
      )}
    </Modal>
  );
}
