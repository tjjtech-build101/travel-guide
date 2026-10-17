---
nro: 2
prd: "02 · Pestaña Plan"
prioridad: P0
estado: "Por hacer"
carril: "App y producto"
tamano: "M (1-3h)"
depende_de: "00"
resumen: "Línea de tiempo del viaje por tramo y día con filtros Todo/Del grupo/Lo mío, tramos paralelos, detalle/edición/creación de bloques, privados como Ocupado, banco de ideas, propuestas pendientes y alertas, todo sincronizado en vivo."
notion_url: https://app.notion.com/p/3fc81924a5c68138b2f6fe8c7f7dcb41
---

# 🗓️ 02 · Pestaña Plan

> 📌 Fuentes: [Producto](../PRODUCT.md) · [Arquitectura](../ARCHITECTURE.md) · [Contratos](../CONTRACTS.md). Requiere PRD 00.

## Objetivo

La pantalla principal del viaje: ver y editar el itinerario completo (todos los tramos, días y bloques) de forma clara en el celu, con una mano, distinguiendo lo del grupo de lo mío, mostrando los tramos paralelos cuando el grupo se separa, y reflejando al instante los cambios de otros y del agente (incluidas sus propuestas pendientes).

## Momento de la demo

Acto 1: mientras `plan_trip` trabaja, el Plan se llena en vivo; Ana edita la hora de un bloque y aparece sola en el celu de Juan; se ve la propuesta pendiente del compañero con su diff; el bloque privado de Juan se ve "Ocupado" en el celu de Sofi. Acto 2: chip "Cierra 17:00" en Teatro Solís.

## Historias de usuario

- Como viajero, veo el viaje día por día agrupado por tramo, con horario, lugar, quién va y estado de cada bloque.
- Como viajero, filtro Todo / Del grupo / Lo mío.
- Como Sofi, cuando el grupo se separa veo mi rama (Buenos Aires) por defecto y puedo ver la otra (Colonia) o las dos en paralelo.
- Como viajero, toco un bloque, veo el detalle y lo edito (hora, lugar, participantes, notas, estado) o lo muevo de día o al banco de ideas.
- Como viajero, creo un bloque de cualquiera de los 7 tipos o anoto una idea sin día.
- Como viajero, mis cosas privadas aparecen a los demás como "Ocupado".
- Como miembro, veo las propuestas pendientes del compañero con lo que cambiarían.
- Como viajero, veo chips de alerta (cierra, llegamos tarde, lluvia, dieta) en los bloques.
- (Nice-to-have) Exporto el viaje a mi calendario y comparto un día por WhatsApp.

## Criterios de aceptación

- [ ] Plan del seed renderiza 4 tramos y ≥ 18 bloques en ≤ 1,5 s desde caché y ≤ 3 s en frío (4G), scroll a 60 fps en un Android de gama media (FlashList).
- [ ] Cada tarjeta muestra: hora (`start_time`–`end_time` o franja de `time_flex`: Mañana/Tarde/Noche/Cuando sea), ícono por `type`, `title`, `place_name`, hasta 3 avatares + "+n", badge de `status` (Idea / Propuesto / Confirmado / Reservado), candado si es privado y mío, chips de `alerts`.
- [ ] Filtros: "Todo" = todo lo de `blocks_visible`; "Del grupo" = bloques con ≥ 2 participantes; "Lo mío" = bloques donde soy participante. Cambiar filtro < 100 ms, sin red.
- [ ] Tramos paralelos (20–21/10 del seed): por defecto se muestra la rama del usuario; chips de rama con el color del tramo permiten cambiar; toggle "Ver en paralelo" muestra 2 columnas compactas.
- [ ] Bloque privado de Juan visto por Sofi: tarjeta gris "Ocupado" con horario, sin detalle, no tocable.
- [ ] Editar hora de un bloque en el celu A → visible en el celu B en ≤ 2 s; la UI de A actualiza al instante (optimista) y si la herramienta falla vuelve atrás con toast.
- [ ] Crear bloque: los 7 tipos (`activity`, `meal`, `tour`, `transfer`, `lodging`, `free`, `meetup`) con los campos de la tabla de Datos; guardar ≤ 3 toques después de completar título y día.
- [ ] Banco de ideas: sección por tramo con contador; "Agendar" una idea (elegir día y hora) usa `move_block`; "Nueva idea" usa `add_idea`.
- [ ] Borrar y mover muestran toast "Listo · Deshacer" 5 s que llama `undo` con el `undo_token`.
- [ ] Propuestas `pending` del viaje: banner "El compañero propone 1 cambio" + lista con `summary`, `reason` y diff por op; los `add` aparecen como tarjeta fantasma punteada en su día. Botones Aceptar/Rechazar visibles solo si `FEATURES.decideProposal` (PRD 11) está activo.
- [ ] Permisos en UI: seguidor no ve ningún control de edición; viajero solo edita en tramos donde es `leg_member`; el backend igual responde 403 si se fuerza.
- [ ] Durante un `plan_trip` activo se monta `AgentJobProgress` (PRD 01) arriba y los bloques entran animados.
- [ ] Nice-to-have: "Exportar a calendario" genera un `.ics` válido (abre en Calendario de iOS y Google Calendar) con 1 `VEVENT` por bloque con hora; "Compartir día" abre la hoja nativa con texto legible.

## Pantallas y estados

### Plan (`app/(app)/trip/[tripId]/plan.tsx`)

- Header: título del viaje + franja horizontal de tramos (chip por tramo con color, ciudad y fechas; los paralelos apilados). Tocar un tramo hace scroll a su primer día.
- Barra: segmentado Todo / Del grupo / Lo mío + selector de vista Lista / Dividida / Mapa (Dividida y Mapa los provee PRD 03; si no está, ocultos).
- Cuerpo: `FlashList` con secciones por día: "Dom 18 oct · Montevideo" (+ clima de `days.weather` si existe). Dentro, tarjetas ordenadas: primero con `start_time`, después por franja (`morning` 06–12, `afternoon` 12–19, `evening` 19–24), `any` al final; empate por `sort_order`.
- Al final de cada tramo: "Banco de ideas (n)" plegable.
- FAB "+" → crear bloque. Slot para el botón flotante de voz (PRD 05) que no lo tape.
- Estados: **vacío** (viaje sin tramos): "Este viaje está en blanco" + "Contale al compañero" (abre "Nuevo viaje" con `trip_id`) + "Agregar a mano". **Día vacío**: "Día libre. ¿Le sumamos algo?" + "+ Bloque" + "Traer del banco". **Filtro sin resultados**: "No tenés nada propio este día". **Cargando**: skeleton de 2 días × 3 tarjetas. **Error**: "No pudimos cargar el plan" + Reintentar (si hay caché, se muestra con banner "Mostrando lo último").

### Detalle de bloque (bottom sheet al 60 %, expandible)

- Ver: todos los campos visibles, participantes con nombre, `sources` como links, `booking_url` ("Abrir reserva"), `transfer` ("Bus · 2 h 45"), alertas completas.
- Editar inline: título, hora/franja, duración, lugar (buscador con `search_places`), participantes, privado (solo si el único participante soy yo), estado, costo, notas → `update_block`.
- Acciones: "Mover a otro día", "Mandar a ideas" (`move_block` con `day_id=null`), "Ver en mapa" (PRD 03), "Hablar de esto" (PRD 05, oculto si no está), "Borrar" (confirmación + `remove_block`).
- Si la respuesta es `mode:'proposed'` (no debería pasar con humanos, pero por las dudas): toast "Quedó como propuesta".
- Error: mensaje inline bajo el campo y valor anterior restaurado.

### Crear bloque (bottom sheet)

Paso 1: grilla de 7 tipos con ícono y nombre (Actividad, Comida, Tour, Traslado, Alojamiento, Libre, Encuentro). Paso 2: formulario según tipo. Default: día visible en pantalla, participantes = miembros del tramo, `status='confirmed'`.

### Propuestas pendientes (sheet desde el banner)

Por propuesta: avatar del compañero, `summary`, `reason`, fecha; lista de ops con color: `add` verde "+ Parrilla X · Lun 19 21:00", `update` amarillo "Cena: 20:30 → 21:30", `move` azul "Feria → Dom 18", `remove` rojo tachado. Vacío: banner oculto.

### Exportar / compartir (menú "⋯" del viaje y de cada día)

"Exportar viaje a calendario", "Compartir este día". Error: toast "No se pudo generar el archivo".

## Datos

- Lectura: `get_trip_overview` (o query directa equivalente) para tramos/miembros/días + `blocks_visible` por `trip_id` + `block_participants` + `agent_proposals` con `status='pending'` + `leg_members` + `trip_members` (rol). Query keys: `['trip', id, 'overview']`, `['trip', id, 'blocks']`, `['trip', id, 'proposals']`, invalidadas por `useTripRealtime` (00).
- Evento `activity_feed` con `kind='busy_changed'` → invalidar `blocks` (privados ajenos).
- Campos por tipo en el formulario (todos columnas de `blocks`):

| Tipo | Campos |
| --- | --- |
| `activity`, `tour` | `title`, lugar (`google_place_id`, `place_name`, `lat`, `lng`), día, `start_time`/`end_time` o `time_flex`, `duration_min`, participantes, `is_private`, `status`, `cost_estimate` + `cost_currency`, `booking_url`, `notes` |
| `meal` | igual que activity; `time_flex` sugerido `afternoon`/`evening` |
| `transfer` | `title`, día, `start_time`, `transfer={from, to, mode, duration_min}` con `mode` ∈ walk, transit, bus, ferry, flight, car; `booking_url`, costo |
| `lodging` | `title`, lugar, día de llegada, `start_time` (check-in), `notes` (noches, código), `booking_url`, costo |
| `free` | `title` (default "Libre"), día, franja |
| `meetup` | `title`, lugar, día, `start_time` obligatorio, participantes (default todos los del tramo) |

- Colores de tramos: constante `LEG_COLORS` (8 colores accesibles) en `packages/shared/src/constants.ts`, asignada por `legs.sort_order`; la usa también el Mapa.

## Herramientas y endpoints

- `update_block`, `move_block` (`recompute_times: true` al cambiar de día u orden), `remove_block`, `add_block`, `undo`, `search_places` (todas de 00).
- `add_idea` (Contratos, PRD 02): **se implementa acá** en `packages/shared` + API. Input = el de `add_block` sin `day_id`, `start_time`, `end_time` (fuerza `day_id=null`, `status='idea'`). Misma regla personal/compartido y mismo `activity_feed` (`kind='block_added'`).
- `decide_proposal` (PRD 11): solo se llama si `FEATURES.decideProposal`.

## Notas técnicas

- Librerías: `@shopify/flash-list` (lista con secciones y `getItemType` por header/tarjeta), `@gorhom/bottom-sheet`, `react-native-reanimated` (layout animations para entradas en vivo: `FadeInDown` 200 ms), `@tanstack/react-query` (mutaciones optimistas con `onMutate`/`onError` rollback), `zustand` (`usePlanMapStore`: `legId`, `dayId`, `selectedBlockId`, `filter`, `view` — compartido con PRD 03).
- Hook `usePermissions(tripId)` → `{ role, canEditLeg(legId), canPropose, isFollower }` (lo reusa PRD 04).
- Selector puro `buildPlanSections(overview, blocks, participants, filter, branchByDate, me)` en `apps/mobile/src/features/plan/selectors.ts` con tests unitarios (filtros, orden por franja, paralelos, Ocupado). Es donde más bugs aparecen: testear primero.
- Tramos paralelos: detectar fechas con > 1 tramo; `branchByDate` default = tramo donde `me` es `leg_member`, si no el primero.
- Horas: `start_time` es `time` sin zona → se muestran tal cual (hora local del destino). Formato 24 h ("16:00").
- `.ics`: generarlo a mano (sin librería): `BEGIN:VCALENDAR`, `VERSION:2.0`, `PRODID:-//build101//ES`, por bloque `BEGIN:VEVENT`, `UID:<block.id>@build101`, `DTSTAMP` en UTC, `DTSTART`/`DTEND` en hora flotante (`20261018T160000`, sin Z ni TZID: Contratos no guarda zona horaria), `SUMMARY`, `LOCATION`, `DESCRIPTION`; líneas con CRLF y escapado de `,` `;` y saltos. Bloques sin hora → evento de día completo (`DTSTART;VALUE=DATE`). Escribir con `expo-file-system` y compartir con `expo-sharing` (`mimeType: 'text/calendar'`, `UTI: 'public.calendar-event'` en iOS).
- Compartir día: `Share.share({ message })` de React Native, formato: "Dom 18/10 · Montevideo" + una línea por bloque "11:00 Tour Ciudad Vieja" (privados ajenos como "Ocupado").
- Accesibilidad: tamaño de toque ≥ 44 pt, `accessibilityLabel` en tarjetas ("Tour Ciudad Vieja, 11 a 13:30, confirmado"), soportar Dynamic Type hasta XL.
- Orden sugerido: selector + tests → lista de solo lectura con Realtime → detalle + edición → crear + `add_idea` → banco de ideas → paralelos → propuestas → alertas → `.ics`/compartir.

## Fuera de alcance

- Aceptar/rechazar propuestas (`decide_proposal`, PRD 11): acá solo se muestran.
- Calcular alertas (las escriben agentes y PRDs de clima/re-planificación): acá solo se renderizan.
- Drag & drop en el mapa (PRD 03); en la lista, reordenar con "Mover" alcanza.
- Votaciones, gastos, diario, pantalla "Ahora", Live Activities, traducción de bloques.

## Dependencias

- 00 (herramientas, `blocks_visible`, Realtime, `undo`). Integra con 01 (`AgentJobProgress`), 03 (vista dividida y "Ver en mapa"), 05 ("Hablar de esto"), 11 (decidir propuestas) si están; si no, esos controles se ocultan.

## Cómo probarlo

1. Juan (iPhone) y Sofi (Android) abren "Montevideo + Buenos Aires" → Plan.
2. Dom 18: Juan ve "Llamada de laburo" con candado; Sofi ve "Ocupado" gris y no lo puede abrir.
3. Sofi baja al 20/10: ve su rama Buenos Aires; toca el chip Colonia → cambia; "Ver en paralelo" → 2 columnas.
4. Juan filtra "Lo mío" y "Del grupo" y verifica los conteos contra Supabase.
5. Juan cambia la hora del Teatro Solís a 15:00 → en ≤ 2 s cambia en el celu de Sofi. Juan lo borra → toast "Deshacer" → vuelve en ambos.
6. Juan crea un `meetup` "Encuentro en Plaza Matriz" 13:45 y una idea "Probar el medío y medio" → aparece en "Banco de ideas (3)"; la agenda el lunes 19 a la tarde.
7. Banner de la propuesta del seed: abrirlo y ver el diff de la cena del lunes.
8. Activar modo avión en el Android: aparece "Mostrando lo último" y el plan sigue visible.
9. Exportar a calendario → abrir el `.ics` en Calendario de iOS → los eventos del dom 18 aparecen a la hora correcta. Compartir el día por WhatsApp.
