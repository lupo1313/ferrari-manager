import { formatPrice, parseEuros } from '../../domain/money';
import { TENDER_KINDS, TENDER_LABELS } from '../../domain/payment';
import type { Cents, PaymentPart, TenderKind } from '../../domain/types';

/** Saisie en cours : texte libre par moyen (« 10 », « 10,50 »), converti en centimes entiers. */
export type SplitDraft = Record<TenderKind, string>;

export const emptySplit = (): SplitDraft => ({ especes: '', carte: '', titres_restaurant: '' });

export function splitFromParts(parts: PaymentPart[]): SplitDraft {
  const draft = emptySplit();
  for (const p of parts) draft[p.kind] = (p.amount / 100).toFixed(2).replace('.', ',');
  return draft;
}

/** Montants saisis, ou null si une saisie est invalide (lettres, plus de deux décimales, négatif). */
export function partsFromSplit(draft: SplitDraft): PaymentPart[] | null {
  const parts: PaymentPart[] = [];
  for (const kind of TENDER_KINDS) {
    const text = draft[kind].trim();
    if (!text) continue;
    const amount = parseEuros(text);
    if (amount === null) return null;
    parts.push({ kind, amount });
  }
  return parts;
}

interface TenderSplitProps {
  total: Cents;
  draft: SplitDraft;
  onChange: (draft: SplitDraft) => void;
}

/**
 * Répartition par moyen de paiement, au doigt : un champ par moyen et un bouton « Reste » qui y place
 * le montant encore à répartir. Le récapitulatif indique le reste ou le dépassement, sans rien corriger seul.
 */
export function TenderSplit({ total, draft, onChange }: TenderSplitProps) {
  const parts = partsFromSplit(draft);
  const sum = parts ? parts.reduce((s, p) => s + p.amount, 0) : 0;
  const amountOf = (kind: TenderKind) => (parts ? parts.find((p) => p.kind === kind)?.amount ?? 0 : 0);
  const fillRest = (kind: TenderKind) => {
    const rest = total - (sum - amountOf(kind));
    onChange({ ...draft, [kind]: rest > 0 ? (rest / 100).toFixed(2).replace('.', ',') : '' });
  };

  return (
    <div className="tender-split">
      {TENDER_KINDS.map((kind) => (
        <div key={kind} className="tender-split__row">
          <label className="tender-split__label" htmlFor={`tender-${kind}`}>
            {TENDER_LABELS[kind]}
          </label>
          <div className="tender-split__input">
            <input
              id={`tender-${kind}`}
              className={`input ${draft[kind].trim() && parseEuros(draft[kind]) === null ? 'input--invalid' : ''}`}
              inputMode="decimal"
              autoComplete="off"
              placeholder="0,00"
              value={draft[kind]}
              onChange={(e) => onChange({ ...draft, [kind]: e.target.value })}
            />
            <span aria-hidden="true">€</span>
          </div>
          <button type="button" className="btn btn--sm" onClick={() => fillRest(kind)}>
            Reste
          </button>
        </div>
      ))}
      <p className={`tender-split__summary ${!parts || sum > total ? 'tender-split__summary--error' : sum < total ? 'tender-split__summary--warn' : 'tender-split__summary--ok'}`}>
        {!parts
          ? 'Montant invalide : chiffres uniquement, deux décimales au plus (ex. 10,50).'
          : sum > total
            ? `Total ${formatPrice(total)} · réparti ${formatPrice(sum)} · dépasse de ${formatPrice(sum - total)}`
            : sum < total
              ? `Total ${formatPrice(total)} · réparti ${formatPrice(sum)} · reste ${formatPrice(total - sum)} non affecté`
              : `Total ${formatPrice(total)} · entièrement réparti`}
      </p>
    </div>
  );
}
