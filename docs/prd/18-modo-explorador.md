---
nro: 18
prd: '18 · Modo explorador / "Tour acá, ahora"'
prioridad: P1
estado: Por hacer
carril: Cerebro y contenido
tamano: L (2-4h)
depende_de: '06, 07'
resumen: 'Desde donde estés, un botón arma un tour espontáneo con fuentes o activa un radar de historias cercanas que el guía narra al acercarte, alimentando la biblioteca global de lugares.'
notion_url: https://app.notion.com/p/3fc81924a5c68157b7b6d5d60271c85b
---

# 18 · Modo explorador / "Tour acá, ahora"

## Objetivo
Dos modos sin planificación previa: **"Tour acá, ahora"** (`tours.mode='spontaneous'`: recorrido en loop de 4–8 paradas desde tu posición) y **modo explorador** (`tours.mode='explorer'`: sin ruta fija, radar de historias cercanas; el guía te habla al acercarte). Contenido con fuentes y verificación en 2 pasadas; lo investigado queda en `place_library` para el próximo.

## Momento de la demo
Acto 3, en vivo en FIUM: Juan toca "Explorar acá". En ≤30 s el radar muestra 5 historias a menos de 600 m. Camina hacia una; al entrar al geofence el guía arranca solo. Pregunta algo que no está en las fuentes → "Eso no lo tengo verificado; ¿lo busco?".

## Historias de usuario
- Como turista sin plan, quiero un tour de 1 hora desde donde estoy, ya.
- Como paseante, quiero ver qué historias hay cerca y que el guía me hable cuando me acerco.
- Como viajero, quiero que lo que me cuente tenga fuente y que admita cuando no sabe.
- Como viajero que se queda mirando algo, quiero que me cuente más.

## Criterios de aceptación
- [ ] Botón "Tour acá, ahora" en Mapa y en Ahora (PRD 19) abre una hoja: duración 30 / 60 / 90 min, temas (historia, arquitectura, comida, curiosidades, para chicos), modo Recorrido o Explorar.
- [ ] Espontáneo: 4 / 6 / 8 paradas para 30 / 60 / 90 min; arranca a ≤150 m de la posición; caminata total ≤50% de la duración (`route_eta` a pie); termina a ≤300 m del inicio.
- [ ] La primera parada narrable está lista en ≤30 s y el tour completo en ≤90 s; `tours.status` pasa `generating` → `ready` y las paradas aparecen de a una por Realtime.
- [ ] Explorador: crea `tour_stops` con hasta 20 lugares en 600 m ordenados por afinidad con `profiles.interests` y distancia; primeras 5 en ≤30 s.
- [ ] Al alejarse más de 400 m del último punto de extensión, la app llama `generate_tour {mode:'explorer', extend_tour_id}` y agrega paradas nuevas sin duplicar `place_id`.
- [ ] Al entrar al `geofence_radius_m` de una parada se dispara `[EVENTO:arrived_stop]` (mismo flujo del PRD 07) y el guía narra la capa corta.
- [ ] Profundidad por permanencia: ≥90 s dentro del geofence → ofrece `narration_more`; ≥240 s → ofrece `narration_secret`.
- [ ] Todo hecho narrado proviene de `place_library.facts` con `verified=true`; si no hay, el guía lo dice y ofrece buscar. 0 fechas/nombres/cifras sin fuente en 10 narraciones revisadas.
- [ ] Lo investigado se guarda en `place_library` con `tier='researched'` (dedupe por `google_place_id`); repetir la generación en la misma zona tarda ≤10 s.
- [ ] Cada parada muestra "Fuentes" con ≥1 link.

## Pantallas y estados
- **Hoja "Tour acá, ahora"**: duración, temas, modo, botón Empezar.
- **Radar (explorador)**: mapa con puntos de historias (color por tier: curado / investigado), lista inferior ordenada por distancia con flecha de rumbo y "a 120 m"; tocar → vista previa de la historia (título + "qué mirar").
- **Recorrido (espontáneo)**: reutiliza la pantalla de tour del PRD 07.
- Cargando: progreso del job en vivo ("Buscando lugares cerca…", "Verificando 3 datos…") y paradas que aparecen. Vacío: "No encontré historias verificadas acá cerca" + ampliar radio a 1.2 km. Error: "No pude armar el tour" + Reintentar.

## Datos
- `tours` (mode `spontaneous` / `explorer`, owner_user_id, persona_id, start_lat, start_lng, duration_min, status), `tour_stops` (place_id, sort_order, geofence_radius_m, look_at, narration_short/more/secret, sources), `place_library` (tier, facts `[{text, source_url, verified}]`, geo, base_lang), `content_told`, `agent_jobs` (kind `generate_tour`).
- En explorador `sort_order` = orden por puntaje al generar (no implica ruta).

## Herramientas y endpoints
- `generate_tour` input `{mode:'spontaneous'|'explorer', lat, lng, duration_min?, themes?, radius_m?, extend_tour_id?, trip_id?}` → `{job_id, tour_id}`.
- `start_tour`, `tour_status`, `get_stop_content`, `next_stop`, `skip_stop` (PRD 07). En explorador `next_stop` devuelve la parada no contada más cercana.
- Internas del job: `search_places` (tipos: historical_landmark, tourist_attraction, church, museum, monument, plaza), `place_details`, `route_eta`.

## Notas técnicas
- Pipeline por lugar: 1) buscar en `place_library` por `geo` (PostGIS `ST_DWithin`); 2) si no está, investigar con `claude-opus-5-5` esfuerzo `medium` + web search/fetch → facts con `source_url`; 3) **segunda pasada** independiente que relee la fuente y marca `verified`; 4) narración en 3 capas con esfuerzo `high` usando solo facts verificados.
- Paralelizar por lugar (hasta 5 a la vez) e insertar cada `tour_stop` apenas está listo.
- Para la demo en FIUM: correr una vez antes ("precalentar") para que la zona quede en `place_library`.
- Persona: guía local de la ciudad (PRD 15) o el compañero si no existe.

## Fuera de alcance
Tours comunitarios, rutas en bici/auto, AR, trama/storyline en espontáneos, contenido offline.

## Dependencias
06 (generación de tours y verificación), 07 (tour en vivo, geofences, `LocationProvider`).

## Cómo probarlo
1. Simulado en Ciudad Vieja → "Tour acá, ahora" 60 min → 6 paradas, loop, caminata ≤30 min.
2. Explorar desde una zona sin contenido (ej. coordenadas de FIUM) → 5 historias en ≤30 s con fuentes; repetir → ≤10 s.
3. Replay de track que entra a un geofence → narración automática; quedarse 90 s → ofrece más.
4. Mover el simulado 500 m → aparecen paradas nuevas sin duplicados.
5. Revisar 10 narraciones contra `facts` → 0 datos sin fuente.
