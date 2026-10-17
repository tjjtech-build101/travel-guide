// Texto plano de una página web (tour director: chequear en código que la cita de un dato está en su fuente).
// Sin JS: si el sitio arma el contenido en el navegador o nos bloquea, devuelve null y el verificador cae al
// web_fetch de Claude.
import { cached } from './cache';

const UA = 'Mozilla/5.0 (compatible; build101-hackathon/0.1; tour fact checker)';

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', laquo: '«', raquo: '»', ndash: '–', mdash: '—' };

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg|nav|footer|header)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#\d+|#x[\da-f]+|\w+);/gi, (m, e: string) => {
      if (e[0] === '#') {
        const code = e[1] === 'x' || e[1] === 'X' ? Number.parseInt(e.slice(2), 16) : Number.parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : ' ';
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/[ \t\r\f\v]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

/** Baja la URL y devuelve su texto (máx. 200k caracteres). null si falla, no es HTML/texto o tarda > 7 s. */
export async function fetchPageText(url: string): Promise<string | null> {
  if (!/^https?:\/\//i.test(url)) return null;
  try {
    return await cached(`page-text:${url}`, async () => {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html,text/plain' }, redirect: 'follow', signal: AbortSignal.timeout(7000) });
      if (!res.ok) throw new Error(String(res.status));
      const type = res.headers.get('content-type') ?? '';
      if (!/text\/html|text\/plain|application\/xhtml/i.test(type)) throw new Error(type);
      const raw = await res.text();
      return (type.includes('html') ? htmlToText(raw) : raw).slice(0, 200_000);
    });
  } catch {
    return null;
  }
}
