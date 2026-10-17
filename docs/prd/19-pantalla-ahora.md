---
nro: 19
prd: '19 · Pantalla "Ahora"'
prioridad: P1
estado: Por hacer
carril: App y producto
tamano: M (1-3h)
depende_de: '02'
resumen: 'En los días de viaje la app abre en "Ahora": qué estás haciendo, qué viene, cuándo salir y las acciones del momento, usable con una mano en la calle.'
notion_url: https://app.notion.com/p/3fc81924a5c6813caaadf10608719a79
---

# 19 · Pantalla "Ahora"

## Objetivo
Una pantalla de inicio para los días de viaje que responde en 2 segundos "¿qué hago ahora y qué sigue?": bloque actual, próximo con ETA y hora de salida, alertas, propuestas pendientes, progreso del agente y acciones rápidas. Nunca vacía, una mano, modo exterior, tolerante a mala conexión.

## Momento de la demo
Acto 2 arranca acá: Juan abre la app en la Ciudadela y ve "Ahora: Tour Ciudad Vieja · quedan 45 min" y "Después: Almuerzo en el Mercado · salí en 12 min". Mantiene apretada la tarjeta del almuerzo → "Hablar de esto" → el guía arranca hablando del almuerzo.

## Historias de usuario
- Como viajero en la calle, quiero ver de un vistazo dónde tengo que estar y cuándo salir.
- Como viajero, quiero hablar con el guía sobre un bloque puntual sin explicarle de qué hablo.
- Como viajero con tiempo libre, quiero sugerencias cerca, no una pantalla vacía.
- Como viajero con mala señal, quiero ver lo último que se cargó.

## Criterios de aceptación
- [ ] Si `trips.status='active'` y hoy cae dentro de un tramo donde el usuario está en `leg_members`, la app abre en la pestaña Ahora (primera del tab bar). Si no, Ahora muestra "Tu viaje empieza en N días" + acceso al plan.
- [ ] Tarjeta **Ahora**: bloque en curso (título, lugar, barra de tiempo restante, avatares de participantes, alertas). Si no hay bloque en curso, se omite.
- [ ] Tarjeta **Después**: próximo bloque con hora, ETA (`route_eta` a pie, o transporte si a pie supera 25 min) y "Salí en X min" = inicio − ETA − 5; naranja con ≤5 min, rojo si ya es tarde.
- [ ] ETA se recalcula cada 2 min o cada 100 m de movimiento (no más seguido).
- [ ] Cambios del plan (Realtime `blocks`, `agent_proposals`, `agent_jobs`) se reflejan en ≤2 s sin recargar.
- [ ] Acciones rápidas (zona inferior, ≤ 40% de la pantalla desde abajo): Hablar con {guide_name}, Iniciar tour (solo si el bloque actual o próximo es `tour`), Tour acá ahora (PRD 18 si está), ¿Dónde están? (PRD 13 si está), Cómo llego (deep link a Google Maps / Apple Maps a pie). Las de PRDs no hechos se ocultan.
- [ ] Mantener apretada cualquier tarjeta de bloque → "Hablar de esto": abre la sesión de voz y envía como primer mensaje de contexto el bloque (título, hora, lugar, participantes, alertas).
- [ ] Nunca vacía: sin bloques en las próximas 2 h → 3 sugerencias: ideas del banco (`day_id` null) a ≤1 km, "Tour acá, ahora" y "Armame la tarde" (`plan_day`).
- [ ] Propuestas `pending` del tramo: badge con la cantidad + tarjeta compacta (componente del PRD 11 si está).
- [ ] Jobs del agente activos: tira de progreso con el último `progress.text`.
- [ ] Modo exterior: títulos ≥22 pt, cuerpo ≥17 pt, contraste AA, botones ≥56 pt de alto; switch en Ajustes y auto con brillo alto si se puede.
- [ ] Sin conexión: muestra el último estado cacheado (AsyncStorage) con banner "Sin conexión · datos de hace X min" en ≤1 s al abrir.
- [ ] Solo muestra bloques `plan_variant='main'` donde el usuario participa; los privados de otros no aparecen.

## Pantallas y estados
- **Header**: ciudad, fecha, chip de clima (PRD 16 si está, si no se oculta).
- **Ahora / Después / Más tarde hoy** (lista colapsada) / **Propuestas** / **Progreso del agente** / **Acciones**.
- Cargando: skeleton de 2 tarjetas. Error: "No pude cargar tu día" + Reintentar (manteniendo caché si hay). Vacío: sugerencias (ver criterios). Sin permiso de ubicación: ETA oculto con link "Activar ubicación para calcular cuándo salir".

## Datos
- `trips` (status), `legs`, `leg_members`, `days` (date, weather), `blocks_visible` + `block_participants` (filtrado por usuario y `plan_variant='main'`), `agent_proposals` (pending), `agent_jobs` (activos del usuario o del viaje), `profiles.guide_name`.
- Caché local: `now_screen:{trip_id}` en AsyncStorage con el payload de `get_day_plan` y `fetched_at`.

## Herramientas y endpoints
- `get_day_plan` (PRD 00) para la carga inicial; luego Realtime.
- `route_eta` para ETA. `plan_day` para "Armame la tarde". `POST /voice/session` para hablar.

## Notas técnicas
- Determinar "hoy" y la hora con la zona horaria del tramo (derivada de `legs.lat/lng`; para el MVP `America/Montevideo` y `America/Argentina/Buenos_Aires` hardcodeadas por país).
- "Hablar de esto": después de conectar, la app manda un `conversation.item.create` de sistema con el bloque en JSON y pide `response.create` (no requiere cambiar `/voice/session`).
- Bloques con `time_flex` distinto de `fixed` y sin hora: se ubican en "Más tarde hoy" según la franja (morning/afternoon/evening).
- Haptic suave al pasar "Salí en X" a naranja.

## Fuera de alcance
Widget de pantalla de inicio, Live Activity (PRD 17), modo multi-día, gastos rápidos (se agrega la acción cuando exista PRD 23).

## Dependencias
02 (plan del día y bloques). Integra 11, 13, 16, 18 si están hechos (ocultando lo que falte).

## Cómo probarlo
1. Seed con viaje `active` y fecha del celu en el día 2 a las 10:30 → abre en Ahora con el tour en curso.
2. Simulado caminando → "Salí en X" cambia, se pone naranja a 5 min.
3. Otro celu mueve el almuerzo → Ahora se actualiza en ≤2 s.
4. Mantener apretado el almuerzo → el guía arranca hablando de ese bloque.
5. Modo avión y reabrir → último estado + banner.
6. Borrar los bloques de la tarde → aparecen 3 sugerencias.
