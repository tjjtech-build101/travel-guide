---
nro: 16
prd: '16 · Contexto: clima (Open-Meteo) y eventos (web search) en planificación y en vivo'
prioridad: P1
estado: Por hacer
carril: Cerebro y contenido
tamano: M (1-3h)
depende_de: '01'
resumen: 'El planificador y el guía usan el pronóstico de Open-Meteo y eventos encontrados con web search de Claude (con fuente) para armar el plan y avisar cambios en vivo.'
notion_url: https://app.notion.com/p/3fc81924a5c68144a7e8d8e2ecd02edf
---

# 16 · Contexto: clima (Open-Meteo) y eventos (web search) en planificación y en vivo

## Objetivo
Que el plan tenga en cuenta el clima y lo que pasa en la ciudad: pronóstico por día/hora con Open-Meteo (sin key) y eventos con web search nativo de Claude, siempre con fuente. En vivo, si se viene lluvia sobre un bloque al aire libre, el guía avisa y dispara el plan B (PRD 12).

## Momento de la demo
Acto 1: al llenarse el itinerario, cada día muestra su chip de clima y el agente agrega a ideas "Llamadas de candombe, domingo 18:00 (fuente: IM)". Acto 2: "se viene lluvia en 40 minutos" → el guía ofrece el plan B.

## Historias de usuario
- Como viajero, quiero ver qué tiempo va a hacer cada día del viaje.
- Como viajero, quiero que el plan no me mande a la playa con 80% de lluvia.
- Como viajero, quiero enterarme de eventos de esos días que me puedan gustar, con link de dónde sale.
- Como viajero en la calle, quiero que me avisen antes de que llueva.

## Criterios de aceptación
- [ ] `weather` responde en ≤1.5 s (p95) con resumen diario y horario normalizado; para fechas a más de 16 días devuelve `{available:false}` y la UI muestra "Pronóstico disponible desde el {fecha}".
- [ ] El resultado se guarda en `days.weather` con `fetched_at`; se reutiliza si tiene menos de 3 h.
- [ ] `plan_trip` / `plan_day` consultan el clima de cada día del tramo; en días con probabilidad de lluvia ≥60% en la franja del bloque, los bloques al aire libre llevan `alerts` `{kind:'rain', text}` y el planificador prioriza opciones bajo techo (≥1 bloque techado ese día).
- [ ] Chip de clima en el encabezado de cada día: ícono, máx/mín, % lluvia.
- [ ] En vivo, con la app en primer plano o tour activo, se consulta `weather` cada 30 min; si en las próximas 2 h la probabilidad es ≥60% o la precipitación ≥0.5 mm/h y hay un bloque al aire libre en esa ventana → `[EVENTO:weather_change]` a la sesión activa (o feed kind `weather_change` si no hay sesión). Máximo 1 aviso cada 2 h por día.
- [ ] `events_search` devuelve ≤10 eventos en ≤25 s, cada uno con `source_url` y fecha; se descartan los que no tienen fuente o fecha.
- [ ] El planificador agrega ≤3 eventos relevantes por tramo como ideas (`day_id` null) con `sources`.
- [ ] Por voz "¿qué hay esta noche?" usa `events_search`; mientras busca el guía dice "dejame fijarme" y después responde citando de dónde sale.
- [ ] Una segunda búsqueda igual (misma ciudad y fechas) en menos de 6 h responde desde caché en ≤1 s.

## Pantallas y estados
- Chip de clima en día y en pantalla Ahora (PRD 19); al tocarlo, detalle por hora (próximas 12 h).
- Alerta "rain" en el bloque (ícono de nube + texto).
- Ideas de eventos con badge "Evento" y link "Fuente".
- Cargando: chip con skeleton. Error/sin datos: chip gris "Sin pronóstico" (nunca bloquea el plan). Vacío de eventos: "No encontré eventos con fuente para esas fechas".

## Datos
- `days.weather` jsonb: `{fetched_at, tmax, tmin, precip_prob_max, code, hourly:[{h, t, pp, mm, code}]}`.
- `blocks.alerts` (`kind:'rain'`), `blocks.sources` para ideas de eventos.
- Caché de eventos: `agent_jobs` con `kind='events_search'` y `result` (clave: ciudad + rango de fechas en `progress[0]`).
- `activity_feed` kind `weather_change`.

## Herramientas y endpoints
- `weather` input `{lat, lng, date_from, date_to, day_id?}` → llama `https://api.open-meteo.com/v1/forecast` con `hourly=temperature_2m,precipitation_probability,precipitation,weather_code` y `daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code`, `timezone=auto`. Con `day_id` persiste en `days.weather`.
- `events_search` input `{city, country, date_from, date_to, interests?, lang}` → `[{title, date, start_time?, venue, address?, lat?, lng?, price_text?, url, source_url}]`.

## Notas técnicas
- `events_search`: `claude-opus-5-5`, esfuerzo `medium`, herramienta server-side de web search de Claude + salida estructurada Zod; prompt: "solo eventos con fecha concreta en el rango y fuente verificable; nada inventado". Geocodificar el `venue` con `search_places` si falta lat/lng.
- "Al aire libre" se calcula igual que en PRD 12 (tipo `tour` o tipos de Google al aire libre), sin columna nueva.
- Códigos WMO de Open-Meteo → íconos (mapa local en `packages/shared`).
- Botón debug "Simular lluvia" (compartido con PRD 12) inyecta el evento sin llamar a Open-Meteo.

## Fuera de alcance
Alertas meteorológicas oficiales, calidad del aire, mareas, venta de entradas, eventos recurrentes sin fecha.

## Dependencias
01 (agente planificador). PRD 12 consume `weather_change` para el plan B.

## Cómo probarlo
1. `curl /tools/weather` con Ciudad Vieja y fechas del seed → JSON normalizado en ≤1.5 s; segunda llamada desde `days.weather`.
2. Forzar en el seed un día con 80% de lluvia (mock) → `plan_day` pone alertas y ≥1 bloque techado.
3. `events_search` Montevideo, fin de semana → ≤10 eventos con `source_url`; repetir → caché ≤1 s.
4. Tour activo + debug "Simular lluvia" → el guía avisa una vez; segundo disparo dentro de 2 h → no repite.
