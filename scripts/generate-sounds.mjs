/**
 * Génère les deux signatures sonores d'encaissement de Ferrari Manager (fichiers WAV originaux).
 *
 *   node scripts/generate-sounds.mjs
 *
 * Synthèse procédurale déterministe (graine fixe) : aucun échantillon externe, aucune bibliothèque.
 * Les sons produits sont donc des créations originales du projet (pas de licence tierce).
 *
 * - vente.wav  « Notification de vente » : petit « ka-ching » moderne et brillant.
 * - caisse.wav « Caisse enregistreuse »   : mécanique de caisse, sonnette métallique et pièces.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RATE = 44100;
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'assets', 'sounds');

/* ---------- Outils de synthèse ---------- */

function rng(seed) {
  // mulberry32 : bruit reproductible d'une génération à l'autre.
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const buffer = (seconds) => new Float64Array(Math.ceil(seconds * RATE));

/** Biquad passe-bande (RBJ), appliqué sur un signal. */
function bandpass(signal, freq, q) {
  const w = (2 * Math.PI * freq) / RATE;
  const alpha = Math.sin(w) / (2 * q);
  const a0 = 1 + alpha;
  const b0 = alpha / a0, b2 = -alpha / a0, a1 = (-2 * Math.cos(w)) / a0, a2 = (1 - alpha) / a0;
  const out = new Float64Array(signal.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < signal.length; i++) {
    const x = signal[i];
    const y = b0 * x + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    out[i] = y;
  }
  return out;
}

/** Rafale de bruit filtré (transitoires, mécanique, frottements). */
function noiseBurst(buf, { at, dur, freq, q, amp, attack = 0.001, rand, shape = 'exp' }) {
  const n = Math.ceil(dur * RATE);
  const raw = new Float64Array(n);
  for (let i = 0; i < n; i++) raw[i] = rand() * 2 - 1;
  const filtered = bandpass(raw, freq, q);
  const start = Math.floor(at * RATE);
  for (let i = 0; i < n && start + i < buf.length; i++) {
    const t = i / RATE;
    const att = Math.min(1, t / attack);
    const env = shape === 'exp' ? Math.exp((-5 * t) / dur) : Math.sin((Math.PI * i) / n);
    buf[start + i] += filtered[i] * amp * att * env;
  }
}

/** Partiel sinusoïdal amorti (métal, cloche, résonance). */
function partial(buf, { at, freq, amp, decay, attack = 0.002, detune = 0, vibrato = 0 }) {
  const start = Math.floor(at * RATE);
  const n = Math.min(buf.length - start, Math.ceil(decay * 7 * RATE));
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const f = freq + detune + vibrato * Math.sin(2 * Math.PI * 5.5 * t);
    phase += (2 * Math.PI * f) / RATE;
    const env = Math.min(1, t / attack) * Math.exp(-t / decay);
    buf[start + i] += Math.sin(phase) * amp * env;
  }
}

/** Corps métallique : partiels inharmoniques, chacun doublé et légèrement désaccordé (miroitement). */
function metal(buf, { at, f0, ratios, amps, decays, amp, shimmer = 2.5 }) {
  ratios.forEach((r, k) => {
    const a = amp * amps[k];
    partial(buf, { at, freq: f0 * r, amp: a * 0.6, decay: decays[k], detune: -shimmer * r });
    partial(buf, { at: at + 0.0007, freq: f0 * r, amp: a * 0.4, decay: decays[k] * 0.92, detune: shimmer * r });
  });
}

/** Coup sourd (choc mécanique, tiroir). */
function thump(buf, { at, freq, amp, decay }) {
  const start = Math.floor(at * RATE);
  const n = Math.ceil(decay * 6 * RATE);
  let phase = 0;
  for (let i = 0; i < n && start + i < buf.length; i++) {
    const t = i / RATE;
    const f = freq * (1 + 0.8 * Math.exp(-t / 0.01)); // légère chute de hauteur, comme un impact
    phase += (2 * Math.PI * f) / RATE;
    buf[start + i] += Math.sin(phase) * amp * Math.exp(-t / decay);
  }
}

/** Normalise la crête, adoucit la fin et écrit un WAV PCM 16 bits mono. */
function writeWav(name, buf, peakTarget = 0.8) {
  let peak = 0;
  for (const v of buf) peak = Math.max(peak, Math.abs(v));
  const gain = peakTarget / peak;
  const fade = Math.floor(0.03 * RATE);
  const pcm = Buffer.alloc(44 + buf.length * 2);
  pcm.write('RIFF', 0);
  pcm.writeUInt32LE(36 + buf.length * 2, 4);
  pcm.write('WAVE', 8);
  pcm.write('fmt ', 12);
  pcm.writeUInt32LE(16, 16);
  pcm.writeUInt16LE(1, 20); // PCM
  pcm.writeUInt16LE(1, 22); // mono
  pcm.writeUInt32LE(RATE, 24);
  pcm.writeUInt32LE(RATE * 2, 28);
  pcm.writeUInt16LE(2, 32);
  pcm.writeUInt16LE(16, 34);
  pcm.write('data', 36);
  pcm.writeUInt32LE(buf.length * 2, 40);
  for (let i = 0; i < buf.length; i++) {
    const tail = i > buf.length - fade ? (buf.length - i) / fade : 1;
    const s = Math.max(-1, Math.min(1, buf[i] * gain * tail));
    pcm.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), pcm);
  return { name, seconds: buf.length / RATE, bytes: pcm.length };
}

/* ---------- « Notification de vente » : ka-ching moderne ---------- */

function vente() {
  const rand = rng(20261030);
  const buf = buffer(1.25);
  // « Ka » : attaque brillante et sèche (bruit aigu très court + petit clic).
  noiseBurst(buf, { at: 0, dur: 0.035, freq: 4200, q: 1.2, amp: 0.9, rand });
  noiseBurst(buf, { at: 0.004, dur: 0.02, freq: 9000, q: 2, amp: 0.4, rand });
  thump(buf, { at: 0, freq: 220, amp: 0.15, decay: 0.02 });
  // « Ching » : deux corps métalliques clairs (accord de quinte), partiels inharmoniques miroitants.
  const ratios = [1, 2.01, 2.76, 3.98, 5.42];
  const amps = [1, 0.32, 0.38, 0.16, 0.09];
  metal(buf, { at: 0.055, f0: 1318.5, ratios, amps, decays: [0.42, 0.3, 0.24, 0.15, 0.1], amp: 0.5 });
  metal(buf, { at: 0.085, f0: 1975.5, ratios, amps, decays: [0.5, 0.34, 0.26, 0.16, 0.1], amp: 0.42, shimmer: 3.2 });
  // Scintillement : fin grésillement aigu qui s'éteint.
  noiseBurst(buf, { at: 0.06, dur: 0.32, freq: 8500, q: 3, amp: 0.1, attack: 0.01, rand });
  return writeWav('vente.wav', buf);
}

/* ---------- « Caisse enregistreuse » : mécanique, sonnette, pièces ---------- */

function caisse() {
  const rand = rng(1980);
  const buf = buffer(1.4);
  // Touches et mécanisme : deux déclics secs.
  for (const at of [0, 0.05]) {
    noiseBurst(buf, { at, dur: 0.012, freq: 2600, q: 1.5, amp: 0.7, rand });
    thump(buf, { at, freq: 160, amp: 0.25, decay: 0.015 });
  }
  // Tiroir qui glisse puis vient en butée.
  noiseBurst(buf, { at: 0.09, dur: 0.14, freq: 700, q: 0.9, amp: 0.35, attack: 0.03, rand, shape: 'sine' });
  noiseBurst(buf, { at: 0.225, dur: 0.05, freq: 520, q: 1.1, amp: 0.8, rand });
  thump(buf, { at: 0.225, freq: 85, amp: 0.55, decay: 0.05 });
  // Sonnette de caisse : timbre de cloche métallique, partiels inharmoniques.
  metal(buf, {
    at: 0.13,
    f0: 2240,
    ratios: [1, 2.32, 4.25, 6.63],
    amps: [1, 0.48, 0.24, 0.1],
    decays: [0.38, 0.24, 0.14, 0.08],
    amp: 0.55,
    shimmer: 4,
  });
  // Pièces qui tintent dans le tiroir : petits chocs métalliques aléatoires.
  for (let k = 0; k < 8; k++) {
    const at = 0.25 + rand() * 0.32 + k * 0.012;
    const f = 4200 + rand() * 3600;
    const a = 0.12 + rand() * 0.14;
    for (const [r, ra] of [[1, 1], [1.47, 0.5], [2.09, 0.3]]) {
      partial(buf, { at, freq: f * r, amp: a * ra, decay: 0.03 + rand() * 0.05, attack: 0.0005 });
    }
    noiseBurst(buf, { at, dur: 0.008, freq: 6000, q: 2, amp: a * 0.6, rand });
  }
  return writeWav('caisse.wav', buf);
}

for (const r of [vente(), caisse()]) {
  console.log(`${r.name} : ${r.seconds.toFixed(2)} s, ${(r.bytes / 1024).toFixed(0)} Ko`);
}
