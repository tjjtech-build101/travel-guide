---
nro: 4
prd: "04 · Multiplayer básico"
prioridad: P0
estado: "Por hacer"
carril: "App y producto"
tamano: "M (1-3h)"
depende_de: "00"
resumen: "Invitar por link/QR/WhatsApp con invite_code, unirse con Google + onboarding del viaje de 30 s y elección de tramos, roles organizador/viajero/seguidor con permisos, pestaña Grupo con miembros y feed de actividad, y gestión de miembros, todo en vivo."
notion_url: https://app.notion.com/p/3fc81924a5c681239b9ffec506e0d073
---

# 👥 04 · Multiplayer básico

> 📌 Fuentes: [Producto](../PRODUCT.md) · [Arquitectura](../ARCHITECTURE.md) · [Contratos](../CONTRACTS.md). Requiere PRD 00.

## Objetivo

Que el viaje sea de verdad multiplayer: el organizador invita en 2 toques (link, QR o WhatsApp), el invitado entra con Google y en 30 s cuenta qué quiere del viaje y en qué tramos está; cada uno tiene su rol con permisos reales; los cambios de todos aparecen solos y la pestaña Grupo muestra quién está y qué pasó.

## Momento de la demo

Acto 1: "el compañero se suma por QR". Juan muestra el QR en el escenario, Ana lo escanea con su celu, entra con Google, completa el onboarding de 30 s ("ni loco: madrugar"), elige sus tramos y en el celu de Juan aparece "Ana se sumó al viaje" en el feed y su avatar en los bloques del grupo.

## Historias de usuario

- Como organizador, comparto el link del viaje por WhatsApp o muestro un QR, para todo el viaje o para tramos específicos.
- Como invitado, abro el link (o escaneo el QR, o tipeo el código), entro con Google y quedo adentro sin pasos extra.
- Como invitado, en 30 s digo mi objetivo, presupuesto (o sin límite), qué sí o sí, qué ni loco, en qué tramos estoy y cómo comparto mi ubicación.
- Como viajero, edito mis tramos, agrego cosas personales y propongo; como seguidor, solo miro.
- Como miembro, veo en la pestaña Grupo quién está, en qué tramos y el feed de lo que va pasando (personas y agente).
- Como organizador, cambio roles, asigno tramos, saco gente y regenero el código.

## Criterios de aceptación

- [ ] Compartir invitación en ≤ 2 toques desde Grupo: "WhatsApp" abre WhatsApp con mensaje + link; "QR" muestra QR a pantalla completa con brillo legible; "Copiar link".
- [ ] El link funciona tocado desde WhatsApp en iOS y Android con la app instalada (abre la pantalla de unirse con el código cargado); sin app instalada muestra la página con el código para tipear.
- [ ] Escanear el QR con la cámara de la app ("Unirme con código" → "Escanear") une en ≤ 3 s después del login.
- [ ] `POST /trips/join` con código válido: crea `trip_members` (`role='traveler'` por defecto), `leg_members` según `legs` (o todos los tramos si no viene), 1 fila `activity_feed` `kind='member_joined'`; código inválido → 404 `{code:'invalid_code'}`; ya miembro → 200 idempotente.
- [ ] Al unirse a un tramo, el nuevo miembro queda como participante de los bloques del grupo de ese tramo (no privados y cuyos participantes eran todos los miembros del tramo); al salir, se lo quita.
- [ ] Onboarding del viaje completable en ≤ 30 s (cronómetro, 3 personas): 4 pantallas con chips y "Saltear" en cada una; guarda `trip_members.trip_prefs = { goal, budget_per_person, must, avoid, companions }`, `location_sharing` y `leg_members`.
- [ ] Elección de tramos presugerida: si `agent_jobs.result.participants_hint` de `plan_trip` nombra al usuario (match por `display_name`, sin tildes ni mayúsculas), esos tramos vienen marcados; si no, todos.
- [ ] Permisos verificados en 2 celus: seguidor no ve controles de edición y la API le da 403; viajero no puede editar bloques de un tramo donde no está (403); organizer puede todo.
- [ ] Pestaña Grupo: lista de miembros con avatar, nombre, rol, chips de tramos (color `LEG_COLORS`) e ícono de ubicación; feed de actividad con las últimas 30 entradas y "Cargar más".
- [ ] Unirse, cambiar rol o tramos en el celu A se refleja en Grupo y Plan del celu B en ≤ 2 s sin recargar.
- [ ] Gestión (solo organizer): cambiar rol, editar tramos de un miembro, sacar del viaje (con confirmación), regenerar código (el link viejo da `invalid_code`). No se puede dejar el viaje sin organizer (error claro). Cualquiera puede "Salir del viaje".

## Pantallas y estados

### Grupo (`app/(app)/trip/[tripId]/group.tsx`)

- Header: "4 personas" + botón "Invitar".
- Miembros: fila por `trip_members` ordenada organizer → viajeros → seguidores; avatar, `display_name`, badge de rol (Organizador / Viajero / Seguidor), chips de tramos, ícono de ubicación según `location_sharing` (Siempre / En lo compartido / Nunca) o fantasma si `ghost_until > now()`. Tocar → sheet de miembro (gestión si sos organizer; "Salir del viaje" si sos vos).
- Feed: entradas de `activity_feed` más nuevas arriba: avatar del actor (o ícono del compañero si `actor_agent`), `payload.summary`, tiempo relativo ("hace 2 min"); si es tuya, tiene `undo_token` y no fue deshecha → "Deshacer". `busy_changed` no se muestra.
- **Vacío** (solo vos): "Estás solo en este viaje" + ilustración + "Invitar a alguien". Feed vacío: "Acá vas a ver lo que va pasando". **Cargando**: 3 filas skeleton. **Error**: "No pudimos cargar el grupo" + Reintentar.

### Invitar (sheet)

Opciones: "Todo el viaje" (default) o "Solo algunos tramos" (checkboxes); botones WhatsApp, QR, Copiar link, y el código grande ("K7M2QX9P") para dictarlo.

### Unirse (`app/join/[code].tsx` + "Unirme con código" en Mis viajes)

- Sin sesión: "Te invitaron a un viaje" + "Entrar con Google" (el código se guarda en AsyncStorage y se retoma después del login).
- Con sesión: llama `POST /trips/join` → "¡Estás adentro de Montevideo + Buenos Aires!" → onboarding.
- Entrada manual: input de 8 caracteres en mayúsculas + botón "Escanear QR" (`expo-camera`).
- **Cargando**: spinner "Entrando al viaje…". **Error**: código inválido → "Ese código no existe o ya no sirve. Pedile uno nuevo a quien te invitó."; red → Reintentar.

### Onboarding del viaje (4 pantallas, barra de progreso, "Saltear" siempre visible)

1. **¿Qué querés de este viaje?** chips multi: Descansar, Conocer mucho, Comer bien, Historia y cultura, Salir de noche, Naturaleza, Compras + texto opcional → `goal`.
2. **Presupuesto** por persona: input número + moneda (`base_currency` del viaje por defecto) o chip "Sin límite" → `budget_per_person` (null = sin límite). Debajo: "Sí o sí" y "Ni loco" (chips sugeridos + texto) → `must`, `avoid`.
3. **¿En qué tramos estás?** checkboxes por tramo (ciudad, fechas, color; paralelos agrupados con "elegí uno o los dos"), presugeridos. Mínimo 1 salvo seguidores.
4. **Tu ubicación en este viaje**: Siempre / Solo en lo compartido y tours (recomendado, default) / Nunca → `location_sharing`. Botón final "Listo".

- Al terminar: navega a Plan del viaje. Si se cierra a la mitad, lo guardado queda y Grupo muestra "Completá tu perfil del viaje" una vez.

## Datos

- `trips.invite_code` (unique, generado en 00). Regenerar = `update trips set invite_code = <nuevo>` (organizer, directo con RLS).
- `trip_members`: `role` ∈ organizer, traveler, follower; `trip_prefs` = `{ goal, budget_per_person, must:[], avoid:[], companions }` (`companions` = texto libre opcional "con quien viajo"); `location_sharing`; `language` (default `profiles.locale`).
- `leg_members` para participación por tramo; `block_participants` sincronizado para bloques del grupo.
- `activity_feed` kinds de 00: `member_joined`, `member_left`, `member_role_changed`, `member_legs_changed` (insertados por trigger o por la API, con `payload.summary` tipo "Ana se sumó al viaje").
- Permisos (los aplica la RLS de 00; la UI los espeja con `usePermissions` de 02):

| Acción | Organizador | Viajero | Seguidor |
| --- | --- | --- | --- |
| Ver todo el viaje (privados como Ocupado) | sí | sí | sí |
| Editar bloques | todos | de sus tramos | no |
| Agregar personal / ideas | sí | en sus tramos | no |
| Crear propuestas | sí | sí | no |
| Editar tramos/fechas, invitar, regenerar código | sí | invitar sí; resto no | no |
| Cambiar roles, sacar miembros, asignar tramos ajenos | sí | no | no |
| Elegir sus propios tramos y preferencias | sí | sí | preferencias sí |

## Herramientas y endpoints

- `POST /trips/join` `{ invite_code, legs? }` (Contratos). Con service role tras validar el JWT. Semántica:
  - No miembro → inserta `trip_members` (`traveler`) + `leg_members` (los de `legs`, o todos si no viene) + sincroniza `block_participants` + `activity_feed` `member_joined`.
  - Ya miembro y viene `legs` → reemplaza sus `leg_members` por esos (lo usa el paso 3 del onboarding) + `member_legs_changed`.
  - Respuesta: `{ ok:true, data:{ trip_id, role, already_member, legs:[{ id, city, country, start_date, end_date, member_count, suggested }] } }`.
- Gestión de miembros: escrituras directas a Supabase con RLS (no son acciones del agente): `update trip_members set role`, `delete from trip_members`, `insert/delete leg_members`, `update trips set invite_code`. Trigger `trip_members_guard`: solo organizer cambia `role`; nunca 0 organizers. Trigger en `leg_members` sincroniza `block_participants` de los bloques del grupo y escribe `activity_feed`.
- Preferencias propias: `update trip_members set trip_prefs, location_sharing, language where user_id = auth.uid()` (directo, RLS de 00).
- Feed: "Deshacer" llama `POST /tools/undo` (00).

## Notas técnicas

- Link de invitación: WhatsApp solo vuelve tocables los links `https`, así que el link es `https://<API>/j/<invite_code>` (ver PROPUESTA). Esa página (HTML mínimo servido por Hono) intenta abrir `<scheme>://join/<code>` y muestra el código grande + instrucciones si no hay app. Universal Links / App Links quedan fuera (requieren dominio y AASA).
- Deep link en la app: Expo Router resuelve `<scheme>://join/<code>` a `app/join/[code].tsx`. Probar arranque en frío y en caliente (`Linking.getInitialURL` lo maneja Router).
- WhatsApp: `Linking.openURL('https://wa.me/?text=' + encodeURIComponent(msg))` con msg "Sumate a nuestro viaje Montevideo + Buenos Aires: \<link\> (código K7M2QX9P)". Si no hay WhatsApp, `Share.share`.
- QR: `react-native-qrcode-svg` (usa `react-native-svg`, ya en el dev build) con el link https; tamaño 280 pt, margen blanco. Escaneo: `expo-camera` `CameraView` con `barcodeScannerSettings={{ barcodeTypes: ['qr'] }}`; extraer el código de `/j/<code>` o aceptar el código pelado. Permiso de cámara pedido al tocar "Escanear".
- Invitación a tramos específicos: el link lleva `?legs=<id1>,<id2>`; se pasa a la app y preselecciona en el onboarding (y se manda en `legs` al confirmar el paso 3).
- Login diferido: guardar `pendingInviteCode` en AsyncStorage antes del login y consumirlo en el `onAuthStateChange` (`SIGNED_IN`).
- Sync en vivo: `trip_members` y `leg_members` no están en la publicación Realtime de Contratos; Grupo y Plan se refrescan con los eventos de `activity_feed` (`member_*`), que sí está. No agregar polling.
- Sincronía de participantes (trigger `sync_group_block_participants` en `leg_members`): al insertar, agregar al usuario en bloques no privados del tramo cuyos participantes == miembros del tramo antes del alta; al borrar, quitarlo de los no privados del tramo (los bloques donde quede sin participantes se mantienen con los demás; si era el único, el bloque queda como estaba).
- Códigos: 8 caracteres sin ambiguos (00); comparar en mayúsculas y sin espacios.
- Orden sugerido: `POST /trips/join` + trigger de participantes → pantalla unirse (código manual) → Grupo (miembros + feed) → invitar (copiar/WhatsApp/QR) → `/j/:code` + deep link → onboarding → gestión → escaneo QR.

### PROPUESTA DE CAMBIO A CONTRATOS

- `GET /j/:invite_code`: página web mínima que redirige al deep link de la app y muestra el código como fallback. Necesaria porque WhatsApp no hace tocables los esquemas propios.
- `POST /trips/join`: campo opcional `role: 'traveler' | 'follower'` (nunca `organizer`) para que el link pueda invitar como seguidor; y respuesta con `legs` y `already_member` como se describe arriba.

## Fuera de alcance

- Seguidor por web sin app (`GET /public/trips/:share_id`).
- Ubicación en vivo efectiva, modo fantasma y "¿dónde están todos?" (PRD 13); acá solo se guarda la preferencia.
- Presencia/cursores, chat del grupo, votaciones, gastos, notificaciones push de "se unió".
- Onboarding general de perfil por voz (~2 min).

## Dependencias

- 00 (RLS por rol, `invite_code`, `activity_feed`, `undo`, deep link `scheme`, `react-native-svg` y `expo-camera` en el dev build). Integra con 01 (`participants_hint`) y 02 (`usePermissions`).

## Cómo probarlo

1. Juan (iPhone) → Grupo → Invitar → WhatsApp → mandarse el link a Leo.
2. Leo (Android, sesión cerrada) toca el link en WhatsApp → abre la app → "Entrar con Google" → "¡Estás adentro!" → onboarding: Comer bien → Sin límite + "ni loco: madrugar" → tramos (Colonia presugerido si el plan lo nombró) → "Solo en lo compartido". Medir ≤ 30 s.
3. En el iPhone, sin tocar nada: el feed dice "Leo se sumó al viaje" y su avatar aparece en los bloques del grupo de sus tramos en ≤ 2 s.
4. Juan muestra el QR; Ana lo escanea desde "Unirme con código → Escanear" y entra.
5. Juan cambia a Ana a Seguidora → en el celu de Ana desaparecen los botones de editar; forzar `POST /tools/update_block` con su JWT → 403.
6. Juan intenta pasarse a viajero siendo el único organizador → error "El viaje necesita al menos un organizador".
7. Juan regenera el código → el link viejo muestra "Ese código no existe o ya no sirve".
8. Leo toca "Salir del viaje" → desaparece de Grupo y de los bloques en el iPhone.
