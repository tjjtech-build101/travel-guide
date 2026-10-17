---
nro: 24
prd: "24 · Diario + Wrapped + postal + podcast + quiz + link público + \"hace un año\""
prioridad: P2
estado: Por hacer
carril: Cerebro y contenido
tamano: L (2-4h)
depende_de: "05, 07"
resumen: "El agente convierte lo vivido en recuerdos listos para compartir: diario vivo por día (grupo y personal), Wrapped del viaje, postal, podcast de 3 min, quiz, link público y recuerdo 'hace un año'."
notion_url: https://app.notion.com/p/3fc81924a5c6818bae5cf09b46c075e1
---

# 24 · Diario + Wrapped + postal + podcast + quiz + link público + "hace un año"

## Objetivo

Convertir lo vivido (bloques, tours, fotos, lo que contó el guía, gastos) en recuerdos listos para compartir sin trabajo del usuario. Es el cierre emocional de la demo y un canal de adquisición: todo se comparte.

## Momento de la demo

Acto 3, cierre: tras el modo explorador en FIUM, Juan toca **Wrapped** → stories: "4 viajeros · 2 países · 10 paradas · la historia que más te gustó: la Puerta de la Ciudadela", postal con la mejor foto, **Escuchar podcast (3 min)** con la voz del guía. Final: **Compartir** → link público.

## Historias de usuario

- Como viajero, al final del día quiero un diario armado con lo que hicimos, fotos y lo que contó el guía.
- Como viajero, quiero además mi diario personal, con lo que hablé en privado con el guía, que nadie más ve.
- Al terminar el viaje, quiero un Wrapped para compartir.
- Quiero mandarle una postal a mi vieja.
- Quiero escuchar un podcast de 3 minutos del viaje.
- Quiero jugar un quiz con el grupo sobre lo que contó el guía.
- Un año después, quiero que la app me recuerde el viaje.

## Criterios de aceptación

- [ ] Diario del grupo por día (`diary_entries.user_id = null`) generado a demanda ("Armar diario de hoy", por botón o voz) o al cierre del día, usando **solo contenido compartido**: bloques confirmados del día, tours hechos, fotos de los miembros, `memories` con `scope='trip'`, total gastado del día (sin montos individuales).
- [ ] Diario personal (`user_id` = yo) suma `voice_sessions.summary` de mis sesiones 1 a 1 y mis `memories` personales; nunca entra en el prompt del diario del grupo y RLS impide que otros lo lean.
- [ ] Cada entrada tiene `content` con la forma de Datos y `photo_ids` (máximo 6, elegidas por el agente; prioriza fotos con lat/lng cerca de bloques del día).
- [ ] Ningún dato histórico en diario, podcast o quiz sale de fuera de `place_library.facts` o `tour_stops` (con fuente); si no hay fuente, no se afirma.
- [ ] Wrapped: 6–8 tarjetas. Las cifras (días, países, tramos, paradas visitadas por `content_told`, km aproximados entre paradas de tours `done`, fotos, gasto total si hubo) se calculan en código; el LLM solo escribe títulos y tono.
- [ ] Postal: imagen 1080×1350 compuesta en el celu (foto + 2 líneas escritas por el agente + nombre del lugar + fecha), compartible por la hoja nativa. Sin generación de imágenes.
- [ ] Podcast: guion de unas 450 palabras (3 min ±20 s) con la persona del compañero, audio TTS en Storage, reproducible en la app y desde el link público.
- [ ] Quiz: 5 preguntas de opción múltiple (4 opciones) sobre lo que el guía contó al grupo (`content_told` + facts), cada una con `source_url`; se juega local y el puntaje se comparte como imagen.
- [ ] Link público: el Wrapped (sin diario personal ni gastos) se ve en `GET /public/trips/:share_id` cuando el organizador activó el link (PRD 27).
- [ ] "Hace un año": un cron diario manda push a los miembros de viajes con `start_date` = hoy − 1 año; tocarla abre el Wrapped (se genera si no existía).
- [ ] Toda generación corre como job en `agent_jobs` con progreso en vivo; nunca pantalla vacía.

## Pantallas y estados

- **Pestaña Diario**: selector de día, toggle **Grupo / Mío**, entrada en scroll (titular, momentos con hora y foto, "Lo que aprendimos" con fuentes tocables, cifra del día).
    - Estados: generando (progreso del job) / listo / sin contenido ("Todavía no pasó nada hoy, ¡salí a caminar!") / error con Reintentar.
- **Wrapped**: stories a pantalla completa, tocar para avanzar, compartir por tarjeta (captura con `react-native-view-shot`).
- **Postal**: el agente sugiere foto y texto; se pueden editar; Compartir.
- **Podcast**: reproductor (play/pausa, 15 s atrás), transcripción debajo.
- **Quiz**: pregunta, 4 opciones, feedback con fuente, puntaje final compartible.
- Entrada a Wrapped/Podcast/Quiz desde la portada del viaje cuando `trips.status='finished'` y desde el Diario siempre ("Armar Wrapped ahora").

## Datos

- `diary_entries.content`: `{title, summary, moments:[{time, block_id?, text, photo_id?}], learned:[{text, source_url, place_id}], stat:{label, value}}`.
- Wrapped, postal, podcast y quiz se guardan en `agent_jobs.result` (`kind` = `wrapped` / `postcard` / `podcast` / `quiz`; se usa el último job `done` por viaje, y por usuario en postal):
    - `wrapped`: `{cards:[{kind, title, value, photo_id?}]}`
    - `podcast`: `{script, audio_url, duration_s}` (Storage `recaps/{trip_id}/podcast.mp3`)
    - `quiz`: `{questions:[{q, options, answer_idx, source_url}]}`
    - `postcard`: `{photo_id, text, place_name}`
- Lee: `blocks`, `days`, `legs`, `tours`, `tour_stops`, `content_told`, `photos`, `memories`, `voice_sessions`, `expenses`, `place_library`, `device_tokens`.

## Herramientas y endpoints

- Reusa: `POST /uploads/sign`, `GET /jobs/:id`, `GET /public/trips/:share_id` (PRD 27), `recall` (PRD 14) para traer memorias del viaje.
- **PROPUESTA DE CAMBIO A CONTRATOS** (Contratos no tiene herramientas de recuerdos):
    - `generate_diary` `{trip_id, day_id, scope:'group'|'personal'}` → `{job_id}`. También por voz: "armame el diario de hoy".
    - `generate_recap` `{trip_id, kind:'wrapped'|'postcard'|'podcast'|'quiz'}` → `{job_id}`.
    - `POST /cron/anniversary` (Vercel Cron, 1 vez por día, protegido con `CRON_SECRET`).

## Notas técnicas

- Claude `claude-opus-5-5`: esfuerzo `low` para diario, postal y quiz; `medium` para el guion del podcast. Salida estructurada Zod para todo.
- Privacidad: el builder del diario del grupo recibe solo datos con `scope='trip'` o compartidos; filtrar en la query, no en el prompt.
- TTS del podcast: OpenAI TTS (`gpt-4o-mini-tts`) con la voz `profiles.guide_voice` del organizador (la key ya vive en el servidor; Arquitectura no fija proveedor de TTS, cambiarlo es local a este módulo).
- Cierre del día: si existe el briefing de cierre, dispara `generate_diary` del grupo; si no, botón manual (suficiente para la demo).
- Push "hace un año": Expo push con `device_tokens`; enviar a las 13:00 UTC y respetar `profiles.quiet_hours`.
- Pre-generar el Wrapped del viaje de demo antes de subir al escenario (no depender de la red en vivo).
- Alternativa a guardar en `agent_jobs.result`: tabla `trip_recaps(id, trip_id, user_id null, kind, content jsonb, media_url, created_at)` — **PROPUESTA DE CAMBIO A CONTRATOS** opcional, si el equipo prefiere no usar jobs como almacenamiento.

## Fuera de alcance

Álbum imprimible/PDF (fuera del MVP según Producto), video, edición colaborativa del diario, música en el podcast, ranking del quiz en vivo entre celus.

## Dependencias

- PRD 05: sesiones de voz y sus resúmenes/memorias.
- PRD 07: tour en vivo (paradas visitadas, `content_told`).
- Blanda: PRD 27 para el link público.

## Cómo probarlo

1. Seed: tour Ciudad Vieja `done`, filas en `content_told` para Juan, 4 fotos del día 2, una `voice_session` 1 a 1 de Juan con resumen "le interesa la masonería".
2. Armar diario del grupo del día 2 → no menciona la masonería; armar el de Juan → sí.
3. Loguearse como Ana y pedir el diario personal de Juan por API → 403/vacío.
4. Generar Wrapped → cifras coinciden con un `SELECT` manual.
5. Podcast → suena, dura entre 2:40 y 3:20.
6. Quiz → 5 preguntas, cada una con fuente que existe en `place_library.facts`.
7. Poner `start_date` del viaje en hoy − 1 año y llamar `POST /cron/anniversary` con el secreto → llega la push y abre el Wrapped.
