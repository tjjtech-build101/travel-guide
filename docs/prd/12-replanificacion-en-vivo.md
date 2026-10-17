---
nro: 12
prd: "12 · Itinerario por voz + re-planificación en vivo + plan B + prepare_booking"
prioridad: P1
estado: Por hacer
carril: Cerebro y contenido
tamano: L (2-4h)
depende_de: "05, 11"
resumen: "Editar el itinerario hablando, re-planificar lo mínimo ante imprevistos, pasar a un plan B pre-generado en un paso y preparar reservas como deep link sin reservar solo."
notion_url: https://app.notion.com/p/3fc81924a5c68125b3a5e1ba91bb6082
---

# 12 · Itinerario por voz + re-planificación en vivo + plan B + prepare_booking

## Objetivo

Que el guía haga trabajo real sobre el plan durante el viaje: cambios por voz, re-planificación mínima (tour → día → días siguientes) con diff visible, plan B pre-generado para lluvia/cerrado, urgencias que se aplican y avisan, y reservas preparadas como deep link (nunca reserva, nunca manda mensajes ni paga).

## Momento de la demo

Acto 2, en medio del tour: "se largó a llover". El guía: "Tengo plan B: cambiamos la Rambla por el Museo del Carnaval y un café en el Mercado. ¿Lo cambio?" → "dale" → la línea de tiempo cambia con animación en ≤3 s. Después: "¿me reservás en el Jacinto a las 13 para cuatro?" → tarjeta "Abrir WhatsApp con el mensaje listo".

## Historias de usuario

- Como viajero, quiero decir "mové la cena a las 21" y que pase, sin tocar la pantalla.
- Como viajero, si llueve o algo está cerrado, quiero una alternativa ya pensada, no esperar a que el agente piense.
- Como grupo, si vamos atrasados, quiero que el agente ajuste lo que queda del día tocando lo mínimo.
- Como viajero, quiero que me deje la reserva lista para mandar, sin que el agente hable con terceros.

## Criterios de aceptación

- [ ] Por voz, ≥8 de estas 10 frases terminan en la herramienta correcta con los parámetros correctos: "agregá un café a las 17", "mové la cena a las 21", "sacá el museo", "pasá la feria a mañana", "agregá a ideas el Palacio Salvo", "hacé la cena solo para Ana y yo", "cambiá el almuerzo por algo vegetariano", "¿qué tengo después?", "adelantá todo media hora", "deshacé".
- [ ] Cada acción por voz muestra una tarjeta de acción en pantalla en ≤2 s; en personal aplica directo, en compartido crea propuesta (PRD 11).
- [ ] `plan_day` genera el día y, para cada bloque al aire libre, ≥1 alternativa `plan_variant='rain'`; para bloques con riesgo de horario (cierra ≤60 min después del fin previsto) ≥1 `plan_variant='closed'`. En ≤60 s por día.
- [ ] La línea de tiempo y el mapa muestran solo `plan_variant='main'`; un chip "Plan B listo" indica que existe variante.
- [ ] `replan` con `reason:'rain'` y variante pre-generada resuelve sin LLM en ≤3 s; sin variante, job en ≤30 s.
- [ ] Re-planificación mínima: ante un problema en 1 bloque, modifica ≤3 bloques; nunca toca bloques `booked` ni `time_flex='fixed'` salvo que el usuario lo pida; escala de scope solo si hay desborde (tour → day → following_days).
- [ ] Urgencia: si el bloque afectado empieza en ≤60 min (o ya empezó) y `reason` ∈ rain/closed/late, se aplica directo con `agent_proposals.status='applied_urgent'`, `activity_feed` + `notify_member` a los participantes, y el guía lo avisa; `undo` disponible.
- [ ] Ánimo ("estoy fundido"): el guía solo **ofrece** una versión liviana; 0 cambios sin confirmación.
- [ ] `prepare_booking` devuelve `url` válida para cada canal: `https://wa.me/<E164 sin +>?text=…` (WhatsApp), `tel:` (teléfono), web del lugar (`websiteUri` de `place_details`), búsqueda de TheFork. Mensaje de WhatsApp en el idioma del usuario con nombre, cantidad de personas, fecha y hora.
- [ ] `prepare_booking` nunca envía nada ni cambia el bloque. Cuando el usuario dice "listo, reservé", `update_block` pone `status='booked'` y `booking_url`.
- [ ] Sin teléfono ni web: devuelve `{url:null, label:'Sin canal de reserva', fallback_urls:[google maps]}` y el guía lo dice.

## Pantallas y estados

- Tarjeta de acción (voz): ícono de la acción, "Moví la cena a las 21:00", Deshacer.
- Tarjeta de re-plan: "Plan B por lluvia · 2 cambios" con diff (componente del PRD 11) o banner "Apliqué un cambio urgente" + Deshacer.
- Chip "Plan B listo" en el bloque; al tocarlo, vista previa de la variante.
- Tarjeta de reserva: lugar, canal, texto del mensaje (editable), botón Abrir.
- Cargando: progreso del job (`agent_jobs`). Error: "No pude re-planificar, el plan sigue igual" + Reintentar. Vacío: el día sin bloques ofrece "Armame el día" → `plan_day`.

## Datos

- `blocks` (`plan_variant`, `time_flex`, `status`, `alerts`, `booking_url`, `sort_order`), `agent_proposals` (status `pending` o `applied_urgent`), `agent_jobs` (kinds `plan_day`, `replan`), `activity_feed` (kinds `replanned`, `plan_b_applied`, `booking_prepared`).
- Swap a plan B = 1 propuesta con 2 tipos de op `update`: los bloques `main` afectados pasan a `plan_variant='rain'` (quedan como respaldo) y los de variante pasan a `'main'`. Reversible con `undo` o con otro swap.

## Herramientas y endpoints

- `add_block` / `update_block` / `move_block` / `remove_block` / `add_idea` / `undo` expuestas a la sesión de voz (PRD 05).
- `plan_day` input `{trip_id, day_id, instruction?, with_plan_b:true}` → `{job_id}`.
- `replan` input `{trip_id, day_id, scope:'tour'|'day'|'following_days', reason:'rain'|'closed'|'late'|'tired'|'user_request'|'weather_forecast', block_id?, note?}` → `{proposal_id, applied:boolean}` o `{job_id}`.
- `prepare_booking` input `{block_id?, google_place_id?, channel:'whatsapp'|'phone'|'web'|'thefork', party_size, date, time, note?}` → `{url, label, message?, fallback_urls}`.
- Dentro del agente: `place_details` (horarios, `currentOpeningHours`), `route_eta`, `weather` (PRD 16, si está), `propose_changes`.

## Notas técnicas

- Agente `claude-opus-5-5`, esfuerzo `high` para `plan_day`/`replan`; salida estructurada = `ops` de Contratos.
- "Al aire libre" se calcula al vuelo: bloques `tour` siempre; `activity` cuyo lugar tiene tipos de Google como park, beach, plaza, tourist_attraction sin techo. No hay columna nueva.
- Atraso (`late`): recalcular con `route_eta` desde la ubicación actual; empujar `time_flex` no fijos, acortar `duration_min` hasta 30% antes de quitar algo.
- Disparadores de `replan`: voz, botón "Re-planificar" en el día, evento `[EVENTO:weather_change]` (PRD 16) y botón debug "Simular lluvia" para la demo.
- TheFork: `https://www.thefork.com/search?queryText=<nombre urlencoded>`; teléfono desde `internationalPhoneNumber` de Places normalizado a E.164.

## Fuera de alcance

Reservas reales, pagos, mensajes enviados por el agente, consulta de disponibilidad, detección automática de ánimo por tono de voz.

## Dependencias

05 (voz + herramientas + undo + tarjetas de acción), 11 (propuestas y diff). Opcional 16 (clima) para disparar plan B solo.

## Cómo probarlo

1. Seed día 2 Montevideo con tour Ciudad Vieja + almuerzo; correr `plan_day` con `with_plan_b` → verificar bloques `rain` en DB y chip "Plan B listo".
2. Sesión de voz: leer las 10 frases, contar aciertos (≥8).
3. Debug "Simular lluvia" con el tour en curso → guía ofrece plan B → "dale" → timeline cambia en ≤3 s; Deshacer vuelve.
4. Poner hora del dispositivo 30 min antes del almuerzo y `replan reason:'closed'` → `applied_urgent` + aviso en feed de los participantes.
5. "Reservame en el Jacinto a las 13 para 4" → abrir link → WhatsApp con texto correcto. Decir "listo, reservé" → bloque `booked`.
