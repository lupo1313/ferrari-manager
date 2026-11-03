import { useState } from 'react';
import { Modal } from '../ui/Modal';
import { Icon } from '../ui/Icon';
import { useStore } from '../../state/StoreContext';
import { useToast } from '../ui/Toast';
import type { ImportAnalysis } from '../../domain/customersImport';

interface CustomerImportDialogProps {
  fileName: string;
  analysis: ImportAnalysis;
  onClose: () => void;
}

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

/** Récapitulatif avant import : rien n'est enregistré tant que « Importer » n'est pas confirmé. */
export function CustomerImportDialog({ fileName, analysis, onClose }: CustomerImportDialogProps) {
  const store = useStore();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const count = analysis.toAdd.length;
  const duplicates = analysis.duplicatesExisting + analysis.duplicatesInFile;

  const confirm = () => {
    if (busy) return; // double appui : une seule importation
    setBusy(true);
    const result = store.importCustomers(analysis.toAdd);
    if (!result.ok) {
      setError(result.error);
      setBusy(false);
      return;
    }
    toast(`${plural(result.value.added, 'client importé', 'clients importés')}`, 'success');
    onClose();
  };

  return (
    <Modal
      title="Importation des clients"
      subtitle={fileName}
      size="md"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn--lg" onClick={onClose} data-autofocus>
            {count > 0 ? 'Annuler' : 'Fermer'}
          </button>
          {count > 0 && (
            <button type="button" className="btn btn--lg btn--success" onClick={confirm} disabled={busy}>
              Importer {plural(count, 'client', 'clients')}
            </button>
          )}
        </>
      }
    >
      {analysis.fatal ? (
        <p className="notice notice--error" role="alert">
          <Icon name="alert" size={18} /> {analysis.fatal}
        </p>
      ) : (
        <div className="confirm-message">
          <ul className="confirm-list">
            <li>
              <strong>{plural(count, 'nouveau client à importer', 'nouveaux clients à importer')}.</strong>
            </li>
            <li>
              {plural(duplicates, 'doublon ignoré', 'doublons ignorés')}
              {duplicates > 0 && ` (${analysis.duplicatesExisting} déjà enregistré${analysis.duplicatesExisting > 1 ? 's' : ''}, ${analysis.duplicatesInFile} répété${analysis.duplicatesInFile > 1 ? 's' : ''} dans le fichier)`}.
            </li>
            <li>{plural(analysis.invalid, 'ligne invalide ignorée', 'lignes invalides ignorées')}.</li>
          </ul>
          {analysis.errors.length > 0 && (
            <div className="notice notice--warning" role="status">
              <div>
                <strong>Principales erreurs :</strong>
                <ul className="confirm-list">
                  {analysis.errors.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                  {analysis.invalid > analysis.errors.length && <li>… et {analysis.invalid - analysis.errors.length} autres.</li>}
                </ul>
              </div>
            </div>
          )}
          <p className="confirm-impact">
            {count > 0
              ? 'Seuls les nouveaux clients sont ajoutés, avec leurs coordonnées uniquement. Aucune fiche existante n’est modifiée ; aucune fidélité ni commande n’est importée.'
              : 'Rien ne sera ajouté : aucun nouveau client dans ce fichier.'}
          </p>
          {error && (
            <p className="notice notice--error" role="alert">
              <Icon name="alert" size={18} /> {error}
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}
