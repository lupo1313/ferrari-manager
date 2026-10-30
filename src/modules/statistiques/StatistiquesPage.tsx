import { useEffect, useMemo, useState } from 'react';
import monogram from '../../assets/monogram-ferrari.webp';
import { Icon, type IconName } from '../../components/ui/Icon';
import { useAppSelector } from '../../state/StoreContext';
import { formatPrice } from '../../domain/money';
import { availablePeriods, computePeriodStats, dueHint, hasOrdersBeforeTracking, periodLabel, type Period, type PeriodKind, type PeriodStats } from './calculs';
import { HourlyChart } from './HourlyChart';
import { BestSellers } from './BestSellers';
import './statistiques.css';

const KINDS: { kind: PeriodKind; label: string }[] = [
  { kind: 'service', label: 'Service' },
  { kind: 'jour', label: 'Jour' },
  { kind: 'semaine', label: 'Semaine' },
  { kind: 'mois', label: 'Mois' },
];

const s = (n: number) => (n > 1 ? 's' : '');

/** Heure courante, rafraîchie chaque minute (axe horaire d'un service en cours). */
function useNow(): string {
  const [now, setNow] = useState(() => new Date().toISOString());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date().toISOString()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

/**
 * Tableau de bord des statistiques (module facultatif, lecture seule).
 * Les chiffres sont recalculés à chaque changement des commandes : rien n'est stocké par le module.
 */
export default function StatistiquesPage() {
  const orders = useAppSelector((d) => d.orders);
  const services = useAppSelector((d) => d.services);
  const now = useNow();
  const [kind, setKind] = useState<PeriodKind>('service');
  /** Période choisie ; null = la plus récente (suit l'ouverture d'un nouveau service). */
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const periods = useMemo(() => availablePeriods(kind, services, hasOrdersBeforeTracking(orders, services)), [kind, services, orders]);
  const found = selectedKey === null ? -1 : periods.findIndex((p) => p.key === selectedKey);
  const index = found < 0 ? 0 : found;
  const period = periods[index];
  const stats = useMemo(() => (period ? computePeriodStats(period, orders, services, now) : null), [period, orders, services, now]);

  const go = (i: number) => setSelectedKey(i === 0 ? null : periods[i]?.key ?? null);

  return (
    <div className="page stats-page">
      <header className="page__header">
        <div>
          <h1 className="page__title">Statistiques</h1>
          <p className="muted">Bilan des commandes et des encaissements marqués dans Ferrari Manager.</p>
        </div>
        <div className="segmented stats-kinds" role="group" aria-label="Période">
          {KINDS.map((k) => (
            <button
              key={k.kind}
              type="button"
              className="segmented__item"
              aria-pressed={kind === k.kind}
              onClick={() => {
                setKind(k.kind);
                setSelectedKey(null);
              }}
            >
              {k.label}
            </button>
          ))}
        </div>
      </header>

      {period && stats ? (
        <>
          <div className="stats-nav">
            <button type="button" className="icon-btn stats-nav__arrow" aria-label="Période précédente" disabled={index >= periods.length - 1} onClick={() => go(index + 1)}>
              <Icon name="chevronLeft" size={24} />
            </button>
            <div className="stats-nav__label">
              <strong>{periodLabel(period)}</strong>
              <PeriodStatus period={period} />
            </div>
            <button type="button" className="icon-btn stats-nav__arrow" aria-label="Période suivante" disabled={index === 0} onClick={() => go(index - 1)}>
              <Icon name="chevronRight" size={24} />
            </button>
            {index > 0 && (
              <button type="button" className="btn btn--sm stats-nav__latest" onClick={() => go(0)}>
                {kind === 'service' ? 'Service le plus récent' : 'Période la plus récente'}
              </button>
            )}
          </div>

          <p className="notice notice--info stats-disclaimer">
            <Icon name="info" size={18} />
            <span>
              Chiffres indicatifs, calculés à partir des encaissements confirmés à la main dans l’application. Ferrari Manager n’est ni une
              caisse ni un logiciel de comptabilité certifié.
            </span>
          </p>

          <section className="stats-kpis" aria-label="Indicateurs principaux">
            <div className="stats-hero">
              <img className="stats-hero__mark" src={monogram} alt="" width={512} height={512} />
              <span className="stats-hero__label">Total encaissé</span>
              <strong className="stats-hero__amount">{formatPrice(stats.paid)}</strong>
              <span className="stats-hero__sub">
                {stats.paidAfterClose > 0 ? (
                  <>
                    {formatPrice(stats.paidBeforeClose)} avant la clôture · <b>{formatPrice(stats.paidAfterClose)}</b> encaissé
                    {s(stats.paidAfterCloseCount)} après la clôture
                  </>
                ) : (
                  <>
                    {stats.paidCount} commande{s(stats.paidCount)} marquée{s(stats.paidCount)} encaissée{s(stats.paidCount)}
                  </>
                )}
              </span>
            </div>
            <Kpi icon="orders" label="Commandes enregistrées" value={String(stats.orderCount)} hint={`Montant total : ${formatPrice(stats.registered)}`} />
            <Kpi
              icon="clock"
              label="Reste à encaisser"
              value={formatPrice(stats.due)}
              hint={dueHint(stats)}
              tone={stats.due > 0 ? 'warn' : undefined}
            />
            <Kpi
              icon="pizza"
              label="Pizzas vendues"
              value={String(stats.pizzas)}
              hint={stats.rewards ? `Payantes · ${stats.rewards} produit${s(stats.rewards)} offert${s(stats.rewards)} en plus` : 'Pizzas payantes uniquement'}
            />
          </section>

          <section className="stats-strip" aria-label="Autres indicateurs">
            <StripItem icon="cart" value={formatPrice(stats.averageBasket)} label="Panier moyen" />
            <StripItem icon="cup" value={String(stats.drinks)} label={`Boisson${s(stats.drinks)} vendue${s(stats.drinks)}`} />
            <StripItem icon="cake" value={String(stats.desserts)} label={`Dessert${s(stats.desserts)} vendu${s(stats.desserts)}`} />
            <StripItem icon="truck" value={String(stats.deliveries)} label={`Livraison${s(stats.deliveries)} · offerte${s(stats.deliveries)}`} />
            <StripItem icon="bag" value={String(stats.takeaway)} label="À emporter" />
            <StripItem icon="close" value={String(stats.cancelled.count)} label={`Annulée${s(stats.cancelled.count)} · exclue${s(stats.cancelled.count)}`} />
          </section>

          <Notes period={period} stats={stats} />

          <div className="stats-lower">
            <section className="card stats-panel">
              <HourlyChart buckets={stats.hourly} peak={stats.peak} />
            </section>
            <section className="card stats-panel">
              <BestSellers ranking={stats.ranking} />
            </section>
          </div>
        </>
      ) : (
        <div className="page__empty empty">
          <p className="empty__title">Aucun service enregistré</p>
          <p className="muted">Les statistiques apparaîtront après l’ouverture d’un service.</p>
        </div>
      )}
    </div>
  );
}

function PeriodStatus({ period }: { period: Period }) {
  if (period.kind === 'avant') return <span className="stats-status">Regroupement approximatif des anciennes commandes</span>;
  const open = period.services.some((x) => !x.closedAt);
  if (period.kind === 'service') {
    return open ? (
      <span className="stats-status stats-status--live">
        <i aria-hidden="true" /> Service en cours · mis à jour en direct
      </span>
    ) : (
      <span className="stats-status">Service clôturé · bilan conservé</span>
    );
  }
  const n = period.services.length;
  return (
    <span className={`stats-status ${open ? 'stats-status--live' : ''}`}>
      {open && <i aria-hidden="true" />}
      {n} service{s(n)}
      {open ? ', dont le service en cours' : ''}
    </span>
  );
}

function Kpi({ icon, label, value, hint, tone }: { icon: IconName; label: string; value: string; hint: string; tone?: 'warn' }) {
  return (
    <div className={`stats-kpi ${tone === 'warn' ? 'stats-kpi--warn' : ''}`}>
      <span className="stats-kpi__icon">
        <Icon name={icon} size={20} />
      </span>
      <span className="stats-kpi__label">{label}</span>
      <strong className="stats-kpi__value">{value}</strong>
      <span className="stats-kpi__hint">{hint}</span>
    </div>
  );
}

function StripItem({ icon, value, label }: { icon: IconName; value: string; label: string }) {
  return (
    <div className="stats-strip__item">
      <span className="stats-strip__icon">
        <Icon name={icon} size={20} />
      </span>
      <span>
        <strong className="stats-strip__value">{value}</strong>
        <span className="stats-strip__label">{label}</span>
      </span>
    </div>
  );
}

/** Situations particulières, affichées seulement quand elles existent. */
function Notes({ period, stats }: { period: Period; stats: PeriodStats }) {
  const notes: string[] = [];
  if (period.kind === 'avant') {
    notes.push('Commandes enregistrées avant la mise en place du suivi des services : elles ne sont rattachées à aucun service précis.');
  }
  if (stats.paidFromEarlier.count > 0) {
    const n = stats.paidFromEarlier.count;
    notes.push(
      `${formatPrice(stats.paidFromEarlier.amount)} encaissé${s(n)} pendant ce service pour ${n} commande${s(n)} d’un service précédent : compté${s(n)} dans leur service d’origine, pas ici.`,
    );
  }
  if (stats.untracked.count > 0) {
    const n = stats.untracked.count;
    notes.push(
      `${n} ancienne${s(n)} commande${s(n)} en « Paiement non suivi » (${formatPrice(stats.untracked.amount)}) : ni encaissée${s(n)} ni à encaisser, incluse${s(n)} dans le total enregistré.`,
    );
  }
  if (stats.cancelled.paidCount > 0) {
    const n = stats.cancelled.paidCount;
    notes.push(`${n} commande${s(n)} annulée${s(n)} après encaissement (${formatPrice(stats.cancelled.paidAmount)}) : remboursement à traiter hors de Ferrari Manager.`);
  }
  if (stats.legacyFeeOrders > 0) {
    const n = stats.legacyFeeOrders;
    notes.push(`${n} ancienne${s(n)} commande${s(n)} avec frais de livraison : frais conservés sur la commande, exclus des statistiques.`);
  }
  if (notes.length === 0) return null;
  return (
    <ul className="stats-notes">
      {notes.map((n) => (
        <li key={n}>
          <Icon name="alert" size={16} /> {n}
        </li>
      ))}
    </ul>
  );
}
