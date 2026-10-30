import type { DeliveryTrip } from '../domain/types';
import { deliveryAddressKey, tripAddressProblem, type DeliveryAddress } from '../domain/trip';

/**
 * Calcul du trajet en scooter : géocodage des deux adresses (Base Adresse Nationale, Géoplateforme IGN,
 * service public gratuit sans clé), puis itinéraire Valhalla avec le profil « motor_scooter » (deux-roues
 * motorisé : routes autorisées aux cyclomoteurs, voies rapides évitées, vitesse plafonnée).
 *
 * Aucune clé API : le serveur de calcul est configurable au build (VITE_ROUTING_URL), par exemple un service
 * Valhalla hébergé avec authentification par domaine. Aucune valeur n'est jamais inventée : toute erreur
 * renvoie un message et la commande reste enregistrable normalement.
 */

export const GEOCODING_URL = 'https://data.geopf.fr/geocodage/search';
/**
 * Contact technique de l'exploitant, exigé par les conditions du serveur public FOSSGIS (adresse visible et
 * joignable sur le site). Affiché seulement dans l'application, jamais sur les tickets ni envoyé aux services.
 */
export const OPERATOR_CONTACT_EMAIL = 'ast.logistiques@gmail.com';
export const DEFAULT_ROUTING_URL = 'https://valhalla1.openstreetmap.de/route';
/** Vitesse maximale du profil scooter (km/h) : 45 = cyclomoteur, valeur par défaut de Valhalla. */
export const SCOOTER_TOP_SPEED_KMH = 45;
const TIMEOUT_MS = 10_000;
/** Conditions du serveur public FOSSGIS : au plus une requête d'itinéraire par seconde. */
export const MIN_ROUTING_INTERVAL_MS = 1000;
/** En dessous, la correspondance d'adresse est jugée trop incertaine pour calculer un trajet. */
const MIN_SCORE = 0.5;

export type TripErrorCode =
  | 'adresse_incomplete'
  | 'adresse_introuvable'
  | 'depart_introuvable'
  | 'aucun_itineraire'
  | 'quota'
  | 'service_indisponible'
  | 'hors_ligne';

export type TripResult = { ok: true; trip: DeliveryTrip } | { ok: false; code: TripErrorCode; message: string };

/** Messages courts (une ou deux lignes dans le panneau) ; l'interface précise que le trajet est facultatif. */
const MESSAGES: Record<TripErrorCode, string> = {
  adresse_incomplete: 'Adresse incomplète : rue et code postal requis.',
  adresse_introuvable: 'Adresse introuvable : vérifiez la rue et le code postal.',
  depart_introuvable: 'Adresse de la pizzeria introuvable (voir Paramètres).',
  aucun_itineraire: 'Aucun itinéraire en scooter vers cette adresse.',
  quota: 'Service de calcul saturé : réessayez dans un instant.',
  service_indisponible: 'Service de calcul indisponible.',
  hors_ligne: 'Pas de connexion Internet.',
};

const fail = (code: TripErrorCode): TripResult => ({ ok: false, code, message: MESSAGES[code] });

export interface TripDeps {
  fetchFn?: typeof fetch;
  routingUrl?: string;
  now?: () => Date;
  isOnline?: () => boolean;
  /** Horloge et attente injectables (tests) pour l'espacement des requêtes d'itinéraire. */
  nowMs?: () => number;
  sleep?: (ms: number) => Promise<void>;
  minIntervalMs?: number;
}

interface GeoPoint {
  lon: number;
  lat: number;
  label: string;
  approximate: boolean;
}

class TripFailure extends Error {
  constructor(readonly code: TripErrorCode) {
    super(code);
  }
}

async function getJson(fetchFn: typeof fetch, url: string): Promise<{ status: number; body: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const r = await fetchFn(url, { signal: controller.signal });
    let body: unknown = null;
    try {
      body = await r.json();
    } catch {
      body = null;
    }
    return { status: r.status, body };
  } catch {
    throw new TripFailure('service_indisponible');
  } finally {
    clearTimeout(timer);
  }
}

/** Géocodage d'une adresse française ; null si introuvable ou trop incertaine. */
async function geocode(fetchFn: typeof fetch, query: string, postcode: string | null): Promise<GeoPoint | null> {
  const params = new URLSearchParams({ q: query, limit: '1', index: 'address' });
  if (postcode) params.set('postcode', postcode);
  const { status, body } = await getJson(fetchFn, `${GEOCODING_URL}?${params}`);
  if (status === 429) throw new TripFailure('quota');
  if (status >= 500 || status === 0) throw new TripFailure('service_indisponible');
  const feature = (body as { features?: unknown[] } | null)?.features?.[0] as
    | { geometry?: { coordinates?: unknown }; properties?: { score?: unknown; type?: unknown; label?: unknown } }
    | undefined;
  const coords = feature?.geometry?.coordinates;
  const props = feature?.properties;
  if (!Array.isArray(coords) || typeof coords[0] !== 'number' || typeof coords[1] !== 'number') return null;
  if (typeof props?.score !== 'number' || props.score < MIN_SCORE) return null;
  if (props.type !== 'housenumber' && props.type !== 'street') return null;
  return { lon: coords[0], lat: coords[1], label: typeof props.label === 'string' ? props.label : query, approximate: props.type !== 'housenumber' };
}

const departCache = new Map<string, GeoPoint>();
let lastRoutingAt = Number.NEGATIVE_INFINITY;

/** Espace les requêtes d'itinéraire d'au moins MIN_ROUTING_INTERVAL_MS (appuis répétés sur « Recalculer »). */
async function respectRoutingInterval(deps: TripDeps) {
  const nowMs = deps.nowMs ?? (() => Date.now());
  const wait = lastRoutingAt + (deps.minIntervalMs ?? MIN_ROUTING_INTERVAL_MS) - nowMs();
  if (wait > 0) await (deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms))))(wait);
  lastRoutingAt = nowMs();
}

/** Calcule le trajet en scooter de la pizzeria jusqu'à l'adresse de livraison. */
export async function computeScooterTrip(pizzeriaAddress: string, destination: DeliveryAddress | null, deps: TripDeps = {}): Promise<TripResult> {
  const fetchFn = deps.fetchFn ?? fetch;
  const now = deps.now ?? (() => new Date());
  const routingUrl = deps.routingUrl ?? DEFAULT_ROUTING_URL;
  if (!destination || tripAddressProblem(destination)) return fail('adresse_incomplete');
  if (deps.isOnline && !deps.isOnline()) return fail('hors_ligne');
  try {
    let from = departCache.get(pizzeriaAddress);
    if (!from) {
      const found = await geocode(fetchFn, pizzeriaAddress, pizzeriaAddress.match(/\b\d{5}\b/)?.[0] ?? null);
      if (!found) return fail('depart_introuvable');
      from = found;
      departCache.set(pizzeriaAddress, found);
    }
    const to = await geocode(fetchFn, `${destination.address} ${destination.postalCode} ${destination.city}`, destination.postalCode.trim());
    if (!to) return fail('adresse_introuvable');

    const request = {
      locations: [
        { lon: from.lon, lat: from.lat },
        { lon: to.lon, lat: to.lat },
      ],
      costing: 'motor_scooter',
      costing_options: { motor_scooter: { top_speed: SCOOTER_TOP_SPEED_KMH } },
      units: 'kilometers',
      directions_type: 'none',
    };
    await respectRoutingInterval(deps);
    const { status, body } = await getJson(fetchFn, `${routingUrl}?json=${encodeURIComponent(JSON.stringify(request))}`);
    if (status === 429) return fail('quota');
    const summary = (body as { trip?: { summary?: { length?: unknown; time?: unknown } } } | null)?.trip?.summary;
    if (status === 400) return fail('aucun_itineraire');
    if (status !== 200 || typeof summary?.length !== 'number' || typeof summary.time !== 'number' || summary.length < 0 || summary.time < 0) {
      return fail('service_indisponible');
    }
    return {
      ok: true,
      trip: {
        vehicle: 'scooter',
        distanceM: Math.round(summary.length * 1000),
        durationS: Math.round(summary.time),
        addressKey: deliveryAddressKey(destination),
        matchedLabel: to.label,
        approximate: to.approximate,
        computedAt: now().toISOString(),
        source: 'valhalla-motor_scooter',
      },
    };
  } catch (e) {
    return fail(e instanceof TripFailure ? e.code : 'service_indisponible');
  }
}

/** Réservé aux tests : oublie la position de la pizzeria mémorisée. */
export function resetTripCache() {
  departCache.clear();
  lastRoutingAt = Number.NEGATIVE_INFINITY;
}
