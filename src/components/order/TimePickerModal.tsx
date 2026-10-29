import { useState } from 'react';
import { Modal } from '../ui/Modal';
import { formatTimeOfDay, isValidTimeOfDay, timeSlots } from '../../domain/time';

interface TimePickerModalProps {
  value: string | null;
  onSelect: (value: string | null) => void;
  onClose: () => void;
}

export function TimePickerModal({ value, onSelect, onClose }: TimePickerModalProps) {
  const [custom, setCustom] = useState(value ?? '');
  const slots = timeSlots(new Date(), 15, 16, 15);

  return (
    <Modal title="Heure souhaitée" subtitle="Créneaux à partir de maintenant + 15 min" onClose={onClose} size="sm">
      <div className="slot-grid">
        <button
          type="button"
          className="slot slot--asap"
          aria-pressed={value === null}
          onClick={() => {
            onSelect(null);
            onClose();
          }}
        >
          Dès que possible
        </button>
        {slots.map((s) => (
          <button
            key={s}
            type="button"
            className="slot"
            aria-pressed={value === s}
            onClick={() => {
              onSelect(s);
              onClose();
            }}
          >
            {formatTimeOfDay(s)}
          </button>
        ))}
      </div>
      <form
        className="slot-custom"
        onSubmit={(e) => {
          e.preventDefault();
          if (isValidTimeOfDay(custom)) {
            onSelect(custom);
            onClose();
          }
        }}
      >
        <label className="field">
          <span className="field__label">Autre heure</span>
          <input className="input" type="time" value={custom} onChange={(e) => setCustom(e.target.value)} />
        </label>
        <button type="submit" className="btn btn--dark" disabled={!isValidTimeOfDay(custom)}>
          Valider
        </button>
      </form>
    </Modal>
  );
}
