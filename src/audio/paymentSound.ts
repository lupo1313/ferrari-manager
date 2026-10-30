/**
 * Signature sonore d'encaissement : deux notes claires et montantes (do6 puis sol6), type carillon,
 * courtes et douces. Générée avec la Web Audio API : aucun fichier, aucune bibliothèque.
 *
 * Contrat : play() ne lève jamais d'exception. Audio indisponible, bloqué ou refusé par le navigateur
 * → renvoie false, l'encaissement n'est jamais affecté.
 */

type AudioContextCtor = new () => AudioContext;

interface Note {
  freq: number;
  /** Décalage en secondes depuis le début. */
  at: number;
  /** Durée de la résonance en secondes. */
  decay: number;
}

const NOTES: Note[] = [
  { freq: 1046.5, at: 0, decay: 0.42 }, // do6
  { freq: 1567.98, at: 0.11, decay: 0.6 }, // sol6
];

/** Volume général : volontairement discret (le maximum vaut 1). */
const MASTER_VOLUME = 0.16;

function defaultCtor(): AudioContextCtor | undefined {
  if (typeof window === 'undefined') return undefined;
  const w = window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  return w.AudioContext ?? w.webkitAudioContext;
}

export function createPaymentSound(getCtor: () => AudioContextCtor | undefined = defaultCtor) {
  let ctx: AudioContext | null = null;

  function play(): boolean {
    try {
      const Ctor = getCtor();
      if (!Ctor) return false;
      // Créé au premier appui (geste utilisateur) : condition imposée par les navigateurs, tablettes comprises.
      ctx ??= new Ctor();
      if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);

      const start = ctx.currentTime + 0.02;
      const master = ctx.createGain();
      master.gain.value = MASTER_VOLUME;
      master.connect(ctx.destination);

      for (const note of NOTES) {
        const t = start + note.at;
        // Fondamentale (sinus) + léger harmonique (une octave au-dessus) pour un timbre de cloche.
        for (const [mult, level, type] of [
          [1, 1, 'sine'],
          [2, 0.18, 'triangle'],
        ] as const) {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = type;
          osc.frequency.setValueAtTime(note.freq * mult, t);
          gain.gain.setValueAtTime(0.0001, t);
          gain.gain.exponentialRampToValueAtTime(level, t + 0.008);
          gain.gain.exponentialRampToValueAtTime(0.0001, t + note.decay);
          osc.connect(gain);
          gain.connect(master);
          osc.start(t);
          osc.stop(t + note.decay + 0.05);
        }
      }
      return true;
    } catch {
      return false;
    }
  }

  return { play };
}

/** Instance de l'application (un seul contexte audio). */
export const paymentSound = createPaymentSound();
