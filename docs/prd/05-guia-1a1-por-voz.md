---
nro: 5
prd: "05 · Guía 1 a 1 por voz"
prioridad: P0
estado: "Por hacer"
carril: "Columna / voz / nativo"
tamano: "L (2-4h)"
depende_de: "00"
resumen: "Llamada de voz 1 a 1 con el compañero por OpenAI Realtime sobre WebRTC: token temporal desde la API, function calls reenviados a /tools/:name, botón flotante, barra tipo WhatsApp, tarjetas con Deshacer, subtítulos, interrupción, idioma en vivo, llamada con contexto, resumen al cortar y audio en background."
notion_url: https://app.notion.com/p/3fc81924a5c681f58357ccba60b4fc72
---

# 🎙️ 05 · Guía 1 a 1 por voz

> 📌 Fuentes: [Producto](../PRODUCT.md) · [Arquitectura](../ARCHITECTURE.md) (sección "Voz: flujo técnico") · [Contratos](../CONTRACTS.md). Requiere PRD 00.

## Objetivo

Hablar con el compañero como en una llamada de WhatsApp: tocar un botón, que atienda en menos de 3 s con contexto del viaje, que haga trabajo real con las mismas herramientas del backend (y se vea en tarjetas con "Deshacer"), que se pueda interrumpir, cambiar de idioma en vivo, abrir la llamada desde un bloque o un punto del mapa, que siga sonando con la pantalla bloqueada y que al cortar deje un resumen. Esta es la base de toda la voz (tours, eventos del mundo, traductor) de los PRDs siguientes.

## Momento de la demo

Acto 1: "Che, sumame una parrilla para el lunes a la noche" → el guía busca, propone, y aparece la tarjeta "Propuse Parrilla X · Lun 21:00" (compartido → propuesta). Acto 2: celu en el atril **sin auriculares**, el guía habla por el parlante, alguien lo interrumpe ("pará, ¿y eso cuándo fue?") y responde; "hablame en inglés" y cambia; se corta y aparece el resumen.

## Historias de usuario

- Como viajero, toco el botón flotante y hablo con mi compañero sobre el viaje.
- Como viajero, le pido cambios ("pasá el museo a la mañana") y veo una tarjeta de lo que hizo con "Deshacer".
- Como viajero, lo interrumpo cuando quiero y me escucha.
- Como viajero, le pido que me hable en otro idioma y cambia en el momento.
- Como viajero, mantengo apretado un bloque o un punto del mapa y la llamada arranca hablando de eso.
- Como viajero, bloqueo el celu y la llamada sigue.
- Como viajero, al cortar veo un resumen de lo que hablamos y lo que se hizo.
- Como viajero sorda/o o en un lugar ruidoso, leo subtítulos.

## Criterios de aceptación

- [ ] `POST /voice/session` responde en ≤ 1,2 s (p50) con `{ client_secret, session_config, voice_session_id }`, crea la fila en `voice_sessions` (`mode`, `trip_id`, `participants=[uid]`, `persona_id`, `started_at`) y nunca expone `OPENAI_API_KEY`.
- [ ] Del toque en el botón a la primera palabra del guía: ≤ 3 s en 4G/Wi-Fi (p50 de 5 intentos).
- [ ] Las instrucciones incluyen: persona (`personas` + `profiles.guide_name`, `guide_style`), resumen del viaje (`get_trip_overview.summary` + próximos 3 bloques de hoy), memoria relevante (≤ 20 `memories`), idioma, y la lista de herramientas sale de `packages/shared` (`toRealtimeTools`) filtrada a las que tienen handler en la API.
- [ ] Function calls: cada `function_call` del modelo se reenvía a `POST /tools/:name` con el JWT del usuario y `x-actor: agent`; el resultado vuelve como `function_call_output` y el guía lo comunica. Round-trip `add_block` ≤ 2,5 s. Errores de la herramienta se devuelven como output `{ ok:false, error }` (el guía lo dice, no se cuelga).
- [ ] Llamadas paralelas en una misma respuesta se ejecutan en paralelo y se manda **un solo** `response.create` al final.
- [ ] Toda respuesta de herramienta con `undo_token` genera una tarjeta de acción (ícono + `payload.summary` del feed o texto armado del `data`) con "Deshacer" que llama `undo`; `mode:'proposed'` muestra "Propuesta enviada al grupo · Ver". Visible 8 s, máx. 3 apiladas.
- [ ] Interrupción: si el usuario habla mientras el guía habla, el audio del guía se corta en ≤ 500 ms y responde a lo nuevo (10 de 10 intentos con auriculares, ≥ 8 de 10 por parlante).
- [ ] Prueba de eco con parlante (sin auriculares, volumen 70 %, celu sobre la mesa): en 10 turnos, ≤ 1 auto-interrupción (el guía reaccionando a su propia voz).
- [ ] Cambio de idioma: decir "hablame en inglés" o elegir EN en la barra → la siguiente respuesta ya es en inglés y los subtítulos del usuario se transcriben en ese idioma.
- [ ] Llamada con contexto: "Hablar de esto" desde un bloque (02), ficha o mantener apretado en el mapa (03) → la primera frase del guía menciona ese bloque/lugar.
- [ ] Pantalla bloqueada / app en background en iOS: la llamada sigue ≥ 3 min con audio en ambos sentidos.
- [ ] Al cortar: `POST /voice/session/:id/end` guarda `ended_at` y `transcript`; en ≤ 20 s aparece la tarjeta de resumen (`voice_sessions.summary`) con la lista de acciones hechas; se insertan `memories` con `scope='personal'` por defecto (lo dicho en 1 a 1 es privado).
- [ ] Subtítulos: las últimas 2 frases (usuario y guía) visibles en grande durante la llamada; transcript completo desplegable.
- [ ] Sonidos y haptics: al conectar, al cortar, al ejecutar una herramienta (haptic liviano) y al terminar una acción (haptic de éxito); error con haptic de error.
- [ ] Si se corta la conexión: banner "Se cortó. Reconectando…" y 1 reintento automático con sesión nueva (mismo `focus`); si falla, "No pudimos reconectar" + botón Llamar.

## Pantallas y estados

### Botón flotante `FloatingVoiceButton` (global en el layout del viaje)

Círculo 64 pt con avatar del compañero, abajo a la derecha encima de las tabs, arrastrable a los bordes. Tocar → llama. Estados: reposo; conectando (anillo girando); en llamada (se oculta: manda la barra); sin red (gris + toast "Sin conexión"); sin permiso de micrófono (abre explicación antes de pedirlo; si lo negó, "Activá el micrófono en Ajustes" con link a `Linking.openSettings()`).

### Barra de llamada `CallBar` (tipo WhatsApp, arriba de todo, en todas las pantallas)

Verde, 44 pt: avatar + nombre del guía + cronómetro mm:ss + indicador "hablando" animado. Tocar → vista de llamada expandida. Se puede navegar la app con la barra puesta.

### Vista de llamada (expandida, sheet a pantalla completa)

- Avatar grande con anillos que laten según quién habla (eventos `speech_started` / audio del guía).
- Subtítulos (2 líneas grandes) + "Ver todo" (transcript con burbujas).
- Tarjetas de acción apiladas.
- Botones: Silenciar mic, Parlante/Auricular, Idioma (ES / EN / PT + "Otro"), Subtítulos on/off, Colgar (rojo).
- **Conectando**: "Llamando a Don Julio…" + sonido de conexión. **Error de conexión**: "No pudimos conectar" + Reintentar. **Herramienta en curso**: chip "Buscando…" con el nombre amigable ("Buscando lugares", "Calculando tiempos").

### Resumen al cortar (sheet)

"Resumen de la llamada" · duración · acciones hechas (de `activity_feed` con `actor_agent=true` del usuario entre `started_at` y `ended_at`, cada una con Deshacer si aplica) · texto de `summary` (skeleton mientras el job corre; si falla: "No pudimos armar el resumen", las acciones se muestran igual).

## Datos

- `voice_sessions`: `trip_id`, `tour_id` (null en este PRD salvo que venga), `mode` (`chat` o `tour`), `participants`, `persona_id`, `started_at`, `ended_at`, `summary`, `transcript` (`[{ role:'user'|'assistant', text, at }]`).
- `personas`: la `companion` por defecto; en `mode='tour'`, la `persona_id` del tour. `name`, `style`, `voice`, `system_prompt`.
- `profiles`: `guide_name`, `guide_voice`, `guide_style`, `locale`, `languages`, `interests`, `avoid`, `dietary`, `pace`. `trip_members.language` (si existe pisa a `profiles.locale`), `trip_members.trip_prefs`.
- `memories`: lectura de `scope='personal'` del usuario + `scope='trip'` del viaje, `deleted_at is null`, últimas 20 por `created_at` (relevancia semántica queda para PRD 14). Escritura al cerrar.
- `agent_jobs`: `kind='voice_summary'` para el resumen.
- `activity_feed`: lectura para tarjetas y resumen.

## Herramientas y endpoints

- `POST /voice/session` `{ mode, trip_id?, tour_id?, focus? }` → `{ client_secret, session_config, voice_session_id }` (ver PROPUESTA por `focus`).
  1. Valida JWT y membresía; arma instrucciones (abajo); `tools = toRealtimeTools(VOICE_TOOLS)`.
  2. `POST https://api.openai.com/v1/realtime/client_secrets` con `{ session: { type: 'realtime', model: OPENAI_REALTIME_MODEL, instructions, tools, tool_choice: 'auto', audio: { input: { transcription: { model: 'gpt-4o-mini-transcribe', language }, noise_reduction: { type: 'far_field' }, turn_detection: { type: 'server_vad', threshold: 0.6, silence_duration_ms: 500, interrupt_response: true, create_response: true } }, output: { voice } } } }` → `value` es el `client_secret` (efímero, ~10 min).
  3. Inserta `voice_sessions` y devuelve.
- `POST /voice/session/:id/end` `{ transcript }` → guarda `ended_at` + `transcript`, crea `agent_jobs` `voice_summary` y con `waitUntil` llama a Claude (`claude-opus-5-5`, `effort: 'low'`, `messages.parse` con salida estructurada `{ summary, memories:[{ scope, kind, text }] }`), escribe `voice_sessions.summary` y `memories` (`source_session_id`). Responde `{ ok:true, data:{ job_id } }`.
- `POST /tools/:name` (00) para cada function call. `VOICE_TOOLS` = `TOOL_NAMES` con handler registrado (hoy: las 10 de 00 + `add_idea` y `plan_trip` si ya existen).
- Eventos del mundo: helper `injectEvent(type, payload)` manda `[EVENTO:<tipo>] <json>` como mensaje de sistema + `response.create`. En este PRD solo se cablea `proposal_decided` (cambio de `agent_proposals.status` por Realtime durante la llamada); el resto de los tipos los usan PRDs de tour.

### Instrucciones (template en `apps/api/src/voice/instructions.ts`)

```plain text
{persona.system_prompt}
Te llamás {guide_name o persona.name}. Estilo: {guide_style}. Hablás en {idioma}; si la persona te habla en otro idioma o te lo pide, cambiá en el momento.
Español rioplatense con voseo. Respuestas cortas (1-2 frases) salvo que te pidan más. Podés ser interrumpido: retomá natural.
Nunca inventes fechas, nombres, horarios ni cifras: usá herramientas o decí que no sabés.
Para cualquier cosa del plan usá herramientas. En lo compartido tus cambios quedan como propuesta: decilo así ("te lo dejo propuesto al grupo").
Antes de una herramienta lenta, avisá en 3-4 palabras ("Dale, lo busco").
Hoy es {fecha y hora local}. Viaje: {summary}. Hoy: {próximos bloques}. Con vos en este tramo: {nombres}.
Lo que sabés de la persona: {intereses, avoid, dietary, pace}. Memoria: {memories en viñetas}.
Eventos: llegan como [EVENTO:tipo] json. proposal_decided: contá en una frase qué se decidió.
{si focus} Apertura: la persona abrió la llamada desde {bloque o lugar}; empezá hablando de eso en una frase.
{si no} Apertura: saludá en una frase y preguntá en qué ayudás.
```

## Notas técnicas

### Cliente (`apps/mobile/src/voice/`)

- Módulos: `VoiceProvider.tsx` (contexto + máquina de estados `idle → connecting → live → ending → summary`), `realtimeClient.ts` (WebRTC + data channel), `toolBridge.ts`, `events.ts`, `audioRoute.ts`, `ui/FloatingVoiceButton.tsx`, `ui/CallBar.tsx`, `ui/CallView.tsx`, `ui/ActionCard.tsx`, `ui/Transcript.tsx`, `ui/CallSummary.tsx`.
- API pública para otros PRDs: `useVoice()` → `{ state, startCall({ mode, tripId, tourId?, focus? }), endCall(), injectEvent(type, payload), setLanguage(lang), setMuted(bool), startTranslator(from, to) }`.
- Conexión (`react-native-webrtc`, plugin `@config-plugins/react-native-webrtc` ya en el dev build de 00):

```typescript
const pc = new RTCPeerConnection();
const mic = await mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
mic.getTracks().forEach((t) => pc.addTrack(t, mic));
const dc = pc.createDataChannel('oai-events');
const offer = await pc.createOffer({});
await pc.setLocalDescription(offer);
const r = await fetch('https://api.openai.com/v1/realtime/calls', {
  method: 'POST', body: offer.sdp,
  headers: { Authorization: `Bearer ${client_secret}`, 'Content-Type': 'application/sdp' },
});
await pc.setRemoteDescription({ type: 'answer', sdp: await r.text() });
// el audio remoto suena solo (react-native-webrtc lo enruta al output del sistema)
dc.onopen = () => dc.send(JSON.stringify({ type: 'response.create' })); // el guía habla primero
```

- Function calls: escuchar `response.done`; por cada item `type:'function_call'` (`call_id`, `name`, `arguments`) → `JSON.parse(arguments)` → `fetch(API/tools/name, { headers: { Authorization, 'x-actor': 'agent' } })` en paralelo → por cada uno `conversation.item.create` `{ item: { type: 'function_call_output', call_id, output: JSON.stringify(res) } }` → un `response.create`. Timeout por herramienta 12 s → output `{ ok:false, error:{ code:'timeout' } }`.
- Subtítulos: usuario con `conversation.item.input_audio_transcription.delta` / `.completed`; guía con `response.output_audio_transcript.delta` / `.done`. Acumular en `transcript` local para mandarlo al cortar. Si los nombres de eventos difieren en la versión del modelo, loguear todos los `type` del data channel en dev y ajustar el `switch`.
- Interrupción: la hace el servidor (`interrupt_response: true`); con WebRTC el audio se trunca solo. En `input_audio_buffer.speech_started`: haptic `selectionAsync` y cortar el subtítulo del guía.
- Idioma en vivo: `session.update` `{ session: { type: 'realtime', instructions: base + idioma nuevo, audio: { input: { transcription: { model: 'gpt-4o-mini-transcribe', language } } } } }`. El modelo también cambia solo si se lo piden hablando.
- Hook traductor de bolsillo: `startTranslator(from, to)` hace `session.update` con instrucciones de intérprete ("repetí en {to} todo lo que se diga en {from} y viceversa, sin agregar nada") y desactiva herramientas (`tools: []`); UI detrás de flag `FEATURES.translator` (el feature completo es otro PRD).
- Llamada con contexto: `startCall({ focus: { block_id } })` / `{ google_place_id }` / `{ lat, lng, label }`. La API resuelve el foco (bloque visible para el usuario, `place_details`, o `search_places` cercano) y lo mete en la apertura.

### Audio, background y eco

- Ruteo: `react-native-incall-manager` → `InCallManager.start({ media: 'audio' })` (pone la sesión de audio en modo voz: activa el AEC de hardware en iOS) + `setForceSpeakerphoneOn(true)` por defecto (demo sin auriculares); botón Parlante/Auricular alterna. Bluetooth lo maneja el sistema. `InCallManager.stop()` al cortar.
- Background iOS: `UIBackgroundModes: ["audio"]` (ya en 00). Con la sesión de audio activa, WebRTC sigue al bloquear. Validar en el primer build: si iOS suspende, mantener la llamada con el mic abierto (no pausar tracks) y probar `voip` como plan B.
- Android: con la app en background el mic requiere servicio en primer plano tipo `microphone` (Android 14+). MVP: `expo-keep-awake` (`activateKeepAwakeAsync`) durante la llamada y documentar; la demo es en iPhone.
- Eco por parlante: 1) `echoCancellation: true` + modo voz de InCallManager; 2) `noise_reduction: far_field`; 3) `server_vad` con `threshold` 0.6 (subir a 0.7 si se auto-interrumpe; probar también `semantic_vad`); 4) plan B en la barra: "Modo push-to-talk" que pone `track.enabled = false` mientras el guía habla (entre `response.created` y `response.done`) y lo reactiva al terminar. Medir en el escenario real el sábado.
- Sonidos: `expo-audio` con mp3 cortos en `assets/sounds/` (`connect.mp3`, `hangup.mp3`). Gotcha: compiten con la sesión de audio de WebRTC; reproducir `connect` antes de `InCallManager.start` y `hangup` después de `stop`. Durante la llamada usar solo haptics (`expo-haptics`: `impactAsync(Light)` al llamar herramienta, `notificationAsync(Success/Error)` al terminar).

### Backend

- Modelo de OpenAI en env `OPENAI_REALTIME_MODEL` (default `gpt-realtime`; se puede comparar con otros el sábado: cambiar es barato porque las herramientas viven en el backend). Voz: `profiles.guide_voice` ?? `personas.voice` ?? `marin`.
- `session_config` devuelto = el objeto `session` enviado (sin secretos), para debug y para `session.update` del cliente.
- Resumen con Claude: `client.messages.parse({ model: 'claude-opus-5-5', max_tokens: 4000, output_config: { effort: 'low', format: zodOutputFormat(VoiceSummary) }, ... })`. Regla del prompt: memorias `personal` por defecto; `trip` solo si la persona dijo explícitamente que es para el grupo. Nada de datos sensibles de terceros.

### Orden de implementación sugerido

1. `POST /voice/session` mínimo (instrucciones fijas, sin herramientas) + cliente WebRTC + botón → hablar con el guía en el celu real (validar latencia y background **primero**: es riesgo técnico de Arquitectura).
2. Prueba de eco con parlante y ajuste de VAD.
3. Herramientas: `toRealtimeTools` + `toolBridge` + tarjetas con Deshacer.
4. Instrucciones con contexto real + memoria.
5. CallBar + vista expandida + subtítulos + haptics/sonidos.
6. Cierre + resumen + memorias.
7. Idioma en vivo, llamada con contexto (`focus`), `injectEvent`, hook traductor, reconexión.

### PROPUESTA DE CAMBIO A CONTRATOS

- `POST /voice/session`: campo opcional `focus: { block_id?, google_place_id?, lat?, lng?, label? }` para la "llamada con contexto" (desde bloque, ficha o mantener apretado en el mapa). Sin esto, el contexto tendría que inyectarse con un mensaje que no es un `[EVENTO:<tipo>]` de la lista.
- `POST /voice/session/:id/end`: body `{ transcript: [{ role, text, at }] }` (el servidor no está en el camino del audio WebRTC, así que el transcript lo manda el celu) y respuesta `{ job_id }` del `agent_jobs` `voice_summary`.

## Fuera de alcance

- Modo tour completo: geofences, `arrived_stop`, activo/dormido, guías locales narrando (PRDs de tour).
- Llamada grupal (LiveKit), "el guía te llama", CallKit, Live Activities, wake word.
- Cámara (`look_at_photo`), traductor de bolsillo completo, memoria semántica (`remember`/`forget`/`recall`).
- Voz en "Nuevo viaje" como flujo propio (la voz puede llamar `plan_trip` si existe, sin UI especial).

## Dependencias

- 00: `/tools/:name`, `x-actor`, `toRealtimeTools`, `activity_feed`/`undo`, `react-native-webrtc` + `react-native-incall-manager` + `UIBackgroundModes audio` en el dev build, `personas` del seed.
- Integra con 02 ("Hablar de esto"), 03 ("¿qué hay acá?"), 01 (`plan_trip` como herramienta), 11 (`proposal_decided`).
- Keys en Vercel: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`.

## Cómo probarlo

1. iPhone (Juan) con el viaje del seed. Tocar el botón flotante → aceptar micrófono → el guía saluda en ≤ 3 s.
2. "¿Qué tenemos mañana?" → responde con los bloques reales del día (verificar contra Plan).
3. "Agendame un café para mí solo a las 17 cerca del Solís" → tarjeta "Agregué … 17:00" → aparece en Plan como personal; tocar "Deshacer" → desaparece.
4. "Sumanos una parrilla para el lunes a la noche" → tarjeta "Propuesta enviada al grupo"; en el celu de Ana aparece el banner de propuesta.
5. Mientras el guía habla largo, interrumpir "pará, pará" → se calla y responde.
6. "Hablame en inglés" → sigue en inglés; subtítulos en inglés. Volver con el botón ES.
7. Bloquear el celu y seguir hablando 3 min → audio en ambos sentidos.
8. Prueba de eco: sin auriculares, parlante al 70 %, celu sobre la mesa, 10 turnos con 3 personas alrededor → contar auto-interrupciones (≤ 1). Si falla, activar push-to-talk y repetir.
9. Desde Plan, en "Teatro Solís" → "Hablar de esto" → la primera frase habla del Teatro Solís. Desde el Mapa, mantener apretado en Plaza Matriz → idem.
10. Colgar → sheet de resumen con las acciones y, en ≤ 20 s, el texto; en Supabase, `voice_sessions` con `ended_at`, `transcript`, `summary` y `memories` `personal` nuevas.
11. Modo avión 5 s durante una llamada → "Reconectando…" → vuelve sola o muestra "No pudimos reconectar".
