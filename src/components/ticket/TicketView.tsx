import type { DeliveryTicket, KitchenTicket } from '../../domain/ticket';

/** En-tête commun : numéro très visible, date, heure demandée. */
function Header({ ticket, title }: { ticket: KitchenTicket | DeliveryTicket; title: string }) {
  return (
    <>
      <div className="ticket__center">
        <p className="ticket__brand">{ticket.pizzeriaName}</p>
        <p className="ticket__kind">{title}</p>
      </div>
      <hr />
      {ticket.statusWarning && <p className="ticket__warning">*** {ticket.statusWarning} ***</p>}
      <p className="ticket__headline">{ticket.headline}</p>
      {ticket.revisionLabel && <p className="ticket__strong">{ticket.revisionLabel}</p>}
      <p>
        {ticket.date} à {ticket.time}
      </p>
      <p className="ticket__requested">{ticket.requestedLabel}</p>
    </>
  );
}

/** Ticket cuisine : lecture rapide, personnalisations mises en avant, ni coordonnées ni paiement. */
export function KitchenTicketView({ ticket }: { ticket: KitchenTicket }) {
  return (
    <div className="ticket ticket--cuisine" style={{ width: `${ticket.widthMm}mm` }}>
      <Header ticket={ticket} title="TICKET CUISINE" />
      {ticket.customerName && <p className="ticket__strong">{ticket.customerName}</p>}
      {ticket.groups.map((g) => (
        <div key={g.title}>
          <hr />
          <p className="ticket__group">{g.title}</p>
          {g.lines.map((l, i) => (
            <div key={i} className="ticket__kline">
              <p className="ticket__kname">
                {l.quantity} × {l.name}
              </p>
              {l.details.map((d) => (
                <p key={d} className="ticket__kdetail">
                  • {d}
                </p>
              ))}
            </div>
          ))}
        </div>
      ))}
      {ticket.note && (
        <>
          <hr />
          <p className="ticket__strong">NOTE :</p>
          <p className="ticket__note">{ticket.note}</p>
        </>
      )}
      <hr />
      <p className="ticket__strong">
        {ticket.pizzaCount} pizza{ticket.pizzaCount > 1 ? 's' : ''}
      </p>
    </div>
  );
}

/** Ticket livreur : identification, adresse complète, contenu du sac et sommes à encaisser. */
export function DeliveryTicketView({ ticket }: { ticket: DeliveryTicket }) {
  const c = ticket.customer;
  const p = ticket.payment;
  return (
    <div className="ticket ticket--livreur" style={{ width: `${ticket.widthMm}mm` }}>
      <Header ticket={ticket} title="TICKET LIVREUR" />
      {c && (
        <>
          <hr />
          <p className="ticket__big">{c.name}</p>
          {c.phone && <p className="ticket__strong">Tél. {c.phone}</p>}
          {c.addressLines.map((l) => (
            <p key={l} className="ticket__strong">
              {l}
            </p>
          ))}
          {c.details.map((d) => (
            <p key={d.label}>
              {d.label} : <b>{d.value}</b>
            </p>
          ))}
          {c.instructions && <p className="ticket__note">» {c.instructions}</p>}
        </>
      )}
      <hr />
      <table className="ticket__lines">
        <tbody>
          {ticket.lines.map((l, i) => (
            <tr key={i}>
              <td className="ticket__qty">{l.quantity}×</td>
              <td>
                {l.name}
                {l.offered && <span className="ticket__detail">Offert fidélité</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="ticket__small">
        {ticket.itemCount} article{ticket.itemCount > 1 ? 's' : ''} dans le sac
      </p>
      <hr />
      <p className="ticket__row ticket__total">
        <span>TOTAL</span>
        <span>{ticket.total}</span>
      </p>
      {ticket.historicFee && <p className="ticket__small">dont frais de livraison (ancienne commande) : {ticket.historicFee}</p>}
      <div className="ticket__pay">
        <p className="ticket__pay-headline">{p.headline}</p>
        {p.dueLine && <p className="ticket__strong">{p.dueLine}</p>}
        {p.rowsTitle && <p>{p.rowsTitle} :</p>}
        {p.rows.map((r) => (
          <p key={r.label} className="ticket__row ticket__strong">
            <span>• {r.label}</span>
            <span>{r.amount}</span>
          </p>
        ))}
        {p.notes.map((n) => (
          <p key={n} className="ticket__strong">
            {n}
          </p>
        ))}
      </div>
      <p className="ticket__center ticket__small">Pizzeria : {ticket.pizzeriaPhone}</p>
    </div>
  );
}
