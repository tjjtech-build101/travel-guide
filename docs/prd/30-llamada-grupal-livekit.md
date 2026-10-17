---
nro: 30
prd: "30 · Llamada grupal con LiveKit"
prioridad: P2
estado: Por hacer
carril: Columna / voz / nativo
tamano: L (2-4h)
depende_de: "05"
resumen: "Fase 2 opcional: llamada grupal en una sala LiveKit con el guía como agente (Deepgram → Claude → TTS), transcript con nombre por participante, las mismas /tools, sumarse a una llamada en curso y \"sumá a Sofi\"."
notion_url: https://app.notion.com/p/3fc81924a5c681c295cbf4db15227fbd
---

# 30 · Llamada grupal con LiveKit

> ⚠️ **Fase 2 / si sobra tiempo.** Solo se arranca si el P0 corre punta a punta **y** la prueba de validación de abajo da GO. El MVP sigue siendo 1 a 1 (OpenAI Realtime) + modo "un celu para todos".

## Objetivo

Varias personas, cada una con su celu y en lugares distintos, hablan con el mismo guía a la vez (planificar juntos o tour grupal). El guía sabe quién habla, usa las mismas herramientas `/tools/:name` y la memoria del viaje.

## Momento de la demo

Acto 1 alternativo: Juan y Ana en llamada, el guía les responde por nombre. Juan: "sumá a Sofi" → a Sofi le llega la notificación, entra y el guía le resume en una frase lo que se decidió. Fallback si algo falla: modo "un celu para todos".

## Prueba de validación previa (timebox 90 min, GO / NO-GO)

1. La API emite un token de LiveKit; 2 celus (dev build) entran a la misma sala.
2. El worker (LiveKit Agents) se une; Deepgram transcribe en español el track de cada participante y loguea `Ana: …` / `Juan: …`.
3. Claude responde y el TTS se escucha en ambos celus. Medir fin de habla → primer audio: **GO si p50 < 2,5 s y p90 < 4 s** en 10 turnos.
4. Una herramienta real (`get_day_plan`) vía `POST /tools/:name` actuando como quien preguntó devuelve datos correctos.
5. Sin auriculares: el agente no se transcribe a sí mismo (cancelación de eco del cliente activa).

- **NO-GO** en cualquiera → se descarta el PRD y queda "un celu para todos". Anotar métricas en este PRD.

## Historias de usuario

- Como grupo, queremos hablar todos con el guía desde nuestros celus a la vez.
- Como viajero, quiero sumarme a una llamada que ya está en curso y que el guía me ponga al día.
- Como viajero, quiero decir "sumá a Sofi" y que a Sofi le llegue la invitación.
- Como grupo, queremos que el guía no hable encima de nosotros.

## Criterios de aceptación

- [ ] Crear llamada desde el viaje (botón "Llamada grupal") crea `voice_sessions` con `mode` `chat` o `tour`, `trip_id`, `persona_id` y `participants=[creador]`; la sala LiveKit se llama `vs_<voice_session_id>`.
- [ ] Cada participante publica su propio track; la identidad del participante en LiveKit es su `user_id`, así cada frase se atribuye sin diarización.
- [ ] `voice_sessions.transcript` guarda `[{at, user_id, name, text}]`; los turnos del guía con `user_id: null` y `name` = nombre de la persona del guía.
- [ ] Al entrar alguien se agrega a `participants`.
- [ ] Herramientas: el worker llama `POST /tools/:name` con los mismos esquemas Zod de `packages/shared`, actuando como el usuario que pidió la acción; resultado → tarjeta de acción en todos los celus (vía `activity_feed`).
- [ ] Turnos: el guía habla si lo nombran, si le hacen una pregunta dirigida o ante un evento del mundo (`[EVENTO:<tipo>]`); si no, calla. Un solo turno del guía a la vez; si alguien empieza a hablar, el TTS se corta (barge-in).
- [ ] Llamada en curso: al crearla se escribe `activity_feed` `call_started`; los miembros del viaje ven el banner "Llamada con Juan y Ana · Sumarme". Al entrar tarde, el guía da un resumen de una frase ("¿qué me perdí?").
- [ ] "Sumá a Sofi" → el guía llama `notify_member` (PRD 13) con la invitación y deep link a la llamada; Sofi entra con un toque.
- [ ] Fin: cuando sale el último humano, la sala cierra a los 30 s, se escribe `call_ended` y se llama `POST /voice/session/:id/end` (resumen + memorias). Lo dicho en llamada grupal se guarda con `scope='trip'`, no personal.
- [ ] Un solo idioma por llamada (el del creador).

## Pantallas y estados

- **Llamada grupal**: avatares con indicador de quién habla (incluido el guía), subtítulos con nombre, tarjetas de acción, botones mute / altavoz / salir / sumar persona.
- **Banner de llamada en curso** en la portada del viaje y en "Ahora".
- Estados: conectando / en llamada / reconectando / guía caído ("El guía se desconectó, reintentando…"; la llamada humana sigue) / terminada.

## Datos

- `voice_sessions` (`participants`, `transcript`, `summary`, `mode`, `persona_id`), `activity_feed` (`call_started`, `call_ended`), `memories`, `personas`, `profiles.guide_voice`.
- `voice_sessions` no está en Realtime: el estado "en curso" se comunica por `activity_feed`.

## Herramientas y endpoints

- Mismas `/tools/:name`; `notify_member` para "sumá a Sofi"; `POST /voice/session/:id/end` al cerrar.
- **PROPUESTA DE CAMBIO A CONTRATOS:**
    - `POST /voice/session` acepta `transport: 'realtime' | 'livekit'` (default `realtime`). Con `livekit` devuelve `{livekit_url, livekit_token, room, voice_session_id}` en lugar de `client_secret`; si se pasa `voice_session_id` existente, devuelve token para sumarse.
    - Autenticación de servicio para el worker en `/tools/:name`: header `Authorization: Bearer <API_SERVICE_TOKEN>` + `X-Acting-User: <user_id>`; la API valida que ese usuario esté en `voice_sessions.participants` de una sesión abierta. (Los JWT de usuario no viajan por la sala: la metadata de participantes es visible para todos.)

## Notas técnicas

- Worker: LiveKit Agents para Node (`@livekit/agents`) con plugins Deepgram (STT, `nova-3`, `language=es`), LLM Claude `claude-opus-5-5` con streaming y esfuerzo `low` (respuestas de 1–2 frases), TTS OpenAI (`gpt-4o-mini-tts`) con `profiles.guide_voice` para que suene igual que el 1 a 1 (Arquitectura no fija proveedor de TTS).
- El system prompt se arma con el **mismo builder** que `/voice/session` (persona + contexto + memoria del viaje), más reglas de turnos grupales.
- Hosting del worker: proceso largo, **no** Vercel. LiveKit Cloud Agents o una VM/laptop durante la demo. Env: `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `DEEPGRAM_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `API_SERVICE_TOKEN`, `API_BASE_URL`.
- Cliente: `@livekit/react-native` + `@livekit/react-native-webrtc` (config plugin en el dev build). Audio: altavoz + cancelación de eco activas.
- Eventos del mundo: la app de cualquier participante los manda al worker como data message de LiveKit con el mismo formato `[EVENTO:<tipo>] <json>`; el worker deduplica por tipo + 10 s.

## Fuera de alcance

Video, multilenguaje dentro de la llamada (fuera del MVP), grabación de audio, más de 6 participantes, timbre nativo con CallKit, reemplazar el 1 a 1 de OpenAI Realtime, wake word.

## Dependencias

- PRD 05: sesiones de voz (builder del prompt, `voice_sessions`, cierre con resumen y memorias).

## Cómo probarlo

1. Correr la prueba de validación y anotar latencias.
2. Juan crea llamada grupal; Ana ve el banner y se suma → el guía la saluda y resume.
3. Ana: "¿qué hacemos mañana a la tarde?" → el guía llama `get_day_plan` como Ana y responde nombrándola.
4. Juan y Ana charlan entre ellos sin nombrar al guía → el guía no interviene.
5. Juan: "sumá a Sofi" → llega la notificación a Sofi, entra con un toque.
6. Todos salen → `voice_sessions.transcript` con nombres por turno, `summary` cargado y memorias con `scope='trip'`.
