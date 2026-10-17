---
nro: 0
prd: "00 · Columna"
prioridad: P0
estado: "Por hacer"
carril: "Columna / voz / nativo"
tamano: "L (2-4h)"
depende_de: "—"
resumen: "Dev build de Expo, monorepo, esquema de Contratos en Supabase con RLS, API Hono en Vercel con /tools/:name y herramientas base, login Google, Realtime y seed de demo: la base sobre la que se construyen 01–05 en paralelo."
notion_url: https://app.notion.com/p/3fc81924a5c681e0a45cc506ddcd89e6
---

# 🦴 00 · Columna

> 📌 Fuentes de verdad: [Producto](../PRODUCT.md) · [Arquitectura](../ARCHITECTURE.md) · [Contratos](../CONTRACTS.md). Nombres de tablas, campos y herramientas: **exactos** de Contratos.

## Objetivo

Dejar la columna vertebral andando punta a punta para que los PRDs 01–05 se construyan en paralelo sin pisarse: development build de Expo instalado en los celus (con **todos** los módulos nativos del finde), monorepo, esquema completo de Contratos en Supabase con RLS (incluida `blocks_visible`), API Hono en Vercel con `POST /tools/:name` y las 10 herramientas base, `activity_feed` + `undo_token`, login con Google, suscripciones Realtime, `LocationProvider` y seed del viaje de demo.

## Momento de la demo

No se ve en escena pero sostiene todo: el viaje "Montevideo + Buenos Aires" ya cargado al abrir la app; Ana mueve un bloque y aparece solo en el celu de Juan (Acto 1); la voz agrega algo y aparece la tarjeta con "Deshacer" (Acto 2).

## Historias de usuario

- Como dev del equipo, clono el repo, corro `pnpm i` + `pnpm dev` y tengo app, API y DB local andando en menos de 10 min.
- Como viajero, entro con Google y veo mis viajes.
- Como agente (voz o Claude), llamo `POST /tools/add_block` con el JWT del usuario y la regla "personal aplica / compartido + agente propone" se resuelve sola en el backend.
- Como miembro, cualquier cambio de otro miembro aparece en mi pantalla en ≤ 2 s sin recargar.
- Como usuario, puedo deshacer cualquier acción (mía o del agente) con su `undo_token`.

## Criterios de aceptación

- [ ] `apps/mobile` corre como **development build** (no Expo Go) en 1 iPhone y 1 Android reales, con todos los plugins nativos listados en Notas técnicas (objetivo: 0 rebuilds nativos el resto del finde).
- [ ] `supabase db reset` aplica las migraciones sin error y crea **todas** las tablas de Contratos (incluida la sección "Cambios v1.1": `notifications`, `trip_recaps` y columnas nuevas) con nombres, columnas, defaults y `check` exactos, extensiones `postgis` y `vector`, y la vista `blocks_visible`.
- [ ] RLS activo en todas las tablas. Test SQL (`supabase/tests/rls.sql`): un usuario no miembro hace `select` en `blocks`, `legs`, `activity_feed` → 0 filas.
- [ ] Bloque privado de Juan: Sofi lo ve desde `blocks_visible` con `title='Ocupado'` y `description`, `notes`, `place_name`, `google_place_id`, `lat`, `lng`, `cost_estimate`, `booking_url` en `null`; desde `blocks` directo no lo ve (0 filas). Juan lo ve completo en ambos.
- [ ] Login con Google funciona en iOS y Android; un trigger sobre `auth.users` crea la fila en `profiles` (`display_name` y `avatar_url` desde la metadata de Google).
- [ ] API desplegada en Vercel: `POST /tools/:name` con input inválido → 400 `{ok:false, error:{code:'invalid_input', issues}}`; sin JWT → 401; herramienta desconocida → 404; sin permiso → 403 `{code:'forbidden'}`.
- [ ] Las 10 herramientas base responden con `{ok, data, undo_token?, feed_id?}`: `get_trip_overview`, `get_day_plan`, `add_block`, `update_block`, `move_block`, `remove_block`, `search_places`, `place_details`, `route_eta`, `undo`.
- [ ] Regla de escritura con test automatizado (vitest) para 5 casos: humano + compartido → aplica; agente + personal → aplica; agente + compartido → crea `agent_proposals` con `status='pending'` y **no** toca `blocks`; seguidor → 403; agente sobre bloque personal de otro → 403.
- [ ] Toda escritura inserta exactamente 1 fila en `activity_feed` y devuelve `undo_token` + `feed_id`. `undo` revierte add/update/move/remove y propuestas; un segundo `undo` del mismo token → 409 `{code:'already_undone'}`.
- [ ] Realtime: un cambio hecho en el celu A aparece en el celu B en ≤ 2 s en 5 de 5 intentos (cronómetro).
- [ ] `packages/shared` exporta los Zod de las 10 herramientas, `TOOL_NAMES`, y el exportador a OpenAI Realtime (JSON Schema). Un test verifica que cada nombre en `TOOL_NAMES` tiene schema, handler en la API y JSON Schema con `type: 'object'` en la raíz.
- [ ] `LocationProvider` (interfaz) + `RealLocationProvider` emite un fix cada ≤ 2 s en primer plano con `lat`, `lng`, `heading`, `accuracy`.
- [ ] Seed: 4 usuarios, viaje "Montevideo + Buenos Aires" con 4 tramos (2 en paralelo), ≥ 18 bloques, 1 bloque privado de Juan, 1 propuesta `pending`, 2 personas, tour `ready` con 10 paradas y `supabase/seed/ciudad-vieja-track.json`.
- [ ] `docs/CLAUDE.md` (según Arquitectura) + `CLAUDE.md` en la raíz que lo importa, con links a Notion y las reglas de la sección Notas técnicas.

## Pantallas y estados

| Pantalla | Contenido | Vacío | Cargando | Error |
| --- | --- | --- | --- | --- |
| Login (`app/(auth)/login.tsx`) | "Entrar con Google". Solo en `__DEV__`: "Entrar como demo" con 4 botones (Juan/Ana/Leo/Sofi) vía email+password. | — | Spinner dentro del botón, botones deshabilitados | Toast "No pudimos entrar con Google. Probá de nuevo." + código de error en dev |
| Mis viajes (`app/(app)/index.tsx`) | Cards de viaje: título, fechas, destinos, avatares | "Todavía no tenés viajes" + CTA "Nuevo viaje" (PRD 01) + "Unirme con código" (PRD 04) | 3 cards skeleton | "No pudimos cargar tus viajes" + Reintentar |
| Shell del viaje (`app/(app)/trip/[tripId]/_layout.tsx`) | Tabs Plan / Mapa / Grupo (Gastos y Diario ocultos con flag). Cada tab es un placeholder que lista datos crudos hasta que llegue su PRD. Slot global para el botón flotante de voz (PRD 05). | — | Skeleton del header | Si el viaje no existe o no sos miembro: "No tenés acceso a este viaje" + volver |
| Banner de conexión (global) | "Sin conexión — mostrando lo último" cuando el canal Realtime cae o no hay red | — | — | — |

## Datos

Todas las tablas de Contratos, tal cual. Detalles de implementación obligatorios:

- Convenciones: `id uuid primary key default gen_random_uuid()`, `created_at timestamptz default now()`.
- `geo` en `blocks` y `place_library`: columna generada `geography(Point,4326) generated always as (ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography) stored` + índice GIST.
- `blocks.updated_at` y `agent_jobs.updated_at`: trigger `set updated_at = now()`.
- `trips.invite_code`: default de 8 caracteres de `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (sin 0/O/1/I), unique.
- Trigger `after insert on trips`: inserta `trip_members(trip_id, created_by, role='organizer')`.
- Trigger `after insert on auth.users`: inserta `profiles(id, display_name, avatar_url)` desde `raw_user_meta_data`.
- Helpers SQL internos (`security definer`, `stable`): `is_trip_member(trip_id)`, `trip_role(trip_id)`, `is_leg_member(leg_id)`, `is_block_participant(block_id)`.

### Matriz RLS (MVP)

| Tabla | select | insert / update / delete |
| --- | --- | --- |
| `trips` | miembro | insert: `created_by = auth.uid()`; update/delete: organizer |
| `trip_members` | miembro del mismo viaje | insert: solo service role (join) o trigger; update: uno mismo u organizer (trigger impide que no-organizer cambie `role` y que quede 0 organizers); delete: uno mismo u organizer |
| `legs`, `days`, `leg_members` | miembro | organizer; `days` también viajero del tramo |
| `blocks`, `block_participants` | miembro y (`not is_private` o participante o `created_by = auth.uid()`) | organizer, o viajero que es `leg_member` del tramo del bloque. Seguidor: nada. |
| `agent_proposals` | miembro | insert: miembro no seguidor; update: organizer (lo refina PRD 11) |
| `activity_feed` | miembro | insert: miembro con `actor_user_id = auth.uid()`; sin update/delete (append-only) |
| `member_locations` | miembro (PRD 13 refina por `location_sharing` / `ghost_until`) | upsert solo la fila propia |
| `profiles` | uno mismo + co-miembros de algún viaje | update: uno mismo |
| `saved_places`, `device_tokens` | propio | propio |
| `agent_jobs` | `user_id = auth.uid()` o miembro de `trip_id` | solo service role |
| `personas`, `place_library`, `tour_stops` | cualquier autenticado | solo service role |
| `tours` | `owner_user_id = auth.uid()` o miembro de `trip_id` | service role |
| `voice_sessions` | `auth.uid() = any(participants)` | service role |
| `memories` | `scope='personal'` → `user_id = auth.uid()`; `scope='trip'` → miembro; siempre `deleted_at is null` | service role |
| resto (`polls`, `poll_votes`, `expenses`, `settlements`, `photos`, `diary_entries`, `content_told`, `place_error_reports`) | miembro (o propio si no hay `trip_id`) | miembro no seguidor; sus PRDs refinan |

### Vista `blocks_visible`

Vista con el owner por defecto (no `security_invoker`), así ve los privados ajenos y los enmascara. Filtra por membresía con `auth.uid()`:

```sql
create view public.blocks_visible with (security_barrier = true) as
select b.id, b.trip_id, b.leg_id, b.day_id, b.type,
  case when m.masked then 'Ocupado' else b.title end as title,
  case when m.masked then null else b.description end as description,
  case when m.masked then null else b.google_place_id end as google_place_id,
  case when m.masked then null else b.place_name end as place_name,
  case when m.masked then null else b.lat end as lat,
  case when m.masked then null else b.lng end as lng,
  b.start_time, b.end_time, b.time_flex, b.duration_min, b.is_private, b.status, b.plan_variant,
  case when m.masked then null else b.cost_estimate end as cost_estimate,
  case when m.masked then null else b.cost_currency end as cost_currency,
  case when m.masked then null else b.booking_url end as booking_url,
  case when m.masked then null else b.notes end as notes,
  case when m.masked then null else b.transfer end as transfer,
  case when m.masked then null else b.alerts end as alerts,
  case when m.masked then null else b.sources end as sources,
  b.tour_id, b.sort_order, b.created_by, b.created_by_agent, b.created_at, b.updated_at,
  m.masked
from public.blocks b
cross join lateral (select (b.is_private and not public.is_block_participant(b.id)
  and b.created_by is distinct from auth.uid()) as masked) m
where public.is_trip_member(b.trip_id);
grant select on public.blocks_visible to authenticated;
```

### Realtime

`alter publication supabase_realtime add table` exactamente las de Contratos: `blocks`, `block_participants`, `legs`, `agent_proposals`, `polls`, `activity_feed`, `member_locations`, `expenses`, `agent_jobs`.

- Hueco conocido: Realtime no emite cambios de bloques privados ajenos (RLS los filtra). Solución sin tocar Contratos: la API inserta en `activity_feed` una fila `kind='busy_changed'`, `payload={day_id}` (sin detalles) cuando cambia un privado; los clientes refrescan `blocks_visible` de ese día.
- `days`, `trip_members` y `leg_members` no están en la lista: los clientes refrescan el overview cuando llega un evento de `legs`, `activity_feed` (kinds de miembros) o `agent_jobs`.

### Valores de `activity_feed.kind` (constante `FEED_KINDS` en `packages/shared`)

`block_added`, `block_updated`, `block_moved`, `block_removed`, `proposal_created`, `undo`, `busy_changed`, `trip_planned`, `member_joined`, `member_left`, `member_role_changed`, `member_legs_changed`. `payload` siempre incluye `summary` (texto corto en rioplatense para feed y tarjetas de acción) y, si es deshacible, `inverse` (lista de ops inversas, mismo formato que `agent_proposals.ops`).

## Herramientas y endpoints

Contrato común: `POST /tools/:name` · body = input Zod · `Authorization: Bearer <supabase JWT>` · header `x-actor: user` (default) o `agent` (ver PROPUESTA en Notas) · respuesta `{ ok, data, undo_token?, feed_id? }`; error `{ ok:false, error:{ code, message, issues? } }`.

| Herramienta | Input (Zod) | `data` |
| --- | --- | --- |
| `get_trip_overview` | `{ trip_id }` | `{ trip, members:[{user_id, display_name, avatar_url, role}], legs:[{...leg, member_ids, days:[{id, date}]}], summary }` — `summary` ≤ 600 caracteres en texto plano, pensado para la voz |
| `get_day_plan` | `{ day_id }` o `{ trip_id, date, leg_id? }` (si hay tramos paralelos y no viene `leg_id`, usa el tramo del usuario) | `{ day, leg, blocks:[fila de blocks_visible + participant_ids] }` ordenados por `start_time` y luego `sort_order` |
| `add_block` | `{ trip_id, leg_id, day_id: uuid o null, type, title, description?, google_place_id?, place_name?, lat?, lng?, start_time?, end_time?, time_flex?, duration_min?, participant_ids?, is_private?, status?, cost_estimate?, cost_currency?, booking_url?, notes?, transfer?, sort_order?, reason? }` — `participant_ids` default = miembros del tramo | `{ mode:'applied', block }` o `{ mode:'proposed', proposal_id }` |
| `update_block` | `{ block_id, patch:{...campos editables de blocks + participant_ids}, reason? }` | igual que arriba |
| `move_block` | `{ block_id, day_id: uuid o null, sort_order?, start_time?, recompute_times?: boolean = true, reason? }` | igual + `changed_block_ids` (los que corrieron de horario) |
| `remove_block` | `{ block_id, reason? }` | `{ mode, block_id }` o `{ mode:'proposed', proposal_id }` |
| `search_places` | `{ query?, near?:{lat, lng}, radius_m?=3000, open_now?, max_results?=8 }` (al menos `query` o `near`; validación en runtime, no `.refine` en el schema) | `[{ google_place_id, name, address, lat, lng, rating, price_level, open_now, types }]` |
| `place_details` | `{ google_place_id }` | `{ name, address, lat, lng, rating, user_rating_count, price_level, open_now, weekday_hours:string[], website, phone, google_maps_uri, editorial_summary }` |
| `route_eta` | `{ stops:[{lat, lng} o {google_place_id}] (2 a 10), mode:'walk' o 'transit' o 'car', departure_time? }` | `{ segments:[{ from_idx, to_idx, duration_min, distance_m, polyline }], total_min }` |
| `undo` | `{ undo_token }` | `{ reverted: true, feed_id }` |

### Regla de escritura (en un solo lugar: `apps/api/src/policy/writeMode.ts`)

1. Cargar bloque (o el tramo, para `add_block`) + participantes + rol del actor. Seguidor → 403.
2. Permiso base: organizer, o viajero que es `leg_member` del tramo. Si no → 403.
3. **Personal** = participantes resultantes == `[actor]` (o `is_private` y el actor es el único participante). Si no, es **compartido**.
4. `x-actor: user` → aplica siempre (los humanos editan directo).
5. `x-actor: agent` + personal del actor → aplica (`created_by_agent = true`). Agente sobre personal de otro → 403.
6. `x-actor: agent` + compartido → inserta `agent_proposals` (`by_agent=true`, `status='pending'`, `summary`, `reason`, `ops=[{op, block_id?, block?, patch?}]`, `leg_id`, `day_id`) y no toca `blocks`.
7. Siempre: 1 fila en `activity_feed` (`actor_agent` según header, `payload.summary`, `payload.inverse`) + `undo_token` = 24 bytes random base64url guardado en esa fila.

### `undo`

Busca la fila de `activity_feed` por `undo_token`; solo el mismo actor o un organizer. Si ya existe una fila `kind='undo'` con `payload.undo_of = feed_id` → 409. Aplica `payload.inverse` en una transacción (para propuestas: `status='rejected'`, `decided_by = auth.uid()`, `decided_at = now()`) e inserta la fila `kind='undo'`.

### `move_block` con `recompute_times`

Reordena `sort_order` del día destino; después, para los bloques siguientes con `time_flex <> 'fixed'`, recalcula `start_time` = fin del anterior + `route_eta` a pie (o transit si a pie > 30 min). Si un bloque `fixed` queda pisado, agrega `alerts` `{kind:'late', text:'Llegás 15 min tarde a X'}`. Todo con el mismo `undo_token`.

### Otros endpoints en este PRD

- `GET /jobs/:id` → fila de `agent_jobs` (fallback si Realtime falla; RLS por JWT).
- Fuera: `POST /voice/session*` (05), `POST /trips/join` (04), `POST /uploads/sign` y `GET /public/trips/:share_id` (sus PRDs).

## Notas técnicas

### Estructura

```plain text
/apps/mobile        Expo Router, TS. src/{lib/supabase.ts, lib/api.ts, realtime/, location/, voice/ (05), features/}
/apps/api           Hono. src/{index.ts, auth.ts, tools/<name>.ts, policy/, google/, agents/ (01), voice/ (05)}
/packages/shared    src/{tools/<name>.ts, tools/index.ts, db.types.ts, constants.ts, location.ts}
/supabase           migrations/, seed.sql, seed/ciudad-vieja-track.json, tests/rls.sql
/scripts            seed-remote.ts, resolve-places.ts, make-track.ts
/docs/CLAUDE.md     + /CLAUDE.md raíz con "@docs/CLAUDE.md"
```

### Registro de herramientas (fuente única)

```typescript
// packages/shared/src/tools/index.ts
import { z } from 'zod'; // zod@^4
export const toolDefs = {
  get_trip_overview: { description: 'Tramos, miembros, días y resumen del viaje', input: GetTripOverviewInput },
  add_block: { description: 'Agrega un bloque. Personal: aplica. Compartido + agente: crea propuesta.', input: AddBlockInput },
  // ...las 10
} as const;
export type ToolName = keyof typeof toolDefs;
export const TOOL_NAMES = Object.keys(toolDefs) as ToolName[];
export const toRealtimeTools = (names: ToolName[] = TOOL_NAMES) => names.map((n) => {
  const { $schema, ...parameters } = z.toJSONSchema(toolDefs[n].input) as any;
  return { type: 'function', name: n, description: toolDefs[n].description, parameters };
});
```

```typescript
// apps/api/src/tools/claude.ts  (el SDK de Anthropic NO entra al bundle del celu)
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
export const toClaudeTools = (ctx: ToolCtx, names: ToolName[]) => names.map((n) => betaZodTool({
  name: n, description: toolDefs[n].description, inputSchema: toolDefs[n].input,
  run: async (input) => JSON.stringify(await handlers[n](input, ctx)), // misma función que POST /tools/:name
}));
```

- Gotcha Zod/JSON Schema: nada de `z.union` ni `discriminatedUnion` en la raíz del input (OpenAI exige `type:'object'`); `.refine/.superRefine` no se serializan → validar en el handler.
- Gotcha `betaZodTool`: si la versión del SDK pide el import de `zod/v4`, usar ese path; probarlo en el primer commit.

### App (Expo)

- Expo SDK estable más reciente (≥ 54), New Architecture, Expo Router, TypeScript estricto. Estado: `@tanstack/react-query` (datos) + `zustand` (UI). Listas: `@shopify/flash-list`. Sheets: `@gorhom/bottom-sheet`.
- **Primer dev build con todos los nativos del finde** (cada rebuild cuesta 15–25 min): `@rnmapbox/maps`, `react-native-webrtc` + `@config-plugins/react-native-webrtc`, `react-native-incall-manager`, `@react-native-google-signin/google-signin`, `expo-location`, `expo-task-manager`, `expo-camera`, `expo-image-picker`, `expo-haptics`, `expo-audio`, `expo-notifications`, `expo-keep-awake`, `expo-sharing`, `expo-file-system`, `react-native-svg`, `react-native-reanimated`, `react-native-gesture-handler`, `@react-native-async-storage/async-storage`.
- iOS `infoPlist`: `NSLocationWhenInUseUsageDescription`, `NSLocationAlwaysAndWhenInUseUsageDescription`, `NSMicrophoneUsageDescription`, `NSCameraUsageDescription`, `NSPhotoLibraryUsageDescription`, `UIBackgroundModes: ["audio", "location"]`. Android: `ACCESS_FINE_LOCATION`, `ACCESS_BACKGROUND_LOCATION`, `RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS`, `CAMERA`, `BLUETOOTH_CONNECT`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_LOCATION`, `FOREGROUND_SERVICE_MICROPHONE`.
- `scheme` de la app en `app.config.ts` (lo usa el deep link de PRD 04).
- Build: el más rápido es `npx expo run:ios --device` / `npx expo run:android` local; alternativa `eas build --profile development` (registrar el iPhone antes con `eas device:create`). **Arrancar el build en el minuto 0**, en paralelo a la DB.

### Login con Google

- Google Cloud: 3 OAuth clients (Web, iOS con el bundle id, Android con package + SHA-1 del keystore de debug/EAS).
- Supabase Auth → Google: Client IDs = web,ios,android separados por coma; activar "Skip nonce check" (necesario en iOS con `signInWithIdToken`).
- App: `GoogleSignin.configure({ webClientId, iosClientId })` → `GoogleSignin.signIn()` → `supabase.auth.signInWithIdToken({ provider: 'google', token: idToken })`. Plugin con `iosUrlScheme` = iOS client id invertido.
- Cliente Supabase en RN: `import 'react-native-url-polyfill/auto'`, `storage: AsyncStorage` (no SecureStore: la sesión supera 2048 bytes), `detectSessionInUrl: false`, `startAutoRefresh/stopAutoRefresh` según `AppState`.

### API (Hono en Vercel)

- `apps/api/src/index.ts` con `const app = new Hono(); export default app;` (Vercel detecta Hono sin config). Runtime Node (no Edge). `maxDuration` 300 en `vercel.json` (PRD 01 lo necesita). Jobs largos con `waitUntil` de `@vercel/functions`.
- Auth: verificar JWT con `jose` contra `${SUPABASE_URL}/auth/v1/.well-known/jwks.json` (fallback: `supabase.auth.getUser(jwt)`). Por request se crea un cliente Supabase con el JWT del usuario (RLS como segunda barrera); el cliente service role solo para jobs de agentes y join.
- Google: Places API (New) `POST https://places.googleapis.com/v1/places:searchText` y `:searchNearby` (si no hay `query`), `GET /v1/places/{id}`, siempre con `X-Goog-FieldMask` mínimo; Routes `POST https://routes.googleapis.com/directions/v2:computeRoutes` con `routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline`, pares en paralelo. Cache en memoria 10 min por input.
- Monorepo: pnpm workspaces con `.npmrc` → `node-linker=hoisted` (RN se lleva mal con symlinks). `packages/shared` se consume como fuente TS (`"main": "src/index.ts"`). Vercel: Root Directory `apps/api` con "Include files outside root"; si no transpila `packages/shared`, agregar build con `tsup`.
- Env API: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_MAPS_API_KEY`. Env app: `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_MAPBOX_TOKEN`, `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`, `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`. Ninguna key de OpenAI/Anthropic/Google en el celu.

### Realtime en la app

- Hook `useTripRealtime(tripId)`: 1 canal `trip:<id>` con un `.on('postgres_changes', { event: '*', schema: 'public', table, filter: 'trip_id=eq.<id>' })` por tabla de Contratos (`block_participants` sin filtro: no tiene `trip_id`; RLS recorta). Cada evento → `queryClient.invalidateQueries(['trip', id, table])`.
- `supabase.realtime.setAuth(access_token)` en cada refresh de token; resuscribir al volver de background. Nunca polling (salvo `GET /jobs/:id` si el canal da `CHANNEL_ERROR`).

### LocationProvider

```typescript
// packages/shared/src/location.ts
export type LocationFix = { t: number; lat: number; lng: number; heading: number | null; speed?: number | null; accuracy: number };
export interface LocationProvider {
  readonly kind: 'real' | 'simulated';
  start(): Promise<void>;
  stop(): void;
  getCurrent(): LocationFix | null;
  subscribe(cb: (fix: LocationFix) => void): () => void;
}
```

- `RealLocationProvider` (`apps/mobile/src/location/real.ts`): `expo-location` `watchPositionAsync({ accuracy: High, timeInterval: 1000, distanceInterval: 2 })` + `watchHeadingAsync`. Permiso pedido en el momento justo (al abrir Mapa o voz), no al iniciar.
- `SimulatedLocationProvider`: solo el esqueleto que cumple la interfaz (el replay del track es de otro PRD). Selección con `LocationContext` + toggle en un menú dev.

### Seed de demo

- Usuarios con UUID fijos `...0001` Juan (organizer), `...0002` Ana, `...0003` Leo, `...0004` Sofi. Local: `seed.sql` inserta en `auth.users`. Remoto: `scripts/seed-remote.ts` usa `auth.admin.createUser({ email, email_confirm: true })` con los Gmail reales del equipo (env `SEED_EMAIL_JUAN`, etc.); al entrar con Google, Supabase vincula la identidad por email verificado. Si `createUser` no acepta `id`, mapear por email.
- Viaje "Montevideo + Buenos Aires": Montevideo 17–19/10/2026 [todos] → Colonia 20–21/10 [Juan, Ana, Leo] ∥ Buenos Aires 20–21/10 [Sofi] → Buenos Aires 22–24/10 [todos].
- Bloques (≥ 18): sáb 17 `lodging` alojamiento en Ciudad Vieja, `meal` almuerzo en Mercado del Puerto, `activity` Rambla al atardecer; dom 18 `activity` Feria de Tristán Narvaja 09:00, `tour` "Ciudad Vieja" 11:00–13:30 con `tour_id`, `activity` Teatro Solís 16:00 con `alerts:[{kind:'closes', text:'Última visita 17:00'}]`, **privado de Juan** "Llamada de laburo" 18:00–19:00; lun 19 `meal`, `activity` x2, `free`; mar 20 `transfer` bus Montevideo→Colonia (Colonia), `transfer` ferry Montevideo→Buenos Aires (Sofi), actividades en cada rama; jue 22 `transfer` ferry Colonia→Buenos Aires y `meetup` "Reencuentro" [todos]; 2 ideas sin día por tramo.
- 1 `agent_proposals` `pending` del agente: cambiar la cena del lunes 19 (op `update`).
- `personas`: 1 `companion` + 1 `local` "Don Julio, vecino de Ciudad Vieja" (`city='Montevideo'`).
- `tours` `ready` + 10 `tour_stops` → `place_library` `tier='curated'`: Puerta de la Ciudadela, Plaza Independencia, Palacio Salvo, Teatro Solís, Peatonal Sarandí, Plaza Matriz, Catedral Metropolitana, Cabildo, Museo Torres García, Mercado del Puerto. Coordenadas y `google_place_id` con `scripts/resolve-places.ts` (Places searchText). Narraciones: placeholder `PENDIENTE contenido curado` (las escribe el carril de contenido; nunca inventar datos).
- Track: `scripts/make-track.ts` genera uno sintético `[{t, lat, lng, heading, accuracy}]` a 1 Hz y 1,3 m/s entre las 10 paradas, hasta reemplazarlo por el grabado.

### Contenido mínimo de `docs/CLAUDE.md`

```markdown
# build101 — Guía de viaje con IA
Specs (leer antes de tocar algo):
- Producto: https://www.notion.so/3fc81924a5c681f1be4ce49704ebf276
- Arquitectura: https://www.notion.so/3fc81924a5c681e0a1b8f8b260816f70
- Contratos: https://www.notion.so/3fc81924a5c6814087e4e83bdd9916ef
- PRDs: base "PRDs" en Notion (uno por feature)
Reglas:
1. Nombres de tablas/campos/herramientas EXACTOS de Contratos. Cambio de contrato = migración + packages/shared + nota en Notion.
2. Las herramientas viven en el backend (POST /tools/:name, Zod de packages/shared). Nada de lógica de herramientas en el proveedor de voz.
3. El agente propone en lo compartido y aplica en lo personal; toda acción escribe activity_feed y devuelve undo_token.
4. Sync por Supabase Realtime. Nunca polling.
5. Todo lo que use ubicación consume LocationProvider (real | simulated).
6. Secretos solo en apps/api. El celu nunca ve keys de OpenAI/Anthropic/Google.
7. UI en español rioplatense (voseo). Nunca pantalla vacía: siempre estado vacío, cargando y error.
8. No se arranca un P1 hasta que el P0 corra punta a punta.
Comandos: pnpm dev | pnpm --filter api test | supabase db reset | pnpm seed:remote
```

### Orden de implementación sugerido

1. (min 0) Repo + workspaces + `packages/shared` vacío + **arrancar dev build** con todos los plugins.
2. Migraciones + helpers + RLS + `blocks_visible` + `tests/rls.sql` + seed local.
3. API: auth middleware, registro, `writeMode`, `activity_feed`/`undo`, las 10 herramientas, tests vitest de la regla.
4. App: cliente Supabase, login Google, Mis viajes, shell con tabs, `useTripRealtime`, `LocationProvider`.
5. Deploy Vercel + proyecto Supabase remoto + `seed:remote` + prueba con 2 celus.
6. `CLAUDE.md`.

### PROPUESTA DE CAMBIO A CONTRATOS

- Header `x-actor: user | agent` en `POST /tools/:name` (default `user`). Hace falta para que la regla "agente propone en compartido" funcione: la voz reenvía function calls con el JWT del usuario y el backend no tiene otra forma de saber que la acción la decidió el agente. Los agentes Claude internos usan `ctx.actor = 'agent'` sin header.

## Fuera de alcance

- Resto de las herramientas (`plan_trip`, `add_idea`, `decide_proposal`, tours, gastos, memoria, etc.).
- Replay del `SimulatedLocationProvider`, geofencing y ubicación en background.
- Push notifications, seguidor web, uploads, onboarding de perfil.
- UI real de Plan/Mapa/Grupo (PRDs 02–04): acá solo placeholders.

## Dependencias

- Depende de: —. Bloquea: 01, 02, 03, 04, 05.
- Cuentas: Supabase, Vercel, Google Cloud (OAuth + Places API (New) + Routes API), Mapbox (token público), Apple Developer / EAS, Anthropic, OpenAI.

## Cómo probarlo

1. Instalar el dev build en un iPhone (Juan) y un Android (Ana). Abrir con `pnpm --filter mobile start` apuntando a la API de Vercel.
2. En ambos: "Entrar con Google" con los Gmail del seed → aparece "Montevideo + Buenos Aires".
3. En el iPhone abrir Plan (placeholder) del dom 18: se ve "Llamada de laburo". En el Android (Ana): el mismo bloque dice "Ocupado".
4. Desde la terminal: `curl -X POST $API/tools/add_block -H "Authorization: Bearer <JWT de Ana>" -d '{...bloque compartido del dom 18...}'` → en ≤ 2 s aparece en el iPhone sin tocar nada. Respuesta con `undo_token`.
5. Repetir con `-H "x-actor: agent"` → respuesta `mode:'proposed'`; en `agent_proposals` hay una fila `pending` y el bloque **no** aparece en el día.
6. `POST /tools/undo` con el token del paso 4 → el bloque desaparece en ambos celus; repetirlo → 409.
7. `search_places` con `query:'café'` y `near` de Plaza Matriz → ≥ 3 resultados; `route_eta` entre Puerta de la Ciudadela y Mercado del Puerto a pie → 10–20 min.
8. En el iPhone, abrir el menú dev → ver el último `LocationFix` actualizándose caminando unos metros.
