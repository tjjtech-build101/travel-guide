---
nro: 27
prd: "27 · Seguidor web sin app"
prioridad: P2
estado: Por hacer
carril: App y producto
tamano: M (1-3h)
depende_de: "04, 13"
resumen: "Página web pública de solo lectura para seguir un viaje sin instalar la app: itinerario, mapa con ubicación en vivo si se habilitó y CTA de adquisición."
notion_url: https://app.notion.com/p/3fc81924a5c6819db19afe332958b3f1
---

# 27 · Seguidor web sin app

## Objetivo

Que familia y amigos sigan el viaje desde un link de WhatsApp, sin instalar nada: itinerario del día, mapa y (si el viajero lo habilitó) dónde está ahora. Cada visita es una oportunidad de adquisición.

## Momento de la demo

Acto 2: en la laptop proyectada está abierto el link público; el punto de Juan se mueve por Ciudad Vieja (GPS simulado) mientras el tour avanza en su celu. Abajo: "Planificá tu propio viaje".

## Historias de usuario

- Como organizador, quiero compartir un link para que mi familia vea el viaje sin crear cuenta.
- Como familiar, quiero ver qué hacen hoy y dónde están (si lo permitieron).
- Como viajero, quiero que mi ubicación solo aparezca si yo lo habilité y que lo privado se vea como "Ocupado".
- Como visitante, quiero bajarme la app para mi propio viaje.

## Criterios de aceptación

- [ ] El organizador activa "Link para seguir el viaje" en ajustes del viaje → se genera un `share_id` aleatorio (12 caracteres, nanoid) y se ofrece compartir por WhatsApp/QR. Desactivar lo pone en `null` y el link responde 404.
- [ ] `GET /public/trips/:share_id` con `Accept: text/html` devuelve una página server-rendered (Hono JSX) liviana; con `Accept: application/json` o `?format=json` devuelve los datos con el esquema Zod `PublicTripSchema` (lista blanca de campos).
- [ ] Muestra: título, portada, tramos con ciudad y fechas, día de hoy por defecto (o el primero si el viaje no empezó) con bloques (hora, título, lugar), selector de días, ruta del día y pins en un mapa.
- [ ] Bloques `is_private` aparecen como "Ocupado" sin lugar. Nunca se exponen: `notes`, costos, gastos, `booking_url`, votaciones, propuestas, memorias, emails.
- [ ] Personas: solo nombre de pila de `profiles.display_name` + avatar.
- [ ] Ubicación en vivo de un miembro solo si se cumplen todas: `trips.status='active'`, `share_location_with_followers=true`, `location_sharing` distinto de `never`, `ghost_until` nulo o vencido, y si es `shared_only`, que esté en un bloque compartido o tour en curso. Se muestra "hace X min" y se oculta si `updated_at` tiene más de 15 min.
- [ ] La página refresca ubicaciones cada 15 s pidiendo el JSON.
- [ ] Con `trips.status='finished'`: sin ubicaciones; si existe Wrapped (PRD 24), se muestra arriba.
- [ ] CTA fijo abajo: **Seguilo desde la app** (deep link; si no está instalada, store) y **Planificá tu propio viaje** (store con `?ref=share`).
- [ ] Open Graph (`og:title`, `og:image` = portada, `og:description` = "Seguí el viaje de Juan por Montevideo y Buenos Aires") para preview en WhatsApp.
- [ ] `noindex`, rate limit 60 req/min por IP, `Cache-Control: public, max-age=10` en el JSON.
- [ ] Responsive en celu (360 px) y desktop; idioma ES/EN por `Accept-Language`.

## Pantallas y estados

- **Web**: header (portada, título, fechas, avatares), mapa (Mapbox GL JS) con ruta del día y puntos en vivo, lista del día, selector de días, CTA fijo.
    - Estados: viaje en planificación ("Arranca el 18/10", sin mapa en vivo) / en curso / terminado / link inválido o desactivado (404 amable con CTA) / sin ubicaciones compartidas (mapa sin puntos y texto "Nadie comparte su ubicación ahora").
- **App**: en Ajustes del viaje, toggle "Link para seguir el viaje" (solo organizador) con Copiar / WhatsApp / QR; en Perfil del viaje de cada miembro, toggle "Mostrar mi ubicación a seguidores" (`share_location_with_followers`).

## Datos

- Lee: `trips`, `legs`, `days`, `blocks` (con la regla de `blocks_visible` para privados), `trip_members`, `profiles` (`display_name`, `avatar_url`), `member_locations`, `agent_jobs` (Wrapped).
- **PROPUESTA DE CAMBIO A CONTRATOS:** columna `trips.share_id text unique null` (null = link desactivado). Distinta de `invite_code`, que da membresía.

## Herramientas y endpoints

- `GET /public/trips/:share_id` (Contratos). Sin auth.
- Activar/desactivar el link: update directo de `trips.share_id` desde la app con supabase-js; RLS solo permite al `organizer`.

## Notas técnicas

- El endpoint usa service role, así que la privacidad se garantiza con una única función `getPublicTrip(share_id)` que aplica las reglas de arriba y valida la salida con `PublicTripSchema` (nada fuera de la lista blanca llega al cliente). Test unitario que falla si aparece un campo nuevo.
- Único polling permitido del sistema: la web anónima no tiene sesión de Supabase Realtime. La app sigue sin hacer polling.
- Mapbox GL JS con token público (`pk.`) restringido por URL al dominio de la API.
- Horas en la zona horaria del destino del tramo.
- Página sin framework JS: HTML + un script inline para el mapa y el refresco.

## Fuera de alcance

Comentar o reaccionar, chat, notificaciones a seguidores web, unirse al viaje desde la web, login web, ver gastos o diario personal, SEO.

## Dependencias

- PRD 04: viaje multiplayer, roles y ajustes del viaje.
- PRD 13: ubicación en vivo (`member_locations`, `location_sharing`, modo fantasma).

## Cómo probarlo

1. Como Juan (organizador), activar el link → abrir en una ventana de incógnito → se ve el itinerario del día.
2. Marcar un bloque de Ana como privado → en la web aparece "Ocupado" sin lugar.
3. Juan habilita "Mostrar mi ubicación a seguidores", arranca el replay simulado del tour → el punto se mueve en la web cada 15 s.
4. Juan activa modo fantasma → el punto desaparece en el siguiente refresco.
5. `curl -H 'Accept: application/json'` → revisar que no hay `notes`, costos ni emails.
6. Desactivar el link → 404.
7. Pegar el link en WhatsApp → preview con portada y título.
