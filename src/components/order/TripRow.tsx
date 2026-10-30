import { useEffect, useRef, useState } from 'react';
import { Icon } from '../ui/Icon';
import { useAppSelector, useStore } from '../../state/StoreContext';
import { formatDistance, formatDuration, validTripFor } from '../../domain/trip';
import { computeScooterTrip, DEFAULT_ROUTING_URL, OPERATOR_CONTACT_EMAIL } from '../../services/trajet';
import type { DeliveryAddressInput } from '../../domain/types';

const ROUTING_URL = import.meta.env.VITE_ROUTING_URL || DEFAULT_ROUTING_URL;

/**
 * Trajet en scooter de la commande en livraison, calculé à la demande pour le ticket livreur.
 * Discret et jamais bloquant : en cas d'échec, un message s'affiche et la commande s'enregistre normalement.
 */
export function TripRow({ customerId, address }: { customerId: string; address: DeliveryAddressInput }) {
  const store = useStore();
  const cart = useAppSelector((d) => d.cart);
  const pizzeriaAddress = useAppSelector((d) => d.settings.pizzeria.address);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => () => void (mounted.current = false), []);
  // Une autre adresse (client changé, fiche modifiée) : l'ancien message ne s'applique plus.
  useEffect(() => setError(null), [customerId, address.address, address.postalCode, address.city]);

  // Toujours l'adresse effective de livraison de la commande (ponctuelle ou habituelle).
  const trip = validTripFor(cart.deliveryTrip, cart.mode, address);

  const calculate = async () => {
    setBusy(true);
    setError(null);
    const r = await computeScooterTrip(pizzeriaAddress, address, {
      routingUrl: ROUTING_URL,
      isOnline: () => (typeof navigator === 'undefined' ? true : navigator.onLine),
    });
    if (!mounted.current) return;
    setBusy(false);
    if (!r.ok) {
      setError(r.message);
      return;
    }
    const saved = store.setCartDeliveryTrip(r.trip);
    if (!saved.ok) setError(saved.error);
  };

  return (
    <div className={`trip-row ${error ? 'trip-row--error' : ''}`} aria-live="polite">
      {trip ? (
        <span className="trip-row__result" title={trip.matchedLabel ? `Adresse reconnue : ${trip.matchedLabel}` : undefined}>
          <Icon name="check" size={16} /> Scooter : <strong>{formatDistance(trip.distanceM)}</strong> · <strong>{formatDuration(trip.durationS)}</strong>
          {trip.approximate && <small title="Numéro de rue non trouvé : calcul sur la rue."> (rue)</small>}
        </span>
      ) : error ? (
        <span className="trip-row__error">
          <Icon name="alert" size={16} /> {error} <small>Trajet facultatif.</small>
        </span>
      ) : (
        <span className="trip-row__hint">Trajet en scooter pour le ticket livreur</span>
      )}
      <button type="button" className="btn btn--sm trip-row__btn" onClick={calculate} disabled={busy}>
        {busy ? 'Calcul…' : trip ? 'Recalculer' : error ? 'Réessayer' : 'Calculer le trajet'}
      </button>
      {trip && (
        // Attribution exigée par la licence ODbL et les conditions du serveur public FOSSGIS.
        <small className="trip-row__credit">
          ©{' '}
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
            OpenStreetMap
          </a>{' '}
          (
          <a href="https://opendatacommons.org/licenses/odbl/index.html" target="_blank" rel="noreferrer">
            ODbL
          </a>
          ) ·{' '}
          <a href="https://www.openstreetmap.org/fixthemap" target="_blank" rel="noreferrer">
            signaler une erreur
          </a>{' '}
          ·{' '}
          <a href={`mailto:${OPERATOR_CONTACT_EMAIL}`} title={`Contact technique de l’exploitant : ${OPERATOR_CONTACT_EMAIL}`}>
            contact
          </a>
        </small>
      )}
    </div>
  );
}
