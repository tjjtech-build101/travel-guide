---
nro: 7
prd: "07 · Tour en vivo"
prioridad: P0
estado: Por hacer
carril: Columna / voz / nativo
tamano: L (2-4h)
depende_de: "00, 05, 06"
resumen: "Pantalla y motor del tour en vivo: ubicación en segundo plano y geofences vía LocationProvider, estados activo/dormido con despertadores, e inyección de arrived_stop/left_route/time_warning a la sesión Realtime para que el guía hable solo."
notion_url: https://app.notion.com/p/3fc81924a5c68123b60fedbdb7e03941
---

# 07 · Tour en vivo

## Objetivo

Que el guía **hable solo cuando llegás** a cada parada y te acompañe todo el recorrido con el celu en el bolsillo. Este PRD es el motor del tour en vivo: consume `LocationProvider` (real o simulado), detecta llegadas y desvíos, maneja los estados activo/dormido, inyecta eventos `[EVENTO:<tipo>]` en la sesión de voz de PRD 05 y muestra la pantalla de tour (minimizable a la barra de llamada).

## Momento de la demo

Acto 2 — el núcleo: replay del paseo grabado con GPS simulado (PRD 09). El puntito llega a la Puerta de la Ciudadela, suena el haptic y el guía arranca a narrar sin que nadie toque nada. Alguien lo interrumpe con una pregunta y responde. Más adelante salta "quedan 30 minutos" y el guía propone recortar paradas.

## Historias de usuario

- Como viajero, toco "Empezar" y me guardo el celu: cuando llego a cada parada el guía me cuenta qué mirar.
- Como viajero, si me quedo en una parada, el guía me ofrece contarme más; si sigo de largo, no me retiene.
- Como viajero, si me desvío, el guía me pregunta si volvemos o exploramos.
- Como viajero con poco tiempo, el guía me avisa cuánto queda y propone saltear paradas para llegar a horario.
- Como viajero, aprieto el botón del auricular (o el de la pantalla) y el guía me escucha.
- Como grupo con un solo celu, el tour arranca cuando llegamos a la primera parada y nos habla a todos.
- Como viajero, el guía no me repite una historia que ya me contó.

## Criterios de aceptación

- [ ] "Empezar" llama a `start_tour`, abre la sesión con `POST /voice/session { mode: 'tour', tour_id, trip_id? }` y deja `tours.status='active'`.
- [ ] El primer inicio de tour de la vida del usuario pide ubicación "mientras se usa" y después "siempre", con una pantalla previa que explica para qué. Si niega "siempre", el tour funciona con la app abierta y muestra un banner fijo.
- [ ] Llegada: con GPS simulado, `[EVENTO:arrived_stop]` se inyecta ≤3 s después de entrar al radio (`geofence_radius_m`); con GPS real, ≤10 s. El guía empieza a hablar ≤2 s después de la inyección (estrategia dormido = mute) o ≤5 s (estrategia = cerrar sesión).
- [ ] Histéresis: entrar al radio cuenta como llegada; salir requiere superar radio + 20 m. Nunca dos `arrived_stop` para la misma parada en 5 min.
- [ ] Orden flexible: llegar a la parada 5 antes que a la 4 dispara `arrived_stop` de la 5 con `order_changed: true`; la 4 sigue pendiente.
- [ ] Desvío: estar a más de 150 m de la ruta durante ≥30 s seguidos inyecta `[EVENTO:left_route]` una sola vez; se rearma al volver a menos de 100 m.
- [ ] Reloj: se inyecta `[EVENTO:time_warning]` cuando quedan 30 min y 10 min del tour, y cada vez que el tiempo estimado para terminar supera el restante en más de 5 min (como máximo una vez cada 10 min). El payload incluye `suggest_skip`.
- [ ] Profundidad por permanencia: si el usuario sigue dentro del radio 90 s después de terminada `narration_short`, el guía ofrece `narration_more`; a los 4 min, `narration_secret` (si no se contó antes).
- [ ] No repetir: cada capa narrada escribe `content_told (user_id, place_id, layer)` para cada participante; una capa ya contada no se vuelve a narrar entera (el guía la resume en 1 frase o la saltea).
- [ ] Pantalla bloqueada, celu en el bolsillo, GPS real: `arrived_stop` se dispara y se escucha audio en iOS y Android (probado en ambos).
- [ ] Despertadores: geofence, botón del auricular (play/pausa), botón "Hablar" en pantalla, botón de cámara y eventos de tiempo despiertan al guía desde dormido en ≤2 s (mute) o ≤5 s (cerrar sesión).
- [ ] Pasa a dormido solo: 20 s después de la última respuesta del guía sin voz del usuario.
- [ ] Silencio inteligente: sin intervenciones proactivas (salvo `arrived_stop`) con menos de 90 s entre sí; ninguna si la velocidad supera 2,5 m/s por más de 20 s (va en un vehículo); se pausan ante una llamada telefónica entrante.
- [ ] Grupo en un celu: `voice_sessions.participants` tiene a todos; el guía no narra hasta el primer `arrived_stop` (estado "Esperando en el punto de inicio").
- [ ] Minimizar la pantalla de tour la deja en la barra de llamada de PRD 05 con "Tour · próxima: Cabildo · 3 min"; tocarla vuelve a la pantalla de tour en ≤300 ms.
- [ ] "Terminar" o la última parada visitada: `tours.status='done'`, se cierra la sesión con `POST /voice/session/:id/end` y se muestra el resumen.
- [ ] Batería: 60 min de tour real con pantalla bloqueada consumen ≤15% en un iPhone de los últimos 3 años (medido una vez).

## Pantallas y estados

**Pantalla de tour** (`app/tour/[id].tsx`):

- Mapa Mapbox (`@rnmapbox/maps`) con la línea de la ruta, marcadores numerados (visitada = gris, actual = resaltada, próxima = con pulso) y el puntito del usuario dibujado desde `LocationProvider` (no usar el componente de ubicación de Mapbox: no vería el modo simulado).
- Arriba: próxima parada + distancia + minutos a pie; chip "Quedan 38 min".
- Abajo: botón de cámara grande (≥72 pt, abre PRD 08), botón "Hablar", menú con "Saltar parada" y "Terminar".
- Transcript plegable (últimas 3 líneas visibles, se expande).
- Indicador de estado del guía: Hablando / Escuchando / Dormido.
- Botón minimizar → barra de llamada (PRD 05).

**Estados:**

- Cargando: el tour está `generating` → tarjeta de progreso de PRD 06.
- Esperando inicio: "Caminen hasta la parada 1 (Plaza Independencia, 120 m)".
- Activo / Dormido.
- Desviado: banner "Te alejaste de la ruta" con "Volver" (navegación a la parada pendiente más cercana) y "Explorar" (pausa el tour).
- Terminado: resumen (paradas visitadas y salteadas, km, minutos) + "Ver en el diario".
- Error de GPS: precisión peor que 50 m durante 20 s → banner "GPS débil, sigo intentando".
- Error de voz: sesión caída → banner "Reconectando al guía…" con 3 reintentos (1 s, 3 s, 8 s) y después "Reintentar". El tour (geofences, mapa) sigue funcionando sin voz.
- Permiso negado: explicación + botón a Ajustes.
- Vacío: tour sin paradas → "Este tour no tiene paradas" + volver.

## Datos

Tablas: `tours`, `tour_stops`, `place_library`, `content_told`, `voice_sessions`, `profiles` (`quiet_hours` no aplica en tour), `blocks` (bloque `tour`).

**Estado en el cliente** (`apps/mobile/src/tour/useTourEngine.ts`, Zustand): `{ tourId, status: 'waiting' | 'active' | 'dormant' | 'off_route' | 'done', currentStopId, visited: Record<stopId, { arrivedAt, leftAt?, layersTold: string[] }>, skipped: string[], startedAt, endsAt }`. Se persiste en AsyncStorage para sobrevivir a que el sistema mate la app.

**Valores de `content_told.layer`**: `short`, `more`, `secret`, `myth`, `photo`, `kid`, `transition`.

**Payloads de eventos** (formato de Contratos, mensaje de sistema `[EVENTO:<tipo>] <json>`):

```javascript
[EVENTO:arrived_stop] {"stop_id":"…","place_id":"…","name":"Puerta de la Ciudadela","sort_order":3,"order_changed":false,"layers_told":[],"remaining_min":52,"pending_stops":7,"participants":["Juan","Ana"]}
[EVENTO:left_route] {"distance_m":170,"off_route_s":32,"nearest_pending_stop":{"stop_id":"…","name":"Cabildo","distance_m":260}}
[EVENTO:time_warning] {"remaining_min":30,"pending_stops":4,"est_needed_min":41,"suggest_skip":[{"stop_id":"…","name":"Museo Torres García","saves_min":7}]}
```

## Herramientas y endpoints

Herramientas de tour (nombres de Contratos; input Zod en `packages/shared/tools/tour.ts`). Las llama el modelo de voz vía PRD 05 y también la UI.

- `start_tour` `{ tour_id }` → marca `active`, devuelve tour + paradas + `persona`.
- `tour_status` `{ tour_id }` → parada actual, próxima, minutos restantes, visitadas, salteadas, ETA a pie a la próxima (`route_eta`). La app manda su estado local en el body para que sea la verdad (ver propuesta).
- `get_stop_content` `{ stop_id, layer }` → `{ text, sources, already_told }` y escribe `content_told` para los participantes de la sesión.
- `next_stop` `{ tour_id }` → marca la actual como visitada y devuelve la siguiente con `nav_to_next` y `transition_to_next`.
- `skip_stop` `{ tour_id, stop_id }` → la marca salteada (usado también al aceptar un `time_warning`).
- `route_eta` (PRD 00) para "Volver" y la ETA.
- `POST /voice/session` y `POST /voice/session/:id/end` (PRD 05).

**Inyección de eventos:** usar el helper de PRD 05 (p. ej. `voice.injectEvent(type, payload)`), que hace `conversation.item.create` con un mensaje de rol `system` cuyo texto es `[EVENTO:<tipo>] <json>`, seguido de `response.create`. El prompt del guía (PRD 05) define cómo reaccionar; este PRD agrega al prompt del modo `tour` las reglas de abajo.

**Reglas para el prompt del guía en modo tour** (se agregan en el armado de instrucciones de `/voice/session`):

- `arrived_stop`: si `layers_told` está vacío, pedir `get_stop_content(layer:'short')` y narrarla + `look_at`. Si ya se contó, ofrecer la siguiente capa.
- Al salir de una parada: `next_stop` y narrar `transition_to_next`; después `nav_to_next` en frases cortas ("doblamos a la derecha en la esquina").
- `left_route`: preguntar "¿volvemos a la ruta o exploramos un rato?". Volver = guiar a `nearest_pending_stop`. Explorar = callarse hasta el próximo despertador.
- `time_warning`: decir el tiempo restante y proponer saltear lo de `suggest_skip`; si acepta, `skip_stop`.
- Nunca inventar datos: solo lo que viene de `get_stop_content` o fuentes; si no sabe, decirlo.

## Notas técnicas

**Ubicación y geofences**

- Todo consume `LocationProvider` (PRD 00, implementación simulada en PRD 09). La detección de llegada se hace en JS (haversine contra paradas pendientes) sobre cada muestra; así el modo real y el simulado se comportan igual.
- Modo real: `Location.startLocationUpdatesAsync('tour-location', { accuracy: Location.Accuracy.BestForNavigation, distanceInterval: 5, activityType: Location.ActivityType.Fitness, showsBackgroundLocationIndicator: true, pausesUpdatesAutomatically: false, foregroundService: { notificationTitle: 'Tour en curso', notificationBody: 'Tu guía te avisa al llegar a cada parada' } })` con `TaskManager.defineTask` en el scope global del módulo (no dentro de un componente).
- Además, `Location.startGeofencingAsync('tour-geofences', regions)` como respaldo para despertar la app si iOS suspende las actualizaciones. Ojo: iOS monitorea máx. 20 regiones y su precisión efectiva es de ≈100 m, por eso no es la fuente principal.
- Config: plugin `expo-location` con `isIosBackgroundLocationEnabled: true` e `isAndroidBackgroundLocationEnabled: true`; `UIBackgroundModes: [location, audio]`; en Android 14, `foregroundServiceType` `location|microphone` y permisos `FOREGROUND_SERVICE_LOCATION` y `FOREGROUND_SERVICE_MICROPHONE`. El servicio con micrófono tiene que arrancar con la app en primer plano.
- Permisos: `requestForegroundPermissionsAsync()` y después `requestBackgroundPermissionsAsync()`. En Android 11+ el "siempre" se elige en Ajustes: mostrar pantalla previa y abrir `Linking.openSettings()`.
- Distancia a la ruta: usar `tours.route` si existe (ver propuesta de PRD 06); si no, la polilínea de segmentos rectos entre paradas pendientes. En Ciudad Vieja alcanza con el umbral de 150 m.

**Voz: dormido y despertadores**

- Estrategia por flag `TOUR_SLEEP_STRATEGY`: `mute` (default: sesión abierta, pista del micrófono con `enabled=false`) o `close` (cerrar la sesión y reabrir con resumen). Medir la latencia de las dos el sábado temprano y dejar la mejor.
- Botón del auricular: `react-native-track-player` con una pista silenciosa en loop para ser "now playing" y escuchar `Event.RemotePlay`, `Event.RemotePause` y `Event.RemoteTogglePlayPause` (Remote Command Center en iOS, MediaSession en Android). **Riesgo:** puede pelearse con la sesión de audio de WebRTC (`playAndRecord`). Timebox de 45 min; si no anda, queda solo el botón en pantalla y la notificación fija.
- Eventos de tiempo: un intervalo de 15 s en el motor calcula restante y necesario (ETA a pie de las pendientes + 4 min por parada, o `dwell_min` si existe).
- Profundidad por permanencia: no hay un tipo de evento para "sigue acá" (ver propuesta). Mientras tanto, despertar al guía con `arrived_stop` repetido con `layers_told` actualizado, que el prompt interpreta como "ofrecé la siguiente capa".
- Silencio inteligente: el VAD de Realtime (`server_vad`) evita pisar al usuario; además, el motor no inyecta nada mientras el usuario está hablando y espera 3 s de silencio.
- Interrupciones de audio (llamada entrante, Siri): escuchar las interrupciones de la sesión de audio y pasar a dormido.
- Mantener la pantalla encendida solo con la pantalla de tour en primer plano (`expo-keep-awake`).

**Gotchas**

- iOS no ejecuta timers de JS en segundo plano: el intervalo de tiempo solo corre si hay actualizaciones de ubicación (que despiertan la task). Con `distanceInterval: 5` caminando alcanza.
- La task de ubicación corre en un contexto sin React: escribir las muestras en un store compartido (Zustand vanilla) y emitir desde ahí.
- No llamar `start_tour` dos veces si el usuario toca rápido: debounce y estado `starting`.

**Orden de implementación sugerido:** (1) motor puro `tourEngine.ts` (sin UI) con tests: llegada, histéresis, desvío, reloj, usando un track JSON; (2) pantalla con mapa y modo simulado (PRD 09) → ya sirve para la demo; (3) inyección de eventos en PRD 05 + reglas del prompt; (4) dormido/despertadores; (5) ubicación real en segundo plano y permisos; (6) botón del auricular (timebox).

**PROPUESTA DE CAMBIO A CONTRATOS**

- `tours.progress jsonb` = `{ current_stop_id, visited: [{ stop_id, arrived_at, left_at }], skipped: [stop_id], started_at, ends_at }`. Hoy el progreso vive solo en el celu; con esto `tour_status` funciona aunque se cierre la sesión y se puede retomar desde otro dispositivo.
- Nuevo tipo de evento `[EVENTO:dwell]` `{ stop_id, dwell_s, layers_told }` para "sigue en la parada". Mientras no se apruebe, se usa `arrived_stop` repetido.
- Input de `POST /voice/session` sin cambios; se reusa `{ mode: 'tour', tour_id }`.

## Fuera de alcance

- Modo explorador / radar de historias (PRD 18).
- Llamada grupal con varios celus (LiveKit, fase 2) y "arranca cuando llega la mayoría" con varios dispositivos: acá solo grupo en un celu.
- Wake word.
- Live Activities / Dynamic Island (si sobra tiempo).
- Ubicación en vivo para el grupo (`member_locations`, PRD 13).
- Re-planificación por lluvia (PRD 12).

## Dependencias

- **PRD 00:** esquema, `LocationProvider` (interfaz), `route_eta`, Mapbox en el dev build.
- **PRD 05:** sesión Realtime, barra de llamada, helper de inyección de eventos, reenvío de function calls a `/tools/:name`, transcript.
- **PRD 06:** tour `ready` con `tour_stops` (el seed de Ciudad Vieja alcanza para empezar).
- Para probar sin caminar: PRD 09 (simulador).

## Cómo probarlo

1. Con GPS simulado (menú de debug de PRD 09), cargar el track de Ciudad Vieja, abrir el tour del día 2 y tocar "Empezar". Ver estado "Esperando inicio".
2. Play a 1x: al entrar en el radio de la parada 1 vibra y el guía habla en ≤5 s. En el transcript aparece el texto; en Supabase, filas nuevas en `content_told`.
3. Quedarse (pausa del simulador) 2 min dentro del radio → el guía ofrece contar más.
4. Saltar en el simulador a la parada 5 → llega `arrived_stop` con `order_changed: true`; la 4 sigue pendiente en el mapa.
5. Arrastrar el puntito 200 m fuera de la ruta → a los ≈30 s el guía pregunta "¿volvemos o exploramos?". Decir "volvemos" → indica la dirección de la pendiente más cercana.
6. Poner velocidad 10x → aparece `time_warning` con propuesta de saltear; aceptar por voz → la parada queda gris tachada.
7. Minimizar → barra de llamada con la próxima parada; tocarla vuelve.
8. **GPS real (iPhone y Android):** iniciar un tour corto generado alrededor de la oficina con 3 paradas a 150 m; bloquear la pantalla y caminar con auriculares. Cada llegada se escucha. Apretar play/pausa del auricular → el guía escucha.
9. Negar "siempre" en el permiso → el banner "Mantené la app abierta" aparece y el tour sigue con pantalla encendida.
