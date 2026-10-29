import { Icon } from './Icon';

interface StepperProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  label: string;
  /** Rend le bouton « moins » destructif quand il supprime la ligne (valeur à 1). */
  removeAtMin?: boolean;
  disabled?: boolean;
}

export function Stepper({ value, onChange, min = 1, max = 99, label, removeAtMin = false, disabled = false }: StepperProps) {
  const canDecrease = removeAtMin ? value >= min : value > min;
  return (
    <div className="stepper" role="group" aria-label={label}>
      <button
        type="button"
        className="stepper__btn"
        onClick={() => onChange(value - 1)}
        disabled={disabled || !canDecrease}
        aria-label={`Diminuer ${label}`}
      >
        <Icon name="minus" size={18} />
      </button>
      <span className="stepper__value" aria-live="polite">
        {value}
      </span>
      <button
        type="button"
        className="stepper__btn stepper__btn--plus"
        onClick={() => onChange(value + 1)}
        disabled={disabled || value >= max}
        aria-label={`Augmenter ${label}`}
      >
        <Icon name="plus" size={18} />
      </button>
    </div>
  );
}
