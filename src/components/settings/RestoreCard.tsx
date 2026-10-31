import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Icon } from '../ui/Icon';
import { Modal } from '../ui/Modal';
import { useAppData, useStore } from '../../state/StoreContext';
import { dryRunLoad, emptyCartText, factsOf } from '../../state/restoreDryRun';
import { tabPresence } from '../../storage/tabs';
import {
  analyzeBackupText,
  performRestore,
  planFromSafetyCopy,
  readSafetyCopy,
  restoreKeys,
  type AnalyzedBackup,
  type Problem,
  type RestoreFacts,
  type RestorePlan,
} from '../../storage/restore';
import type { BackupFile } from '../../storage/export';

interface Review {
  title: string;
  source: string;
  analysis: AnalyzedBackup;
  plan: RestorePlan;
  after: RestoreFacts;
}

const PROBLEM_LABELS: Record<Problem['kind'], string> = {
  fichier: 'Fichier',
  structure: 'Données invalides',
  reference: 'Référence cassée',
};

const formatDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }).replace(' ', ' à ') : 'date inconnue';

function storage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Copie de sécurité enregistrée : date et contenu, pour la carte et le téléchargement. */
function describeCopy(text: string | null): { date: string | null; commandes: number; clients: number } | null {
  if (!text) return null;
  try {
    const raw = JSON.parse(text) as BackupFile;
    return { date: raw.exporteLe ?? null, commandes: raw.resume?.commandes ?? 0, clients: raw.resume?.clients ?? 0 };
  } catch {
    return null;
  }
}

/**
 * Restauration d'une sauvegarde (intervention 8) : sélection du fichier, contrôles complets sans écriture,
 * résumé avant/après, avertissement, confirmation, copie de sécurité puis remplacement et rechargement.
 * Carte « Copie de sécurité » : téléchargement et retour arrière COMPLET (panier et modification compris).
 */
export function RestoreCard() {
  const store = useStore();
  const data = useAppData();
  const keys = restoreKeys();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [refused, setRefused] = useState<{ source: string; problems: Problem[] } | null>(null);
  const [understood, setUnderstood] = useState(false);
  const [failure, setFailure] = useState<{ message: string; reload: boolean } | null>(null);
  const [copyText, setCopyText] = useState<string | null>(() => {
    const kv = storage();
    return kv ? readSafetyCopy(kv, keys) : null;
  });
  const copy = useMemo(() => describeCopy(copyText), [copyText]);
  const copyUrl = useMemo(() => (copyText ? URL.createObjectURL(new Blob([copyText], { type: 'application/json' })) : null), [copyText]);
  useEffect(() => () => {
    if (copyUrl) URL.revokeObjectURL(copyUrl);
  }, [copyUrl]);

  const locked = store.isStorageLocked();
  const before = locked ? null : factsOf(data);
  const cartArticles = data.cart.lines.reduce((n, l) => n + l.quantity, 0);
  const editing = data.cart.editingOrderId ? data.orders.find((o) => o.id === data.cart.editingOrderId) : undefined;

  /** Contrôles complets puis chargement à blanc ; aucune écriture. */
  async function examine(text: string, source: string, mode: RestorePlan['mode']) {
    setBusy('Vérification du fichier…');
    try {
      const analysis = await analyzeBackupText(text, keys.namespace);
      if (!analysis.ok) {
        setRefused({ source, problems: analysis.problems });
        return;
      }
      const plan = mode === 'fichier' ? { mode, docText: analysis.docText, cartText: emptyCartText() } : planFromSafetyCopy(text, keys);
      if (!plan) {
        setRefused({ source, problems: [{ kind: 'fichier', message: 'Copie de sécurité incomplète.' }] });
        return;
      }
      const dry = dryRunLoad(plan.docText, plan.cartText);
      if (!dry.ok) {
        setRefused({ source, problems: [{ kind: 'structure', message: `L’application ne pourrait pas charger ces données (${dry.reason}).` }] });
        return;
      }
      setUnderstood(false);
      setFailure(null);
      setReview({
        title: mode === 'fichier' ? 'Restaurer cette sauvegarde ?' : 'Revenir à la copie de sécurité ?',
        source,
        analysis,
        plan,
        after: dry.facts,
      });
    } catch {
      setRefused({ source, problems: [{ kind: 'fichier', message: 'Lecture du fichier impossible.' }] });
    } finally {
      setBusy(null);
    }
  }

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = ''; // permet de choisir à nouveau le même fichier
    if (!file) return;
    let text: string;
    try {
      text = await file.text();
    } catch {
      setRefused({ source: file.name, problems: [{ kind: 'fichier', message: 'Lecture du fichier impossible.' }] });
      return;
    }
    await examine(text, file.name, 'fichier');
  };

  const confirm = async () => {
    if (!review) return;
    const kv = storage();
    if (!kv) {
      setFailure({ message: 'Stockage du navigateur inaccessible : restauration impossible.', reload: false });
      return;
    }
    setBusy('Vérification des autres onglets…');
    const others = await (tabPresence()?.otherTabs() ?? Promise.resolve(null));
    if (others) {
      setBusy(null);
      setFailure({ message: 'Ferrari Manager est ouvert dans un autre onglet ou une autre fenêtre : fermez-le, puis recommencez. Rien n’a été modifié.', reload: false });
      return;
    }
    setBusy('Restauration en cours…');
    store.suspendWrites('Restauration en cours : ne fermez pas la page.');
    tabPresence()?.announceRestore();
    const outcome = await performRestore(kv, review.plan, { now: new Date(), origin: window.location.origin + window.location.pathname, keys });
    if (outcome.ok) {
      const f = review.after;
      try {
        sessionStorage.setItem(
          keys.notice,
          review.plan.mode === 'fichier'
            ? `Sauvegarde restaurée : ${f.clients} clients, ${f.commandes} commandes. Panier vide. Copie de l’état précédent disponible dans Paramètres.`
            : 'Retour à la copie de sécurité effectué : données et panier d’avant la restauration.',
        );
      } catch {
        /* message seulement */
      }
      window.location.reload();
      return;
    }
    setBusy(null);
    setCopyText(readSafetyCopy(kv, keys));
    if (!outcome.changed) store.resumeWrites();
    setFailure({ message: outcome.error, reload: outcome.changed });
  };

  const rows: [string, (f: RestoreFacts) => string][] = [
    ['Clients', (f) => String(f.clients)],
    ['Commandes', (f) => `${f.commandes} (${f.commandesEnCours} affichées, ${f.commandesArchivees} archivées)`],
    ['Encaissées', (f) => String(f.commandesEncaissees)],
    ['Paiement non suivi', (f) => String(f.commandesPaiementNonSuivi)],
    ['Services', (f) => `${f.services} · ${f.serviceOuvert ? 'ouvert' : 'fermé'}`],
    ['Prochain numéro', (f) => String(f.prochainNumero)],
    ['Dernière commande', (f) => formatDate(f.derniereCommande)],
    ['Fidélité', (f) => `${f.evenementsFidelite} opérations · ${f.pizzasComptees} pizzas comptées · ${f.recompensesDisponibles} récompense(s) disponible(s)`],
  ];

  return (
    <section className="card settings-grid__wide">
      <h2 className="card__title">
        <Icon name="refresh" /> Restaurer une sauvegarde
      </h2>
      <p>
        Remplace les données de ce navigateur par celles d’un fichier créé avec « Sauvegarder mes données » (par exemple depuis une clé USB).
        Le fichier est entièrement vérifié avant toute modification, et une copie de sécurité de l’état actuel est créée automatiquement.
      </p>
      <input ref={input} type="file" accept=".json,application/json" className="sr-only" onChange={onFile} tabIndex={-1} aria-hidden="true" />
      <button type="button" className="btn btn--dark" onClick={() => input.current?.click()} disabled={busy !== null}>
        <Icon name="file" /> {busy ?? 'Choisir un fichier de sauvegarde'}
      </button>

      <div className="backup-result">
        {copy && copyText ? (
          <>
            <p className="backup-result__ok">
              <Icon name="database" size={18} /> Copie de sécurité du {formatDate(copy.date)} : état avant la dernière restauration ({copy.commandes} commandes,{' '}
              {copy.clients} clients, panier compris).
            </p>
            <div className="backup-result__actions">
              {copyUrl && (
                <a className="btn" href={copyUrl} download={`ferrari-manager-copie-de-securite-${(copy.date ?? '').slice(0, 10)}.json`}>
                  <Icon name="file" /> Télécharger la copie
                </a>
              )}
              <button type="button" className="btn" disabled={busy !== null} onClick={() => examine(copyText, 'Copie de sécurité', 'copie')}>
                <Icon name="history" /> Revenir à cet état
              </button>
            </div>
          </>
        ) : (
          <p className="muted">Aucune copie de sécurité : elle sera créée automatiquement à la première restauration.</p>
        )}
      </div>

      {refused && (
        <Modal
          title="Fichier refusé"
          subtitle={`${refused.source} · rien n’a été modifié`}
          onClose={() => setRefused(null)}
          size="md"
          footer={
            <button type="button" className="btn btn--lg" onClick={() => setRefused(null)} data-autofocus>
              Fermer
            </button>
          }
        >
          <ul className="restore-problems">
            {refused.problems.map((p, i) => (
              <li key={i}>
                <strong>{PROBLEM_LABELS[p.kind]} :</strong> {p.message}
              </li>
            ))}
          </ul>
        </Modal>
      )}

      {review && (
        <Modal
          title={review.title}
          subtitle={`${review.source} · ${review.plan.mode === 'fichier' ? `sauvegarde du ${formatDate(review.analysis.exporteLe)}` : 'état avant la dernière restauration'}`}
          onClose={() => busy === null && setReview(null)}
          dismissOnBackdrop={false}
          size="lg"
          footer={
            failure?.reload ? (
              <button type="button" className="btn btn--lg btn--primary" onClick={() => window.location.reload()}>
                Recharger la page
              </button>
            ) : (
              <>
                <button type="button" className="btn btn--lg" onClick={() => setReview(null)} disabled={busy !== null} data-autofocus>
                  Annuler
                </button>
                <button type="button" className="btn btn--lg btn--primary" onClick={confirm} disabled={!understood || busy !== null}>
                  {busy ?? (review.plan.mode === 'fichier' ? 'Remplacer mes données' : 'Revenir à cet état')}
                </button>
              </>
            )
          }
        >
          <div className="restore-review">
            <p className="restore-review__source">
              Provenance : {review.analysis.provenance === 'production' ? 'version de production' : 'prévisualisation'}
              {review.analysis.empreinte === 'sha256' ? ' · intégrité vérifiée (empreintes)' : ' · fichier sans empreinte (longueurs vérifiées)'}
            </p>
            <table className="restore-table">
              <thead>
                <tr>
                  <th scope="col">Données</th>
                  <th scope="col">Actuellement</th>
                  <th scope="col">Après</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(([label, value]) => (
                  <tr key={label}>
                    <th scope="row">{label}</th>
                    <td>{before ? value(before) : 'illisibles'}</td>
                    <td>{value(review.after)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="restore-warning" role="alert">
              <Icon name="alert" size={18} />
              <div>
                {review.plan.mode === 'fichier' ? (
                  <>
                    <p>
                      <strong>Les données actuelles de ce navigateur seront remplacées par celles du fichier, sans fusion.</strong> Une copie de sécurité
                      de l’état actuel (panier compris) sera créée juste avant.
                    </p>
                    <p>
                      Panier : {!review.analysis.fileCart
                        ? 'le fichier ne contient pas de panier. '
                        : review.analysis.fileCart.articles > 0 || review.analysis.fileCart.modificationCommande
                          ? `le panier sauvegardé dans le fichier (${review.analysis.fileCart.articles} article(s)${review.analysis.fileCart.modificationCommande ? `, modification de la commande n° ${review.analysis.fileCart.modificationCommande}` : ''}) ne sera pas repris. `
                          : 'le panier sauvegardé dans le fichier (vide) ne sera pas repris. '}
                      {cartArticles > 0 || editing
                        ? `Le panier actuel (${cartArticles} article(s)${editing ? `, modification de la commande n° ${editing.number}` : ''}) sera remplacé par un panier vide ; il reste dans la copie de sécurité.`
                        : 'Le panier actuel est vide.'}
                    </p>
                  </>
                ) : (
                  <p>
                    <strong>Retour arrière complet :</strong> données, panier et modification en cours redeviennent exactement ceux d’avant la dernière
                    restauration. L’état actuel est lui-même gardé comme nouvelle copie de sécurité.
                  </p>
                )}
                <p>Fermez les autres onglets de Ferrari Manager avant de continuer.</p>
              </div>
            </div>

            {(review.analysis.notes.length > 0 || review.after.clientsEnDette > 0) && (
              <ul className="restore-notes">
                {review.analysis.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
                {review.after.clientsEnDette > 0 && (
                  <li>{review.after.clientsEnDette} client(s) avec un solde de récompenses négatif (dette) : situation permise par les règles de fidélité.</li>
                )}
              </ul>
            )}

            {failure && (
              <p className="notice notice--error" role="alert">
                <Icon name="alert" size={18} /> {failure.message}
              </p>
            )}

            <label className="restore-confirm">
              <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} disabled={busy !== null || failure?.reload} />
              J’ai compris que les données actuelles seront remplacées.
            </label>
          </div>
        </Modal>
      )}
    </section>
  );
}
