import { useEffect, useState } from 'react';
import { Icon } from '../components/ui/Icon';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { useToast } from '../components/ui/Toast';
import { useAppData, useStore, useCatalog } from '../state/StoreContext';
import { formatPrice } from '../domain/money';
import type { Settings, TicketWidth } from '../domain/types';
import { paymentSound } from '../audio/paymentSound';
import { TICKET_TEXT_LIMITS } from '../domain/pizzeria';
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
    <div className="page settings-page">
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
          <details className="settings-disclosure settings-grid__wide" open>
            <summary><Icon name="printer" /><strong>Pizzeria et ticket</strong><span className="field__hint">Cliquez sur Enregistrer pour appliquer</span></summary>
            <div className="settings-disclosure__body">
              <div className="settings-fields">
                {([['name', 'Nom sur le ticket'], ['phone', 'Téléphone'], ['address', 'Adresse']] as const).map(([key, label]) => (
                  <label className="field" key={key}><span className="field__label">{label}</span>
                    <input className="input" value={draft.pizzeria[key]} onChange={(e) => setDraft((d) => ({ ...d, pizzeria: { ...d.pizzeria, [key]: e.target.value } }))} />
                  </label>
                ))}
                <label className="field"><span className="field__label">Largeur du rouleau thermique</span>
                  <select className="input" value={draft.ticketWidthMm} onChange={(e) => setDraft((d) => ({ ...d, ticketWidthMm: Number(e.target.value) as TicketWidth }))}>
                    <option value={58}>58 mm</option><option value={80}>80 mm</option>
                  </select>
                </label>
              </div>
              <details className="settings-optional">
                <summary>Mentions et pied de ticket <span className="muted">Facultatifs</span></summary>
                <p className="field__hint">SIRET, RCS, TVA et mentions sur le ticket livreur. Pied personnalisé sur les deux tickets. Vides : aucune ligne ajoutée.</p>
                <div className="settings-fields">
                  {([['siret', 'SIRET'], ['rcs', 'RCS'], ['vatNumber', 'Numéro de TVA intracommunautaire']] as const).map(([key, label]) => (
                    <label className="field" key={key}><span className="field__label">{label}</span>
                      <input className="input" maxLength={TICKET_TEXT_LIMITS[key]} value={draft.pizzeria[key] ?? ''} onChange={(e) => setDraft((d) => ({ ...d, pizzeria: { ...d.pizzeria, [key]: e.target.value } }))} />
                    </label>
                  ))}
                </div>
                <div className="settings-fields settings-fields--text">
                  {([['additionalMentions', 'Mentions complémentaires libres'], ['ticketFooter', 'Pied de ticket personnalisé']] as const).map(([key, label]) => (
                    <label className="field" key={key}><span className="field__label">{label}</span>
                      <textarea className="input" rows={2} maxLength={TICKET_TEXT_LIMITS[key]} value={draft.pizzeria[key] ?? ''} onChange={(e) => setDraft((d) => ({ ...d, pizzeria: { ...d.pizzeria, [key]: e.target.value } }))} />
                      <span className="field__hint">{(draft.pizzeria[key] ?? '').length} / {TICKET_TEXT_LIMITS[key]} caractères</span>
                    </label>
                  ))}
                </div>
              </details>
            </div>
          </details>
          <div className="settings-quick settings-grid__wide">
            <section className="settings-inline">
              <Icon name="volume" /><div><h3>Son des encaissements</h3><span className="field__hint">Caisse enregistreuse · Enregistrement immédiat</span></div>
              <button type="button" className="btn settings-switch" role="switch" aria-label="Son des encaissements" aria-checked={data.settings.paymentSound} onClick={() => {
                const on = !data.settings.paymentSound;
                const r = store.updateSettings({ paymentSound: on, paymentSoundKind: 'caisse' });
                if (!r.ok) toast(r.error, 'error');
                else setDraft((d) => ({ ...d, paymentSound: on, paymentSoundKind: 'caisse' }));
              }}>{data.settings.paymentSound ? 'Activé' : 'Désactivé'}</button>
              <button type="button" className="btn" onClick={() => {
                if (!paymentSound.play('caisse')) toast('Son indisponible sur cet appareil (vérifiez le volume ou le mode silencieux).', 'info');
              }}>Écouter</button>
            </section>
            <section className="settings-inline">
              <div><h3>Onglet Statistiques</h3><span className="field__hint">Enregistrement immédiat · données conservées</span></div>
              <button type="button" className="btn" aria-pressed={data.settings.modules.statistiques} aria-label={data.settings.modules.statistiques ? 'Masquer les statistiques' : 'Afficher les statistiques'} onClick={() => {
                const on = !data.settings.modules.statistiques;
                const r = store.updateSettings({ modules: { statistiques: on } });
                if (!r.ok) toast(r.error, 'error');
                else setDraft((d) => ({ ...d, paymentSoundKind: r.value.paymentSoundKind, modules: { statistiques: on } }));
              }}><Icon name={data.settings.modules.statistiques ? 'eye' : 'eyeOff'} />{data.settings.modules.statistiques ? 'Affiché' : 'Masqué'}</button>
            </section>
          </div>
          <p className="settings-delivery settings-grid__wide"><Icon name="truck" /><strong>Livraison toujours offerte (0 €)</strong><span className="muted">Règle fixe, aucun frais ajouté.</span></p>

          {/* Mentions exigées par les conditions du serveur public FOSSGIS et la licence OpenStreetMap. */}
          <details className="settings-disclosure settings-grid__wide">
            <summary><Icon name="info" /><strong>Informations avancées</strong><span className="field__hint">Calcul des trajets de livraison</span></summary>
            <div className="settings-disclosure__body">
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
            </div>
          </details>
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
          <details className="settings-disclosure settings-grid__wide"><summary><Icon name="database" /><strong>Sauvegarder les données</strong><span className="field__hint">Fichier JSON complet</span></summary><BackupCard /></details>

          <details className="settings-disclosure settings-grid__wide"><summary><Icon name="history" /><strong>Restaurer une sauvegarde</strong><span className="field__hint">Contrôles et copie de sécurité</span></summary><RestoreCard /></details>

          <details className="settings-disclosure settings-grid__wide"><summary><Icon name="alert" /><strong>Données de démonstration</strong><span className="field__hint">Remplacement des données, avec confirmation</span></summary>
          <section className="card card--danger">
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
          </section></details>
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
