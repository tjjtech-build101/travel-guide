// Detección de eco (PRD 05, demo sin auriculares): si lo que "dijo el usuario" es casi lo mismo que acaba de decir
// el scout, el micrófono está escuchando el parlante. El store pasa solo al modo por turnos.

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1);

/** Proporción de palabras del usuario que aparecen en la última frase del scout (0..1). */
export function echoScore(userText: string, assistantText: string): number {
  const u = norm(userText);
  if (u.length < 2) return 0;
  const a = new Set(norm(assistantText));
  if (!a.size) return 0;
  return u.filter((w) => a.has(w)).length / u.length;
}

export function looksLikeEcho(userText: string, assistantText: string): boolean {
  return echoScore(userText, assistantText) >= 0.6;
}
