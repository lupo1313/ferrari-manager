import { useEffect, useState } from 'react';
import { Icon } from '../components/ui/Icon';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { useToast } from '../components/ui/Toast';
import { useAppData, useStore } from '../state/StoreContext';
import { formatPrice, parseEuros } from '../domain/money';
import type { Settings, TicketWidth } from '../domain/types';
import { PAYMENT_SOUND_KINDS, PAYMENT_SOUND_LABELS, paymentSound, type PaymentSoundKind } from '../audio/paymentSound';
import {
  backupFileName,
  backupToText,
  browserStorage,
  createBackup,
  matchesStorage,
  verifyBackupText,
  type BackupSummary,
} from '../storage/export';

interface PreparedBackup {
  name: string;
  url: string;
  file: File;
  summary: BackupSummary;
  sizeKb: number;
}

/**
 * Sauvegarde des données locales : le fichier est préparé et vérifié, puis téléchargé par un vrai appui
 * sur un lien (Safari iPhone n'autorise pas toujours un téléchargement déclenché après un calcul).
 * Lecture seule : aucune donnée n'est modifiée ni supprimée.
 */
function BackupCard() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [prepared, setPrepared] = useState<PreparedBackup | null>(null);
  useEffect(() => () => {
    if (prepared) URL.revokeObjectURL(prepared.url);
  }, [prepared]);

  const prepare = async () => {
    const storage = browserStorage();
    if (!storage) {
      toast('Stockage du navigateur inaccessible : sauvegarde impossible.', 'error');
      return;
    }
    setBusy(true);
    try {
      const now = new Date();
      const backup = await createBackup(storage, { now, origin: window.location.origin + window.location.pathname });
      if (Object.keys(backup.stockage).length === 0) {
        toast('Aucune donnée Ferrari Manager enregistrée dans ce navigateur.', 'error');
        return;
      }
      const text = backupToText(backup);
      // Vérification du texte exact qui sera téléchargé, et comparaison avec le stockage à cet instant.
      const check = await verifyBackupText(text);
      if (!check.ok || !matchesStorage(check.backup, storage)) {
        toast(check.ok ? 'Les données ont changé pendant la sauvegarde : recommencez.' : check.error, 'error');
        return;
      }
      const name = backupFileName(now);
      const file = new File([text], name, { type: 'application/json' });
      setPrepared({ name, url: URL.createObjectURL(file), file, summary: backup.resume, sizeKb: Math.max(1, Math.round(file.size / 1024)) });
    } catch {
      toast('Sauvegarde impossible sur ce navigateur.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const canShare = Boolean(prepared && typeof navigator.canShare === 'function' && navigator.canShare({ files: [prepared.file] }));
  const share = async () => {
    if (!prepared) return;
    try {
      await navigator.share({ files: [prepared.file], title: prepared.name });
    } catch (e) {
      if ((e as Error).name !== 'AbortError') toast('Partage impossible : utilisez « Télécharger le fichier ».', 'error');
    }
  };
  const s = prepared?.summary;

  return (
    <section className="card settings-grid__wide">
      <h2 className="card__title">
        <Icon name="database" /> Sauvegarde des données
      </h2>
      <p>
        Crée un fichier contenant toutes les données Ferrari Manager de ce navigateur (commandes, clients, paiements, fidélité, état du
        service, paramètres et commande en cours). Rien n’est modifié ni supprimé.
      </p>
      <button type="button" className="btn btn--dark" onClick={prepare} disabled={busy}>
        <Icon name="file" /> {busy ? 'Préparation…' : 'Sauvegarder mes données'}
      </button>
      {prepared && s && (
        <div className="backup-result" role="status">
          <p className="backup-result__ok">
            <Icon name="check" size={18} /> Fichier prêt et vérifié : <strong>{prepared.name}</strong> ({prepared.sizeKb} Ko)
          </p>
          <ul className="backup-result__summary">
            <li>{s.commandes} commandes ({s.commandesEnCours} en cours, {s.commandesArchivees} archivées, {s.commandesEncaissees} encaissées)</li>
            <li>{s.clients} clients · {s.evenementsFidelite} opérations de fidélité</li>
            <li>
              Prochain numéro : {s.prochainNumero ?? 'non enregistré'} · Service {s.serviceOuvert === null ? 'non renseigné' : s.serviceOuvert ? 'ouvert' : 'fermé'}
            </li>
            {!s.lisible && <li className="backup-result__warn">Données principales illisibles ou absentes : copiées telles quelles.</li>}
          </ul>
          <div className="backup-result__actions">
            <a className="btn btn--success" href={prepared.url} download={prepared.name}>
              <Icon name="check" /> Télécharger le fichier
            </a>
            {canShare && (
              <button type="button" className="btn" onClick={share}>
                <Icon name="file" /> Partager ou enregistrer dans Fichiers
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

export function SettingsPage() {
  const store = useStore();
  const data = useAppData();
  const toast = useToast();
  const [draft, setDraft] = useState<Settings>(data.settings);
  const [fee, setFee] = useState(formatPrice(data.settings.deliveryFee).replace(' €', ''));
  const [confirmReset, setConfirmReset] = useState(false);

  const pizzas = store.catalog.products.filter((p) => p.category === 'pizza');
  const drinks = store.catalog.products.filter((p) => p.category === 'boisson');
  const feeCents = parseEuros(fee);

  const toggle = (key: 'eligiblePizzaIds' | 'eligibleDrinkIds', id: string) =>
    setDraft((d) => {
      const list = d.loyalty[key];
      return { ...d, loyalty: { ...d.loyalty, [key]: list.includes(id) ? list.filter((x) => x !== id) : [...list, id] } };
    });

  const save = () => {
    if (feeCents === null) {
      toast('Frais de livraison invalides (ex. 2,00).', 'error');
      return;
    }
    const r = store.updateSettings({ ...draft, deliveryFee: feeCents });
    if (!r.ok) {
      toast(r.error, 'error');
      return;
    }
    setDraft(r.value);
    toast('Paramètres enregistrés', 'success');
  };

  return (
    <div className="page">
      <header className="page__header">
        <div>
          <h1 className="page__title">Paramètres</h1>
          <p className="muted">Les changements s’appliquent aux prochaines commandes, jamais aux commandes déjà enregistrées.</p>
        </div>
        <button type="button" className="btn btn--success" onClick={save}>
          <Icon name="check" /> Enregistrer
        </button>
      </header>

      <div className="settings-grid">
        <section className="card">
          <h2 className="card__title">
            <Icon name="truck" /> Livraison
          </h2>
          <label className="field">
            <span className="field__label">Frais de livraison (€)</span>
            <input className={`input ${feeCents === null ? 'input--invalid' : ''}`} inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} />
            <span className="field__hint">0 pour une livraison offerte. Valeur de démonstration : 2,00 €.</span>
          </label>
        </section>

        <section className="card">
          <h2 className="card__title">
            <Icon name="printer" /> Ticket
          </h2>
          <div className="field">
            <span className="field__label">Largeur du rouleau thermique</span>
            <div className="segmented">
              {([58, 80] as TicketWidth[]).map((w) => (
                <button
                  key={w}
                  type="button"
                  className="segmented__item"
                  aria-pressed={draft.ticketWidthMm === w}
                  onClick={() => setDraft((d) => ({ ...d, ticketWidthMm: w }))}
                >
                  {w} mm
                </button>
              ))}
            </div>
            <span className="field__hint">Impression via la boîte de dialogue du navigateur (pilotage direct de l’imprimante prévu en V2).</span>
          </div>
          {(['name', 'address', 'phone'] as const).map((k) => (
            <label key={k} className="field">
              <span className="field__label">{k === 'name' ? 'Nom sur le ticket' : k === 'address' ? 'Adresse' : 'Téléphone'}</span>
              <input
                className="input"
                value={draft.pizzeria[k]}
                onChange={(e) => setDraft((d) => ({ ...d, pizzeria: { ...d.pizzeria, [k]: e.target.value } }))}
              />
            </label>
          ))}
        </section>

        <section className="card">
          <h2 className="card__title">
            <Icon name="volume" /> Son des encaissements
          </h2>
          <div className="segmented" role="group" aria-label="Son des encaissements">
            {[true, false].map((on) => (
              <button
                key={String(on)}
                type="button"
                className="segmented__item"
                aria-pressed={data.settings.paymentSound === on}
                onClick={() => {
                  // Enregistré immédiatement (sans le bouton « Enregistrer ») : un simple interrupteur.
                  const r = store.updateSettings({ paymentSound: on });
                  if (!r.ok) toast(r.error, 'error');
                  else setDraft((d) => ({ ...d, paymentSound: on }));
                }}
              >
                {on ? 'Activé' : 'Désactivé'}
              </button>
            ))}
          </div>
          <div className="field">
            <span className="field__label">Choisir le son</span>
            <div className="sound-options">
              {PAYMENT_SOUND_KINDS.map((kind: PaymentSoundKind) => (
                <div key={kind} className="sound-option">
                  <button
                    type="button"
                    className="sound-option__choice"
                    aria-pressed={data.settings.paymentSoundKind === kind}
                    onClick={() => {
                      const r = store.updateSettings({ paymentSoundKind: kind });
                      if (!r.ok) toast(r.error, 'error');
                      else setDraft((d) => ({ ...d, paymentSoundKind: kind }));
                    }}
                  >
                    <span className="sound-option__radio" aria-hidden="true" />
                    {PAYMENT_SOUND_LABELS[kind]}
                  </button>
                  <button
                    type="button"
                    className="btn btn--sm"
                    onClick={() => {
                      if (!paymentSound.play(kind)) toast('Son indisponible sur cet appareil (vérifiez le volume ou le mode silencieux).', 'info');
                    }}
                  >
                    <Icon name="volume" size={18} /> Écouter
                  </button>
                </div>
              ))}
            </div>
          </div>
          <span className="field__hint">Joué uniquement quand une commande passe à « Encaissée ». Choix enregistré immédiatement. Pensez au volume de la tablette.</span>
        </section>

        <section className="card settings-grid__wide">
          <h2 className="card__title">
            <Icon name="gift" /> Fidélité · produits éligibles aux récompenses
          </h2>
          <p className="muted">
            Règle fixe : {draft.loyalty.pizzasPerReward} pizzas payantes = 1 récompense. Les boissons alcoolisées ne peuvent pas être sélectionnées.
          </p>
          <h3 className="card__subtitle">Pizzas offertes possibles</h3>
          <div className="check-grid">
            {pizzas.map((p) => (
              <label key={p.id} className="check">
                <input type="checkbox" checked={draft.loyalty.eligiblePizzaIds.includes(p.id)} onChange={() => toggle('eligiblePizzaIds', p.id)} />
                <span>{p.name}</span>
                <span className="muted price">{formatPrice(p.price)}</span>
              </label>
            ))}
          </div>
          <h3 className="card__subtitle">Boissons offertes possibles (grandes bouteilles)</h3>
          <div className="check-grid">
            {drinks.map((p) => (
              <label key={p.id} className={`check ${p.alcohol ? 'check--disabled' : ''}`}>
                <input
                  type="checkbox"
                  disabled={p.alcohol}
                  checked={!p.alcohol && draft.loyalty.eligibleDrinkIds.includes(p.id)}
                  onChange={() => toggle('eligibleDrinkIds', p.id)}
                />
                <span>{p.name}</span>
                <span className="muted">{p.alcohol ? 'Alcool, exclu' : formatPrice(p.price)}</span>
              </label>
            ))}
          </div>
        </section>

        <BackupCard />

        <section className="card settings-grid__wide card--danger">
          <h2 className="card__title">
            <Icon name="database" /> Données de test
          </h2>
          <p>
            Cette version est destinée aux tests : les données sont stockées uniquement dans ce navigateur (localStorage) et ne doivent pas
            contenir de véritables informations clients.
          </p>
          <button type="button" className="btn btn--primary" onClick={() => setConfirmReset(true)}>
            <Icon name="refresh" /> Réinitialiser les données de démonstration
          </button>
        </section>
      </div>

      {confirmReset && (
        <ConfirmDialog
          title="Réinitialiser toutes les données ?"
          confirmLabel="Tout réinitialiser"
          onCancel={() => setConfirmReset(false)}
          onConfirm={() => {
            store.resetDemoData();
            setDraft(store.getData().settings);
            setFee(formatPrice(store.getData().settings.deliveryFee).replace(' €', ''));
            setConfirmReset(false);
            toast('Données de démonstration rechargées', 'success');
          }}
          message="Clients, commandes, journal de fidélité et paramètres seront effacés de ce navigateur, puis remplacés par le jeu de démonstration. Action irréversible."
        />
      )}
    </div>
  );
}
