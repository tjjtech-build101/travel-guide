---
nro: 23
prd: "23 · Gastos + presupuesto + foto del ticket"
prioridad: P2
estado: Por hacer
carril: Cerebro y contenido
tamano: L (2-4h)
depende_de: "04"
resumen: "Gastos tipo Splitwise liviano: presupuesto opcional o sin límite, multi-moneda con moneda base, split por participantes del bloque, saldos simplificados, marcar saldado, carga por voz y por foto del ticket con Claude visión, estimado vs real."
notion_url: https://app.notion.com/p/3fc81924a5c681aeb3b1df918ce0069a
---

# 23 · Gastos + presupuesto + foto del ticket

## Objetivo

Saber cuánto se gastó contra lo que se pensaba y quién le debe a quién, **sin pagos en la app**. Anotar un gasto tiene que llevar menos de 10 segundos: hablando o sacándole foto al ticket. El presupuesto es opcional ("sin límite" = solo se registran gastos reales).

## Momento de la demo

Acto 2, en la Ciudadela: Juan le saca foto al ticket del café → en unos 5 s aparece el formulario prellenado (Café Brasilero · UYU 1.240 · dividido entre Juan, Ana y Leo por ser participantes del bloque) → **Confirmar**. Después, por voz: "pagué 3.000 pesos argentinos el taxi, entre Ana y yo" → tarjeta de acción con deshacer. En la pestaña Gastos: "Leo le debe USD 12 a Juan" y la barra estimado vs real del día.

## Historias de usuario

- Como viajero, quiero anotar un gasto hablando y que se divida solo entre los del bloque.
- Como viajero, quiero sacarle foto al ticket y que se complete solo, pero confirmar yo.
- Como grupo, quiero ver saldos simplificados en una sola moneda base aunque paguemos en pesos uruguayos y argentinos.
- Como deudor, quiero marcar "saldado" cuando pago por fuera (efectivo, transferencia).
- Como organizador, quiero fijar un presupuesto por persona o "sin límite" y ver estimado vs real.

## Criterios de aceptación

- [ ] `add_expense` guarda `amount` y `currency` originales y calcula `amount_base` en `trips.base_currency` con `convert_currency` al momento de crear (la tasa queda fija desde ahí).
- [ ] Split por defecto: participantes del bloque (`block_participants`) si hay `block_id`; si no, `leg_members` del `leg_id`; si no, todos los miembros no `follower`. Pesos iguales.
- [ ] Split personalizado por voz ("entre Ana y yo", "yo pago doble") y por formulario (chips de participantes + peso).
- [ ] Si el usuario no dice el bloque, se asigna el bloque en curso según la hora (si hay uno) y se muestra en la tarjeta para corregir.
- [ ] Moneda por defecto: la del país del tramo activo (`legs.country`); si por voz el monto es ambiguo ("pagué 500") y el tramo es multi-moneda, el guía pregunta "¿pesos uruguayos?".
- [ ] `get_balances` devuelve neto por persona y la lista simplificada de transferencias (mínima cantidad, greedy deudor mayor ↔ acreedor mayor), descontando `settlements`. Voz y app usan el mismo cálculo (servidor).
- [ ] Marcar saldado crea una fila en `settlements` y el saldo cambia en todos los celus en menos de 2 s.
- [ ] `read_receipt` con la foto devuelve `{merchant, total, currency, date, items[], confidence}` en menos de 8 s y **nunca** guarda el gasto solo: siempre abre el formulario prellenado para confirmar.
- [ ] Si `confidence` es menor a 0.6 o falta total o moneda, el formulario marca esos campos "revisar".
- [ ] `budget_mode='limited'`: barra gastado vs presupuesto por persona (`trip_members.trip_prefs.budget_per_person`, en moneda base) y del grupo; `unlimited`: solo reales, sin barra ni alertas.
- [ ] Estimado vs real: por bloque (`blocks.cost_estimate` convertido vs suma de `expenses.amount_base` con ese `block_id`), por día y por viaje.
- [ ] Cada gasto escribe `activity_feed` (`expense_added`) y devuelve `undo_token`; saldar escribe `settled`.
- [ ] Los `follower` no ven la pestaña Gastos ni montos.

## Pantallas y estados

- **Pestaña Gastos**: arriba resumen (total gastado, presupuesto si aplica, mi saldo en verde/rojo); "Quién le debe a quién" con botón **Marcar saldado** por fila; lista de gastos agrupada por día (descripción, quién pagó, monto original + base, miniatura del ticket).
    - Vacío: "Todavía no hay gastos. Decile al guía 'pagué 500 el café' o sacale foto al ticket."
    - Sin presupuesto: no hay barra, solo totales.
- **Nuevo gasto**: monto + moneda, descripción, quién pagó (default yo), bloque (default el en curso), participantes (chips), botón cámara.
- **Ticket**: cámara → "Subiendo…" → "Leyendo ticket…" → formulario prellenado con campos en duda marcados → Confirmar. Error de lectura: "No pude leerlo, completalo a mano" con la foto adjunta igual.
- **Estimado vs real**: chip en el detalle del bloque ("estimado USD 30 · real USD 34") y en el resumen del día.
- **Tarjeta de acción** en la llamada cuando se anota por voz (con Deshacer).

## Datos

- `expenses`, `settlements`, `photos` (`kind='receipt'`), `trips.base_currency`, `trips.budget_mode`, `trip_members.trip_prefs.budget_per_person`, `blocks.cost_estimate` / `cost_currency`, `legs.country`, `block_participants`, `leg_members`.
- `expenses.split`: `[{user_id, share}]` donde `share` es **peso relativo** (1 = parte igual). Cada uno debe `amount_base × share / Σshare`.
- Redondeo a 2 decimales; la diferencia de redondeo se la queda el pagador.

## Herramientas y endpoints

- `add_expense` `{trip_id, amount, currency, description, payer_id?, block_id?, leg_id?, split?, receipt_url?}` → `{expense_id, amount_base}`.
- `get_balances` `{trip_id}` → `{base_currency, net:[{user_id, amount_base}], transfers:[{from_user, to_user, amount_base}], spent_total, budget?:{per_person, total}, by_day:[{day_id, estimate, actual}]}`.
- `read_receipt` `{trip_id, photo_url}` → `{merchant, total, currency, date, items:[{desc, amount}], confidence, photo_id}` (crea la fila en `photos` con `kind='receipt'`).
- `convert_currency` `{amount, from, to}` → `{amount, rate, as_of}`.
- `POST /uploads/sign` para subir la foto; `undo` para revertir.
- Marcar saldado: ver PROPUESTA abajo.

## Notas técnicas

- `read_receipt`: Claude `claude-opus-5-5`, esfuerzo `low`, imagen como input, salida estructurada Zod. Prompt: no inventar; campo ilegible → `null`; moneda solo si aparece símbolo/código o se infiere del país del comercio.
- Tasas para `convert_currency`: [open.er-api.com](http://open.er-api.com) (sin key, incluye UYU y ARS), cache en memoria 12 h; tasas fijas de respaldo en el seed para la demo. ARS usa la tasa de referencia publicada; la UI dice "tasa de referencia".
- `settlements` no está en Realtime: al saldar se escribe `activity_feed` (`settled`) y la app vuelve a pedir `get_balances` al ver ese evento o cambios en `expenses`.
- Gasto por voz: lo pide un humano, así que `add_expense` aplica directo (no es propuesta) y muestra tarjeta con deshacer.
- Editar un gasto: se deshace y se carga de nuevo (el `undo_token` queda en el feed).
- **PROPUESTA DE CAMBIO A CONTRATOS:** herramienta nueva `settle_up` `{trip_id, from_user, to_user, amount_base}` → inserta en `settlements`, escribe `activity_feed` (`settled`) y devuelve `undo_token` (también usable por voz: "ya le pagué a Juan"). Mientras no se apruebe: insert directo en `settlements` con supabase-js y RLS (solo `from_user`, `to_user` u organizador) + fila en `activity_feed`.

## Fuera de alcance

Pagos en la app o links a apps de pago, integración con Splitwise/Mercado Pago, categorías de gasto, gastos recurrentes, OCR sin conexión, tasas históricas por fecha del ticket, edición in situ de gastos.

## Dependencias

- PRD 04: miembros, tramos y participantes del viaje.

## Cómo probarlo

1. Seed: viaje con `base_currency='USD'`, `budget_mode='limited'`, `budget_per_person=500`; bloque café día 2 con Juan, Ana y Leo.
2. Foto de un ticket real impreso → formulario prellenado con UYU y 3 participantes → Confirmar → aparece en los 3 celus.
3. Por voz como Juan: "pagué 3.000 pesos argentinos el taxi, entre Ana y yo" → gasto ARS con split 2 personas y tarjeta de acción.
4. `get_balances` muestra transferencias simplificadas que cierran a 0 (suma de netos = 0).
5. Leo toca **Marcar saldado** → su fila desaparece en todos los celus.
6. Cambiar el viaje a `unlimited` → desaparece la barra de presupuesto.
7. Foto borrosa → campos marcados "revisar", nada guardado sin confirmar.
