---
title: "📐 3 · Contratos (datos + herramientas)"
notion_url: https://app.notion.com/p/3fc81924a5c6814087e4e83bdd9916ef
---

# 📐 3 · Contratos (datos + herramientas)

> ⚠️ Esta página es la **fuente única de nombres**. El PRD-00 la convierte en `supabase/migrations` y `packages/shared` (Zod). Desde ahí, **el código es la verdad** de los contratos; si hay que cambiar algo, se cambia en el código y se anota acá.

## Modelo de datos (Supabase / Postgres)

Convenciones: `id uuid pk default gen_random_uuid()`, `created_at timestamptz default now()`. Coordenadas como `lat`/`lng` double + columna `geo geography(Point)` donde se busque por cercanía. RLS: un usuario lee todo lo de los viajes donde es miembro; escribe según rol y participantes. Bloques privados: otros miembros solo ven `title='Ocupado'` (vista `blocks_visible`).

```sql
-- PERFIL
profiles(id uuid pk references auth.users, display_name, avatar_url, locale text default 'es',
  home_currency text, interests jsonb,            -- {"arquitectura":3,"comida":4}
  pace text check (pace in ('relaxed','balanced','intense')),
  chronotype text check (chronotype in ('early','normal','night')),
  budget_level text, dietary text[], mobility jsonb, languages text[],
  travel_style text check (travel_style in ('planned','mixed','spontaneous')),
  avoid text[], guide_name text, guide_voice text, guide_style text,  -- serious|neighbor|kids
  quiet_hours jsonb, notification_prefs jsonb, inferred_traits jsonb, -- perfil transparente
  onboarded_at timestamptz)

saved_places(id, user_id, google_place_id, name, lat, lng, city, country, note, created_at)

-- VIAJE
trips(id, title, cover_url, base_currency text default 'USD',
  budget_mode text check (budget_mode in ('limited','unlimited')) default 'unlimited',
  status text check (status in ('planning','active','finished')) default 'planning',
  start_date date, end_date date, invite_code text unique, created_by uuid, created_at)

trip_members(trip_id, user_id, role text check (role in ('organizer','traveler','follower')),
  joined_at, trip_prefs jsonb,      -- {goal, budget_per_person, must:[], avoid:[], companions}
  location_sharing text check (location_sharing in ('always','shared_only','never')) default 'shared_only',
  ghost_until timestamptz, share_location_with_followers bool default false,
  language text, primary key (trip_id,user_id))

legs(id, trip_id, city, country, google_place_id, lat, lng, start_date, end_date, sort_order int)
leg_members(leg_id, user_id, primary key (leg_id,user_id))

days(id, leg_id, date, weather jsonb, briefing text)

blocks(id, trip_id, leg_id, day_id null,          -- day_id null = banco de ideas
  type text check (type in ('activity','meal','tour','transfer','lodging','free','meetup')),
  title, description, google_place_id, place_name, lat, lng, geo geography(Point),
  start_time time null, end_time time null,
  time_flex text check (time_flex in ('fixed','morning','afternoon','evening','any')) default 'fixed',
  duration_min int, is_private bool default false,
  status text check (status in ('idea','proposed','confirmed','booked')) default 'confirmed',
  plan_variant text check (plan_variant in ('main','rain','closed')) default 'main',
  cost_estimate numeric, cost_currency text, booking_url text, notes text,
  transfer jsonb,                    -- {from, to, mode:'walk'|'transit'|'bus'|'ferry'|'flight'|'car', duration_min}
  alerts jsonb,                      -- [{kind:'closes'|'late'|'rain'|'diet', text}]
  sources jsonb, tour_id uuid null, sort_order int,
  created_by uuid null, created_by_agent bool default false, created_at, updated_at)
block_participants(block_id, user_id, primary key (block_id,user_id))

agent_proposals(id, trip_id, leg_id null, day_id null, created_by uuid null, by_agent bool,
  summary text, reason text,
  ops jsonb,                         -- [{op:'add'|'update'|'move'|'remove', block_id?, block?, patch?}]
  status text check (status in ('pending','accepted','rejected','expired','applied_urgent')),
  decided_by uuid null, decided_at, created_at)

polls(id, trip_id, block_id null, question, options jsonb, closes_at, status text, result jsonb, created_by)
poll_votes(poll_id, user_id, option_idx int, primary key (poll_id,user_id))

activity_feed(id, trip_id, actor_user_id null, actor_agent bool, kind text, payload jsonb,
  undo_token text null, created_at)

member_locations(trip_id, user_id, lat, lng, heading, speed, accuracy, battery, updated_at,
  primary key (trip_id,user_id))      -- solo la última posición

-- GASTOS
expenses(id, trip_id, leg_id null, block_id null, payer_id, amount numeric, currency,
  amount_base numeric, description, receipt_url, split jsonb, -- [{user_id, share}]
  created_by, created_at)
settlements(id, trip_id, from_user, to_user, amount_base numeric, settled_at)

-- TOURS Y CONTENIDO
personas(id, kind text check (kind in ('companion','local')), name, city null,
  style text, voice text, system_prompt text)

tours(id, trip_id null, block_id null, owner_user_id,
  mode text check (mode in ('planned','spontaneous','explorer')),
  title, persona_id, storyline text null, duration_min, start_lat, start_lng, end_point jsonb,
  status text check (status in ('generating','ready','active','done','failed')), created_at)

tour_stops(id, tour_id, place_id uuid references place_library, sort_order,
  geofence_radius_m int default 35, look_at text, narration_short, narration_more,
  narration_secret, myth_vs_fact text null, photo_spot text null, kid_mission text null,
  transition_to_next text, nav_to_next text, sources jsonb)

place_library(id, google_place_id, osm_id, wikidata_id, name, lat, lng, geo geography(Point),
  city, country, tier text check (tier in ('curated','researched')),
  facts jsonb,                       -- [{text, source_url, verified:bool}]
  base_lang text, embedding vector(1024), updated_at)
place_error_reports(id, place_id, user_id, text, created_at)

-- VOZ Y MEMORIA
voice_sessions(id, trip_id null, tour_id null, mode text check (mode in ('chat','tour')),
  participants uuid[], persona_id, started_at, ended_at, summary text, transcript jsonb)

memories(id, scope text check (scope in ('personal','trip')), user_id null, trip_id null,
  kind text, text, source_session_id null, created_at, deleted_at null)
content_told(user_id, place_id, layer text, told_at, primary key (user_id,place_id,layer))

-- DIARIO Y FOTOS
photos(id, trip_id, user_id, url, lat, lng, taken_at,
  kind text check (kind in ('camera','gallery','receipt')), caption)
diary_entries(id, trip_id, day_id, user_id null,   -- null = versión del grupo
  content jsonb, photo_ids uuid[], created_at)

-- INFRA
agent_jobs(id, kind text, trip_id null, user_id, status text, progress jsonb, -- [{at, text}]
  result jsonb, error text, created_at, updated_at)
device_tokens(user_id, token, platform, updated_at)
```

**Realtime:** la app se suscribe por `trip_id` a `blocks`, `block_participants`, `legs`, `agent_proposals`, `polls`, `activity_feed`, `member_locations`, `expenses`, `agent_jobs`.

## API de herramientas

`POST /tools/:name` · body = input validado con Zod (`packages/shared/tools`) · header `Authorization: Bearer <supabase JWT>` · respuesta `{ ok, data, undo_token?, feed_id? }`. Las mismas definiciones se exportan como herramientas de Claude (Tool Runner) y como funciones de OpenAI Realtime.

| Grupo | Herramienta | Qué hace | PRD |
| --- | --- | --- | --- |
| Itinerario | `get_trip_overview` | Tramos, miembros, días y resumen | 00 |
| Itinerario | `get_day_plan` | Bloques de un día (para un usuario) | 00 |
| Itinerario | `add_block` / `update_block` / `move_block` / `remove_block` | Personal → aplica; compartido + agente → crea propuesta | 00/02 |
| Itinerario | `add_idea` | Bloque sin día | 02 |
| Itinerario | `plan_trip` | Agente planificador (job) a partir de la conversación | 01 |
| Itinerario | `plan_day` / `replan` | Re-planificación mínima con `scope` y `reason` | 12 |
| Itinerario | `propose_changes` / `decide_proposal` | Crear diff / aceptar o rechazar | 11 |
| Itinerario | `undo` | Revierte por `undo_token` | 05 |
| Grupo | `create_poll` / `vote` / `close_poll` | Votaciones opcionales | 22 |
| Grupo | `where_is_everyone` | Ubicaciones permitidas + ETA | 13 |
| Grupo | `create_meetup` / `notify_member` | Encuentro / aviso in-app | 13 |
| Lugares | `search_places` / `place_details` | Google Places (horario, abierto ahora, precio) | 00 |
| Lugares | `route_eta` | Google Routes (a pie / transporte) | 00 |
| Lugares | `nearby` | Café, baño, cajero, farmacia, comida | 26 |
| Contexto | `weather` / `events_search` / `convert_currency` | Open-Meteo / web search de Claude / tasas | 16/23 |
| Gastos | `add_expense` / `get_balances` / `read_receipt` | Splitwise liviano + foto de ticket | 23 |
| Memoria | `remember` / `forget` / `recall` | Memoria en 3 capas | 14 |
| Tour | `generate_tour` | Job: planificado / espontáneo / explorador | 06/18 |
| Tour | `start_tour` / `tour_status` / `get_stop_content` / `next_stop` / `skip_stop` | Control del tour en vivo | 07 |
| Tour | `look_at_photo` | Foto + GPS + orientación → Claude visión | 08 |
| Tour | `time_travel_image` | Imagen "cómo era" | 25 |
| Externo | `prepare_booking` | Devuelve deep link (web / TheFork / WhatsApp con mensaje). Nunca reserva solo. | 12 |

## Otros endpoints

- `POST /voice/session` → `{client_secret, session_config, voice_session_id}`
- `POST /voice/session/:id/end` → resumen + memorias (asíncrono)
- `POST /trips/join` `{invite_code, legs?}` · `GET /public/trips/:share_id` (seguidor web)
- `POST /uploads/sign` → URL firmada de Supabase Storage
- `GET /jobs/:id` (fallback si Realtime falla)

## Eventos del mundo hacia la sesión de voz

Formato de mensaje de sistema inyectado: `[EVENTO:<tipo>] <json>`. Tipos: `arrived_stop`, `left_route`, `time_warning`, `photo_result`, `weather_change`, `member_late`, `proposal_decided`. El prompt del guía define cómo reaccionar a cada uno.

## Datos de demo (seed)

- Usuarios: Juan (organizador), Ana, Leo, Sofi.
- Viaje "Montevideo + Buenos Aires": tramo Montevideo [todos] → tramo Colonia [Juan, Ana, Leo] y tramo Buenos Aires [Sofi] en paralelo → reencuentro Buenos Aires [todos].
- Día 2 Montevideo con bloque `tour` "Ciudad Vieja" + tour `ready` con 10 paradas curadas.
- Track grabado del paseo (`/supabase/seed/ciudad-vieja-track.json`: `[{t, lat, lng, heading, accuracy}]`).

---

## Cambios v1.1 (aprobados, consolidan las propuestas de los PRDs)

> ✅ Estos cambios son parte del contrato. El PRD-00 crea todas las tablas y columnas de esta sección junto con el resto (no esperar a cada PRD).

### Tablas y columnas

```sql
-- nuevas tablas
notifications(id, user_id, trip_id null, category text, urgency text,
  channel text check (channel in ('call','push','feed')), title, body, data jsonb,
  status text check (status in ('queued','sent','bundled','suppressed')),
  send_after timestamptz, sent_at timestamptz, created_at)                     -- PRD 17
trip_recaps(id, trip_id, user_id null, kind text check (kind in ('wrapped','postcard','podcast','quiz')),
  content jsonb, media_url text, created_at)                                    -- PRD 24

-- columnas nuevas
trips.share_id text unique null            -- link público de seguidor (null = desactivado); distinto de invite_code (PRD 27, 24)
tours.route jsonb                          -- {polyline, total_walk_m, est_duration_min} (PRD 06/07)
tours.progress jsonb                       -- {current_stop_id, visited:[{stop_id, arrived_at, left_at}], skipped:[], started_at, ends_at} (PRD 07)
tour_stops.dwell_min int default 4         -- permanencia sugerida (PRD 06)
photos.place_id uuid null references place_library, photos.heading double  -- (PRD 08)
photos.trip_id -> NULLABLE                 -- tour espontáneo sin viaje (PRD 08/18)
photos.kind check += 'generated'           -- recreaciones de "viaje en el tiempo" (PRD 25)
voice_sessions.purpose text null           -- 'onboarding' | 'translator' | null (PRD 10, 20)
device_tokens.platform += 'ios_voip'       -- (PRD 17)

-- índices / valores
unique index saved_places(user_id, google_place_id)                            -- PRD 28
profiles.budget_level in ('low','mid','high','no_limit')                       -- PRD 10
```

### Herramientas nuevas

| Herramienta | Input | PRD |
| --- | --- | --- |
| `add_idea` | (ya estaba) se implementa en 02 | 02 |
| `update_profile` | `{patch}` sobre campos editables de `profiles` | 10 |
| `save_place` | `{google_place_id, note?}` | 28 |
| `settle_up` | `{trip_id, from_user, to_user, amount_base}` → `settlements` + feed `settled` + `undo_token` | 23 |
| `generate_diary` | `{trip_id, day_id, scope:'group'\|'personal'}` (job) | 24 |
| `generate_recap` | `{trip_id, kind:'wrapped'\|'postcard'\|'podcast'\|'quiz'}` (job → `trip_recaps`) | 24 |

### Endpoints y headers

- `POST /tools/:name` acepta header **`x-actor: user | agent`** (default `user`). La voz reenvía con `agent`; los agentes Claude internos usan `ctx.actor='agent'`. Es lo que hace cumplir "el agente propone en lo compartido".
- `POST /voice/session` body completo: `{ mode, trip_id?, tour_id?, focus?: {block_id?, google_place_id?, lat?, lng?, label?}, purpose?: 'onboarding'|'translator', target_lang?, participants?: uuid[], guests?: string[], transport?: 'realtime'|'livekit' }`. Con `transport='livekit'` (fase 2) devuelve `{livekit_url, livekit_token, room, voice_session_id}`.
- `POST /voice/session/:id/end` body `{ transcript: [{role, text, at}] }` → `{ job_id }` (el celu manda el transcript; el servidor no está en el camino del audio).
- `POST /trips/join` `{ invite_code, legs?, role?: 'traveler'|'follower' }` → `{trip_id, role, already_member, legs[]}`. Idempotente: si ya es miembro y vienen `legs`, reemplaza sus `leg_members`.
- `GET /j/:invite_code` → página web mínima que abre el deep link de la app (WhatsApp solo linkea https).
- `POST /translate` `{ texts[], target_lang }` → `{ items:[{text, detected_lang, translated}] }` (cache en el celu, no en DB).
- `POST /cron/tick` (header `x-cron-secret`, Vercel Cron cada 5 min): briefings matinal y de cierre, envío de push agrupados, "tu tour empieza", recuerdo "hace un año".
- Servicio interno (fase 2, worker LiveKit): `Authorization: Bearer <API_SERVICE_TOKEN>` + `X-Acting-User`, validando que esté en `voice_sessions.participants`.

### Eventos de voz nuevos

`[EVENTO:dwell] {stop_id, dwell_s, layers_told}` (sigue en la parada) · `[EVENTO:speaker_changed] {user_id, name}` (modo un celu para todos).

### Decisiones de interpretación (aprobadas)

- **Excepción en `plan_trip`:** dentro del job, sobre un tramo **sin bloques**, `add_block` aplica directo (el pedido explícito del organizador es la aprobación) y un único `undo_token` (`trip_planned`) revierte todo el plan. Sin esto el itinerario no podría llenarse en vivo. Fuera de ese caso rige la regla normal.
- **Realtime:** `days`, `trip_members`, `leg_members` no se publican; la app refresca el overview ante eventos de `legs`, `activity_feed` o `agent_jobs`. Cambios en privados ajenos → feed `busy_changed` sin detalles.
- **Seguidor web (PRD 27):** única excepción a "sin polling" (web anónima, refresco cada 15 s).
- **TTS** para podcast y pipeline LiveKit: OpenAI `gpt-4o-mini-tts`. **Proveedor de imágenes** (PRD 25): pendiente, detrás de `IMAGE_PROVIDER` con `mock`.
- Archivos de seed: `supabase/seed/ciudad-vieja-stops.json` (paradas curadas, solo con datos de fuente verificada por una persona) y `supabase/seed/ciudad-vieja-track.json` (`t` = segundos desde el inicio, `heading` puede ser null). Constantes de demo en `packages/shared/demo.ts`.

---

## Cambios PRD 01 (plan_trip) — en código

- `plan_trip` en `packages/shared/src/tools` (`PlanTripInput`: `trip_id?`, `title?`, `conversation[1..40]`, `start_date?`, `end_date?`). Respuesta `{ ok, data: { job_id, trip_id } }`; 409 `trip_not_empty` / `job_running`, 403 si no es organizer.
- `agent_jobs.result` de `plan_trip`: tipo `PlanTripResult` en `packages/shared/src/jobs.ts` (`legs, days, blocks, summary, assumptions, participants_hint, undo_token, failed_legs?, request?, usage?`).
- `BlockFields` (add_block / update_block / add_idea) acepta `alerts[]` y `sources[]` (las columnas ya existían).
- `activity_feed.payload.inverse` de `trip_planned` usa además la op `{ op: 'remove_leg', leg_id }` (borra el tramo en cascada: días, miembros, bloques).
- Excepción de plan: `ctx.plan` (solo dentro del job, nunca por HTTP) + `PolicyFacts.planEmptyLeg` en `writeMode`; los bloques del plan no escriben `block_added`, solo la fila `trip_planned`.
- Sin `GOOGLE_MAPS_API_KEY`, `search_places` / `place_details` usan OpenStreetMap (Photon / Nominatim) y el id va como `osm:<N|W|R><id>` en `google_place_id` (desactivable con `PLACES_OSM_FALLBACK=false`).

---

## Cambios PRD 10 (onboarding mínimo con chips) — en código

- Sin cambios de esquema. Formas de los jsonb/enums de `profiles` en `packages/shared/src/profile.ts`: `INTEREST_TAGS`, `Pace`, `Chronotype`, `BudgetLevel` (`low|mid|high|no_limit`), `TravelStyle`, `Interests` (pesos 1–5), `Mobility`, `InferredTrait`, `QuietHours`, `NotificationPrefs` y `ProfilePreferencesPatch` (lo que escribe el onboarding/Perfil).
- La app escribe `profiles` directo con Supabase (RLS: cada uno el suyo) y pone `onboarded_at = now()` en la misma actualización. `avoid` guarda etiquetas en español ("multitudes", "caminar mucho", …); `languages` en ISO 639-1.
- Estrellas de los chips → peso: ★ = 2, ★★ = 4, ★★★ = 5.

---

## Cambios PRD 05 (voz) — en código

- `POST /voice/session` acepta además `lang?`, `location?: {lat, lng, accuracy?}` y `sdp?` (oferta WebRTC, interfaz unificada): con `sdp` la API crea la llamada en OpenAI (`/v1/realtime/calls`) y devuelve `answer_sdp` (y `client_secret: null`); sin `sdp`, `client_secret`. Respuesta: `{ client_secret, answer_sdp, expires_at, voice_session_id, session_config, instructions_base, lang, scout }` (`VoiceSessionStart` en `packages/shared/src/voice.ts`).
- `POST /voice/session/:id/end` `{ transcript }` → `{ job_id }` del job `voice_summary`; `agent_jobs.result` = `VoiceSummaryResult` (`summary`, `memories`, `duration_s`, `actions[]`).
- Herramientas del celu (no del backend; controles de la llamada): `set_language { lang }` en `VOICE_CLIENT_TOOLS`. La API las suma a la sesión.
- Eventos de voz nuevos: `[EVENTO:tour_ready] {tour_id, title, stop_count, est_duration_min, total_walk_m, stops:[{sort_order,name}]}` y `[EVENTO:tour_failed] {tour_id, error}`: la app escucha el job de `generate_tour` por Realtime y avisa al scout.
- Env de la API: `OPENAI_REALTIME_MODEL` (default `gpt-realtime-2.1`), `VOICE_VAD` (`semantic_vad` default | `server_vad`), `VOICE_VAD_EAGERNESS` (`low`), `VOICE_VAD_THRESHOLD`, `VOICE_VAD_SILENCE_MS`, `API_REGION` (default `gru1`).
- `activity_feed.payload.summary` de acciones del agente usa `SCOUT.name` (antes "El asistente").


---

## Cambios PRD 07 (tour en vivo) — en código

- Herramientas `start_tour` / `tour_status` / `get_stop_content` / `next_stop` / `skip_stop` con Zod en `packages/shared/src/tools/tour.ts` (`TourProgress` = forma de `tours.progress`, `STOP_LAYERS` = valores de `content_told.layer`, tipos de respuesta `StartTourResult`, `TourStatusResult`, `StopContentResult`, `NextStopResult`, `SkipStopResult`).
- `tour_status` acepta además `progress?` (estado local del celu: si viene, se guarda; ids ajenos al tour se ignoran), `lat?/lng?` (ETA a pie a la próxima con `route_eta`) y `end?: true` (= "Terminar": `tours.status='done'`). No hay herramienta aparte para terminar.
- `next_stop` acepta `lat?/lng?` (explorador: la pendiente más cercana). Si no quedan pendientes → `done: true` y `tours.status='done'`.
- `get_stop_content` escribe `content_told` (upsert, no pisa `told_at`) para los participantes de la `voice_sessions` de tour abierta del usuario (o solo el usuario); `already_told` es del usuario que llama. Capa sin contenido → `text: null` y no escribe.
- Permisos: el tour se lee con RLS (dueño o miembro del viaje); las escrituras (`tours.progress/status`, `content_told` de otros participantes) van con service role. Sin `activity_feed` (no son cambios del itinerario).
- `POST /voice/session` con `mode:'tour'` suma las reglas del modo tour (`apps/api/src/voice/tourRules.ts`) y la lista de paradas con sus `stop_id`.
- Evento de voz nuevo `[EVENTO:tour_started] {tour_id, title, rules[], stops:[{sort_order,name,stop_id}]}`: el tour arrancó en medio de una llamada de **chat** (p. ej. "dale, arrancamos" después de `tour_ready`); trae las reglas del modo tour (`TOUR_RULES` en `packages/shared/src/tourVoice.ts`, las mismas que usa la API) porque la sesión no se creó con `mode:'tour'`. En modo chat las instrucciones suman `TOUR_STARTED_RULE`.
- Motor del tour en el celu: `packages/shared/src/tourEngine.ts` (puro). Usa `[EVENTO:dwell]` (v1.1) para la permanencia, no `arrived_stop` repetido.

---

## Cambios vigilante de horarios — en código

- Evento de voz nuevo `[EVENTO:schedule_alert] {kind, block_id, title, start_time, eta_min, leave_in_min, late_by_min}` en `VOICE_EVENT_TYPES` (`packages/shared/src/voice.ts`; tipos `ScheduleAlertPayload`, `ScheduleAlertKind`, `SCHEDULE_ALERT_KINDS`). `kind`: `leave_now` | `running_late` | `starting_soon`. `start_time` en `"HH:MM"` local; minutos enteros; `null` cuando no aplica (p. ej. `leave_in_min` y `late_by_min` en `starting_soon`).
- Lógica pura en `packages/shared/src/scheduleWatcher.ts` (`evaluateSchedule`, `nextWatchTarget`, `shouldRefreshEta`, `inQuietHours`, `alertKey`, `scheduleAlertText`). "Salí en X" (`leaveInMin`, `LEAVE_BUFFER_MIN`), `walkEstimateMin` y `FAR_AWAY_M` / `isFarAway` se movieron acá desde la vista Ahora (que los reexporta, sin cambios de comportamiento).
- Reglas: `leave_now` a ≤ 10 y ≤ 5 min de tener que salir; `running_late` si la llegada estimada supera el inicio por > 5 min; `starting_soon` si empieza en ≤ 15 min y ya estás a ≤ 150 m. Un aviso por bloque y por (tipo, umbral) — la clave incluye la hora de inicio, así un bloque movido se rearma. Solo el próximo bloque con hora fija (`time_flex='fixed'`) y lugar; nada durante un tour activo (manda `time_warning`), en `profiles.quiet_hours` ni para bloques a > 30 km.
- Instrucciones del scout (`apps/api/src/voice/instructions.ts`, `SCHEDULE_ALERT_RULE`, aditiva en chat y tour): una frase con el número exacto, ofrecer indicaciones a pie ("¿te llevo?"); en `running_late`, ofrecer avisar al grupo o mover el bloque sin aplicar nada solo.
- Entrega en el celu (`apps/mobile/src/schedule`): con llamada abierta → `voice.injectEvent('schedule_alert', payload)` (espera 3 s de silencio si la persona habla); sin llamada → notificación **local** de `expo-notifications` (`trigger: null`, sin servidor de push, no pasa por la tabla `notifications`), `data.url` = `/trip/<id>/now`. Sin cambios de esquema.
