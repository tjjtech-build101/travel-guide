---
nro: 1
prd: "01 · Crear viaje conversacional"
prioridad: P0
estado: "Por hacer"
carril: "Cerebro y contenido"
tamano: "M (1-3h)"
depende_de: "00"
resumen: "Chat de texto \"Nuevo viaje\" que dispara plan_trip: un job con Claude Opus 5.5 (effort high, Tool Runner, salidas estructuradas, web search) que arma tramos, días y bloques mientras el itinerario se llena en vivo por Realtime."
notion_url: https://app.notion.com/p/3fc81924a5c6814697b9e324790fa444
---

# 🧠 01 · Crear viaje conversacional

> 📌 Fuentes: [Producto](../PRODUCT.md) · [Arquitectura](../ARCHITECTURE.md) · [Contratos](../CONTRACTS.md). Requiere PRD 00 (registro de herramientas, `writeMode`, `activity_feed`, Realtime).

## Objetivo

Que un usuario cuente su viaje en un chat ("Montevideo y Buenos Aires, 8 días, somos 4, Sofi se va antes a Buenos Aires") y en menos de 3 minutos tenga un itinerario multi-destino real: tramos con fechas, tramos paralelos si el grupo se separa, días repartidos entre destinos y bloques con lugares reales de Google, horarios verificados y traslados. El itinerario aparece **en vivo** mientras el agente trabaja, con progreso visible. Nunca pantalla vacía.

## Momento de la demo

Acto 1, "planificar juntos": Juan escribe el viaje en el chat, toca "Armar el viaje" y en el escenario se ve cómo aparecen los tramos, después los días y bloque por bloque (y los pines en el mapa 3D si PRD 03 está), con líneas de progreso tipo "Busqué parrillas cerca del Mercado del Puerto…".

## Historias de usuario

- Como organizador, cuento mi viaje con mis palabras (destinos, fechas aproximadas, quiénes, qué nos gusta, sí o sí / ni loco) y el compañero arma el viaje.
- Como organizador, si sólo sé "Montevideo y Buenos Aires, 8 días", el agente reparte los días entre destinos y me dice qué supuso.
- Como organizador, si digo que alguien se separa, el agente crea tramos paralelos y el reencuentro.
- Como organizador, mientras se arma veo qué está haciendo y el itinerario creciendo; si algo falla, puedo reintentar sin perder lo hecho.
- Como organizador, si no me gusta, deshago todo el plan con un toque.

## Criterios de aceptación

- [ ] `plan_trip` registrado en `packages/shared` y en la API; responde en ≤ 1,5 s con `{ ok:true, data:{ job_id, trip_id } }` y sigue trabajando en background (`waitUntil`).
- [ ] Sin `trip_id`: crea `trips` (`status='planning'`, `created_by`, título) y el organizer queda en `trip_members` (trigger de 00).
- [ ] Primer tramo visible en la app ≤ 20 s después de tocar "Armar el viaje"; primer bloque ≤ 40 s; job `done` ≤ 180 s para un viaje de 2 destinos y 8 días (medido 3 veces).
- [ ] `agent_jobs.progress` recibe una línea nueva al menos cada 10 s mientras `status='running'` (heartbeat si no hubo herramienta).
- [ ] Viaje de prueba A ("Montevideo y Buenos Aires, 8 días desde el 17/10, 4 amigos"): 2 tramos, 8 días totales contiguos, 1 bloque `transfer` entre tramos con `transfer.mode` = `ferry` o `bus`.
- [ ] Viaje de prueba B ("... y Sofi se va 2 días sola a Buenos Aires mientras el resto va a Colonia"): tramos paralelos con fechas superpuestas + tramo de reencuentro; `agent_jobs.result.participants_hint` nombra a Sofi en el tramo correcto.
- [ ] Cada día de cada tramo tiene entre 3 y 6 bloques; hay al menos 1 `meal` por día; el primer día de cada tramo tiene 1 `lodging` con `status='idea'`.
- [ ] 100 % de los bloques con lugar tienen `google_place_id`, `lat`, `lng` obtenidos de `search_places` (nunca inventados). Si `place_details` dice que está cerrado ese día, el bloque no se agenda ahí o lleva `alerts:[{kind:'closes', text}]`.
- [ ] Bloques con `created_by_agent=true`, `created_by` = organizer, `time_flex` coherente (`fixed` solo si hay horario real: shows, tours, traslados).
- [ ] Al terminar: `agent_jobs.status='done'`, `result={ legs, days, blocks, summary, assumptions, participants_hint }` y 1 fila `activity_feed` `kind='trip_planned'` con `undo_token` que borra todo lo creado por el job (bloques, días, tramos) y deja el viaje vacío.
- [ ] Reintento: `plan_trip` sobre un `trip_id` existente solo completa tramos sin bloques; si todos tienen bloques → 409 `{code:'trip_not_empty'}`.
- [ ] Error de Claude o Google: `status='failed'`, `error` legible; lo ya escrito queda y la UI ofrece "Reintentar".
- [ ] Ninguna key sale del servidor; el celu solo llama `POST /tools/plan_trip` y escucha Realtime.

## Pantallas y estados

### "Nuevo viaje" (`app/(app)/trips/new.tsx`) — chat de texto guiado

Burbujas del compañero son textos locales (sin LLM) para que sea instantáneo; las respuestas del usuario son texto libre + chips. Orden:

1. "¡Buenas! ¿A dónde quieren ir? Pueden ser varios lugares, en el orden que quieran."
2. "¿Cuándo y cuántos días más o menos?" — chips: "Este finde", "1 semana", "10 días", "Todavía no sé" + selector de fecha.
3. "¿Quiénes viajan? ¿Alguien se separa en algún momento?" — chips: "Solo yo", "En pareja", "Con amigos", "En familia".
4. "¿Qué les copa?" — chips multi: Comida, Historia, Arquitectura, Museos, Naturaleza, Noche, Playa, Compras, Caminar.
5. "¿Algo sí o sí? ¿Algo ni loco?" → botón grande "Armar el viaje".

- Desde la respuesta 1 aparece el botón secundario "Armalo ya" (el mínimo es un destino).
- Vacío: la primera burbuja ya está + 3 chips de ejemplo ("Montevideo y Buenos Aires", "Ruta por el norte argentino", "Lisboa y Oporto").
- Cargando (tras "Armar"): navega en ≤ 1,5 s a Plan del viaje nuevo con `trip_id`.
- Error al llamar: burbuja roja "No pude arrancar. ¿Probamos de nuevo?" + reintentar; el chat no se pierde (`zustand` persistido).

### Panel de progreso `AgentJobProgress` (`apps/mobile/src/features/jobs/AgentJobProgress.tsx`)

Componente reutilizable que se monta arriba de Plan (PRD 02) y funciona aunque Plan sea todavía el placeholder de 00.

- Running: título "Tu compañero está armando el viaje", barra indeterminada, últimas 4 líneas de `progress` con animación de entrada, contador "3 tramos · 12 bloques" en vivo.
- Debajo, mientras no hay bloques: skeleton de tramos/días con los que ya existen en `legs` (nunca pantalla vacía).
- Done: se colapsa a un chip "Listo: 2 tramos, 8 días, 31 bloques · Ver supuestos · Deshacer". "Ver supuestos" abre `result.assumptions`.
- Failed: banner "Se trancó armando Colonia" + "Reintentar" (vuelve a llamar `plan_trip` con el `trip_id`).

## Datos

- Escribe: `trips`, `legs`, `leg_members`, `days`, `blocks`, `block_participants`, `agent_jobs`, `activity_feed`.
- Lee: `profiles` (intereses, `pace`, `chronotype`, `dietary`, `avoid`, `budget_level`, `languages`), `trip_members.trip_prefs` de los miembros, `saved_places` del organizer (si hay lugares guardados en esas ciudades, priorizarlos).
- `agent_jobs`: `kind='plan_trip'`, `trip_id`, `user_id`, `status` ∈ `queued`, `running`, `done`, `failed`; `progress=[{at, text}]` (append); `result` como en criterios.
- `legs.sort_order` por fecha de inicio; tramos paralelos comparten fechas. `leg_members`: solo usuarios que ya son miembros (si el viaje es nuevo, sólo el organizer en los tramos donde dijo que va). Los nombres de personas que todavía no están se guardan en `result.participants_hint=[{leg_id, names}]` (PRD 04 lo usa para presugerir tramos al unirse).
- `days`: una fila por fecha por tramo. Bloques de traslado: `type='transfer'`, en el primer día del tramo destino, `transfer={from, to, mode, duration_min}`, participantes = miembros del tramo destino.

## Herramientas y endpoints

- `POST /tools/plan_trip` (nombre de Contratos). Input:

```typescript
export const PlanTripInput = z.object({
  trip_id: z.string().uuid().optional(),
  title: z.string().max(80).optional(),
  conversation: z.array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().max(2000) })).min(1).max(40),
  start_date: z.string().optional(), // YYYY-MM-DD si el usuario lo eligió en el selector
  end_date: z.string().optional(),
});
```

- Herramientas que usa el agente por dentro (mismas funciones que `/tools/:name`, vía `toClaudeTools` de 00): `get_trip_overview`, `search_places`, `place_details`, `route_eta`, `add_block`. Server tool: web search.
- Fallback de progreso: `GET /jobs/:id` (00) solo si el canal Realtime falla.
- La voz (PRD 05) puede llamar `plan_trip` como cualquier herramienta: el input es el mismo con la conversación transcripta.

## Notas técnicas

### Pipeline del job (`apps/api/src/agents/planTrip.ts`)

1. **Setup** (≤ 1 s, síncrono): validar, crear viaje si falta, insertar `agent_jobs` `queued`, responder `{job_id, trip_id}`; el resto dentro de `waitUntil`.
2. **Esqueleto** con salida estructurada: una llamada a Claude que devuelve tramos y traslados. Después se resuelve cada ciudad con `search_places` (query = ciudad + país) para `google_place_id`, `lat`, `lng`, y se insertan `legs` + `leg_members` + `days` en una transacción. Progreso: "Armé 3 tramos: Montevideo (17–19), Colonia y Buenos Aires en paralelo (20–21), Buenos Aires (22–24)".
3. **Relleno por tramo**, hasta 3 tramos en paralelo (`Promise.allSettled`): un Tool Runner por tramo que agrega bloques con `add_block`. Cada `add_block` exitoso agrega una línea de progreso ("Agregué Mercado del Puerto al sáb 17") y el bloque llega a los celus por Realtime.
4. **Traslados** entre tramos (del esqueleto) con `route_eta` (`car` para bus; para ferry y vuelo, duración del esqueleto + web search si hace falta).
5. **Cierre**: `result`, `activity_feed` `trip_planned` con `payload.inverse` = borrar todo lo creado (ids recolectados), `status='done'`.

### Llamadas a Claude (exactas)

```typescript
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
const client = new Anthropic();

// Paso 2: esqueleto (salida estructurada)
const sk = await client.messages.parse({
  model: 'claude-opus-5-5',
  max_tokens: 16000,
  thinking: { type: 'adaptive' },
  output_config: { effort: 'high', format: zodOutputFormat(TripSkeleton) },
  system: SKELETON_SYSTEM, // reglas de reparto de días, tramos paralelos, idioma
  messages: [{ role: 'user', content: renderConversation(input, today, profiles) }],
});
if (sk.stop_reason === 'refusal' || !sk.parsed_output) throw new JobError('skeleton_failed');

// Paso 3: un runner por tramo
const runner = client.beta.messages.toolRunner({
  model: 'claude-opus-5-5',
  max_tokens: 16000,
  thinking: { type: 'adaptive' },
  output_config: { effort: 'high' },
  betas: ['server-side-fallback-2026-07-01'],
  fallbacks: 'default',
  max_iterations: 40,
  system: legSystemPrompt(leg, members, prefs),
  tools: [
    ...toClaudeTools(ctxAgentPlan, ['search_places', 'place_details', 'route_eta', 'add_block', 'get_trip_overview']),
    { type: 'web_search_20260209', name: 'web_search', max_uses: 4 },
  ],
  messages: [{ role: 'user', content: `Armá los días ${leg.start_date} a ${leg.end_date} en ${leg.city}.` }],
});
for await (const msg of runner) {
  if (msg.stop_reason === 'pause_turn') runner.pushMessages({ role: 'assistant', content: msg.content });
}
const final = await runner.done();
```

- `TripSkeleton` (Zod, interno de `apps/api/src/agents/schemas.ts`): `{ title, start_date, end_date, legs:[{ key, city, country, start_date, end_date, participant_names:string[], parallel_with:string[], why }], transfers:[{ from_key, to_key, date, mode:'walk'|'transit'|'bus'|'ferry'|'flight'|'car', duration_min, participant_names }], assumptions:string[] }`. Es un tipo interno del agente, no una herramienta ni una tabla.
- Gotcha Opus 5.5: `thinking` no se puede deshabilitar y el `effort` por defecto es `medium` → pasar `effort:'high'` explícito. `tool_choice` forzado (`any`/`tool`) da 400: usar `auto` y pedirlo en el prompt.
- Gotcha Tool Runner: no reanuda solo `pause_turn` cuando hay server tools (web search) → el loop de arriba es obligatorio; chequear `stop_reason` del final antes de confiar.
- `fallbacks: 'default'` + beta `server-side-fallback-2026-07-01`: si un clasificador rechaza, reintenta en otro modelo del lado del servidor. Si la versión del SDK no tipa `fallbacks`, pasarlo igual (`as any`) o sacarlo; no es bloqueante.
- `ctxAgentPlan`: `actor='agent'` **con excepción de plan**: dentro de un job `plan_trip` sobre un tramo sin bloques, `add_block` aplica directo aunque el bloque sea compartido (el pedido explícito del organizer es la aprobación; el `undo_token` de `trip_planned` lo revierte entero). Implementarlo como flag `ctx.planJobId` que `writeMode` respeta solo si el tramo tenía 0 bloques al empezar el job. Cualquier otra escritura del agente sigue la regla normal (propuesta).

### Reglas del prompt del planificador (resumen para escribir `SKELETON_SYSTEM` y `legSystemPrompt`)

- Hoy es `<fecha>`; si no hay fechas, arrancar el próximo sábado. Reparto de días: proporcional a lo que hay para hacer y a los intereses, mínimo 2 noches por destino salvo que el usuario diga otra cosa; el día de traslado cuenta como medio día.
- Si alguien se separa: tramos paralelos con las mismas fechas y un tramo de reencuentro con la unión. Nunca crear dos viajes.
- Por día: 3 a 6 bloques, ritmo según `pace` (`relaxed` 3–4, `balanced` 4–5, `intense` 5–6), arranque según `chronotype`. Almuerzo y cena como `meal` con `time_flex` (`afternoon`/`evening`) salvo reserva. Respetar `dietary`, `avoid`, `must` y "ni loco".
- Todo lugar sale de `search_places`; horarios de `place_details`. Entre bloques consecutivos, `route_eta` a pie; si > 30 min, transit. Nunca inventar horarios, precios ni eventos: si no hay dato, `time_flex` y sin `cost_estimate`.
- Web search solo para eventos o temporada en esas fechas (ferias, partidos, feriados), máx. 4 por tramo, con fuente en `blocks.sources`.
- Títulos cortos en rioplatense ("Chivito en el Mercado"); nombres de lugares en el idioma original.
- `assumptions`: todo lo que se supuso ("Asumí 3 noches en Montevideo porque…").

### Progreso y tiempos

- Helper `progress(jobId, text)` hace `update agent_jobs set progress = progress || jsonb_build_array(...)`. Heartbeat cada 10 s sin novedad: "Sigo armando Colonia…".
- Durante el job, la app invalida el overview con cada evento de `agent_jobs` (los `days` no están en la publicación Realtime; ver 00).
- Vercel: `maxDuration` 300 en Hobby (800 en Pro). Con 3 tramos en paralelo y effort high debería entrar en ≤ 180 s; si un tramo pasa 150 s, cortar ese runner, marcarlo en `progress` y dejar que "Reintentar" lo complete.
- Costos: Places con FieldMask mínimo y cache de 00; no llamar `place_details` más de 1 vez por lugar.

### Orden de implementación sugerido

1. `PlanTripInput` + handler que crea viaje + job + `waitUntil` con progreso fake (para que 02 pueda probar el panel ya).
2. `AgentJobProgress` + pantalla de chat.
3. Esqueleto con `messages.parse` + inserción de tramos/días.
4. Runner por tramo + excepción de plan en `writeMode`.
5. Traslados, cierre, `trip_planned` + undo, reintento.
6. Afinar prompts con los viajes de prueba A y B.

## Fuera de alcance

- Chat libre con LLM antes de planificar (las preguntas son guiadas y locales).
- Voz en "Nuevo viaje" (llega con PRD 05 llamando `plan_trip`).
- Re-planificar un viaje con bloques (`plan_day` / `replan`, PRD 12) y propuestas sobre plan existente.
- Plan B por lluvia (`plan_variant='rain'`), clima, presupuesto/gastos, reservas.

## Dependencias

- 00: registro de herramientas, `toClaudeTools`, `writeMode`, `activity_feed`/`undo`, `search_places`/`place_details`/`route_eta`/`add_block`, `agent_jobs` en Realtime.
- Se ve mejor con 02 (Plan) y 03 (Mapa), pero se prueba con el placeholder de 00.
- Keys: `ANTHROPIC_API_KEY`, `GOOGLE_MAPS_API_KEY` en Vercel.

## Cómo probarlo

1. En el iPhone (Juan): Mis viajes → "Nuevo viaje".
2. Responder: "Montevideo y Buenos Aires" → "8 días desde el 17/10" → "4 amigos, Sofi se va 2 días sola a Buenos Aires y el resto a Colonia" → chips Comida + Historia → "Sí o sí el Mercado del Puerto, ni loco boliche". Tocar "Armar el viaje" y largar cronómetro.
3. Verificar: navega a Plan en ≤ 1,5 s, el panel muestra líneas nuevas, primer tramo ≤ 20 s, primer bloque ≤ 40 s, `done` ≤ 180 s.
4. Abrir el mismo viaje en el Android (Ana ya unida o con sesión de Juan): los bloques aparecen solos mientras el job corre.
5. Revisar: tramos paralelos 20–21 (Colonia / Buenos Aires), reencuentro, traslados, Mercado del Puerto agendado, ningún bloque sin `google_place_id` (query en Supabase).
6. Tocar "Deshacer" en el chip final → el viaje queda sin tramos ni bloques en ambos celus.
7. Modo avión a los 30 s del job y volver: el progreso se pone al día al reconectar (y si falló, "Reintentar" completa sólo los tramos vacíos).
