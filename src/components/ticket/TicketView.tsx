import type { TicketModel } from '../../domain/ticket';

/** Rendu du ticket, utilisé à la fois pour l'aperçu et pour l'impression. */
export function TicketView({ ticket }: { ticket: TicketModel }) {
  return (
    <div className="ticket" style={{ width: `${ticket.widthMm}mm` }}>
      <div className="ticket__center">
        <p className="ticket__brand">{ticket.pizzeriaName.toUpperCase()}</p>
        <p>{ticket.pizzeriaAddress}</p>
        <p>Tél. {ticket.pizzeriaPhone}</p>
      </div>
      <hr />
      {ticket.statusWarning && <p className="ticket__warning">*** {ticket.statusWarning} ***</p>}
      <p className="ticket__big">{ticket.orderLabel}</p>
      {ticket.revisionLabel && <p className="ticket__strong">{ticket.revisionLabel}</p>}
      <p>
        {ticket.date} à {ticket.time}
      </p>
      <hr />
      <p className="ticket__big">{ticket.modeLabel}</p>
      <p className="ticket__strong">{ticket.requestedLabel}</p>
      {ticket.customer && (
        <>
          <hr />
          <p className="ticket__strong">{ticket.customer.name}</p>
          {ticket.customer.phone && <p>{ticket.customer.phone}</p>}
          {ticket.customer.addressLines.map((l) => (
            <p key={l}>{l}</p>
          ))}
          {ticket.customer.instructions && <p className="ticket__note">» {ticket.customer.instructions}</p>}
        </>
      )}
      <hr />
      <table className="ticket__lines">
        <tbody>
          {ticket.lines.map((l, i) => (
            <tr key={i}>
              <td className="ticket__qty">{l.quantity}×</td>
              <td>
                <span className="ticket__strong">{l.name}</span>
                {l.details.map((d) => (
                  <span key={d} className="ticket__detail">
                    {d}
                  </span>
                ))}
              </td>
              <td className="ticket__amount">{l.amount}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {ticket.note && (
        <>
          <hr />
          <p className="ticket__strong">NOTE :</p>
          <p className="ticket__note">{ticket.note}</p>
        </>
      )}
      <hr />
      <p className="ticket__row">
        <span>Sous-total</span>
        <span>{ticket.subtotal}</span>
      </p>
      {ticket.deliveryFee && (
        <p className="ticket__row">
          <span>Livraison</span>
          <span>{ticket.deliveryFee}</span>
        </p>
      )}
      {ticket.savings && (
        <p className="ticket__row">
          <span>Valeur offerte fidélité</span>
          <span>{ticket.savings}</span>
        </p>
      )}
      <p className="ticket__row ticket__total">
        <span>TOTAL</span>
        <span>{ticket.total}</span>
      </p>
      <hr />
      <p className="ticket__center ticket__small">Ticket de préparation · non valable comme facture</p>
      <p className="ticket__center ticket__small">Merci et bon appétit !</p>
    </div>
  );
}
