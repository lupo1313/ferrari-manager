import venteUrl from '../assets/sounds/vente.wav';
import caisseUrl from '../assets/sounds/caisse.wav';

/**
 * Sons de confirmation d'encaissement : deux fichiers audio originaux, générés par
 * scripts/generate-sounds.mjs (synthèse procédurale, aucune source externe, aucune licence tierce).
 *
 * Contrat : play() ne lève jamais d'exception. Audio indisponible, bloqué ou refusé par le navigateur
 * → renvoie false (ou la lecture échoue en silence), l'encaissement n'est jamais affecté.
 */

import type { PaymentSoundKind } from '../domain/types';

export type { PaymentSoundKind };

export const PAYMENT_SOUND_KINDS: PaymentSoundKind[] = ['vente', 'caisse'];

export const PAYMENT_SOUND_LABELS: Record<PaymentSoundKind, string> = {
  vente: 'Notification de vente',
  caisse: 'Caisse enregistreuse',
};

export const PAYMENT_SOUND_URLS: Record<PaymentSoundKind, string> = {
  vente: venteUrl,
  caisse: caisseUrl,
};

export function isPaymentSoundKind(value: unknown): value is PaymentSoundKind {
  return value === 'vente' || value === 'caisse';
}

/** Lecteur minimal (sous-ensemble de HTMLAudioElement) : permet de tester sans navigateur. */
export interface AudioLike {
  play(): Promise<void> | void;
  currentTime: number;
  volume: number;
}

/** Volume de lecture : discret, adapté à un commerce. */
const VOLUME = 0.6;

function defaultFactory(url: string): AudioLike | undefined {
  if (typeof Audio === 'undefined') return undefined;
  const audio = new Audio(url);
  audio.preload = 'auto';
  return audio;
}

export function createPaymentSound(
  factory: (url: string) => AudioLike | undefined = defaultFactory,
  urls: Record<PaymentSoundKind, string> = PAYMENT_SOUND_URLS,
) {
  const players = new Map<PaymentSoundKind, AudioLike>();

  function player(kind: PaymentSoundKind): AudioLike | undefined {
    let p = players.get(kind);
    if (!p) {
      p = factory(urls[kind]);
      if (!p) return undefined;
      p.volume = VOLUME;
      players.set(kind, p);
    }
    return p;
  }

  function play(kind: PaymentSoundKind): boolean {
    try {
      const p = player(isPaymentSoundKind(kind) ? kind : 'caisse');
      if (!p) return false;
      p.currentTime = 0; // un nouvel encaissement relance le son depuis le début
      const result = p.play();
      // Lecture refusée par le navigateur (autoplay, mode silencieux…) : ignorée.
      if (result && typeof result.catch === 'function') result.catch(() => undefined);
      return true;
    } catch {
      return false;
    }
  }

  /** Prépare les fichiers à l'avance pour une lecture immédiate. */
  function preload() {
    try {
      PAYMENT_SOUND_KINDS.forEach(player);
    } catch {
      /* préchargement facultatif */
    }
  }

  return { play, preload };
}

/** Instance de l'application. */
export const paymentSound = createPaymentSound();
