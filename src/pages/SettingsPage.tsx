import { useEffect, useState } from 'react';
import { Icon } from '../components/ui/Icon';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { useToast } from '../components/ui/Toast';
import { useAppData, useStore, useCatalog } from '../state/StoreContext';
import { formatPrice } from '../domain/money';
import type { Settings, TicketWidth } from '../domain/types';
import { PAYMENT_SOUND_KINDS, PAYMENT_SOUND_LABELS, paymentSound, type PaymentSoundKind } from '../audio/paymentSound';
import { OPERATOR_CONTACT_EMAIL } from '../services/trajet';
import { RestoreCard } from '../components/settings/RestoreCard';
import { isActive } from '../domain/catalog';
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
  const [confirmReset, setConfirmReset] = useState(false);
  // Liste d'éligibilité repliée par défaut. Le brouillon (draft) vit dans cette page : replier ou déplier
  // ne l'enregistre pas et ne l'annule pas ; seul « Enregistrer » applique les choix.
  const [loyaltyOpen, setLoyaltyOpen] = useState(false);

  // Listes d'éligibilité fidélité : produits actifs (un produit désactivé garde sa place dans le réglage).
  const catalog = useCatalog();
  const pizzas = catalog.products.filter((p) => p.category === 'pizza' && isActive(p));
  const drinks = catalog.products.filter((p) => p.category === 'boisson' && isActive(p));
  const activeCount = catalog.products.filter(isActive).length;

  const toggle = (key: 'eligiblePizzaIds' | 'eligibleDrinkIds', id: string) =>
    setDraft((d) => {
      const list = d.loyalty[key];
      return { ...d, loyalty: { ...d.loyalty, [key]: list.includes(id) ? list.filter((x) => x !== id) : [...list, id] } };
    });

  // Brouillon différent de ce qui est enregistré (les réglages à enregistrement immédiat restent synchronisés).
  const dirty = JSON.stringify(draft) !== JSON.stringify(data.settings);
  const loyaltyDirty = JSON.stringify(draft.loyalty) !== JSON.stringify(data.settings.loyalty);
  const eligiblePizzaCount = pizzas.filter((p) => draft.loyalty.eligiblePizzaIds.includes(p.id)).length;
  const eligibleDrinkCount = drinks.filter((p) => !p.alcohol && draft.loyalty.eligibleDrinkIds.includes(p.id)).length;

  const save = () => {
    const r = store.updateSettings(draft);
    if (!r.ok) {
      toast(r.error, 'error');
      return;
    }
    setDraft(r.value);
    toast('Paramètres enregistrés', 'success');
  };

  return (
    <div className="page">
      <header className="page__header page__header--sticky">
        <div>
          <h1 className="page__title">Paramètres</h1>
          <p className="muted">Les changements s’appliquent aux prochaines commandes, jamais aux commandes déjà enregistrées.</p>
        </div>
        <div className="page__actions">
          {dirty && (
            <span className="pill pill--gold" role="status">
              <Icon name="alert" size={14} /> Modifications non enregistrées
            </span>
          )}
          <button type="button" className="btn btn--success" onClick={save}>
            <Icon name="check" /> Enregistrer
          </button>
        </div>
      </header>

      <section className="settings-group" aria-labelledby="settings-carte">
        <h2 className="settings-group__title" id="settings-carte">
          Carte et produits
        </h2>
        <div className="settings-grid">
          <section className="card">
            <h3 className="card__title">
              <Icon name="pizza" /> Carte des produits
            </h3>
            <p>
              {store.getCatalogError()
                ? 'Carte illisible : aucune nouvelle sélection de produit possible. Restaurez une sauvegarde contenant une carte valide.'
                : `${activeCount} produits actifs, ${catalog.products.length - activeCount} désactivé${catalog.products.length - activeCount > 1 ? 's' : ''}. Pizzas, boissons et desserts : les commandes déjà enregistrées ne changent pas.`}
            </p>
            <a className="btn btn--dark" href="#/parametres/carte">
              <Icon name="pencil" /> Gérer les produits
            </a>
          </section>

          <section className="card">
            <h3 className="card__title">
              <Icon name="plusCircle" /> Suppléments
            </h3>
            <p>Ajouter, modifier, désactiver ou réactiver les suppléments. Les noms et prix déjà enregistrés dans les lignes restent inchangés.</p>
            <a className="btn btn--dark" href="#/parametres/supplements">
              <Icon name="pencil" /> Gérer les suppléments
            </a>
          </section>
        </div>
      </section>

      <section className="settings-group" aria-labelledby="settings-service">
        <h2 className="settings-group__title" id="settings-service">
          Service et fonctionnement
        </h2>
        <div className="settings-grid">
          <section className="card">
            <h3 className="card__title">
              <Icon name="printer" /> Pizzeria et ticket
              <span className="pill pill--muted">Cliquez sur Enregistrer pour appliquer</span>
            </h3>
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

          <div className="settings-stack">
            <section className="card">
              <h3 className="card__title">
                <Icon name="volume" /> Son des encaissements
                <span className="pill pill--muted">Enregistrement immédiat</span>
              </h3>
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
              <span className="field__hint">Joué uniquement quand une commande passe à « Encaissée ». Pensez au volume de la tablette.</span>
            </section>

            <section className="card">
              <h3 className="card__title">
                <Icon name="grid" /> Modules facultatifs
                <span className="pill pill--muted">Enregistrement immédiat</span>
              </h3>
              <div className="field">
                <span className="field__label">Onglet Statistiques</span>
                <div className="segmented" role="group" aria-label="Onglet Statistiques">
                  {[true, false].map((on) => (
                    <button
                      key={String(on)}
                      type="button"
                      className="segmented__item"
                      aria-pressed={data.settings.modules.statistiques === on}
                      onClick={() => {
                        // Enregistré immédiatement, comme le son : un simple interrupteur d'affichage.
                        const r = store.updateSettings({ modules: { statistiques: on } });
                        if (!r.ok) toast(r.error, 'error');
                        else setDraft((d) => ({ ...d, modules: { statistiques: on } }));
                      }}
                    >
                      {on ? 'Affiché' : 'Masqué'}
                    </button>
                  ))}
                </div>
              </div>
              <span className="field__hint">
                Masquer l’onglet ne supprime aucune donnée : commandes, encaissements et historique des services restent enregistrés. Les bilans
                réapparaissent dès que l’onglet est de nouveau affiché.
              </span>
            </section>

            <section className="card">
              <h3 className="card__title">
                <Icon name="truck" /> Livraison
              </h3>
              <p className="settings-fixed">
                <strong>Livraison toujours offerte (0 €)</strong>
              </p>
              <span className="field__hint">Règle fixe de la pizzeria, sans exception : aucun frais de livraison ne peut être ajouté.</span>
            </section>
          </div>

          {/* Mentions exigées par les conditions du serveur public FOSSGIS et la licence OpenStreetMap. */}
          <section className="card settings-grid__wide">
            <h3 className="card__title">
              <Icon name="truck" /> Calcul des trajets de livraison
            </h3>
            <p>
              Distance et durée en scooter calculées avec le serveur public d’itinéraires du FOSSGIS e.V. (Valhalla) et la Base Adresse
              Nationale (IGN). Données ©{' '}
              <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
                contributeurs OpenStreetMap
              </a>{' '}
              (
              <a href="https://opendatacommons.org/licenses/odbl/index.html" target="_blank" rel="noreferrer">
                ODbL
              </a>
              ),{' '}
              <a href="https://www.openstreetmap.org/fixthemap" target="_blank" rel="noreferrer">
                signaler une erreur
              </a>
              .
            </p>
            <p>
              Contact technique de l’exploitant : <a href={`mailto:${OPERATOR_CONTACT_EMAIL}`}>{OPERATOR_CONTACT_EMAIL}</a>
            </p>
          </section>
        </div>
      </section>

      <section className="settings-group" aria-labelledby="settings-fidelite">
        <h2 className="settings-group__title" id="settings-fidelite">
          Fidélité
        </h2>
        <div className="settings-grid">
          <section className="card settings-grid__wide">
            <h3 className="card__title">
              <Icon name="gift" /> Fidélité — Produits éligibles
              {loyaltyDirty && (
                <span className="pill pill--gold" role="status">
                  Modifications non enregistrées
                </span>
              )}
              <span className="pill pill--muted">Cliquez sur Enregistrer pour appliquer</span>
            </h3>
            <p>
              <strong>{draft.loyalty.pizzasPerReward} pizzas payantes = 1 récompense.</strong> Règle fixe.
            </p>
            <p className="loyalty-summary">
              <span>
                <strong>{eligiblePizzaCount}</strong> pizza{eligiblePizzaCount > 1 ? 's' : ''} éligible{eligiblePizzaCount > 1 ? 's' : ''}
              </span>
              <span>
                <strong>{eligibleDrinkCount}</strong> boisson{eligibleDrinkCount > 1 ? 's' : ''} éligible{eligibleDrinkCount > 1 ? 's' : ''}
              </span>
            </p>
            <button
              type="button"
              className="btn btn--dark"
              aria-expanded={loyaltyOpen}
              aria-controls="loyalty-eligible"
              onClick={() => setLoyaltyOpen((v) => !v)}
            >
              <Icon name={loyaltyOpen ? 'chevronDown' : 'pencil'} /> {loyaltyOpen ? 'Replier la liste' : 'Modifier les produits éligibles'}
            </button>
            {loyaltyOpen && (
              <div id="loyalty-eligible" className="loyalty-eligible">
                <p className="muted">
                  Les choix ne sont appliqués qu’avec « Enregistrer » : replier la liste ne les enregistre pas et ne les annule pas. Les
                  boissons alcoolisées ne peuvent pas être sélectionnées.
                </p>
                <h4 className="card__subtitle">Pizzas offertes possibles</h4>
                <div className="check-grid">
                  {pizzas.map((p) => (
                    <label key={p.id} className="check">
                      <input type="checkbox" checked={draft.loyalty.eligiblePizzaIds.includes(p.id)} onChange={() => toggle('eligiblePizzaIds', p.id)} />
                      <span>{p.name}</span>
                      <span className="muted price">{formatPrice(p.price)}</span>
                    </label>
                  ))}
                </div>
                <h4 className="card__subtitle">Boissons offertes possibles (grandes bouteilles)</h4>
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
              </div>
            )}
          </section>
        </div>
      </section>

      <section className="settings-group" aria-labelledby="settings-donnees">
        <h2 className="settings-group__title" id="settings-donnees">
          Données et sauvegardes
        </h2>
        <div className="settings-grid">
          <BackupCard />

          <RestoreCard />

          <section className="card settings-grid__wide card--danger">
            <h3 className="card__title">
              <Icon name="database" /> Données de test
            </h3>
            <p>
              Cette version est destinée aux tests : les données sont stockées uniquement dans ce navigateur (localStorage) et ne doivent pas
              contenir de véritables informations clients.
            </p>
            <button type="button" className="btn btn--primary" onClick={() => setConfirmReset(true)}>
              <Icon name="refresh" /> Réinitialiser les données de démonstration
            </button>
          </section>
        </div>
      </section>

      {confirmReset && (
        <ConfirmDialog
          title="Réinitialiser toutes les données ?"
          confirmLabel="Tout réinitialiser"
          onCancel={() => setConfirmReset(false)}
          onConfirm={() => {
            store.resetDemoData();
            setDraft(store.getData().settings);
            setConfirmReset(false);
            toast('Données de démonstration rechargées', 'success');
          }}
          message="Clients, commandes, journal de fidélité et paramètres seront effacés de ce navigateur, puis remplacés par le jeu de démonstration. Action irréversible."
        />
      )}
    </div>
  );
}
