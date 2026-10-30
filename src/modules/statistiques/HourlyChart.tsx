import type { HourBucket } from './calculs';

const W = 640;
const H = 230;
const PAD = { top: 22, right: 8, bottom: 30, left: 30 };

/** Graduation lisible : 4 intervalles au plus, en nombres entiers. */
function scale(max: number) {
  const step = Math.max(1, Math.ceil(max / 4));
  const top = Math.max(step, Math.ceil(max / step) * step);
  const ticks: number[] = [];
  for (let v = 0; v <= top; v += step) ticks.push(v);
  return { top, ticks };
}

/**
 * Activité heure par heure, en SVG (aucune bibliothèque) : commandes enregistrées et encaissements
 * confirmés, côte à côte. L'axe suit l'ordre du service, même après minuit (23 h, 0 h, 1 h).
 */
export function HourlyChart({ buckets, peak }: { buckets: HourBucket[]; peak: HourBucket | null }) {
  const totalOrders = buckets.reduce((n, b) => n + b.orders, 0);
  const totalPayments = buckets.reduce((n, b) => n + b.payments, 0);
  const max = Math.max(1, ...buckets.map((b) => Math.max(b.orders, b.payments)));
  const { top, ticks } = scale(max);
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const slot = buckets.length ? plotW / buckets.length : plotW;
  const barW = Math.min(26, slot * 0.34);
  const y = (v: number) => PAD.top + plotH - (v / top) * plotH;
  const everyOther = buckets.length > 12;

  return (
    <>
      <div className="stats-panel__head">
        <h2 className="card__title">L’activité heure par heure</h2>
        <span className="muted stats-panel__meta">Nombre de commandes</span>
      </div>
      {totalOrders === 0 && totalPayments === 0 ? (
        <p className="muted stats-chart__empty">Aucune commande enregistrée sur cette période.</p>
      ) : (
        <>
          <svg
            className="stats-chart"
            viewBox={`0 0 ${W} ${H}`}
            role="img"
            aria-label={`Activité par heure : ${totalOrders} commandes enregistrées, ${totalPayments} encaissements confirmés.${peak ? ` Pic à ${peak.hour} h.` : ''}`}
          >
            {ticks.map((v) => (
              <g key={v}>
                <line className="stats-chart__grid" x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} />
                <text className="stats-chart__tick" x={PAD.left - 8} y={y(v) + 4} textAnchor="end">
                  {v}
                </text>
              </g>
            ))}
            {buckets.map((b, i) => {
              const cx = PAD.left + slot * i + slot / 2;
              const isPeak = peak?.hour === b.hour;
              return (
                <g key={b.hour}>
                  {b.orders > 0 && (
                    <>
                      <rect className={`stats-chart__bar ${isPeak ? 'stats-chart__bar--peak' : ''}`} x={cx - barW - 1} y={y(b.orders)} width={barW} height={y(0) - y(b.orders)} rx={4} />
                      <text className="stats-chart__value" x={cx - barW / 2 - 1} y={y(b.orders) - 6} textAnchor="middle">
                        {b.orders}
                      </text>
                    </>
                  )}
                  {b.payments > 0 && (
                    <>
                      <rect className="stats-chart__bar stats-chart__bar--paid" x={cx + 1} y={y(b.payments)} width={barW} height={y(0) - y(b.payments)} rx={4} />
                      <text className="stats-chart__value" x={cx + barW / 2 + 1} y={y(b.payments) - 6} textAnchor="middle">
                        {b.payments}
                      </text>
                    </>
                  )}
                  {(!everyOther || i % 2 === 0) && (
                    <text className={`stats-chart__hour ${isPeak ? 'stats-chart__hour--peak' : ''}`} x={cx} y={H - 8} textAnchor="middle">
                      {b.hour} h
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
          <div className="stats-legend">
            <span>
              <i className="stats-legend__dot" /> Commandes enregistrées
            </span>
            <span>
              <i className="stats-legend__dot stats-legend__dot--paid" /> Encaissements confirmés
            </span>
            {peak && (
              <span className="stats-legend__peak">
                Pic d’activité : <strong>{peak.hour} h</strong> ({peak.orders} commande{peak.orders > 1 ? 's' : ''})
              </span>
            )}
          </div>
          <table className="sr-only">
            <caption>Activité par heure</caption>
            <thead>
              <tr>
                <th>Heure</th>
                <th>Commandes enregistrées</th>
                <th>Encaissements confirmés</th>
              </tr>
            </thead>
            <tbody>
              {buckets.map((b) => (
                <tr key={b.hour}>
                  <td>{b.hour} h</td>
                  <td>{b.orders}</td>
                  <td>{b.payments}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}
