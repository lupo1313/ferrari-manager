import type { Order, ServiceRecord } from './types';

/** Affichage de l'état du service : vert = ouvert, gris = fermé (état normal, pas une erreur). */
export interface ServiceIndicator {
  tone: 'green' | 'grey';
  label: string;
  action: string;
}

export function serviceIndicator(open: boolean): ServiceIndicator {
  return open
    ? { tone: 'green', label: 'Service ouvert', action: 'Fermer le service' }
    : { tone: 'grey', label: 'Service fermé', action: 'Ouvrir le service' };
}

/* ---------- Historique des services ---------- */

/**
 * Identifiant d'un service, déduit de sa date d'ouverture : stable d'un chargement à l'autre,
 * y compris pour le service reconstitué à la lecture des anciennes données (rien n'est réécrit).
 */
export function serviceIdFromStart(openedAt: string): string {
  return `svc-${openedAt}`;
}

/** Identifiant libre pour un nouveau service (deux ouvertures à la même milliseconde restent distinctes). */
export function newServiceId(openedAt: string, services: ServiceRecord[]): string {
  const base = serviceIdFromStart(openedAt);
  const taken = new Set(services.map((s) => s.id));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/** Service en cours (ouvert) ou dernier service clôturé. La liste n'est jamais vide après lecture. */
export function currentService(services: ServiceRecord[]): ServiceRecord {
  return services[services.length - 1];
}

export function openServiceRecord(services: ServiceRecord[], openedAt: string): ServiceRecord[] {
  return [...services, { id: newServiceId(openedAt, services), openedAt, closedAt: null }];
}

/** Clôture le dernier service. Déjà clôturé : la date d'origine est conservée. */
export function closeServiceRecord(services: ServiceRecord[], closedAt: string): ServiceRecord[] {
  const last = currentService(services);
  if (!last || last.closedAt) return services;
  return [...services.slice(0, -1), { ...last, closedAt }];
}

/**
 * Service auquel une commande est rattachée, ou null pour « Avant le suivi des services ».
 * - Règle normale : le service de création (order.serviceId), jamais changé ensuite.
 * - Commande sans serviceId (anciennes données) : le service ouvert au moment de sa création,
 *   c'est-à-dire entre son ouverture et l'ouverture du service suivant. Avant le premier service suivi : null.
 */
export function serviceOfOrder(order: Order, services: ServiceRecord[]): string | null {
  if (order.serviceId && services.some((s) => s.id === order.serviceId)) return order.serviceId;
  for (let i = services.length - 1; i >= 0; i--) {
    const s = services[i];
    const next = services[i + 1];
    if (order.createdAt >= s.openedAt && (!next || order.createdAt < next.openedAt)) return s.id;
  }
  return null;
}
