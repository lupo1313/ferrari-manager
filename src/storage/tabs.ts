import { STORAGE_NAMESPACE } from './repository';

/**
 * Onglets ouverts de la même application (même espace de stockage), pour la restauration.
 *
 * Mécanisme : un canal BroadcastChannel propre à l'espace (production et prévisualisation séparées).
 * - Chaque onglet répond « présent » à une demande et s'annonce à son ouverture.
 * - Avant d'écrire, l'onglet qui restaure interroge les autres : une réponse, ou l'annonce d'un onglet
 *   ouvert pendant l'attente, bloque la restauration.
 * - Pendant les écritures, il prévient les autres : ils suspendent toute écriture et demandent de recharger.
 *   Un onglet ouvert pendant l'opération voit la trace d'opération au démarrage et se suspend de même.
 * Sans BroadcastChannel (navigateur ancien), la vérification est impossible : `otherTabs` renvoie null.
 */

type Message = { t: 'qui' | 'present' | 'ouverture' | 'restauration'; from: string };

export interface TabPresence {
  /** true : un autre onglet est ouvert ; false : aucun ; null : vérification impossible sur ce navigateur. */
  otherTabs(waitMs?: number): Promise<boolean | null>;
  announceRestore(): void;
  close(): void;
}

let installed: TabPresence | null = null;

/** Présence de l'onglet, installée une fois au démarrage (main.tsx). */
export function installTabPresence(onRestoreElsewhere: () => void): TabPresence {
  installed ??= createTabPresence(onRestoreElsewhere);
  return installed;
}

export function tabPresence(): TabPresence | null {
  return installed;
}

export function createTabPresence(onRestoreElsewhere: () => void, namespace = STORAGE_NAMESPACE): TabPresence {
  const id = Math.random().toString(36).slice(2);
  let channel: BroadcastChannel | null = null;
  try {
    channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(`${namespace}-onglets`);
  } catch {
    channel = null;
  }
  const post = (t: Message['t']) => {
    try {
      channel?.postMessage({ t, from: id } satisfies Message);
    } catch {
      /* canal fermé */
    }
  };
  let heard = false;
  if (channel) {
    channel.onmessage = (event: MessageEvent<Message>) => {
      const m = event.data;
      if (!m || m.from === id) return;
      if (m.t === 'qui') post('present');
      if (m.t === 'present' || m.t === 'ouverture') heard = true;
      if (m.t === 'restauration') onRestoreElsewhere();
    };
    post('ouverture');
  }
  return {
    async otherTabs(waitMs = 400) {
      if (!channel) return null;
      heard = false;
      post('qui');
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      return heard;
    },
    announceRestore: () => post('restauration'),
    close: () => channel?.close(),
  };
}
