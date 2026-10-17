// Chequeo determinístico de las narraciones (tour director). Reemplaza la heurística vieja de "palabras con
// mayúscula" que fallaba casi siempre y, al fallar, dejaba pasar el texto igual.
// Regla: cada oración con un dato duro (año, número, siglo en romanos o nombre propio) tiene que estar respaldada
// por un fact verificado de esa parada. Los escritores citan con [fN]; si la cita falta o apunta mal pero el dato
// está en otro fact de la parada, se atribuye a ese fact. Si no aparece en ningún fact, la oración se BORRA.
// Las marcas [fN] se sacan antes de guardar; `sources` sale de los facts efectivamente usados.

export type CitedFact = { id: string; text: string; quote?: string | null; source_url: string; source_title?: string | null };

const CITE_RE = /\s*\[(f\d+(?:\s*[,;]\s*f\d+)*)\]/gi;
const YEAR_RE = /\b(1[0-9]\d\d|20\d\d)\b/g;
const NUM_RE = /\b\d[\d.,]*\d\b|\b\d\b/g;
const ROMAN_RE = /\b(?=[MDCLXVI]{2,}\b)M{0,3}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})\b/g;

/** Palabras que pueden ir con mayúscula a mitad de oración sin ser un dato (tratamientos, interjecciones). */
const COMMON_CAPS = new Set(['Mirá', 'Fijate', 'Ojo', 'Ahora', 'Acá', 'Dale', 'Che', 'Bueno', 'Y', 'Pero', 'Si', 'No', 'Sí', 'Ok', 'Uy', 'Ah', 'Eh']);

export function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

const digitsOnly = (s: string) => s.replace(/[.,]/g, '');

export function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?…])\s+(?=[¿¡"«(A-ZÁÉÍÓÚÑ0-9])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export type Claim = { kind: 'year' | 'number' | 'roman' | 'name'; value: string };

/** Datos duros de una oración (sin las marcas [fN]). El primer token de la oración nunca cuenta como nombre. */
export function sentenceClaims(sentence: string, allow: Set<string>): Claim[] {
  const s = sentence.replace(CITE_RE, '');
  const out: Claim[] = [];
  const years: string[] = s.match(YEAR_RE) ?? [];
  for (const y of years) out.push({ kind: 'year', value: y });
  for (const n of s.match(NUM_RE) ?? []) if (!years.includes(n)) out.push({ kind: 'number', value: digitsOnly(n) });
  for (const r of s.match(ROMAN_RE) ?? []) if (r) out.push({ kind: 'roman', value: r });
  const tokens = s.split(/\s+/);
  for (let i = 0; i < tokens.length; i++) {
    const raw = tokens[i];
    const prev = tokens[i - 1] ?? '';
    const startsClause = i === 0 || /[:.!?…«"“(¿¡—–-]$/.test(prev) || /^[«"“(¿¡]/.test(raw);
    const w = raw.replace(/^[«"“'(¿¡]+|[.,;:!?)"”'»…]+$/g, '');
    if (startsClause || w.length < 3) continue;
    if (!/^[A-ZÁÉÍÓÚÑ]/.test(w) || w === w.toUpperCase()) continue;
    if (COMMON_CAPS.has(w) || allow.has(normalize(w))) continue;
    out.push({ kind: 'name', value: w });
  }
  return out;
}

function supports(claim: Claim, haystackNorm: string, haystackDigits: string): boolean {
  if (claim.kind === 'year' || claim.kind === 'number') return haystackDigits.includes(claim.value);
  if (claim.kind === 'roman') return haystackNorm.includes(normalize(claim.value)) || haystackNorm.includes(`siglo ${normalize(claim.value)}`);
  const w = normalize(claim.value);
  // Tolerancia de flexión (España/españoles no, pero Zabala/Zabala's o Solís/Solis sí): raíz de largo-2, mínimo 4.
  const stem = w.slice(0, Math.max(4, w.length - 2));
  return haystackNorm.includes(stem);
}

export type CheckResult = { text: string; cited: Set<string>; dropped: string[] };

/**
 * Limpia una narración: deja solo oraciones sin datos duros o con datos respaldados por los facts de la parada.
 * `allow`: nombres que no necesitan respaldo (la parada, la siguiente, el grupo, la ciudad, el Scout).
 */
export function checkNarration(text: string | null | undefined, facts: CitedFact[], allowWords: string[]): CheckResult {
  const cited = new Set<string>();
  const dropped: string[] = [];
  if (!text) return { text: '', cited, dropped };
  const allow = new Set(allowWords.map(normalize).filter((w) => w.length > 1));
  const byId = new Map(facts.map((f) => [f.id.toLowerCase(), f]));
  const factHay = (f: CitedFact) => `${f.text} ${f.quote ?? ''}`;
  const kept: string[] = [];

  for (const sentence of splitSentences(text)) {
    const ids = [...sentence.matchAll(CITE_RE)].flatMap((m) => m[1].split(/[,;]/).map((x) => x.trim().toLowerCase()));
    const claims = sentenceClaims(sentence, allow);
    const clean = sentence.replace(CITE_RE, '').replace(/\s+([.,;:!?…])/g, '$1').trim();
    if (!claims.length) {
      ids.filter((id) => byId.has(id)).forEach((id) => cited.add(id));
      kept.push(clean);
      continue;
    }
    // 1) Contra los facts citados; 2) si no alcanza, contra cualquier fact de la parada (y se atribuye).
    const citedFacts = ids.map((id) => byId.get(id)).filter((f): f is CitedFact => !!f);
    const usedFor = new Set<string>();
    const ok = claims.every((c) => {
      const pools = [citedFacts, facts];
      for (const pool of pools) {
        const hit = pool.find((f) => {
          const hay = factHay(f);
          return supports(c, normalize(hay), digitsOnly(hay));
        });
        if (hit) {
          usedFor.add(hit.id.toLowerCase());
          return true;
        }
      }
      return false;
    });
    if (ok) {
      usedFor.forEach((id) => cited.add(id));
      citedFacts.forEach((f) => cited.add(f.id.toLowerCase()));
      kept.push(clean);
    } else {
      dropped.push(clean);
    }
  }
  return { text: kept.join(' ').trim(), cited, dropped };
}

/** Saca las marcas [fN] sin chequear (para campos sin datos duros, como nav_to_next). */
export function stripCitations(text: string | null | undefined): string | null {
  if (!text) return text ?? null;
  return text.replace(CITE_RE, '').replace(/\s+([.,;:!?…])/g, '$1').trim();
}

export const wordCount = (s: string | null | undefined) => (s ? s.trim().split(/\s+/).filter(Boolean).length : 0);

/** sources de tour_stops: solo los facts usados, deduplicado por URL. */
export function sourcesFor(facts: CitedFact[], citedIds: Set<string>, fallbackTitle: string): { title: string; url: string }[] {
  const byUrl = new Map<string, { title: string; url: string }>();
  for (const f of facts) {
    if (!f.source_url || !citedIds.has(f.id.toLowerCase())) continue;
    if (!byUrl.has(f.source_url)) byUrl.set(f.source_url, { title: f.source_title || fallbackTitle, url: f.source_url });
  }
  return [...byUrl.values()];
}

/** ¿La cita aparece (casi) textual en el texto de la página? Normaliza acentos, espacios y comillas. */
export function quoteInText(quote: string, pageText: string): boolean {
  const norm = (s: string) =>
    normalize(s)
      .replace(/[«»"“”'‘’]/g, '')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
  const q = norm(quote);
  if (q.length < 12) return false;
  const page = norm(pageText);
  if (page.includes(q)) return true;
  // Tolerancia: la cita puede venir recortada o con "…": alcanza con que un tramo largo (≥ 8 palabras seguidas o
  // el 80% de las palabras en orden) esté en la página.
  const words = q.split(' ');
  if (words.length >= 8) {
    for (let i = 0; i + 8 <= words.length; i++) if (page.includes(words.slice(i, i + 8).join(' '))) return true;
  }
  return false;
}
