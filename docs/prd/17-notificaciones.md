---
nro: 17
prd: '17 · Notificaciones: push, "el guía te llama" (CallKit / ConnectionService), briefing matinal y cierre del día, Live Activities / notificación fija, horas de silencio, topes, agrupado'
prioridad: P1
estado: Por hacer
carril: Columna / voz / nativo
tamano: L (2-4h)
depende_de: '05, 13'
resumen: 'Un único pipeline de notificaciones con canales (llamada del guía, push, feed, briefing), Live Activity / notificación fija, y reglas de silencio, topes y agrupado configurables por categoría.'
notion_url: https://app.notion.com/p/3fc81924a5c6811096dde3f9387e67c7
---

# 17 · Notificaciones: push, "el guía te llama" (CallKit / ConnectionService), briefing matinal y cierre del día, Live Activities / notificación fija, horas de silencio, topes, agrupado

## Objetivo
Que la app avise lo justo por el canal justo: **llamada del guía** (urgente, CallKit en iOS / ConnectionService en Android), **push**, **feed** y **briefing** (matinal + cierre del día). Con horas de silencio, tope de llamadas, agrupado y control por categoría. Más una **Live Activity** (iOS) / **notificación fija** (Android) con el bloque actual y el próximo.

## Momento de la demo
Acto 2: con el celu bloqueado, entra una llamada: "Lu · Tu guía" (pantalla nativa de llamada). Juan atiende: "Se viene lluvia en 30 minutos, tengo plan B, ¿lo cambio?". En la pantalla bloqueada se ve la Live Activity "Tour Ciudad Vieja · Parada 4/10 · Próxima: Cabildo en 3 min".

## Historias de usuario
- Como viajero, quiero enterarme de lo urgente aunque tenga el celu en el bolsillo.
- Como viajero, no quiero que me molesten de noche ni con diez pushes seguidos.
- Como viajero, quiero un resumen del día a la mañana y un cierre a la noche.
- Como viajero, quiero elegir por categoría qué me llega y cómo.
- Como viajero, quiero ver en la pantalla bloqueada qué viene.

## Criterios de aceptación
- [ ] Al loguearse y dar permiso se registra el token Expo en `device_tokens` (`platform` `ios` / `android`); en iOS además el token VoIP con `platform='ios_voip'`. El permiso se pide en el momento justo (primer evento relevante), no al abrir la app.
- [ ] Toda notificación pasa por `notify()` en la API; push llega en ≤5 s desde el evento (Expo Push API).
- [ ] Categorías: `plan`, `group`, `guide_call`, `briefing`, `expenses`, `location`, `tour`; cada una configurable a `call` / `push` / `feed` / `off` en `profiles.notification_prefs`. Defaults: guide_call=call, plan=push, group=push, briefing=push, expenses=feed, location=push, tour=push.
- [ ] Horas de silencio (`profiles.quiet_hours`, default 23:00–08:00 en la zona del tramo): solo pasan urgentes como push; nunca hay llamadas en silencio.
- [ ] Topes: ≤2 llamadas del guía por día y ≤10 push normales por día; lo que excede va al feed.
- [ ] Agrupado: push normales de la misma categoría dentro de 10 min se envían como 1 ("3 cambios en el plan"); `low` va solo al feed.
- [ ] Llamada del guía: dispara con urgencia (re-plan `applied_urgent`, `weather_change` con bloque al aire libre en ≤60 min, tour que empieza ahora y el usuario no está en sesión). iOS: pantalla nativa de CallKit con el celu bloqueado; Android: pantalla de llamada entrante. Atender abre la sesión de voz y el guía arranca con el motivo en ≤3 s. Rechazar → push con el resumen.
- [ ] Fallback si VoIP/CallKit no funciona en el dev build: push `interruptionLevel: time-sensitive` con acción "Atender" (aceptable para la demo).
- [ ] Briefing matinal a la hora según `chronotype` (early 07:30, normal 08:30, night 10:00): ≤90 palabras con clima, primer bloque, "salí a las X", alertas, propuestas pendientes; se guarda en `days.briefing` y "contame el día" por voz lo lee.
- [ ] Cierre del día a las 21:30: ≤60 palabras (qué hicieron, gastos del día si hay, a qué hora arranca mañana), en `activity_feed` kind `day_closing` + push.
- [ ] Live Activity (iOS) / notificación fija (Android) visible durante bloques y tours del día: bloque actual, próximo con cuenta regresiva, progreso del tour "Parada N/M"; se actualiza en ≤5 s al cambiar de parada o de bloque y se cierra al terminar el día.

## Pantallas y estados
- **Ajustes → Notificaciones**: lista de categorías con selector de canal, horas de silencio (2 time pickers), tope de llamadas (0–3), switch "agrupar".
- **Pantalla de llamada** nativa + pantalla in-app "Lu te está llamando" si la app está abierta.
- **Live Activity / notificación fija** (layout compacto y expandido).
- Vacío: feed "Todo tranquilo por ahora". Error: permiso denegado → banner en Ajustes "Las notificaciones están apagadas" + Abrir ajustes del sistema.

## Datos
- `device_tokens`, `profiles.quiet_hours` (`{start:'23:00', end:'08:00'}`), `profiles.notification_prefs` (`{categories:{…}, max_calls_per_day, bundle:true}`), `profiles.chronotype`, `days.briefing`, `activity_feed`.
- Registro de envíos para topes y agrupado: ver PROPUESTA en Notas técnicas.

## Herramientas y endpoints
- Módulo interno `apps/api/src/lib/notify.ts`: `notify({user_ids, trip_id, category, urgency:'urgent'|'normal'|'low', title, body, data:{deep_link, event?}})`. Lo usan `notify_member` (PRD 13), propuestas (11), re-plan (12), clima (16).
- Expo Push API `https://exp.host/--/api/v2/push/send`; VoIP push por APNs directo (`.voip` topic) para iOS; FCM data message `priority: high` para Android.

## Notas técnicas
- Llamada: `react-native-callkeep` + `react-native-voip-push-notification` (iOS) con config plugin en el dev build. Al atender, la app llama `POST /voice/session` y luego inyecta `[EVENTO:<tipo>]` con el motivo (tipos existentes: `weather_change`, `member_late`, `proposal_decided`, `time_warning`).
- Live Activity: `expo-live-activity` (o target nativo con `expo-apple-targets` si falla); Android: `@notifee/react-native` foreground service, el mismo que usa la ubicación en background (PRD 13).
- Briefing/cierre: Claude `low`; se genera uno por usuario (personalizado) y se guarda el del grupo en `days.briefing`.
- **PROPUESTA DE CAMBIO A CONTRATOS:** tabla `notifications(id, user_id, trip_id null, category text, urgency text, channel text check (channel in ('call','push','feed')), title, body, data jsonb, status text check (status in ('queued','sent','bundled','suppressed')), send_after timestamptz, sent_at timestamptz, created_at)` para topes, agrupado y auditoría. Fallback si no se aprueba: registrar en `activity_feed` con kind `notification_sent` y ocultar ese kind en la UI del feed.
- **PROPUESTA DE CAMBIO A CONTRATOS:** endpoint `POST /cron/tick` (header `x-cron-secret`) disparado cada 5 min (Vercel Cron si el plan lo permite; si no, `pg_cron` + `pg_net` desde Supabase) que: genera briefings y cierres a su hora, vacía la cola de agrupados vencidos y dispara llamadas de "tu tour empieza ahora".

## Fuera de alcance
SMS/email, notificaciones al seguidor web, widgets de pantalla de inicio, Apple Watch, notificaciones ricas con mapa.

## Dependencias
05 (sesión de voz y eventos), 13 (`notify_member`, foreground service de ubicación).

## Cómo probarlo
1. Login en 2 celus → filas en `device_tokens` (incluida `ios_voip`).
2. Crear 3 propuestas en 2 min → 1 solo push agrupado en el otro celu.
3. Poner horas de silencio que incluyan ahora → push normal no llega (va al feed); urgente sí.
4. Celu bloqueado + debug "Simular lluvia" con tour en ≤60 min → entra llamada nativa; atender → el guía arranca con el motivo. Tercera llamada del día → cae a push.
5. Llamar `/cron/tick` con la hora de briefing simulada → push de briefing y `days.briefing` lleno.
6. Iniciar tour → Live Activity visible; avanzar parada → se actualiza en ≤5 s.
