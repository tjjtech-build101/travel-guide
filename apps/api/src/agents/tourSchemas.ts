// Esquemas Zod de las llamadas a Claude del generador de tours (PRD 06 · tour director).
// Salida estructurada → nada de min/max/regex (mismo criterio que TripSkeleton en ./schemas):
// las validaciones duras (largo de narración, datos respaldados, etc.) se hacen después en código.
import { z } from 'zod';

const FactKind = z.enum(['date', 'person', 'number', 'story', 'detail', 'myth']);

// ---------- Investigación: extracción desde un artículo que ya bajamos (Wikipedia) ----------
export const ExtractedFact = z.object({
  text: z.string().describe('Afirmación atómica y autocontenida, con el sujeto explícito (ej. "El Teatro Solís se inauguró en 1856")'),
  quote: z.string().describe('Oración copiada TEXTUAL del artículo que respalda el dato'),
  kind: FactKind,
});
export const ExtractOutput = z.object({ facts: z.array(ExtractedFact) });
export type ExtractOutputT = z.infer<typeof ExtractOutput>;

// ---------- Investigación web (pasada 1 con web_search/web_fetch) ----------
export const ResearchFact = z.object({
  text: z.string().describe('Afirmación atómica: un dato por fact (ej. "El Teatro Solís se inauguró en 1856")'),
  source_url: z.string().describe('URL exacta de la página donde aparece ese dato'),
  source_title: z.string().describe('Título corto de la fuente (ej. "Teatro Solís · Historia")'),
  quote: z.string().describe('Frase copiada textual de esa página que respalda el dato'),
  kind: FactKind,
});
export const ResearchOutput = z.object({ facts: z.array(ResearchFact) });
export type ResearchOutputT = z.infer<typeof ResearchOutput>;

// ---------- Verificación por web_fetch (fallback cuando no podemos bajar la página nosotros) ----------
export const VerifyOutput = z.object({
  supported: z.boolean().describe('true solo si el texto de la URL respalda el fact tal cual está escrito'),
  quote: z.string().describe('Frase textual de la fuente que respalda el fact; vacío si supported=false'),
});
export type VerifyOutputT = z.infer<typeof VerifyOutput>;

// ---------- Juez: ¿la cita respalda el dato? (una llamada por lugar, sin herramientas) ----------
export const JudgeOutput = z.object({
  verdicts: z.array(
    z.object({
      id: z.string().describe('El id del par (c1, c2, ...)'),
      supported: z.boolean().describe('true solo si la cita por sí sola respalda el dato tal cual (fechas, nombres y cifras idénticos)'),
    }),
  ),
});
export type JudgeOutputT = z.infer<typeof JudgeOutput>;

// ---------- Pedido libre de la persona → campos concretos ----------
export const InterpretOutput = z.object({
  must_include: z.array(z.string()).describe('Lugares concretos que la persona quiere sí o sí (nombre tal cual lo dijo); vacío si no nombra ninguno'),
  avoid: z.array(z.string()).describe('Cosas que no quiere (palabras cortas: "iglesias", "museos", "subidas")'),
  themes: z.array(z.string()).describe('Temas que le interesan, de esta lista: historia, arquitectura, arte, museos, comida, mercados, vida_nocturna, musica, naturaleza, playa, compras, deporte, fotografia, religion, tecnologia, curiosidades, para_chicos'),
});
export type InterpretOutputT = z.infer<typeof InterpretOutput>;

// ---------- Director: tesis, arco y papel de cada parada ----------
export const StopRole = z.enum(['gancho', 'desarrollo', 'giro', 'climax', 'respiro', 'cierre']);
export const DirectorOutput = z.object({
  title: z.string().describe('Título corto y evocador del tour, sin dos puntos de folleto'),
  thesis: z.string().describe('La idea que hilvana todo el tour, una frase'),
  storyline: z.string().nullable().describe('Premisa de la trama si se pidió; si no, null'),
  swaps: z
    .array(z.object({ remove_key: z.string(), add_key: z.string(), why: z.string() }))
    .describe('Hasta 3 reemplazos de paradas del recorrido por alternativas; vacío si el recorrido ya sirve'),
  stops: z.array(
    z.object({
      key: z.string().describe('La key de la parada tal como te la pasé'),
      role: StopRole,
      angle: z.string().describe('Qué historia se cuenta acá y por qué le importa a este grupo (1-2 frases)'),
      point_at: z.string().describe('Algo concreto y visible para señalar'),
      personal_hook: z.string().nullable().describe('Conexión natural con alguien del grupo por su nombre, o null'),
      callbacks_to: z.array(z.string()).describe('Keys de paradas ANTERIORES con las que conectar'),
    }),
  ),
});
export type DirectorOutputT = z.infer<typeof DirectorOutput>;

// ---------- Escritor: una parada ----------
export const WrittenStop = z.object({
  look_at: z.string().describe('Qué mirar en el lugar, una o dos oraciones concretas'),
  narration_short: z.string().describe('Capa corta: 40-80 palabras, gancho + historia central, con citas [fN]'),
  narration_more: z.string().describe('Capa "contame más": 80-150 palabras, otra historia, con citas [fN]'),
  narration_secret: z.string().describe('Capa "lo que nadie sabe": 40-100 palabras, con citas [fN]'),
  myth_vs_fact: z.string().nullable().describe('Mito vs realidad si un fact desmiente una creencia; si no, null'),
  photo_spot: z.string().nullable().describe('Dónde pararse y qué encuadrar; o null'),
  kid_mission: z.string().nullable().describe('Misión concreta y posible para chicos en este lugar; o null'),
  transition_to_next: z.string().nullable().describe('1-2 frases que dan ganas de ir a la siguiente; null si es la última'),
  nav_to_next: z.string().nullable().describe('Indicación práctica breve para llegar a la siguiente; null si es la última'),
});
export type WrittenStopT = z.infer<typeof WrittenStop>;

// ---------- Crítico: rúbrica sobre el tour completo ----------
export const CriticOutput = z.object({
  overall: z.string().describe('Diagnóstico general en una o dos frases'),
  stops: z.array(
    z.object({
      key: z.string(),
      score: z.number().describe('1 a 10 según la rúbrica'),
      rewrite: z.boolean().describe('true si hay que reescribirla'),
      issues: z.array(z.string()).describe('Problemas concretos y accionables (vacío si está bien)'),
    }),
  ),
});
export type CriticOutputT = z.infer<typeof CriticOutput>;
