// Investigador del catálogo del destino (PRD 31): Claude + web_search/web_fetch arma la lista de TODO lo que vale
// la pena de una ciudad (imperdibles, barrios, comida institucional, experiencias, joyas, escapadas) y después un
// crítico independiente busca lo que falta. Cumple CatalogDeps['research'] (types.ts).
// Mismo criterio que tourLlm.ts: Tool Runner con server tools + herramienta local de captura (captureViaTool),
// nunca output_config.format con server tools. Prompts de sistema estáticos (se cachean); lo variable va en el user.
// Lo que vuelve NO está resuelto en Places: catalog.ts lo valida, lo ubica y descarta lo que no existe.
import { BEST_TIMES, BOOKING_NEEDS, CATALOG_CATEGORIES, CATALOG_TIERS, COST_HINTS, INTEREST_TAGS, SCOUT } from '@build101/shared';
import { z } from 'zod';
import { captureViaTool, type TourLlmConfig } from '../tourLlm';
import type { CatalogDeps, CityRef, RawCatalogItem } from './types';

// ───────────────────────── Esquema de captura (sin min/max/regex: se valida en catalog.ts)

const ResearchItem = z.object({
  name: z.string().describe('Nombre en el idioma original, como figura en Google Maps ("Cementerio de la Recoleta", "Café Tortoni")'),
  query: z.string().describe('Consulta para Google Places: nombre + ciudad ("Cementerio de la Recoleta, Buenos Aires")'),
  category: z.enum(CATALOG_CATEGORIES).describe('Nunca "event" (los eventos con fecha se buscan aparte)'),
  tier: z.enum(CATALOG_TIERS).describe('must = canónico (≥2 fuentes independientes lo ponen entre lo esencial) · recommended · gem = joya local'),
  zone: z.string().nullable().describe('Barrio o zona ("Recoleta", "San Telmo"); para escapadas, el pueblo'),
  duration_min: z.number().describe('Permanencia realista en minutos (escapada de un día: 360-600)'),
  best_time: z.enum(BEST_TIMES),
  indoor: z.boolean(),
  booking: z.enum(BOOKING_NEEDS).describe('required = sin reserva/entrada previa no entrás (visitas guiadas con cupo, cenas show)'),
  cost_hint: z.enum(COST_HINTS).nullable(),
  interests: z.array(z.enum(INTEREST_TAGS)),
  why: z.string().describe('Una oración concreta: por qué vale la pena (sin adjetivos de folleto)'),
  tip: z.string().nullable().describe('Consejo local corto y accionable, o null'),
  closed_days: z.array(z.number()).describe('Días que cierra (0=domingo … 6=sábado), SOLO si una fuente lo dice; si no, []'),
  sources: z.array(z.object({ url: z.string(), title: z.string().nullable() })).describe('URLs reales que usaste para este ítem'),
});

const ResearchOutput = z.object({
  items: z.array(ResearchItem),
  lodging_zones: z.array(z.object({ zone: z.string(), why: z.string() })).describe('2-4 barrios para alojarse (en review: [])'),
});
type ResearchOutputT = z.infer<typeof ResearchOutput>;

// ───────────────────────── Prompts

const ITEM_RULES = `Reglas de cada ítem:
- Solo lugares y experiencias que existen hoy y que encontraste en la web. NUNCA inventes un lugar, un dato ni una URL. Si dudás de que siga abierto, no lo pongas.
- name: en el idioma original y como lo encontraría Google Maps. query: nombre + ciudad, para ubicarlo en Google Places.
- tier:
  · must: SOLO si es canónico, es decir, al menos 2 fuentes independientes (guías, prensa de viajes, turismo oficial) lo ponen entre lo esencial de la ciudad. Lo que cualquier guía top pondría.
  · gem: joya local, lo que conocen y recomiendan los que viven ahí y casi no aparece en las guías para turistas.
  · recommended: todo lo demás que vale la pena.
- zone: barrio o zona (agrupa los días). Para escapadas, el pueblo o la zona.
- duration_min: permanencia realista (un museo grande 120-180, un mirador 30-45, un barrio para caminar 120-180, un café histórico 45-60, una escapada de un día 360-600).
- best_time: atardecer en miradores y costaneras; mañana temprano en lo muy concurrido; noche en shows y vida nocturna; "any" si da igual.
- booking: required si sin reserva o entrada anticipada no entrás (visitas guiadas con cupo, cenas show, partidos); recommended si conviene; none si no.
- cost_hint: free | low | mid | high (entrada o gasto típico por persona), null si no sabés.
- interests: los que correspondan de esta lista: ${INTEREST_TAGS.join(', ')}.
- why: UNA oración concreta (qué es y por qué vale la pena), sin marketing ("Bóvedas de la élite porteña del siglo XIX, con la tumba de Evita", no "Un lugar mágico e imperdible").
- tip: consejo local corto y accionable ("Entrá por la calle Junín y andá directo a la bóveda de Rufina Cambaceres"), o null.
- closed_days: días que cierra (0=domingo … 6=sábado), SOLO si una fuente lo dice. Si no sabés, [].
- sources: las URLs reales (de páginas que viste en los resultados o bajaste) que respaldan el ítem. Cuantas más fuentes independientes, mejor: es lo que decide si es imperdible.
- Nunca pongas eventos con fecha puntual (recitales, festivales de un día): se buscan aparte. Las ferias y shows que se repiten (todos los domingos, todas las noches) sí van, con el día en "tip".`;

export const CATALOG_GENERATE_SYSTEM = `Sos el investigador de destinos de ${SCOUT.name}, un guía de viajes rioplatense. Conocés las ciudades como un local y como el mejor editor de guías del mundo. Te paso una ciudad y armás el catálogo COMPLETO de lo que vale la pena: la base con la que después se arman viajes para grupos con gustos distintos. Lo que no esté acá, no existe para el planificador: si se te escapa un imperdible, el viaje sale mal.

Cómo investigar:
- Usá web_search (pocas búsquedas, bien elegidas) y web_fetch para leer las mejores listas: turismo oficial de la ciudad, guías serias (Lonely Planet, Time Out, Michelin, Condé Nast, Atlas Obscura), prensa local y recomendaciones de locales.
- Cruzá fuentes: lo que aparece en varias listas independientes es canónico.

Cubrí SISTEMÁTICAMENTE, sin saltear ninguna categoría que la ciudad tenga:
1. Imperdibles icónicos: monumentos, plazas y edificios emblemáticos, museos principales, miradores (landmark, museum, viewpoint).
2. Barrios como unidad de paseo: los barrios que hay que caminar, cada uno como un ítem (neighborhood).
3. Comida institucional: bodegones y restaurantes clásicos, mercados, cafés históricos, el plato típico y dónde comerlo, heladerías o pastelerías míticas (food, market).
4. Experiencias: shows, tango o la música local, fútbol u otro deporte con hinchada, ferias semanales (con su día), visitas guiadas especiales, paseos en bote (experience).
5. Parques, jardines, costas y playas (park, beach).
6. Vida nocturna: bares notables, coctelerías, peñas, boliches o zonas de salida (nightlife).
7. Compras con identidad: ferias de diseño, calles comerciales, librerías notables (shopping).
8. Joyas locales poco turísticas, de cualquier categoría (tier gem).
9. Escapadas de un día desde la ciudad, con duración realista ida y vuelta incluida (day_trip).

Entre 35 y 60 ítems en total, sin repetir. Además, lodging_zones: 2 a 4 barrios recomendados para alojarse, cada uno con por qué (una oración: qué tiene cerca, para qué tipo de viajero).

${ITEM_RULES}

Llamá report_catalog UNA sola vez, al final, con todo.`;

export const CATALOG_REVIEW_SYSTEM = `Sos el crítico más exigente de ${SCOUT.name}, un guía de viajes rioplatense. Otro investigador armó el catálogo de una ciudad y te paso la lista de nombres que ya tiene. Tu trabajo es encontrar lo que FALTA: ¿qué imperdible o qué joya de esta ciudad no está? Si un viajero vuelve y le dicen "¿y no fuiste a…?", fallamos.

Cómo revisar:
- Pensá como un local y como el editor de la mejor guía: recorré mentalmente cada categoría (íconos, museos, miradores, barrios, comida institucional y mercados, cafés históricos, experiencias y shows, fútbol, ferias semanales, parques y costas, vida nocturna, compras con identidad, joyas locales, escapadas de un día).
- Usá web_search y web_fetch para chequear listas serias que el otro investigador pudo no mirar (turismo oficial, prensa local, Atlas Obscura, guías gastronómicas) y confirmar que lo que proponés existe hoy.
- Devolvé SOLO ítems nuevos: nada que ya esté en la lista, ni con otro nombre ni en otro idioma ("Recoleta Cemetery" = "Cementerio de la Recoleta"). Si no falta nada importante, devolvé una lista vacía.
- Máximo 15 ítems, los más importantes primero. lodging_zones: [].

${ITEM_RULES}

Llamá report_catalog UNA sola vez, al final.`;

const cityLine = (c: CityRef) =>
  `Ciudad: ${c.city}${c.country ? `, ${c.country}` : ''}.${c.lat != null && c.lng != null ? ` Centro: ${c.lat.toFixed(4)}, ${c.lng.toFixed(4)}.` : ''}`;

export function renderCatalogGenerateUser(city: CityRef): string {
  return [cityLine(city), 'Armá el catálogo completo y llamá report_catalog.'].join('\n');
}

export function renderCatalogReviewUser(city: CityRef, known: string[]): string {
  return [
    cityLine(city),
    `El catálogo ya tiene estos ${known.length} lugares:\n${known.map((n) => `- ${n}`).join('\n')}`,
    '¿Qué imperdible o joya falta? Devolvé solo lo nuevo con report_catalog.',
  ].join('\n\n');
}

// ───────────────────────── Llamada

const CONFIGS: Record<'generate' | 'review', TourLlmConfig> = {
  generate: { effort: 'high', maxTokens: 32000, maxIterations: 14, fallbacks: true },
  review: { effort: 'high', maxTokens: 16000, maxIterations: 10, fallbacks: true },
};

/** CatalogDeps['research'] real (Claude + web). */
export const research: CatalogDeps['research'] = async ({ city, mode, known, signal }) => {
  const r = await captureViaTool<ResearchOutputT>({
    system: mode === 'generate' ? CATALOG_GENERATE_SYSTEM : CATALOG_REVIEW_SYSTEM,
    user: mode === 'generate' ? renderCatalogGenerateUser(city) : renderCatalogReviewUser(city, known),
    captureName: 'report_catalog',
    captureDescription: 'Reportá el catálogo (o, en revisión, solo los ítems que faltaban), cada ítem con sus fuentes reales.',
    captureSchema: ResearchOutput,
    serverTools: ['web_search', 'web_fetch'],
    maxUses: mode === 'generate' ? { web_search: 6, web_fetch: 4 } : { web_search: 4, web_fetch: 2 },
    config: CONFIGS[mode],
    signal,
  });
  const items: RawCatalogItem[] = (r.value?.items ?? []).map((i) => ({ ...i, sources: i.sources ?? [] }));
  return {
    items: mode === 'review' ? items.slice(0, 15) : items,
    lodging_zones: mode === 'generate' ? (r.value?.lodging_zones ?? []) : [],
    usage: r.usage,
  };
};
