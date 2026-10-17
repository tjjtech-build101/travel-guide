# Ahora v2 — diseño

Objetivo: Ahora responde en 2 segundos "¿qué hago ya?". **Limpio, una mano, poco ruido.**
Regla de oro: **un solo protagonista** arriba; todo lo demás es una fila chica o no se muestra.

## Layout (de arriba a abajo)

1. **Encabezado compacto** (1 línea): `Dom 18 oct · Montevideo` + `WeatherChip` (ícono + temperatura) a la derecha.
   El chip "Hora simulada" solo en `__DEV__`, chiquito.
2. **`ScoutLine`**: una sola frase de Scout con su avatar chico (28 px). Tocarla abre la llamada con ese contexto.
   Texto inmediato por reglas (`nowBriefRules`), reemplazado por la versión de Claude (`now_brief`) cuando llega.
3. **`DayRail`**: tira horizontal fina (≤ 56 px) con los bloques del día y un marcador "ahora". Reemplaza "Más tarde hoy".
   Tocar un bloque lo abre. Hechos en gris, el actual resaltado.
4. **Protagonista** (`Hero*`, exactamente UNO, lo elige `pickHero`):
   - `leave` — hay que salir en ≤ 30 min o ya vas tarde: `Countdown` grande ("Salí en 6 min"; con ≤ 10 min, `6:30` con segundos),
     destino, `MiniRoute` (vos → destino), `GroupFaces` (quién va y, si comparten ubicación, "Ana a 300 m").
     Botones: **Cómo llego** (primario) · **Voy tarde** (solo si `soon`/`late`, abre `LateSheet`).
   - `tour` — el bloque tour está en curso o empieza en ≤ 60 min y tiene `tour_id`: `TourPreview` (paradas, km, duración,
     minimapa de paradas) + **Empezar tour**. Un bloque tour NUNCA aparece dos veces.
   - `current` — algo en curso: título, lugar, barra de progreso, "Quedan 30 min", `GroupFaces`, botón **Contame de esto**.
   - `free` — nada en curso y lo próximo está a > 30 min (o no hay): "Tenés 45 min libres" (o "Tenés la tarde libre"),
     hasta 3 `GapSuggestion` (idea del banco / lugar cerca abierto / evento de hoy) con **Agregar** en un toque,
     y dos acciones: **Armame la tarde** (`plan_day`) · **Tour acá, ahora**.
   - `state` — `before` / `after` / `noLegs` / `noDay`: mensaje + acción. En `before`: **Ver mi día 1** (simula el reloj
     al día 1 a las 10:00; un chip "Vista previa del día 1 · Volver a hoy" deja salir).
5. **`NextRow`** (solo si el protagonista es `current` o `tour` y hay un próximo bloque): 1 fila
   `18:00 · Llamada de laburo · Salí en 1 h 10`.
6. **`InlineNotice`** — como máximo UNA, por prioridad: sin conexión ("Sin conexión · datos de hace 4 min") > plan B por
   lluvia ("Va a llover a las 15 · ¿Paso al plan de lluvia?") > propuestas pendientes ("Scout propone 3 cambios · Ver").
7. **Dock v2** (abajo, ≤ 22 % de la pantalla): botón **Hablar con Scout** (con el avatar adentro, estado de voz) + 3 íconos
   chicos: Tour acá · Cámara · Cómo llego. En Ahora **se oculta la burbuja flotante** del Scout (ya está el dock).

Nada de textos de ayuda tipo "Mantené apretada…". Las acciones se ven (botones), la pulsación larga queda como atajo.

## Comportamiento

- **Zona horaria** del tramo con IANA (`legTimeZone` + `zonedParts` en `packages/shared/src/timezone.ts`), no por país fijo.
- **Cuenta regresiva**: se actualiza cada segundo solo con ≤ 10 min; si no, cada 30 s. Haptic al pasar a `soon` y a `late`.
- **ETA**: sigue `useEta` (2 min / 100 m).
- **Modo demo de ubicación**: deep link `?loc=near` (y entrada en el menú dev) pone el GPS simulado a ~8 min a pie del próximo
  bloque, para que "Salí en X" se vea aunque estés lejos.
- **Sin conexión**: caché por viaje en AsyncStorage (`now_screen:{trip_id}`: overview + bloques + propuestas + `fetched_at`),
  se hidrata al abrir (≤ 1 s) y muestra el aviso.
- **Modo exterior**: switch en Ajustes (`outdoor`), sube contraste y tamaño. Persistido.
- **Grupo**: la app publica tu ubicación en `member_locations` (cada 30 s o 50 m, respetando `trip_members.location_sharing`
  y `ghost_until`) y lee la de los demás por Realtime.
- **Voy tarde** (`LateSheet`): "Avisar al grupo" (`report_late` → `activity_feed` `running_late`), "Mover {bloque} 15 min"
  (`move_block`, con deshacer), "Llevarme" (Cómo llego).
- **Plan B por lluvia**: si `weather` da lluvia (prob ≥ 60 %) en la franja de un bloque al aire libre del día y existe
  variante `rain` del día, aviso con "Ver plan de lluvia".

## Contratos nuevos (ver `packages/shared/src/tools/nowTools.ts` y `nowBrief.ts`)

- `now_brief` — lectura, sin feed: snapshot del momento → `{text, source: 'llm' | 'rules'}`. Modelo `BRIEF_MODEL`
  (default `claude-haiku-5-5`), timeout 4 s, caché 10 min por snapshot; sin key/saldo devuelve las reglas.
- `gap_suggestions` — lectura: hasta 3 ideas para un hueco (banco del tramo, `search_places` abiertos cerca, `events_search` de hoy).
- `report_late` — escritura: `activity_feed` kind `running_late` + `undo_token`.
- `plan_day` — el agente propone (`agent_proposals`) bloques para el resto del día; nunca aplica solo.
