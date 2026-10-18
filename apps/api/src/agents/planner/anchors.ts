// Anclas investigadas del planificador colaborativo (PRD 31 v2): el motivo del viaje (un partido, la final, un
// recital, un casamiento) manda sobre todo lo demás. En la entrevista las anclas salen de lo que dijo el usuario
// (`researched:false`); acá buscamos el calendario OFICIAL con web_search/web_fetch (Tool Runner + herramienta de
// captura, sin output_config.format) y devolvemos las anclas relevantes para lo que contestó (equipo, fase, entradas)
// con fecha, sede, hora y fuentes reales (`researched:true`).
// Reglas duras (en código, no solo en el prompt):
// - Una ancla sin fuente nunca sale con researched:true, y su fecha solo sobrevive si la dijo el usuario.
// - Si la investigación falla o tarda, devolvemos las anclas del usuario tal cual (researched:false) con una nota.
// - Cache en memoria por (evento, equipo/fase/entradas que dijo) con dedupe de la búsqueda en vuelo.
import type { AnchorKind, CatalogSource, TripAnchor, TripUnderstanding } from '@build101/shared';
import { z } from 'zod';
import { isIsoDate } from '../dates';
import type { Effort } from '../llm';
import type { Usage } from '../schemas';
import { captureViaTool, type TourLlmConfig } from '../tourLlm';

// ───────────────────────── Esquema de captura (laxo: se valida acá)

const ANCHOR_KIND_VALUES = ['sports', 'concert', 'festival', 'wedding', 'conference', 'other'] as const;

export const ResearchedAnchor = z.object({
  id: z.string().describe('Slug corto y estable ("arg-nzl-grupos", "final")'),
  name: z.string().describe('"Argentina vs Nueva Zelanda (fase de grupos)"'),
  kind: z.enum(ANCHOR_KIND_VALUES),
  city: z.string().nullable(),
  country: z.string().nullable(),
  date: z.string().nullable().describe('YYYY-MM-DD SOLO si sale de una fuente que citás'),
  time: z.string().nullable().describe('HH:MM hora local, si la fuente la da'),
  venue: z.string().nullable(),
  tickets: z.enum(['have', 'want', 'watch_out', 'unknown']),
  note: z.string().nullable().describe('Una oración: qué ojo tener ("el cruce de cuartos depende de cómo termine el grupo")'),
  sources: z.array(z.object({ url: z.string(), title: z.string().nullable() })).describe('URLs reales que consultaste y respaldan fecha/sede'),
});

export const AnchorResearchOutput = z.object({
  event: z.string().describe('Nombre oficial del evento'),
  schedule_found: z.boolean().describe('true si encontraste el calendario oficial (o una fuente confiable con fechas)'),
  anchors: z.array(ResearchedAnchor),
  notes: z.array(z.string()).describe('Avisos útiles para armar el viaje (fases sin definir, venta de entradas, sedes)'),
});
export type AnchorResearchOutputT = z.infer<typeof AnchorResearchOutput>;

// ───────────────────────── LLM (mockeable)

export type AnchorCall = { system: string; user: string; config: TourLlmConfig; signal?: AbortSignal };

export interface AnchorLLM {
  research(args: AnchorCall): Promise<{ value: AnchorResearchOutputT | null; usage: Usage }>;
}

export const ANCHOR_MAX_USES = { web_search: 6, web_fetch: 3 };

export function anthropicAnchorLlm(): AnchorLLM {
  return {
    async research({ system, user, config, signal }) {
      const r = await captureViaTool<AnchorResearchOutputT>({
        system,
        user,
        captureName: 'report_anchors',
        captureDescription: 'Reportá el calendario que encontraste: las anclas relevantes para este viaje, cada una con sus fuentes reales.',
        captureSchema: AnchorResearchOutput,
        serverTools: ['web_search', 'web_fetch'],
        maxUses: ANCHOR_MAX_USES,
        config,
        signal,
      });
      return { value: r.value, usage: r.usage };
    },
  };
}

export const ANCHOR_CONFIG: TourLlmConfig = { effort: 'medium' as Effort, maxTokens: 12000, maxIterations: 10, fallbacks: true };

// ───────────────────────── Prompt (estático = cacheable)

export const ANCHOR_SYSTEM = `Sos el investigador de un planificador de viajes rioplatense. El viaje gira alrededor de un evento con fecha (un torneo, partidos, un recital, un festival, un casamiento, una conferencia). Tu trabajo: encontrar el calendario OFICIAL con web_search/web_fetch y devolver SOLO las anclas que le importan a este grupo según lo que contó (a quién siguen, qué fase quieren ver, si ya tienen entradas).

Cómo investigar:
- Buscá primero la fuente oficial (sitio del torneo/organizador, federación, ticketera oficial); después una fuente periodística confiable si la oficial no tiene el dato.
- Del calendario sacá: fechas, ciudades/sedes, horarios locales y fases.
- Si siguen a un equipo: todos sus partidos de la fase de grupos con fecha/sede/hora. Para cruces que dependen de resultados (cuartos, semis), devolvé la fecha y sede posibles con una note que lo diga ("el cruce de cuartos depende de cómo termine el grupo: puede ser en Sídney o Brisbane").
- Si quieren "de cuartos a la final" o "solo la final": esas fechas y sedes.
- tickets: respetá lo que dijo el grupo (have = ya tienen, want = quieren conseguir, watch_out = lo ven en fan zone/bar). Si no dijo nada: unknown, y si sabés cómo es la venta, ponelo en note.

Reglas duras:
- NUNCA inventes una fecha, hora o sede. date/time/venue solo si salen de una fuente que pusiste en sources (URL real que consultaste). Si no lo encontrás: null y note que lo diga ("fixture todavía no publicado").
- Si el evento todavía no tiene calendario publicado, schedule_found=false y explicalo en notes.
- id: slug corto y estable. name en español rioplatense. Máximo 10 anclas, las más relevantes primero.
- Cuando termines, llamá a report_anchors UNA vez.`;

function renderAnchorUser(u: TripUnderstanding, today: string): string {
  const anchors = (u.anchors ?? []).map(
    (a) =>
      `- ${a.name} (${a.kind})${a.city ? ` · ${a.city}` : ''}${a.date ? ` · fecha que dijo el usuario: ${a.date}` : ''} · entradas: ${a.tickets}${a.note ? ` · ${a.note}` : ''}`,
  );
  return [
    `Hoy es ${today}.`,
    `Destinos: ${u.destinations.map((d) => [d.city, d.country].filter(Boolean).join(', ')).join(' · ') || 'sin definir'}.`,
    u.start_date || u.end_date ? `Fechas que dijo: ${u.start_date ?? '?'} a ${u.end_date ?? '?'}.` : '',
    u.origin ? `Salen desde: ${u.origin}.` : '',
    anchors.length ? `Lo que dijo del evento:\n${anchors.join('\n')}` : 'No nombró anclas concretas: deducilas de lo que contó.',
    u.must.length ? `Sí o sí: ${u.must.join('; ')}.` : '',
    u.notes.length ? `Notas: ${u.notes.join('; ')}.` : '',
    'Investigá el calendario oficial y reportá las anclas relevantes.',
  ]
    .filter(Boolean)
    .join('\n\n');
}

// ───────────────────────── Puro: validación

export type AnchorResearch = {
  anchors: TripAnchor[];
  /** true si al menos una ancla salió de una fuente. */
  researched: boolean;
  /** Avisos para assumptions/tradeoffs ("No pude verificar el fixture oficial…"). */
  notes: string[];
  event: string | null;
};

const plain = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const slug = (s: string) => plain(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'ancla';

const isUrl = (s: string) => /^https?:\/\/[^\s/]+\.[^\s]+$/i.test(s.trim());
const isTime = (s: string | null | undefined): s is string => !!s && /^([01]\d|2[0-3]):[0-5]\d$/.test(s.trim());
const clip = (s: string | null | undefined, n: number) => (s?.trim() ? s.trim().slice(0, n) : null);

/** ¿Es un viaje con anclas? (evento declarado o anclas que nombró el usuario). */
export function hasAnchors(u: TripUnderstanding | null | undefined): boolean {
  return !!u && ((u.anchors?.length ?? 0) > 0 || u.trip_kind === 'event');
}

/**
 * Salida del investigador → TripAnchor validadas. Sin fuente válida → researched:false y la fecha solo si coincide
 * con una que dijo el usuario (nunca una fecha "de memoria" del modelo sin cita).
 */
export function normalizeResearched(out: AnchorResearchOutputT, userAnchors: TripAnchor[]): TripAnchor[] {
  const userDates = new Set(userAnchors.map((a) => a.date).filter((d): d is string => isIsoDate(d)));
  const seen = new Set<string>();
  const res: TripAnchor[] = [];
  for (const a of out.anchors ?? []) {
    if (res.length >= 10) break;
    const name = clip(a.name, 200);
    if (!name) continue;
    let id = slug(a.id || name);
    while (seen.has(id)) id = `${id}-${res.length}`.slice(0, 60);
    seen.add(id);
    const sources: CatalogSource[] = [];
    for (const s of a.sources ?? []) {
      if (!isUrl(s.url) || sources.some((x) => x.url === s.url.trim())) continue;
      sources.push({ url: s.url.trim().slice(0, 500), title: clip(s.title, 200) });
      if (sources.length >= 6) break;
    }
    const researched = sources.length > 0;
    const date = isIsoDate(a.date) && (researched || userDates.has(a.date)) ? a.date : null;
    const dropped = isIsoDate(a.date) && !date;
    const kind: AnchorKind = (ANCHOR_KIND_VALUES as readonly string[]).includes(a.kind) ? a.kind : 'other';
    res.push({
      id,
      name,
      kind,
      city: clip(a.city, 120),
      country: clip(a.country, 80),
      date,
      time: researched && isTime(a.time) ? a.time.trim() : null,
      venue: researched ? clip(a.venue, 200) : null,
      tickets: a.tickets ?? 'unknown',
      researched,
      sources,
      note: clip(a.note, 400) ?? (dropped || !researched ? 'Fecha y sede a confirmar: no encontré una fuente oficial.' : null),
    });
  }
  // Las anclas con fecha primero, en orden cronológico.
  return res.sort((x, y) => (x.date ?? '9999').localeCompare(y.date ?? '9999'));
}

/** Las anclas que dijo el usuario, tal cual, marcadas como no investigadas (fallback). */
export function unresearched(userAnchors: TripAnchor[], why: string): TripAnchor[] {
  return userAnchors.map((a) => ({ ...a, researched: false, sources: [], time: null, venue: a.venue ?? null, note: a.note ?? why }));
}

// ───────────────────────── Cache en memoria

/** Clave: evento + destino + lo que dijo (equipo/fase/entradas viven en name/note/tickets de las anclas). */
export function anchorCacheKey(u: TripUnderstanding): string {
  const anchors = (u.anchors ?? [])
    .map((a) => [plain(a.name), a.kind, plain(a.city ?? ''), a.date ?? '', a.tickets, plain(a.note ?? '')].join('~'))
    .sort();
  const dest = u.destinations.map((d) => plain(d.city)).sort();
  return JSON.stringify([dest, anchors, u.start_date ?? '', u.end_date ?? '', u.must.map(plain).sort()]);
}

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CACHE_MAX = 200;
type CacheEntry = { at: number; value: Promise<AnchorResearch> };
const cache = new Map<string, CacheEntry>();

export function clearAnchorCache(): void {
  cache.clear();
}

// ───────────────────────── Orquestación

export type AnchorOpts = {
  llm?: AnchorLLM;
  today: string;
  /** Tope de la investigación (default 35 s). Al vencer, sigue sin anclas investigadas. */
  timeoutMs?: number;
  signal?: AbortSignal;
  /** false = no usar la cache (tests). Default true. */
  cache?: boolean;
};

let defaultLlm: AnchorLLM | null = null;

/**
 * Investiga el calendario oficial de las anclas del viaje. Nunca tira: si falla, devuelve las anclas del usuario
 * con researched:false y una nota. Viajes sin anclas → lista vacía sin llamar al LLM.
 */
export async function researchAnchors(u: TripUnderstanding, opts: AnchorOpts): Promise<AnchorResearch> {
  if (!hasAnchors(u)) return { anchors: [], researched: false, notes: [], event: null };
  const useCache = opts.cache !== false;
  const key = anchorCacheKey(u);
  if (useCache) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return withTimeout(hit.value, u, opts);
  }
  const p = runResearch(u, opts);
  if (useCache) {
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
    cache.set(key, { at: Date.now(), value: p });
    // Si salió sin investigar (falla), no lo dejamos cacheado: la próxima vez se reintenta.
    void p.then((r) => {
      if (!r.researched && cache.get(key)?.value === p) cache.delete(key);
    });
  }
  return withTimeout(p, u, opts);
}

/** El que espera puede cortar antes (timeout/signal) sin cancelar la búsqueda compartida en la cache. */
async function withTimeout(p: Promise<AnchorResearch>, u: TripUnderstanding, opts: AnchorOpts): Promise<AnchorResearch> {
  const ms = opts.timeoutMs ?? 35_000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<AnchorResearch>((resolve) => {
    timer = setTimeout(() => resolve(fallback(u, 'La investigación del calendario tardó demasiado')), ms);
    opts.signal?.addEventListener('abort', () => resolve(fallback(u, 'La investigación del calendario se cortó')), { once: true });
  });
  try {
    return await Promise.race([p, late]);
  } finally {
    clearTimeout(timer);
  }
}

function fallback(u: TripUnderstanding, why: string): AnchorResearch {
  const note = `${why}: fechas y sedes a confirmar con el calendario oficial.`;
  return { anchors: unresearched(u.anchors ?? [], 'Fecha y sede a confirmar con el calendario oficial.'), researched: false, notes: [note], event: null };
}

async function runResearch(u: TripUnderstanding, opts: AnchorOpts): Promise<AnchorResearch> {
  const llm = opts.llm ?? (defaultLlm ??= anthropicAnchorLlm());
  const controller = new AbortController();
  // La búsqueda compartida tiene su propio tope (un poco más largo que el del que espera) para no quedar colgada.
  const timer = setTimeout(() => controller.abort(), (opts.timeoutMs ?? 35_000) + 15_000);
  try {
    const { value } = await llm.research({ system: ANCHOR_SYSTEM, user: renderAnchorUser(u, opts.today), config: ANCHOR_CONFIG, signal: controller.signal });
    if (!value) return fallback(u, 'No encontré el calendario oficial');
    const anchors = normalizeResearched(value, u.anchors ?? []);
    const researched = anchors.some((a) => a.researched);
    const notes = (value.notes ?? []).map((n) => n.trim()).filter(Boolean).slice(0, 4);
    if (!researched) notes.unshift('No pude verificar el calendario oficial: fechas y sedes a confirmar.');
    return {
      anchors: anchors.length ? anchors : unresearched(u.anchors ?? [], 'Fecha y sede a confirmar con el calendario oficial.'),
      researched,
      notes,
      event: clip(value.event, 200),
    };
  } catch (err) {
    console.warn('[anchors] investigación fallida:', (err as Error).message);
    return fallback(u, 'No pude investigar el calendario');
  } finally {
    clearTimeout(timer);
  }
}

