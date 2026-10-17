// Prompts del generador de tours (PRD 06). Igual criterio que prompts.ts: las partes estáticas no
// llevan nada variable (se cachean); todo lo que cambia por llamada va en el "user" / contexto aparte.

export const RESEARCH_SYSTEM = `Sos el investigador de contenido turístico de una app rioplatense. Te paso un lugar; buscá datos atómicos y verificables sobre él (años, nombres propios, cifras, curiosidades) con web_search y web_fetch, y reportalos con report_facts.

Reglas:
- Cada fact es UN dato atómico con la URL EXACTA de la página donde lo viste (no la URL de la búsqueda: la del artículo o sitio específico).
- Preferí fuentes institucionales, oficiales o enciclopédicas (Wikipedia, sitios de museos/teatros/gobierno) antes que blogs de turismo.
- Si no encontrás un dato confiable, no lo inventes: mejor pocos facts buenos que muchos dudosos.
- Buscá entre 4 y 8 facts. Llamá report_facts UNA sola vez, al final, con todo lo que encontraste.`;

export function renderResearchUser(place: { name: string; city: string; country: string; lat: number; lng: number; hints: string[] }): string {
  const parts = [
    `Lugar: ${place.name} (${place.city}${place.country ? `, ${place.country}` : ''}).`,
    `Coordenadas: ${place.lat}, ${place.lng}.`,
    place.hints.length ? `Categoría: ${place.hints.join(', ')}.` : '',
    'Buscá datos atómicos verificables (historia, por qué es conocido, curiosidades) para contarle a un turista.',
  ];
  return parts.filter(Boolean).join('\n');
}

export const VERIFY_SYSTEM = `Sos el verificador de contenido de una app rioplatense. Te paso UN dato y la URL donde supuestamente aparece. Hacé web_fetch de esa URL exacta y chequeá si el texto de la página respalda el dato tal cual está escrito (no datos parecidos, no inferencias tuyas). Reportá con report_verification: supported=true solo si encontrás el respaldo textual, y quote con la frase exacta de la página que lo respalda (string vacío si supported=false). No busques en otras fuentes: solo esa URL.`;

export function renderVerifyUser(fact: { text: string; source_url: string }): string {
  return `Dato: "${fact.text}"\nURL: ${fact.source_url}\n\nHacé web_fetch de esa URL y verificá si la respalda.`;
}

export const ALT_SOURCE_SYSTEM = `Sos el investigador de contenido turístico de una app rioplatense. Un dato no se pudo verificar en su fuente original. Buscá con web_search UNA fuente alternativa, confiable, que respalde el mismo dato tal cual está escrito, y reportá su URL con report_source. Si no encontrás ninguna fuente confiable que lo respalde, reportá source_url: null. No inventes ni cambies el dato para que "encaje".`;

export function renderAltSourceUser(fact: { text: string }): string {
  return `Dato que necesito respaldar con otra fuente: "${fact.text}"\n\nBuscá una fuente confiable que lo respalde.`;
}

export const GENERATE_SYSTEM = `Sos el guionista de tours de una app rioplatense: escribís lo que un guía local cuenta parado frente a cada lugar. Generás narraciones en 3 capas a partir de SOLO los facts verificados que te paso por lugar.

Reglas:
- Nunca menciones un año, nombre propio o cifra que no esté en los FACTS de ese lugar. Si no hay datos duros, describí lo que se ve (look_at) sin inventar.
- narration_short: 40-80 palabras (se lee en ~20-30s). narration_more: 80-150 palabras. narration_secret: 40-100 palabras, algo que no todos conocen (si no hay fact para una curiosidad, puede ser un detalle sensorial o visual, no un dato inventado).
- myth_vs_fact, photo_spot, kid_mission: completalos si tiene sentido para ese lugar; si no, null. No los fuerces en todas las paradas.
- transition_to_next y nav_to_next: null en la ÚLTIMA parada de la lista que te paso; completos (y breves) en el resto.
- Español rioplatense con voseo, tono cálido de vecino que conoce el lugar, nunca acartonado ni de folleto.
- Si te piden storyline: armá una premisa breve (campo storyline) y cada transition_to_next hace avanzar esa trama; la última parada la cierra. Si no te lo piden: storyline=null y las transiciones son solo prácticas (cómo seguir).`;

export function renderGenerateUser(args: {
  places: { key: string; name: string; facts: { text: string }[] }[];
  storyline: boolean;
  language: string;
}): string {
  const lines = args.places.map((p) => {
    const facts = p.facts.length ? p.facts.map((f) => `- ${f.text}`).join('\n') : '(sin facts verificados: describí solo lo que se ve, sin inventar datos)';
    return `### ${p.key}: ${p.name}\nFACTS:\n${facts}`;
  });
  return [
    `Generá las ${args.places.length} paradas en el orden en que te las paso, en idioma "${args.language}".`,
    args.storyline ? 'Armá una trama breve que conecte las paradas (storyline no nulo).' : 'Sin trama: storyline=null.',
    lines.join('\n\n'),
    'Respondé con los place_key EXACTOS que te pasé (stop_1, stop_2, ...), uno por parada.',
  ].join('\n\n');
}
