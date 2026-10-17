---
nro: 22
prd: "22 · Votaciones opcionales"
prioridad: P2
estado: Por hacer
carril: App y producto
tamano: M (1-3h)
depende_de: "04, 11"
resumen: "Votaciones opcionales del grupo: el compañero arma 2–4 opciones reales con trade-offs, se vota tocando o hablando, y el organizador puede decidir directo en cualquier momento."
notion_url: https://app.notion.com/p/3fc81924a5c681309d1fd309b35640c6
---

# 22 · Votaciones opcionales

## Objetivo

Destrabar decisiones del grupo sin burocracia. Votar es **opcional**: el organizador puede decidir directo siempre. El compañero genera opciones concretas (cada una es un diff de bloques aplicable), explica trade-offs, media y, si las preferencias no se concilian, propone separarse. La opción ganadora se aplica sola al itinerario.

## Momento de la demo

Acto 1, después de la conciliación: Ana quiere Mercado del Puerto, Leo es vegetariano. Juan: "armá una votación para la cena". El compañero crea la votación con 3 opciones (una es "nos separamos"). Ana vota hablando ("voto por la dos"), Leo toca en la app; la tarjeta se actualiza en vivo en los tres celus. Juan toca **Decido yo** → el bloque aparece confirmado en el itinerario y en el mapa.

## Historias de usuario

- Como organizador, quiero decidir directo sin votar, para no frenar al grupo.
- Como viajero, quiero pedirle al compañero "armá una votación para la cena" y que traiga lugares reales con pros y contras.
- Como viajero, quiero votar hablando ("voto por la opción 2") o tocando.
- Como grupo, quiero que cuando gane una opción se aplique sola al itinerario.
- Como viajero con gustos distintos, quiero que el agente proponga separarnos si ninguna opción sirve a todos.

## Criterios de aceptación

- [ ] `create_poll` crea una fila en `polls` con 2–4 opciones; con menos de 2 o más de 4 devuelve error de validación (Zod).
- [ ] Cada opción puede traer `ops` con el mismo esquema Zod que `agent_proposals.ops`; se validan al crear (no al cerrar). Opciones sin `ops` son solo texto.
- [ ] Electores: participantes de `block_participants` si la votación tiene `block_id`; si no, miembros con rol `organizer` o `traveler`. Los `follower` ven la tarjeta pero `vote` les devuelve 403.
- [ ] `vote` hace upsert en `poll_votes` (cambiar de voto pisa el anterior) y recalcula `polls.result.tally` en la misma transacción; los otros celus ven el conteo nuevo en menos de 2 s.
- [ ] `close_poll` con `option_idx` solo lo puede llamar el organizador (decisión directa) y cierra aunque falten votos (`result.method='organizer'`).
- [ ] `close_poll` sin `option_idx` cuenta votos. Empate → `status='closed'`, `result.tie=true`, no aplica nada y se avisa al organizador con `notify_member` para que desempate.
- [ ] Al cerrar con ganador que tiene `ops`: se crea un `agent_proposals` con `status='accepted'`, `decided_by` = quien cerró, y se aplican los ops por el mismo camino interno que `decide_proposal` (PRD 11). `result.proposal_id` queda guardado.
- [ ] Votación con `closes_at` vencido se cierra sola: el próximo `vote` o la app al mostrar la tarjeta llama `close_poll` (idempotente, `result.method='expired'`).
- [ ] `create_poll` y `close_poll` escriben `activity_feed` (`poll_created`, `poll_closed`) y devuelven `undo_token`; `vote` escribe `poll_voted`.
- [ ] En sesión de voz, "voto por la dos" llama `vote` con `option_idx=1` y el guía confirma en una sola frase.
- [ ] Si el agente detecta que ninguna opción conforma a todos, incluye una opción `kind='split'` cuyos ops crean bloques paralelos con subconjuntos de participantes.
- [ ] Si el organizador está en la conversación y dice "decidí vos" o "vamos con X", el agente **no** crea votación: usa `propose_changes` normal.

## Pantallas y estados

- **Tarjeta de votación** (en el feed, en el detalle del bloque relacionado y en "Ahora"): pregunta, opciones con pros/contras en una línea, costo estimado, barras de conteo, avatares de quién votó (votos no secretos), tiempo restante.
    - Estados: abierta / ya voté (resalta mi opción, permite cambiar) / cerrada con ganador ("Ganó X · aplicado") / empate ("Esperando que Juan desempate") / cancelada.
- **Decido yo**: botón visible solo para el organizador; abre selector de opción y confirma.
- **Crear votación** (manual, desde un bloque o el feed): pregunta, 2–4 opciones de texto, vencimiento (30 min / 2 h / hoy 20:00 / sin vencimiento). Botón "Pedile opciones al compañero" delega la creación al agente (muestra progreso).
- No hay pantalla "Votaciones" aparte: viven en el feed y en el bloque.

## Datos

Tablas: `polls`, `poll_votes`, `agent_proposals`, `activity_feed`, `block_participants`, `trip_members`. Formas jsonb (se definen en `packages/shared`):

```json
// polls.options
[
  { "label": "Mercado del Puerto", "kind": "option", "pros": "clásico, parrilla", "cons": "poco vegetariano", "est_cost": 35, "google_place_id": "...", "ops": [] },
  { "label": "Nos separamos: Ana y Juan al Mercado, Leo a Jacinto", "kind": "split", "ops": [] }
]
// polls.result (tally se actualiza mientras está abierta)
{ "tally": [2, 1, 0], "option_idx": 0, "method": "votes", "tie": false, "decided_by": "uuid", "proposal_id": "uuid" }
```

- `polls.status`: `open` / `closed` / `cancelled`.
- `result.method`: `votes` / `organizer` / `expired`.

## Herramientas y endpoints

- `create_poll` `{trip_id, block_id?, question, options[], closes_at?}` → `{poll_id}`. La llaman humanos o el agente (planificador o voz).
- `vote` `{poll_id, option_idx}` → `{tally}`.
- `close_poll` `{poll_id, option_idx?}` → `{result, proposal_id?}`.
- Reusa: `decide_proposal` (lógica de aplicar ops, PRD 11), `search_places` / `place_details` para opciones reales, `notify_member` (PRD 13) para avisar a electores y al organizador en empate, `undo`.

## Notas técnicas

- Generación de opciones: Claude `claude-opus-5-5`, esfuerzo `medium`, salida estructurada con el Zod de `polls.options`. Entradas: `trip_members.trip_prefs` y `profiles` (`dietary`, `budget_level`, `avoid`, `interests`) de los electores + resultados de `search_places`. Cada opción explica el trade-off en una línea.
- `poll_votes` no está en Realtime; por eso el conteo se espeja en `polls.result.tally` en cada `vote` (Realtime de `polls` sí está).
- RLS: `polls` y `poll_votes` lectura para miembros del viaje; escritura solo vía API (service role) para mantener la lógica de electores en un lugar.
- "Un celu para todos": el voto hablado va a nombre del dueño del celu. Votar por otro no se permite (los demás votan desde su app).
- Descripción de la herramienta `vote` para el modelo de voz: "Usala solo cuando la persona dice explícitamente por qué opción vota. Índice base 0."

## Fuera de alcance

Votos secretos, ranking/votación por puntos, votaciones sobre gastos, recordatorios programados, votar en nombre de otro, votaciones fuera de un viaje.

## Dependencias

- PRD 04: miembros, roles y sync del viaje.
- PRD 11: propuestas (`agent_proposals`, `decide_proposal`, aplicar ops).

## Cómo probarlo

1. Seed: Juan, Ana y Leo en el tramo Montevideo; bloque `meal` de la noche del día 2 con los tres como participantes.
2. Como Leo, por voz: "armá una votación para la cena, soy vegetariano" → en los 3 celus aparece la tarjeta con 3 opciones, una `split`.
3. Ana vota por voz, Leo toca → conteo 1 y 1 en vivo en el celu de Juan.
4. Juan toca **Decido yo** → opción 2 → el bloque cambia en el itinerario, entrada en el feed; **Deshacer** lo revierte.
5. Crear otra votación con `closes_at` a 1 minuto, votar 1 a 1, esperar y abrir la tarjeta → queda en empate y Juan recibe el aviso.
6. Llamar `vote` con el JWT de Sofi (no participante del bloque) → 403.
