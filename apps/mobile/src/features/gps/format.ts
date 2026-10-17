/** 125.4 → "2:05"; 3725 → "1:02:05". */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** 1234 → "1,2 km"; 87 → "87 m". */
export function formatDistance(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1).replace('.', ',')} km` : `${Math.round(m)} m`;
}

/** Verde ≤10 m, amarillo ≤25 m, rojo peor. */
export function accuracyColor(acc: number | null): string {
  if (acc == null) return '#8A877F';
  if (acc <= 10) return '#1E6B34';
  if (acc <= 25) return '#B7791F';
  return '#C2362B';
}
