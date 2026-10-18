---
nro: 11
prd: "11 · Conciliación de preferencias + propuestas con diff"
prioridad: P1
estado: En curso
carril: Cerebro y contenido
tamano: L (2-4h)
depende_de: "01, 04"
resumen: "El compañero cruza los gustos y restricciones de todos los del tramo y propone cambios sobre lo compartido como un diff que se acepta o rechaza en la app o por voz."
notion_url: https://app.notion.com/p/3fc81924a5c6813c80ccc2885ebc9548
---

# 11 · Conciliación de preferencias + propuestas con diff

## Objetivo

Que el agente concilie las preferencias de los miembros de un tramo y proponga cambios sobre bloques compartidos como `agent_proposals` (diff visible, aceptar/rechazar, deshacer). En lo personal aplica directo. Cumple la regla de Producto: **el agente propone en lo compartido y aplica en lo personal; los humanos editan directo** (un viajero también puede proponer donde no puede editar).

## Momento de la demo

Acto 1. Ana se suma por QR; su onboarding por viaje dice "ni loco: museos" y "sí o sí: Mercado del Puerto". Juan toca **Conciliar preferencias**. Se ve el progreso del agente en vivo y en ≤25 s aparece "Propuesta del compañero · 3 cambios" con diff en colores y una barra de "cuánto le cierra" a cada uno. Juan dice "dale, aceptá" y el mapa de Ana se actualiza solo.

## Historias de usuario

- Como organizador, quiero que el compañero arme algo que contemple a todos, para no negociar cada bloque.
- Como viajero, quiero ver exactamente qué cambia (antes → después) antes de aceptar.
- Como viajero, quiero aceptar o rechazar hablando.
- Como grupo con gustos opuestos, quiero que el agente proponga separarnos un rato y reencontrarnos.
- Como viajero sin permiso de edición sobre un tramo, quiero proponer un cambio en vez de editarlo.

## Criterios de aceptación

- [ ] `propose_changes` con `mode:'reconcile'` devuelve `job_id` en ≤1 s y la propuesta queda `pending` en ≤25 s (3 corridas sobre el seed).
- [ ] La propuesta trae entre 1 y 8 ops; toda op `add` tiene `google_place_id` validado con `place_details`.
- [ ] 0 bloques que violen un `avoid` (de `trip_members.trip_prefs` o `profiles.avoid`), `dietary` o `mobility` de algún participante de ese bloque.
- [ ] Cada `must` de cada miembro del tramo queda cubierto por ≥1 bloque o explicado en `reason`.
- [ ] Si algún miembro tiene afinidad menor a 40/100 en un bloque compartido de ≥90 min, la propuesta incluye separación: 2 bloques paralelos con subsets de participantes + 1 bloque `meetup` de reencuentro.
- [ ] `agent_jobs.result.fit` trae puntaje 0–100 por miembro y la UI lo muestra como barra.
- [ ] Diff: `add` en verde, `remove` en rojo tachado, `update` en amarillo campo a campo (antes → después), `move` muestra día/hora origen → destino.
- [ ] Bloques `is_private` de otros se ven como "Ocupado" y ninguna op los toca; bloques `booked` no se tocan.
- [ ] `decide_proposal` accept aplica todas las ops en 1 transacción; si una falla no se aplica ninguna y queda `pending` con error visible.
- [ ] Aceptar genera `activity_feed` kind `proposal_accepted` con `undo_token`; `undo` revierte en ≤2 s.
- [ ] Si un bloque tocado tiene `updated_at` posterior al `created_at` de la propuesta, decidir devuelve `stale`, la propuesta pasa a `expired` y la UI ofrece "Regenerar".
- [ ] Propuestas `pending` con más de 24 h se marcan `expired` al leerlas.
- [ ] El otro celu ve la tarjeta nueva en ≤2 s (Realtime `agent_proposals`).
- [ ] Por voz "aceptá" / "rechazá" decide la propuesta `pending` más reciente del tramo y el guía confirma en 1 frase; si decide otro, la sesión activa recibe `[EVENTO:proposal_decided]`.
- [ ] Permisos: decide el organizador o un viajero que esté en `leg_members` del tramo; seguidor ve la tarjeta con botones deshabilitados y la API responde 403.
- [ ] Si todos los bloques afectados son personales (único participante = quien pide, o `is_private`), el agente aplica directo sin crear propuesta.

## Pantallas y estados

- **Botón "Conciliar preferencias"** en la vista del tramo (visible con ≥2 miembros en `leg_members`).
- **Tarjeta de propuesta** (plan del día, pantalla Ahora y feed): resumen, `reason`, "N cambios", Ver diff / Aceptar / Rechazar, autor (compañero o persona).
- **Hoja de diff** (bottom sheet): ops agrupadas por día, mini mapa con pines nuevos (verde) y quitados (rojo), barras de fit por miembro, lista de conflictos.
- Vacío: "No hay propuestas pendientes". Cargando: progreso del job en vivo ("Leyendo gustos de Ana…", "Buscando lugares…"). Error: job `failed` → "No pude armar la propuesta" + Reintentar. Expirada: tarjeta gris + Regenerar.

## Datos

- Lee: `trip_members.trip_prefs` (goal, budget_per_person, must, avoid, companions), `profiles` (interests, pace, chronotype, budget_level, dietary, mobility, avoid), `legs`, `leg_members`, `days`, `blocks_visible`, `block_participants`.
- Escribe: `agent_proposals` (summary, reason, ops, status, by_agent, created_by, decided_by, decided_at), `agent_jobs` (kind `reconcile`, progress, result `{proposal_id, fit, conflicts}`), `activity_feed` (kinds `proposal_created`, `proposal_accepted`, `proposal_rejected`, `proposal_expired`), `blocks` y `block_participants` al aplicar (`created_by_agent=true`, `status='confirmed'`).
- `ops` con el formato exacto de Contratos: `[{op:'add'|'update'|'move'|'remove', block_id?, block?, patch?}]`. `move` usa `patch` con `day_id`, `start_time`, `end_time`, `sort_order`. El "antes" del diff se calcula en el cliente con el bloque actual (es válido porque la propuesta expira si el bloque cambió).

## Herramientas y endpoints

- `propose_changes` input `{trip_id, leg_id?, day_id?, mode:'reconcile'|'manual', instruction?, ops?, summary?, reason?}`. `manual`: crea la propuesta sincrónica con las ops dadas (humano o agente). `reconcile`: crea job y devuelve `{job_id}`.
- `decide_proposal` input `{proposal_id, decision:'accept'|'reject', note?}` → `{status, applied_block_ids}` + `undo_token`.
- `undo` (PRD 05). Dentro del agente: `get_trip_overview`, `get_day_plan`, `search_places`, `place_details`, `route_eta` (solo lectura).

## Notas técnicas

- Agente: `claude-opus-5-5`, esfuerzo `high`, Tool Runner + salida estructurada Zod `{summary, reason, ops, fit:{user_id:number}, affinity:[{block_ref, user_id, score}], conflicts:[{user_ids, text}]}`.
- Prompt: restricciones **duras** (avoid, dietary, mobility, bloques fixed/booked, privados ajenos) vs **blandas** (interests con peso, pace, chronotype → ventanas horarias, presupuesto). Si no hay forma de satisfacer a todos, proponer separación antes que un promedio tibio.
- Validación server-side después del modelo: descartar ops que violen restricciones duras o toquen bloques privados ajenos / `booked`; si quedan 0 ops, job `done` con `result.proposal_id=null` y mensaje "Ya les cierra a todos".
- Aplicar en transacción con conexión Postgres directa desde la API (`SUPABASE_DB_URL`), no con supabase-js. `undo_token` guarda snapshot de los bloques afectados.
- Herramientas de voz: el prompt del guía dice "nunca decidas una propuesta sin un sí o no explícito del usuario".
- Expiración perezosa: al leer propuestas `pending`, la API marca `expired` las de más de 24 h o con bloques cambiados.

## Fuera de alcance

Aceptación parcial por op (se acepta o rechaza todo). Votación sobre propuestas (PRD 22). Merge de propuestas concurrentes. Presencia/cursores.

## Dependencias

01 (agente planificador y Tool Runner), 04 (multiplayer: roles, `leg_members`, Realtime). Voz y `undo` vienen de 05; sin 05 todo funciona desde la app.

## Cómo probarlo

1. Seed: Juan con `interests` arquitectura 5 / comida 2; Ana con `trip_prefs.avoid` = museos y `must` = Mercado del Puerto; tramo Montevideo con ambos.
2. Celu de Juan → tramo → Conciliar. Ver progreso → tarjeta con diff y barras de fit.
3. Verificar: 0 museos en bloques con Ana, Mercado del Puerto presente.
4. Celu de Ana: tarjeta en ≤2 s. Juan acepta → bloques en el mapa de ambos. Deshacer → vuelve al estado previo.
5. Crear otra propuesta, editar a mano un bloque afectado, intentar aceptar → `expired`.
6. Loguearse como seguidor: botones deshabilitados; `curl` a `decide_proposal` → 403.
