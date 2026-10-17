---
nro: 3
prd: "03 · Mapa 3D"
prioridad: P0
estado: "En curso (2D mínimo hecho)"
carril: "App y producto"
tamano: "L (2-4h)"
depende_de: "00"
resumen: "Mapa 3D con @rnmapbox/maps en niveles viaje/día/tour, ramas del grupo por color, capas, vista dividida sincronizada con Plan, tocar/mantener apretado sobre lugares, arrastrar para reordenar con recálculo de tiempos y vista previa animada del día."
notion_url: https://app.notion.com/p/3fc81924a5c681d28607d7e28a54447f
---

# 🗺️ 03 · Mapa 3D

> **Estado (sáb 17/10, decisión del sábado: 2D primero):** hecho el mínimo 2D.
> - Pestaña Mapa: selector "Todo el viaje" / días (hoy por defecto, `?day=YYYY-MM-DD|trip` por deep link). Nivel viaje: un punto por tramo + líneas a los tramos siguientes (ramas paralelas). Nivel día: bloques numerados en orden (línea punteada "ruta aproximada", sin `route_eta`), chip "N sin ubicación" y paradas de los tours del día.
> - **Tocar cualquier elemento** (pin o fila) → tarjeta con **"Hablar con Scout de esto"** → `useScout().startScoutCall({ focus, tripId, context })` (stub de `src/voice/useScout.ts`, lo implementa el PRD 05). `focus` = Contratos v1.1 (`block_id` / `google_place_id` / `lat`,`lng` / `label`). Mantener apretado el mapa → focus en esa coordenada.
> - Mapbox (`@rnmapbox/maps`, ya en el dev build) **solo si hay `EXPO_PUBLIC_MAPBOX_TOKEN`**; sin token: aviso "Falta EXPO_PUBLIC_MAPBOX_TOKEN" + la lista de puntos (mismas acciones). Puck propio desde el `LocationProvider` (anda con el simulado).
> - Lógica pura en `apps/mobile/src/features/map/model.ts` (`pnpm --filter mobile test:map`).
> - Pendiente: probar el render de Mapbox con token real, 3D, capas, ficha de lugar, arrastrar, "Ver el día", vista dividida, `route_eta`.

> 📌 Fuentes: [Producto](../PRODUCT.md) · [Arquitectura](../ARCHITECTURE.md) · [Contratos](../CONTRACTS.md). Requiere PRD 00 (y comparte estado con 02).

## Objetivo

El mapa como superficie de planificación, no como adorno: ver el viaje entero, cada día y cada tour en 3D; ver las ramas del grupo por color cuando se separa; sincronizado con la línea de tiempo; tocar un lugar para agregarlo, mantener apretado para preguntar "¿qué hay acá?", arrastrar paradas para reordenar con tiempos recalculados y una vista previa animada del día.

## Momento de la demo

Acto 1: mientras `plan_trip` arma el viaje, los pines y las rutas aparecen en el mapa 3D (Ciudad Vieja con edificios en 3D); se muestran las dos ramas (Colonia y Buenos Aires) en colores; Juan arrastra el Teatro Solís antes del almuerzo y los horarios se recalculan; ▶ "Ver el día" vuela por el domingo 18. Acto 2: nivel tour con las 10 paradas y sus geofences.

## Historias de usuario

- Como viajero, veo todo el viaje en el mapa con los tramos conectados y coloreados por rama.
- Como viajero, veo un día con sus paradas numeradas y la ruta entre ellas.
- Como viajero, veo el tour con sus paradas y radios de geofence.
- Como viajero, uso la vista dividida (mapa arriba, plan abajo) y lo que toco en uno se marca en el otro.
- Como viajero, prendo y apago capas: mi ruta, grupo, una persona, ideas, sugerencias del agente, participantes en vivo, lugares guardados.
- Como viajero, toco un lugar del mapa y veo su ficha para agregarlo al día, a ideas o guardarlo.
- Como viajero, mantengo apretado un punto y le pregunto al guía "¿qué hay acá?".
- Como viajero, arrastro una parada a otro lugar del recorrido y el plan se reordena con horarios nuevos.
- Como viajero, toco ▶ y veo una animación del día.

## Criterios de aceptación

- [ ] Mapbox renderiza en iOS y Android del dev build con estilo Standard, edificios 3D y `pitch` 60 en nivel día; ≥ 50 fps al rotar en Ciudad Vieja (iPhone).
- [ ] Nivel **viaje**: 1 marcador por tramo (ciudad) + líneas entre tramos con el color de `LEG_COLORS`; tramos paralelos como dos líneas divergentes que se reúnen; la cámara encuadra todos los tramos con padding 48 px.
- [ ] Nivel **día**: bloques con coordenadas numerados en orden, línea de ruta de `route_eta` (polilíneas decodificadas), color del tramo; bloques sin coordenadas listados en un chip "3 sin ubicación".
- [ ] Nivel **tour**: las 10 `tour_stops` del seed con círculo de radio `geofence_radius_m` real (en metros, no píxeles) y numeración.
- [ ] Vista dividida: tocar una tarjeta en Plan centra el mapa en ≤ 600 ms en ese bloque; tocar un pin hace scroll a su tarjeta y la resalta. Divisor arrastrable entre 30 % y 70 %.
- [ ] Capas con toggles independientes: Mi ruta, Grupo, Persona (selector de miembro), Ideas, Sugerencias, En vivo, Guardados; el estado de capas se recuerda por viaje.
- [ ] Tocar un POI o un punto cualquiera abre la ficha en ≤ 1,5 s con nombre, rating, abierto ahora/horario de hoy, precio, distancia y minutos a pie desde mi ubicación; botones "Agregar al día", "A ideas", "Guardar".
- [ ] Mantener apretado (≥ 500 ms) → haptic + pin + sheet "¿Qué hay acá?": si PRD 05 está, abre llamada con `focus` en esas coordenadas; si no, lista de hasta 5 lugares cercanos (radio 150 m).
- [ ] Arrastrar un pin de bloque y soltarlo cerca de otro tramo de la ruta llama `move_block` con el nuevo `sort_order` y `recompute_times: true`; en ≤ 3 s los horarios nuevos se ven en mapa y Plan; toast con "Deshacer".
- [ ] "Ver el día": vuela por todas las paradas del día con una tarjeta (hora + título) en cada una, ≤ 20 s para 6 paradas; se puede cortar con un toque.
- [ ] Sugerencias: los `add` de `agent_proposals` pendientes con coordenadas se ven como pines punteados semitransparentes; los `move` como flecha.
- [ ] Participantes en vivo: avatares desde `member_locations` (lo que RLS deje ver), actualizados por Realtime en ≤ 2 s; mi posición viene del `LocationProvider` (funciona igual con `simulated`).
- [ ] Guardados: `saved_places` del usuario como estrellas; "Guardar" en la ficha inserta en `saved_places` y aparece al instante.
- [ ] Nunca se llama `route_eta` más de 1 vez por combinación de paradas en 10 min (caché por hash de ids).

## Pantallas y estados

### Mapa (`app/(app)/trip/[tripId]/map.tsx`) y modo dividido dentro de Plan

- Arriba: selector de nivel Viaje / Día / Tour (Tour solo si el día tiene bloque `tour` con `tour_id`) + selector de día (flechas ‹ › con "Dom 18 · Montevideo").
- Derecha: botón capas (sheet con toggles), botón "mi ubicación", brújula, ▶.
- Abajo: carrusel horizontal de tarjetas del día (en pantalla completa) sincronizado con los pines.
- **Vacío** (viaje sin tramos): mapa del mundo con "Todavía no hay lugares. Contale al compañero tu viaje" + CTA. **Día sin ubicaciones**: centrado en la ciudad del tramo + "Este día no tiene lugares en el mapa".
- **Cargando**: el mapa base aparece primero; pines con fade-in; spinner chico en el chip de ruta mientras `route_eta` responde.
- **Error**: si Mapbox no carga (token/red): fondo gris + "No pudimos cargar el mapa" + Reintentar; si `route_eta` falla, líneas rectas punteadas + chip "Ruta aproximada".

### Ficha de lugar (bottom sheet)

Nombre, foto no (evitar costos), rating + cantidad, abierto/cerrado ahora + horario de hoy, precio, dirección, "12 min a pie". Acciones: "Agregar al día" (elige día y franja; `type` inferido: restaurante/café/bar → `meal`, resto → `activity`), "A ideas" (`add_idea`; si no existe aún, `add_block` con `day_id=null`), "Guardar" / "Guardado", "Hablar de esto" (05). Cargando: skeleton; error: "No encontramos info de este lugar".

### ¿Qué hay acá? (sheet)

Pin + dirección aproximada + "Preguntarle al guía" (05) + lista de cercanos. Vacío: "No encontramos nada cerca. ¿Le preguntás al guía?".

## Datos

- Lee: `legs` (`lat`, `lng`, `sort_order`), `leg_members`, `days`, `blocks_visible` (`lat`, `lng`, `sort_order`, `start_time`, `type`, `status`, `day_id`), `block_participants`, `agent_proposals` (`status='pending'`, `ops`), `tours`, `tour_stops` (`sort_order`, `geofence_radius_m`) + `place_library` (`lat`, `lng`, `name`), `member_locations`, `saved_places`, `trip_members`/`profiles` (avatares).
- Escribe: `saved_places` (insert/delete propio, directo con RLS). Bloques solo vía herramientas.
- Estado compartido con Plan: `usePlanMapStore` (`legId`, `dayId`, `selectedBlockId`, `level`, `layers`) definido en PRD 02 (si 02 no existe aún, crearlo acá en `apps/mobile/src/features/plan/store.ts`).
- Colores: `LEG_COLORS` para tramos; color de persona = hash de `user_id` sobre una paleta de 8 (`MEMBER_COLORS` en `packages/shared/src/constants.ts`).

## Herramientas y endpoints

- `route_eta` (`stops` del día en orden, `mode:'walk'`; si el total > 60 min o hay tramos > 30 min, pedir `transit` para esos pares).
- `search_places` (tocar el mapa: `near` = coordenada, `radius_m` 80, `max_results` 1; mantener apretado: radio 150, `max_results` 5), `place_details` (ficha).
- `move_block` (`recompute_times: true`), `add_block`, `add_idea` (PRD 02), `undo`.
- Hook de voz (PRD 05): `useVoice().startCall({ mode: 'chat', tripId, focus: { lat, lng, label } })` o `focus: { block_id }` / `focus: { google_place_id }`.

## Notas técnicas

- Librería: `@rnmapbox/maps` (v10+, SDK Mapbox v11). Plugin en `app.config.ts`: `["@rnmapbox/maps", { RNMapboxMapsImpl: "mapbox" }]`. `Mapbox.setAccessToken(process.env.EXPO_PUBLIC_MAPBOX_TOKEN)` al iniciar. Si el build pide token secreto de descarga, setear `RNMAPBOX_MAPS_DOWNLOAD_TOKEN` (sk.*) solo en el entorno de build. Ya incluido en el dev build de 00.
- 3D: `MapView styleURL="mapbox://styles/mapbox/standard"`, `StyleImport` / config `lightPreset` (`day`, `dusk` a partir de las 19 h), `Camera` con `pitch` 0–30 en nivel viaje, 60 en día, 65 en tour; `zoomLevel` 15,5 día, 16,5 tour. Opcional `Terrain` + `Atmosphere` solo en nivel viaje.
- Rendimiento: pines de bloques e ideas con `ShapeSource` + `CircleLayer` + `SymbolLayer` (número) — no `MarkerView` (son vistas nativas, caros). `MarkerView` solo para avatares en vivo (≤ 10). Líneas con `LineLayer` (`lineColor` del tramo, `lineWidth` 4, `lineCap: 'round'`; ideas/sugerencias con `lineDasharray`). Geofences con `FillLayer` sobre círculos generados con `@turf/circle` (64 pasos).
- Polilíneas: `@mapbox/polyline` para decodificar `segments[].polyline` de `route_eta` a GeoJSON (ojo: devuelve `[lat, lng]`, GeoJSON usa `[lng, lat]`).
- Arrastrar: `PointAnnotation` con `draggable` solo para el pin seleccionado (tocar primero para "agarrarlo", así no hay cientos de vistas nativas). En `onDragEnd`, calcular el segmento de ruta más cercano al punto soltado (`@turf/nearest-point-on-line`) → nuevo índice → `move_block`. Si se suelta a > 300 m de la ruta: cancelar y volver a su lugar. Probar `draggable` en Android temprano; fallback: modo "Reordenar" con flechas ↑↓ en el carrusel.
- Tocar POI: `MapView onPress` da coordenada; intentar `queryRenderedFeaturesAtPoint` para nombre del POI; como los POI del estilo Standard pueden no ser consultables, **siempre** resolver con `search_places` (`near`, radio 80) y usar el primer resultado.
- Mantener apretado: `MapView onLongPress` + `expo-haptics` `impactAsync(Medium)`.
- Mi posición: **no usar** el `LocationPuck` nativo de Mapbox (lee GPS real); dibujar un puck propio con `ShapeSource` alimentado por `LocationProvider.subscribe` para que el modo `simulated` mueva el punto en la demo.
- Vista previa animada: secuencia con `cameraRef.setCamera({ centerCoordinate, zoomLevel: 16, pitch: 65, heading: bearing(prev, next), animationDuration: 2500, animationMode: 'flyTo' })` + pausa 1200 ms con tarjeta; un punto que recorre la polilínea actualizando un `ShapeSource` a 30 fps con `requestAnimationFrame` (interpolación con `@turf/along`). Cancelable.
- Vista dividida: en Plan, `view='split'` → `MapView` arriba y lista abajo con divisor `react-native-gesture-handler` + `reanimated`. Montar un solo `MapView` por pantalla.
- Realtime: el mapa no se suscribe aparte; usa las mismas queries de 02 (`['trip', id, ...]`) + `['trip', id, 'member_locations']`.
- Deuda (Arquitectura): mostrar datos de Google Places sobre mapa no-Google viola sus términos; OK para hackathon, anotado.
- Orden sugerido: MapView + nivel día con pines y ruta → sincronía con Plan (store) → nivel viaje y ramas → ficha al tocar → capas → nivel tour → mantener apretado → arrastrar → vista previa animada → en vivo y guardados.

## Fuera de alcance

- Publicar mi ubicación en `member_locations` y reglas de compartir (PRD 13); acá solo se dibuja lo que hay (el seed puede traer filas falsas para probar).
- Geofencing real y tour en vivo (PRD 07); acá solo se dibujan radios.
- Navegación giro a giro, modo offline, mapas de Google.

## Dependencias

- 00 (Mapbox en el dev build, herramientas, `LocationProvider`, seed con tour). Integra con 02 (store y vista dividida), 05 ("¿qué hay acá?" y "Hablar de esto") si están.
- `EXPO_PUBLIC_MAPBOX_TOKEN` (token público pk.*).

## Cómo probarlo

1. iPhone, viaje del seed → Mapa, nivel Viaje: 4 tramos, Colonia y Buenos Aires en dos colores divergiendo el 20/10 y reuniéndose el 22.
2. Nivel Día → Dom 18: pines numerados, edificios 3D en Ciudad Vieja, ruta a pie; rotar con dos dedos y ver que va fluido.
3. Nivel Tour: 10 paradas con círculos de ~35 m.
4. Plan → vista Dividida: tocar "Teatro Solís" en la lista → el mapa vuela ahí; tocar el pin del Mercado → la lista salta a esa tarjeta.
5. Tocar un café en el mapa → ficha con horario → "Agregar al día" Dom 18 tarde → aparece en Plan y en el celu de Ana.
6. Mantener apretado sobre la Plaza Matriz → haptic + sheet "¿Qué hay acá?" (con 05: arranca la llamada hablando de eso).
7. Tocar el pin del Teatro Solís, arrastrarlo antes del almuerzo → horarios recalculados en ≤ 3 s → "Deshacer" lo deja como estaba.
8. "Ver el día" → recorrido animado de ≤ 20 s; cortarlo a la mitad con un toque.
9. Capas: apagar Grupo y prender Ideas y Sugerencias → aparecen las ideas grises y la propuesta punteada del seed. "Guardar" un lugar → estrella en la capa Guardados.
10. Menú dev → `LocationProvider` simulado → el puck propio se mueve por Ciudad Vieja (requiere el replay del simulado, que no es de este PRD; si todavía no existe, verificar que el puck sigue al `RealLocationProvider` caminando unos metros).
