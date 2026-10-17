---
nro: 6
prd: "06 · Generador de tours + contenido"
prioridad: P0
estado: Por hacer
carril: Cerebro y contenido
tamano: L (2-4h)
depende_de: "00"
resumen: "Job generate_tour que arma por adelantado un recorrido con paradas verificadas (2 pasadas, cada dato con fuente) y lo guarda en tour_stops y place_library, más el contenido curado de las 10 paradas de Ciudad Vieja para el seed."
notion_url: https://app.notion.com/p/3fc81924a5c6812e879accb936bc050d
---

# 06 · Generador de tours + contenido

## Objetivo

Generar tours con contenido verificado **antes de caminar**. `generate_tour` corre como job (`agent_jobs`): junta candidatos reales, filtra por intereses, horarios y accesibilidad, arma la ruta según tiempo y punto final, y escribe todas las `tour_stops` con narración en 3 capas y fuentes. Todo lo investigado queda en `place_library` para reutilizarlo entre usuarios (foso defensivo). Este PRD también entrega el **contenido curado de las 10 paradas de Ciudad Vieja** para el seed de la demo.

## Momento de la demo

- **Acto 2:** el tour "Ciudad Vieja" del día 2 ya está `ready` con 10 paradas curadas (seed). Todo lo que narra el guía en la Ciudadela sale de acá.
- **Opcional, Acto 1 o 3:** "armame un tour de 45 minutos acá" → la app muestra el progreso del job en vivo ("Buscando lugares… Verificando 18 datos… Armando la ruta…") y el tour aparece en el mapa.

## Historias de usuario

- Como viajero, desde un bloque `tour` toco "Generar tour" y en menos de 2 minutos tengo un recorrido con paradas, tiempos y punto final.
- Como viajero al que le encanta la arquitectura y no le gustan los museos, el tour prioriza fachadas y no me hace entrar a museos.
- Como grupo con alguien con movilidad reducida, el tour evita escalones y acorta los tramos.
- Como usuario, cada dato que escucho tiene fuente; si toco "Fuentes" veo los links.
- Como usuario, si encuentro un error lo reporto desde la parada.
- Como equipo, un segundo tour en una zona ya investigada reutiliza `place_library` y sale más rápido y más barato.

## Criterios de aceptación

- [ ] `POST /tools/generate_tour` valida el input con Zod (`packages/shared/tools`) y responde en ≤1 s con `{ ok: true, data: { job_id, tour_id } }`. Crea `tours` con `status='generating'` y `agent_jobs` con `kind='generate_tour'`.
- [ ] El job escribe ≥5 entradas en `agent_jobs.progress` (formato `[{at, text}]`, en español) que la app ve por Realtime sin polling.
- [ ] Tour de 60 min en Ciudad Vieja con `place_library` vacía: `status='ready'` en ≤120 s (p50) y ≤180 s (máximo). Con `place_library` caliente (≥8 lugares en 600 m): ≤45 s.
- [ ] Cantidad de paradas: entre 3 y 12, ≈ `duration_min / 8` redondeado.
- [ ] Cada parada tiene no vacíos: `look_at`, `narration_short` (40–80 palabras, ≈20–30 s hablado), `narration_more` (80–150 palabras), `narration_secret` (40–100 palabras), `transition_to_next` y `nav_to_next` (salvo la última), `sources` con ≥2 URLs distintas.
- [ ] `myth_vs_fact`, `photo_spot` y `kid_mission` son opcionales, pero ≥50% de las paradas tienen `photo_spot` y `kid_mission`.
- [ ] 100% de los años, nombres propios y cifras de las narraciones están respaldados por un elemento de `place_library.facts` con `verified=true` y `source_url`. Un fact con `verified=false` nunca llega a una narración (chequeo automático post-generación, ver Notas técnicas).
- [ ] Duración estimada (caminata a pie por Google Routes + permanencia por parada) dentro de ±10% de `duration_min`.
- [ ] Si se pasa `end_point`, la última parada queda a ≤150 m de ese punto.
- [ ] Intereses: con 2+ participantes se combinan los pesos de `profiles.interests` (promedio) y se unen los `profiles.avoid`. Con "museos" en `avoid` no hay paradas que requieran entrar a un museo (la fachada puede ser parada si `look_at` es exterior).
- [ ] Horarios: un lugar cerrado a la hora estimada de llegada (según `place_details`) se descarta, salvo que la parada sea solo exterior.
- [ ] Accesibilidad: si algún participante tiene `profiles.mobility.step_free=true`, no hay paradas con `wheelchair=no` en OSM y ningún tramo supera 600 m.
- [ ] Reutilización: el segundo tour en la misma zona hace ≤50% de las llamadas a `web_search` que el primero (queda registrado en `agent_jobs.result.stats`).
- [ ] Los lugares nuevos se guardan en `place_library` con `tier='researched'`. Los `curated` nunca se sobreescriben (upsert por `google_place_id`, después `wikidata_id`, después `osm_id`).
- [ ] Persona: se usa la `personas(kind='local')` de la ciudad si existe; si no, el job crea una y la asigna en `tours.persona_id`.
- [ ] Trama: con `storyline=true`, `tours.storyline` tiene la premisa, cada `transition_to_next` hace avanzar la trama y la última parada la cierra. Con `false`, `tours.storyline` queda null.
- [ ] Si falla (menos de 3 candidatos, API caída, timeout), queda `tours.status='failed'`, `agent_jobs.status='failed'` y `agent_jobs.error` con un texto legible para el usuario.
- [ ] Toda generación escribe una fila en `activity_feed` (`actor_agent=true`, `kind='tour_generated'`) si hay `trip_id`.
- [ ] **Seed:** `supabase/seed.sql` carga 10 filas en `place_library` (`tier='curated'`), 1 en `tours` (`status='ready'`, `mode='planned'`, ligado al bloque "Ciudad Vieja" del día 2) y 10 en `tour_stops`. Un humano revisó cada fact abriendo su fuente.

## Pantallas y estados

- **Entrada:** botón "Generar tour" en el detalle de un bloque `tour` y "Tour acá, ahora" (espontáneo). Abre una hoja con: duración (30 / 45 / 60 / 90 / 120 min), punto final ("terminar en…" con buscador, "volver al inicio" o "donde sea"), trama (sí / no), quiénes van (chips con los participantes del bloque, todos marcados).
- **Cargando:** tarjeta de progreso con las líneas de `agent_jobs.progress` apareciendo en vivo y un indicador de paso (Buscando → Investigando → Verificando → Armando ruta → Escribiendo). Nunca una pantalla vacía.
- **Listo:** vista previa con el mapa y la ruta, lista de paradas (número, nombre, minutos, distancia al siguiente, chip "Curado" o "Investigado"), botón "Fuentes" por parada y botón grande "Empezar" (→ PRD 07).
- **Vacío:** "No encontramos suficientes lugares con historia acá (mínimo 3). Probá con más tiempo o moviéndote un poco."
- **Error:** el texto de `agent_jobs.error` + "Reintentar" (vuelve a llamar `generate_tour` con el mismo input).
- **Reportar error:** en cada parada, "Reportar un error" → campo de texto → inserta en `place_error_reports`.

## Datos

Tablas (nombres exactos de Contratos): `tours`, `tour_stops`, `place_library`, `personas`, `agent_jobs`, `profiles`, `blocks`, `block_participants`, `activity_feed`, `place_error_reports`, `content_told` (solo lectura: evita repetir historias que el usuario ya escuchó).

**Input de `generate_tour`** (en `packages/shared/tools/generate_tour.ts`):

```typescript
export const GenerateTourInput = z.object({
  mode: z.enum(['planned', 'spontaneous', 'explorer']),
  trip_id: z.string().uuid().optional(),
  block_id: z.string().uuid().optional(),          // planned: toma lugar, hora y participantes del bloque
  start_lat: z.number(),
  start_lng: z.number(),
  duration_min: z.number().int().min(15).max(240),
  end_point: z.object({ lat: z.number(), lng: z.number(), name: z.string().optional() }).nullable().optional(),
  participant_ids: z.array(z.string().uuid()).optional(), // default: block_participants o el usuario del JWT
  storyline: z.boolean().default(false),
  start_at: z.string().datetime().optional(),       // para chequear horarios; default: ahora
  language: z.string().default('es'),
});
```

**Resultado del job** (`agent_jobs.result`): `{ tour_id, stop_count, total_walk_m, est_duration_min, stats: { web_search_calls, places_reused, places_new, facts_verified, facts_rejected } }`.

**Formatos jsonb:**

- `place_library.facts`: `[{ text, source_url, verified }]` (contrato). `text` es una afirmación atómica (un dato por fact).
- `tour_stops.sources`: `[{ title, url }]`, deduplicado, solo URLs de facts verificados usados en esa parada.
- `tours.end_point`: `{ lat, lng, name? }` o null.
- `profiles.mobility` (lectura): se usa `step_free: boolean`. La forma completa la define PRD 10.

**Radios de geofence** (`tour_stops.geofence_radius_m`): 35 m por defecto, 50 m en plazas abiertas, 25 m en puntos sobre calles angostas.

### Entregable de contenido: 10 paradas curadas de Ciudad Vieja

> ⚠️ **Nada de esto es dato histórico verificado.** La tabla define qué lugares van, en qué orden y qué hay que investigar. Las preguntas son hipótesis a confirmar. Las coordenadas son aproximadas y se reemplazan por las de `place_details`. Ningún fact entra al seed sin `source_url` abierta y leída por una persona.

Recorrido sugerido (≈2,2 km a pie, ≈90 min con permanencias; termina en el Mercado del Puerto). Reserva: Rambla / Puerto (si alguna parada no se puede verificar a tiempo o para plan B).

| # | Lugar | lat, lng (aprox.) | Radio | Qué mirar (borrador, validar en el lugar) | Preguntas a verificar con fuente |
|---|---|---|---|---|---|
| 1 | Plaza Independencia + Palacio Salvo | -34.9066, -56.1990 | 50 | La torre del Palacio Salvo desde el centro de la plaza; el monumento central | ¿Año de inauguración del Salvo? ¿Fue el edificio más alto de Sudamérica en su momento? ¿Mismo arquitecto que el Palacio Barolo de Buenos Aires? ¿Qué hay debajo del monumento (mausoleo) y en qué horario abre? |
| 2 | Teatro Solís | -34.9073, -56.2006 | 35 | La fachada con columnas desde la vereda de enfrente | ¿Año de inauguración? ¿Origen del nombre? ¿Hay visitas guiadas y en qué horarios? |
| 3 | Puerta de la Ciudadela | -34.9066, -56.2015 | 30 | El arco de piedra y el espesor del muro; pararse debajo | ¿Cuándo se construyó la ciudadela y cuándo se demolió? ¿Por qué se conservó la puerta? ¿Estuvo siempre en este lugar o fue trasladada? |
| 4 | Peatonal Sarandí | -34.9068, -56.2028 | 35 | El empedrado y la perspectiva hacia ambos extremos de la calle | ¿Desde cuándo es peatonal? ¿Por qué se llama Sarandí? ¿Qué tipo de comercio la caracterizó históricamente? |
| 5 | Museo Torres García | -34.9071, -56.2036 | 25 | La fachada y la vidriera (parada exterior) | ¿Quién fue Joaquín Torres García y qué es el Universalismo Constructivo? ¿Dónde está hoy la obra "América invertida"? |
| 6 | Cabildo de Montevideo | -34.9071, -56.2046 | 35 | La galería de arcos de la planta baja | ¿Qué funciones tuvo el edificio (gobierno, cárcel, parlamento)? ¿Qué hecho institucional se asocia con su balcón o con la plaza? ¿Qué funciona hoy? |
| 7 | Iglesia Matriz (Catedral Metropolitana) | -34.9061, -56.2053 | 35 | Las dos torres y la fachada desde la Plaza Matriz | ¿Es la iglesia más antigua de la ciudad? ¿Años de construcción? ¿Quiénes están enterrados ahí? |
| 8 | Museo Histórico Nacional · Casa de Rivera | -34.9063, -56.2064 | 25 | La fachada sobre la calle Rincón (parada exterior) | ¿Quién vivió ahí? ¿Qué colección tiene hoy? ¿Horario de apertura? |
| 9 | Plaza Zabala | -34.9056, -56.2087 | 45 | La estatua ecuestre del centro y el trazado del jardín | ¿Quién fue Bruno Mauricio de Zabala y qué rol tuvo en la fundación? ¿Qué había antes en ese predio? |
| 10 | Mercado del Puerto | -34.9063, -56.2125 | 40 | La estructura del techo y el reloj, desde la entrada principal | ¿Año de inauguración? ¿De dónde vino la estructura? ¿Desde cuándo es conocido por las parrillas? |

**Fuentes a priorizar** (confirmar dominio exacto al investigar): Wikipedia en español y su ítem de Wikidata; Intendencia de Montevideo ([montevideo.gub.uy](http://montevideo.gub.uy)); sitio oficial del Teatro Solís; sitio oficial del Museo Torres García; sitio del Museo Histórico Nacional; Comisión del Patrimonio Cultural de la Nación. Regla: ≥2 fuentes por parada; para fechas y cifras, al menos una fuente institucional u oficial.

**Flujo de curado (≈2 h en total, una persona):**

1. Correr `pnpm curate:ciudad-vieja`: ejecuta los pasos 2 a 6 del pipeline (ver Notas técnicas) para los 10 lugares y escribe un borrador en `supabase/seed/ciudad-vieja-stops.json` con facts y fuentes.
2. Una persona abre cada `source_url`, confirma cada fact y deja `verified: true` solo si el texto está en la fuente. Lo dudoso se borra.
3. Correr el paso 7 (generación, effort `high`) solo con facts verificados → narraciones.
4. Lectura en voz alta: si una narración tarda más de 30 s (capa corta), se recorta. Persona local: un vecino ficticio de Ciudad Vieja, presentado como personaje, que nunca inventa recuerdos como si fueran hechos.
5. `pnpm seed:build` genera los INSERT y los agrega a `supabase/seed.sql`.

**Formato de carga** (`supabase/seed/ciudad-vieja-stops.json`, un objeto por parada):

```json
{
  "sort_order": 3,
  "place": {
    "name": "Puerta de la Ciudadela",
    "google_place_id": "COMPLETAR con place_details",
    "osm_id": "COMPLETAR",
    "wikidata_id": "COMPLETAR",
    "lat": -34.9066, "lng": -56.2015,
    "city": "Montevideo", "country": "UY",
    "tier": "curated", "base_lang": "es",
    "facts": [
      { "text": "COMPLETAR (un dato atómico)", "source_url": "https://...", "verified": true }
    ]
  },
  "stop": {
    "geofence_radius_m": 30,
    "look_at": "...",
    "narration_short": "...",
    "narration_more": "...",
    "narration_secret": "...",
    "myth_vs_fact": null,
    "photo_spot": "...",
    "kid_mission": "...",
    "transition_to_next": "...",
    "nav_to_next": "...",
    "sources": [{ "title": "...", "url": "https://..." }]
  }
}
```

`pnpm seed:build` usa UUIDs determinísticos (uuid v5 sobre `ciudad-vieja:<sort_order>`) para que PRD 07, PRD 09 y el viaje de demo puedan referenciar el tour y las paradas por constante (exportadas desde `packages/shared/demo.ts`). Rechaza el build si algún fact usado tiene `verified=false` o no tiene `source_url`.

## Herramientas y endpoints

- `generate_tour` (este PRD). Respuesta estándar `{ ok, data }` sin `undo_token` (generar no modifica bloques).
- Usadas por dentro (llamadas a las funciones del server, no por HTTP): `search_places`, `place_details`, `route_eta` (PRD 00).
- `GET /jobs/:id`: fallback si Realtime falla.
- APIs externas (solo en el server): Google Places (New) Nearby Search y Place Details; Google Routes `computeRouteMatrix` y `computeRoutes` en modo `WALK`; Wikipedia `action=query&list=geosearch`; Wikidata `wbgetentities`; OSM Overpass (`historic=*`, `tourism=attraction|artwork|viewpoint|museum`, `memorial=*`, `wheelchair=*`).
- Claude Opus 5.5 (`claude-opus-5-5`) con `@anthropic-ai/sdk`:
    - Investigar (pasada 1): effort `medium`, herramientas `web_search_20260209` y `web_fetch_20260209`.
    - Verificar (pasada 2): effort `medium`, `web_fetch_20260209`.
    - Generar paradas: effort `high`, salida estructurada con Zod.

## Notas técnicas

**Pipeline del job** (`apps/api/src/agents/tourGenerator.ts`, cada paso escribe una línea en `agent_jobs.progress`):

1. **Contexto:** leer `profiles` de los participantes, el bloque (si es `planned`) y la hora de inicio. Combinar intereses (promedio de pesos) y `avoid` (unión). `step_free` = OR de todos.
2. **Candidatos en paralelo**, radio = `min(1200, duration_min * 20)` metros desde el inicio: `place_library` con `ST_DWithin(geo, punto, radio)`; Google Places Nearby (tipos: `tourist_attraction`, `historical_landmark`, `museum`, `church`, `park`); Wikipedia geosearch (`gslimit=50`); Overpass. Deduplicar: distancia ≤40 m + similitud de nombre normalizado (trigram ≥0,5) o mismo `wikidata_id`.
3. **Score:** afinidad con intereses (mapa de tipos y etiquetas OSM → tags de interés en `packages/shared/interests.ts`) × notoriedad (cantidad de sitelinks de Wikidata, `userRatingCount` de Places) × bonus 1,5 si `tier='curated'`. Descartar por `avoid`, horario y accesibilidad. Quedarse con los N mejores, N = `clamp(round(duration_min / 8), 3, 12)`.
4. **Ruta:** matriz a pie con `computeRouteMatrix` (WALK); vecino más cercano + 2-opt con inicio fijo y fin fijo si hay `end_point`. Permanencia: 4 min por parada exterior, 6 min si es una parada fuerte. Mientras la duración total supere `duration_min * 1.1`, sacar la parada de menor score.
5. **Investigación (pasada 1, effort `medium`**, máx. 4 lugares en paralelo): solo para lugares sin ≥4 facts verificados en `place_library`. Prompt: "devolvé datos atómicos con la URL exacta donde aparece cada uno; preferí fuentes institucionales; si no encontrás algo, no lo pongas". Salida estructurada `{ facts: [{ text, source_url }] }`.
6. **Verificación (pasada 2, effort `medium`**, llamada independiente): recibe solo `{ text, source_url }` de cada fact, hace `web_fetch` de la URL y responde `{ supported: boolean, quote }`. `verified=true` solo si `supported` y `quote` no está vacío. Si no, se busca una segunda fuente una vez; si tampoco, el fact se guarda con `verified=false` y no se usa.
7. **Generación (effort `high`)**: una llamada con salida estructurada `TourStopsSchema` (los campos de `tour_stops`). Recibe facts verificados por lugar, perfiles combinados, persona, trama y `content_told` del usuario. Regla de prompt: "no menciones años, nombres propios ni cifras que no estén en FACTS; si no hay datos, describí lo que se ve".
8. **Chequeo automático:** extraer de cada narración años (regex `\b(1[5-9]\d\d|20\d\d)\b`), números y nombres propios; cada uno tiene que aparecer en algún fact verificado de esa parada. Si falla: regenerar esa parada una vez; si vuelve a fallar, borrar la oración.
9. **Escritura (transacción):** upsert `place_library` (nunca pisar `curated`), insert `tour_stops`, `tours.status='ready'`, `agent_jobs.status='done'` con `result`, fila en `activity_feed`.

**Claude: detalles que muerden**

- Claude Opus 5.5 no acepta thinking deshabilitado: dejar `thinking: { type: 'adaptive' }` y controlar con `output_config: { effort }`. El effort por defecto es `medium`; poner `high` explícito en la generación.
- `tool_choice` forzado (`any` o `tool`) da 400 en Opus 5.5: para obtener JSON usar `client.messages.parse` con `output_config.format: zodOutputFormat(Schema)` (`@anthropic-ai/sdk/helpers/zod`).
- Las citations de documentos son incompatibles con `output_config.format`: no activarlas en las llamadas con salida estructurada.
- Los errores de `web_search` y `web_fetch` no tiran excepción: vienen como bloque de resultado con `error_code`. Revisarlo y contarlo en `stats`.
- Activar `fallbacks: 'default'` (beta `server-side-fallback-2026-07-01`) y chequear `stop_reason === 'refusal'` antes de leer el contenido.
- `web_fetch` solo trae URLs que ya aparecieron en la conversación: en la pasada 2, incluir la URL en el mensaje del usuario.

**Runtime en Vercel:** el handler responde `job_id` enseguida y sigue el trabajo con `waitUntil` de `@vercel/functions`; `export const maxDuration = 300`. Si se pasa de 280 s, guardar lo que haya (≥3 paradas) y marcar `ready` con una nota en `progress`.

**Costos y caché:** prompt de sistema fijo y lista de herramientas determinística al principio (prompt caching por prefijo). `place_library.embedding` queda en null en el MVP.

**Orden de implementación sugerido:** (1) formato del JSON del seed + `seed:build` y cargar 1 parada a mano → desbloquea PRD 07 y PRD 09 enseguida; (2) pasos 5 y 6 + script `curate:ciudad-vieja`; (3) curar las 10 paradas (en paralelo con lo siguiente); (4) pasos 1 a 4 (candidatos y ruta); (5) paso 7 + chequeo; (6) hoja "Generar tour" y la tarjeta de progreso.

**PROPUESTA DE CAMBIO A CONTRATOS**

- `tour_stops.dwell_min int` (permanencia sugerida por parada). Hoy no hay dónde guardarla y PRD 07 la necesita para respetar el reloj y decidir qué recortar. Alternativa sin cambio: constante 4 min en el cliente.
- `tours.route jsonb` = `{ polyline, total_walk_m, est_duration_min }` (polilínea a pie codificada). La usan el mapa de PRD 07 y la detección de `left_route`. Alternativa sin cambio: segmentos rectos entre paradas.
- Archivo de seed nuevo `supabase/seed/ciudad-vieja-stops.json` (fuente del contenido curado, junto a `ciudad-vieja-track.json`).

## Fuera de alcance

- Modo explorador / radar de historias (PRD 18): acá solo se acepta `mode='explorer'` en el esquema.
- Embeddings y búsqueda semántica en `place_library`.
- Traducción del contenido (se genera en `language`; la traducción al vuelo es otro PRD).
- Imágenes "cómo era" (`time_travel_image`, PRD 25).
- Plan B por lluvia del tour (re-planificación, PRD 12).
- Panel editorial para curar desde la app (se cura con el script + JSON).

## Dependencias

- **PRD 00:** esquema y migraciones, `packages/shared`, `/tools/:name`, `search_places`, `place_details`, `route_eta`, `agent_jobs` + Realtime, seed base (viaje y bloque "Ciudad Vieja").
- Lo consumen: PRD 07 (tour en vivo), PRD 08 (lugares cercanos para la cámara), PRD 09 (el track tiene que pasar por estas paradas).
- Keys en Vercel: `ANTHROPIC_API_KEY`, `GOOGLE_MAPS_API_KEY` (Places New + Routes habilitadas).

## Cómo probarlo

1. Correr `supabase db reset` → verificar en el Studio 10 filas `curated` en `place_library`, el tour `ready` y 10 `tour_stops` con `sources` no vacías.
2. En el celu (dev build), entrar al viaje de demo → día 2 → bloque "Ciudad Vieja" → ver la vista previa con las 10 paradas en el mapa, en orden, y abrir "Fuentes" de la Ciudadela: los links abren.
3. Parado en cualquier lugar de Montevideo (o con GPS simulado de PRD 09), tocar "Tour acá, ahora" → 45 min → "donde sea". Ver aparecer las líneas de progreso en vivo. Cronometrar: ≤120 s hasta "Listo".
4. Abrir 3 paradas al azar del tour generado: elegir un año o nombre de cada narración y buscarlo en `place_library.facts` de esa parada (Studio): tiene que estar con `verified=true`.
5. Editar tu perfil: agregar "museos" en `avoid` → generar de nuevo → no hay paradas de museo con `look_at` interior.
6. Generar otro tour en la misma zona → comparar `agent_jobs.result.stats.web_search_calls` (≤50% del primero) y el tiempo (≤45 s).
7. Apagar los datos del celu a mitad del job → la app sigue mostrando el progreso cuando vuelve la red (el job corre en el server) o el error con "Reintentar" si falló.
