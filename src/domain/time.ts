const pad = (n: number) => String(n).padStart(2, '0');

export function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

export function formatDateTime(iso: string): string {
  return `${formatDate(iso)} ${formatTime(iso)}`;
}

/** "19:45" → affichage "19h45" */
export function formatTimeOfDay(value: string): string {
  return value.replace(':', 'h');
}

export function isValidTimeOfDay(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/**
 * Créneaux proposés pour l'heure souhaitée : à partir de maintenant + délai minimal,
 * arrondi au pas supérieur.
 */
export function timeSlots(now: Date, stepMinutes = 15, count = 12, leadMinutes = 15): string[] {
  const start = new Date(now.getTime() + leadMinutes * 60_000);
  const minutes = start.getHours() * 60 + start.getMinutes();
  const first = Math.ceil(minutes / stepMinutes) * stepMinutes;
  const slots: string[] = [];
  for (let i = 0; i < count; i++) {
    const m = first + i * stepMinutes;
    if (m >= 24 * 60) break;
    slots.push(`${pad(Math.floor(m / 60))}:${pad(m % 60)}`);
  }
  return slots;
}
