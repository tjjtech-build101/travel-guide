---
nro: 13
prd: "13 · Ubicación en vivo + privacidad + encuentros + rezagados"
prioridad: P1
estado: Por hacer
carril: Columna / voz / nativo
tamano: L (2-4h)
depende_de: "04, 07"
resumen: "Compartir ubicación por viaje con opt-in y modo fantasma, ver dónde está el grupo, armar encuentros con punto de reencuentro y avisar rezagados."
notion_url: https://app.notion.com/p/3fc81924a5c68118aca6d9a66cf1cbdc
---

# 13 · Ubicación en vivo + privacidad + encuentros + rezagados

## Objetivo

Ubicación en vivo del grupo con privacidad fuerte: opt-in por viaje (siempre / solo bloques compartidos y tours (default) / nunca), modo fantasma temporal, apagado automático al terminar el viaje. Sobre eso: capa de participantes en el mapa, "¿dónde está todo el mundo?", encuentros con llegada detectada y aviso de rezagado. Todo consume `LocationProvider` (real o simulado).

## Momento de la demo

Acto 2: con GPS simulado, Ana aparece moviéndose en el mapa de Juan. Juan pregunta "¿dónde están todos?" → "Ana está a 200 m, llega en 3 min; Leo no comparte ubicación". Leo viene tarde al encuentro en la Plaza Matriz → al celu de Juan le llega "Leo viene 8 min tarde" y el guía lo menciona.

## Historias de usuario

- Como viajero, quiero elegir cuándo comparto mi ubicación y poder desaparecer un rato sin dar explicaciones.
- Como organizador, quiero ver dónde está cada uno y cuánto le falta para llegar.
- Como grupo, quiero que el agente proponga un punto de reencuentro cómodo para todos.
- Como viajero atrasado, quiero que se avise solo al resto.
- Como seguidor (familia), quiero ver la ubicación solo si me la habilitaron.

## Criterios de aceptación

- [ ] El permiso de ubicación se pide recién al activar compartir, al empezar un bloque compartido o un tour (no en el onboarding). Background ("Siempre") se pide solo si elige "siempre".
- [ ] Ajustes del viaje: 3 opciones de `location_sharing` + modo fantasma 1 h / 3 h / hasta mañana 8:00 (`ghost_until`) + switch `share_location_with_followers`.
- [ ] Publicación: upsert en `member_locations` cada 15 s o 25 m (lo primero) en foreground; cada 60 s o 50 m en background. Incluye heading, speed, accuracy, battery.
- [ ] Si no corresponde compartir (`never`, fantasma activo, `shared_only` fuera de bloque compartido/tour activo, viaje `finished`) no se publica y la fila propia se borra en ≤5 s.
- [ ] Otros miembros ven el punto en la capa "participantes en vivo" ≤3 s después del upsert; con más de 10 min sin actualizar se ve gris "hace X min".
- [ ] Un seguidor solo ve ubicaciones de miembros con `share_location_with_followers=true` (RLS; probado con su JWT).
- [ ] `where_is_everyone` responde en ≤3 s para 6 miembros: por miembro visible `{user_id, name, lat, lng, updated_at, distance_m, eta_min, battery}` (ETA a pie con `route_eta` al próximo bloque compartido o `meetup`); los no visibles aparecen como "no comparte" sin coordenadas.
- [ ] `create_meetup` crea un bloque `type='meetup'` con participantes; sin lugar dado, calcula el centroide de los participantes visibles y devuelve 3 opciones (café o plaza) con `search_places` y ETA de cada uno.
- [ ] Llegada: participante a ≤50 m del meetup → `activity_feed` kind `member_arrived` y el resto ve "Ana llegó".
- [ ] Rezagado: en T-10 min y T+5 min el celu de cada participante calcula su propio ETA; si ETA es mayor que el tiempo restante + 5 min → `notify_member` al resto ("Leo viene ~8 min tarde") con feed kind `member_late`; máximo 1 aviso por persona por meetup cada 10 min.
- [ ] Cada celu con sesión de voz activa que recibe un `member_late` por Realtime inyecta `[EVENTO:member_late]` y el guía lo menciona en 1 frase.
- [ ] Al pasar el viaje a `finished` se borran todas sus filas de `member_locations` y se detiene la tarea de background.

## Pantallas y estados

- **Ajustes del viaje → Ubicación**: 3 opciones + fantasma + seguidores, con texto claro de qué ve cada uno.
- **Mapa, capa "En vivo"**: avatares con anillo de color por frescura, heading como flecha, batería baja (menos de 15%) con ícono.
- **Hoja "¿Dónde están?"**: lista con distancia, ETA, última actualización; acción "Proponer reencuentro".
- **Encuentro**: tarjeta con lugar, hora, quién llegó / quién viene / quién no comparte.
- Vacío: "Nadie está compartiendo ahora". Cargando: skeleton. Error/permiso denegado: banner "Sin permiso de ubicación" + Abrir ajustes. Fantasma activo: chip "Fantasma hasta 18:30" en tu avatar.

## Datos

- `trip_members.location_sharing`, `ghost_until`, `share_location_with_followers`; `member_locations` (solo última posición, PK `trip_id,user_id`); `blocks` `type='meetup'` + `block_participants`; `activity_feed` kinds `member_arrived`, `member_late`, `member_notified`; `trips.status`.
- RLS `member_locations`: insert/update/delete solo la propia fila; select para miembros del viaje con rol organizer/traveler, y para follower solo filas cuyo dueño tiene `share_location_with_followers=true`.

## Herramientas y endpoints

- `where_is_everyone` input `{trip_id}`.
- `create_meetup` input `{trip_id, leg_id, day_id, start_time, participant_ids, google_place_id?, lat?, lng?, title?}` → `{block_id}` o `{options:[{google_place_id, name, lat, lng, eta_by_user}]}` si no vino lugar.
- `notify_member` input `{trip_id, user_ids, text, kind}` → escribe `activity_feed`; el envío push lo agrega PRD 17.
- `route_eta`, `search_places` (PRD 00).

## Notas técnicas

- `LocationProvider` publica a un `LocationPublisher` que decide si compartir (reglas de arriba) y hace upsert directo a Supabase con el JWT del usuario. En modo `simulated` publica las posiciones del replay (así la demo funciona en interiores).
- Background: `expo-location` `startLocationUpdatesAsync` + `expo-task-manager`; en Android con foreground service y notificación fija (compartida con PRD 17).
- "Bloque compartido activo" = ahora entre `start_time` y `end_time` de un bloque del día donde el usuario y ≥1 persona más están en `block_participants`, o un `tour` en estado `active`.
- La detección de rezagado es del lado del celu del rezagado (tiene su ubicación); no requiere servidor programado.
- PRD 07 usa `where_is_everyone` para "el tour grupal arranca cuando llega la mayoría" (más del 50% a ≤50 m del punto de inicio).

## Fuera de alcance

Historial de recorrido, geofences de seguridad ("avisame si sale de X"), compartir con no miembros, ubicación por web del seguidor en tiempo real si PRD del seguidor web no está.

## Dependencias

04 (miembros, roles, Realtime), 07 (tour en vivo y `LocationProvider`).

## Cómo probarlo

1. Dos celus (o celu + simulador) con Juan y Ana en el seed; Ana en `simulated` reproduciendo el track de Ciudad Vieja.
2. Juan ve a Ana moverse; Ana activa fantasma 1 h → desaparece en ≤5 s; lo desactiva → vuelve.
3. "¿Dónde están todos?" por voz → respuesta con distancias y "Leo no comparte".
4. Crear meetup sin lugar → 3 opciones → elegir. Ana llega (track) → "Ana llegó".
5. Leo en simulado lejos: a T-10 → Juan recibe "Leo viene tarde" y el guía lo menciona.
6. Con JWT de seguidor, `select` a `member_locations` → solo filas habilitadas.
