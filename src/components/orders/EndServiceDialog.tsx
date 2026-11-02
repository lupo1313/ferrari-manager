import { useEffect, useRef, useState } from 'react';
import { Modal } from '../ui/Modal';
import { useAppData, useStore } from '../../state/StoreContext';
import { closureBlockers, exportsConfirmed, type ClosureChoices, type ClosureReceipts } from '../../domain/closure';
import { confirmedPayments, serviceReport } from '../../domain/serviceReport';
import { buildServicePdf } from '../../services/servicePdf';
import { checkClosureTabs, commitClosure, prepareClosure, type ClosurePreparation } from '../../storage/closure';
import { tabPresence } from '../../storage/tabs';
import { STORAGE_NAMESPACE } from '../../storage/repository';
import { createId } from '../../domain/ids';
import { currentService, serviceOfOrder } from '../../domain/service';
import { computePeriodStats } from '../../domain/statistics';
import { formatPrice } from '../../domain/money';
import '../../styles/closure.css';

const noReceipts = (): ClosureReceipts => ({ report: false, backup: false });
interface Ready { plan: ClosurePreparation; reportUrl: string | null; backupUrl: string | null }
export function EndServiceDialog({ onClose }: { onClose: () => void }) {
  const store = useStore(), data = useAppData();
  const [choices, setChoices] = useState<ClosureChoices>({ report: true, backup: true });
  const [ready, setReady] = useState<Ready | null>(null);
  const [downloaded, setDownloaded] = useState(noReceipts), [saved, setSaved] = useState(noReceipts);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false), running = useRef(false);
  const [failure, setFailure] = useState<string | null>(null), [needsReload, setNeedsReload] = useState(false);
  const blockers = closureBlockers(data), service = currentService(data.services);
  const stats = computePeriodStats({ kind: 'service', key: service.id, services: [service] }, data.orders, data.services, new Date().toISOString());
  const payments = confirmedPayments(data.orders.filter((o) => serviceOfOrder(o, data.services) === service.id));
  const generated = { report: !!ready?.reportUrl, backup: !!ready?.backupUrl };
  const canFinish = !!ready && confirmed && exportsConfirmed(choices, generated, saved) && !blockers.blocked && !needsReload;
  useEffect(() => () => {
    if (ready?.reportUrl) URL.revokeObjectURL(ready.reportUrl);
    if (ready?.backupUrl) URL.revokeObjectURL(ready.backupUrl);
  }, [ready]);
  const close = () => { if (!running.current && !needsReload) onClose(); };
  const examine = () => { window.location.hash = blockers.cart ? '#/' : '#/commandes'; onClose(); };
  const generate = async () => {
    if (running.current) return;
    running.current = true; setBusy(true); setFailure(null);
    let reportUrl: string | null = null, backupUrl: string | null = null;
    try {
      store.flushPendingWrites();
      if (store.getPersistError()) throw new Error(store.getPersistError()!);
      const plan = await prepareClosure(window.localStorage, store.getData(), new Date(), createId('cloture'));
      if (choices.report) reportUrl = URL.createObjectURL(new Blob([buildServicePdf(data.settings.pizzeria.name, serviceReport(data, plan.at))], { type: 'application/pdf' }));
      if (choices.backup) backupUrl = URL.createObjectURL(new Blob([plan.backupText], { type: 'application/json' }));
      setDownloaded(noReceipts()); setSaved(noReceipts()); setConfirmed(false); setReady({ plan, reportUrl, backupUrl });
    } catch (e) {
      if (reportUrl) URL.revokeObjectURL(reportUrl);
      if (backupUrl) URL.revokeObjectURL(backupUrl);
      setFailure((e instanceof Error ? e.message : 'Génération impossible.') + ' Aucune donnée supprimée.');
    } finally { running.current = false; setBusy(false); }
  };
  const finish = async () => {
    if (running.current || !ready || !canFinish) return;
    running.current = true; setBusy(true); setFailure(null);
    try {
      if (!navigator.locks) throw new Error('Verrouillage entre onglets indisponible : clôture bloquée sur ce navigateur.');
      await navigator.locks.request(`${STORAGE_NAMESPACE}-cloture`, { ifAvailable: true }, async (lock) => {
        if (!lock) throw new Error('Une autre clôture est en cours.');
        await checkClosureTabs(tabPresence());
        if (store.getPersistError()) throw new Error(store.getPersistError()!);
        store.suspendWrites('Clôture en cours : ne fermez pas la page.'); tabPresence()?.announceRestore();
        const result = commitClosure(window.localStorage, ready.plan, choices, generated, saved, confirmed);
        if (result.ok) { window.location.reload(); return; }
        if (!result.committed) store.resumeWrites(); else setNeedsReload(true);
        throw new Error(result.error);
      });
    } catch (e) { setFailure(e instanceof Error ? e.message : 'Clôture impossible.'); }
    finally { running.current = false; setBusy(false); }
  };
  return <Modal title="Clôturer le service" subtitle="Bilan PDF et sauvegarde de récupération : deux fichiers indépendants."
    onClose={close} size="lg" dismissOnBackdrop={false} footer={<>
      <button type="button" className="btn" disabled={busy || needsReload} onClick={close}>Annuler</button>
      {needsReload ? <button className="btn btn--primary" onClick={() => window.location.reload()}>Recharger et terminer le nettoyage</button>
        : blockers.blocked ? <button className="btn btn--primary" onClick={examine}>Résoudre les éléments en attente</button>
        : !ready ? <button className="btn btn--primary" disabled={busy} onClick={() => void generate()}>{busy ? 'Préparation…' : 'Préparer la clôture'}</button>
        : <button className="btn btn--primary" disabled={!canFinish || busy} onClick={() => void finish()}>{busy ? 'Vérification…' : 'Clôturer et retirer les commandes'}</button>}
    </>}>
    <div className="closure-summary">
      <div><span>Ventes enregistrées</span><strong>{formatPrice(stats.registered)}</strong><small>Hors annulations, cadeaux à part</small></div>
      <div><span>Encaissements confirmés</span><strong>{formatPrice(payments.total)}</strong><small>{payments.count} commandes hors annulées ; montants déclarés dans le logiciel</small></div>
      <div><span>Annulations / cadeaux</span><strong>{stats.cancelled.count} / {stats.rewards}</strong><small>Distingués des ventes dans le bilan</small></div>
    </div>
    {blockers.blocked && <section className="notice notice--error" role="alert">
      <strong>Clôture bloquée : aucun élément ne sera supprimé.</strong>
      {!data.serviceOpen && <p>Ce service est déjà fermé.</p>}
      {blockers.cart && <p>Panier ou modification en cours : terminez la saisie, enregistrez ou abandonnez-la explicitement depuis Nouvelle commande.</p>}
      {!!blockers.reservations && <p>{blockers.reservations} récompense(s) réservée(s) à résoudre.</p>}
      <ul>{blockers.orders.map(({ order, reasons }) => <li key={order.id}>Commande n° {order.number} : {reasons.join(', ')}{order.archivedAt ? ' (archive)' : ''}.</li>)}</ul>
    </section>}
    <p><strong>{data.orders.length} commande(s), archives comprises, seront retirées définitivement de ce Manager.</strong> Les anciens services et leurs statistiques ainsi que l’ancienne copie interne de restauration seront retirés. Aucun retour interne à cet historique après clôture.</p>
    <p>Clients, fidélité, carte, suppléments et paramètres conservés. Service fermé, panier vide. La sauvegarde complète habituelle reste disponible depuis Paramètres avant de continuer.</p>
    {!ready ? <fieldset className="closure-choices" disabled={busy || blockers.blocked}><legend>Fichiers souhaités (facultatifs)</legend>
      <label><input type="checkbox" checked={choices.report} onChange={(e) => setChoices({ ...choices, report: e.target.checked })} /><span><strong>Exporter le bilan du service (PDF)</strong><small>Ventes, encaissements confirmés, annulations et cadeaux. Chiffres indicatifs, pas un document de caisse certifié.</small></span></label>
      <label><input type="checkbox" checked={choices.backup} onChange={(e) => setChoices({ ...choices, backup: e.target.checked })} /><span><strong>Sauvegarder le logiciel pour la reprise (JSON)</strong><small>Clients, fidélité, carte, suppléments et paramètres. État après clôture : fermé, panier vide, sans commandes. Ce fichier n’est pas un bilan.</small></span></label>
    </fieldset> : <section className="closure-files">
      <h3>Enregistrez chaque fichier demandé</h3><p>Un téléchargement lancé ne prouve pas l’enregistrement. Vérifiez le fichier sur cet appareil ou la clé USB, puis confirmez ci-dessous. Si vous annulez l’enregistrement, annulez aussi cette clôture ou réessayez.</p>
      {(['report', 'backup'] as const).filter((key) => choices[key]).map((key) => <div className="closure-file" key={key}>
        <a className="btn btn--dark" href={(key === 'report' ? ready.reportUrl : ready.backupUrl)!}
          download={`ferrari-manager-${key === 'report' ? 'bilan' : 'reprise'}-${ready.plan.at.replace(/[:.]/g, '-')}.${key === 'report' ? 'pdf' : 'json'}`}
          onClick={() => setDownloaded({ ...downloaded, [key]: true })}>{key === 'report' ? 'Télécharger le bilan PDF' : 'Télécharger la sauvegarde de reprise'}</a>
        <label><input type="checkbox" disabled={!downloaded[key] || busy} checked={saved[key]} onChange={(e) => setSaved({ ...saved, [key]: e.target.checked })} />{key === 'report' ? 'J’ai enregistré et vérifié le bilan PDF.' : 'J’ai enregistré et vérifié la sauvegarde de reprise.'}</label>
      </div>)}
      {!choices.report && !choices.backup && <p>Aucun fichier demandé. Aucun bilan ni fichier de récupération ne sera créé.</p>}
      <label className="closure-final"><input type="checkbox" checked={confirmed} disabled={busy} onChange={(e) => setConfirmed(e.target.checked)} /><span><strong>Je confirme la clôture et le retrait définitif des {data.orders.length} commandes, des anciens services et de la copie interne.</strong> Je conserve clients, fidélité, carte, suppléments et paramètres.</span></label>
      <button className="btn btn--ghost" disabled={busy} onClick={() => { setReady(null); setSaved(noReceipts()); setConfirmed(false); }}>Revenir aux choix des fichiers</button>
    </section>}
    {failure && <p className="notice notice--error" role="alert">{failure}</p>}
  </Modal>;
}
