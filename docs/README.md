# build101 · Guía de viaje con IA — Specs

> Exportado desde Notion el 2026-10-17. Fuente de verdad del producto: [Notion](https://app.notion.com/p/3fc81924a5c6819f97c6f18dd5f54083).
> Si cambiás una spec, cambiala en Notion y re-exportá (o actualizá ambos). Los contratos, una vez que existe el PRD-00, viven en el código (`supabase/migrations` + `packages/shared`).

**Para cada Claude que programe desde acá:** antes de arrancar un PRD, leé 1) [Producto](PRODUCT.md), 2) [Arquitectura](ARCHITECTURE.md), 3) [Contratos](CONTRACTS.md) (incluida la sección "Cambios v1.1") y 4) el PRD asignado completo. Los nombres de tablas, campos y herramientas de Contratos son obligatorios. Si la spec no alcanza o se contradice, frená y preguntá.

## Hitos

- Sáb ~11:00 Columna (PRD-00) lista → todos pasan a datos reales
- Sáb ~18:00 primer recorrido punta a punta de la demo
- Sáb 21:00 P0 completo
- Dom ~13:00 feature freeze → solo ensayo y bugs

Regla: **no se arranca un P1 hasta que el P0 corra punta a punta.**

## PRDs

### P0 — la demo de punta a punta

| # | PRD | Carril sugerido | Depende de |
|---|---|---|---|
| 00 | [Columna](prd/00-columna.md) | Columna / voz / nativo | — |
| 01 | [Crear viaje conversacional](prd/01-crear-viaje-conversacional.md) | Cerebro y contenido | 00 |
| 02 | [Pestaña Plan](prd/02-pestana-plan.md) | App y producto | 00 |
| 03 | [Mapa 3D](prd/03-mapa-3d.md) 🟡 2D | App y producto | 00 |
| 04 | [Multiplayer básico](prd/04-multiplayer-basico.md) | App y producto | 00 |
| 05 | [Guía 1 a 1 por voz](prd/05-guia-1a1-por-voz.md) | Columna / voz / nativo | 00 |
| 06 | [Generador de tours + contenido](prd/06-generador-de-tours-y-contenido.md) | Cerebro y contenido | 00 |
| 07 | [Tour en vivo](prd/07-tour-en-vivo.md) | Columna / voz / nativo | 00, 05, 06 |
| 08 | [Cámara a pedido](prd/08-camara-a-pedido.md) | Columna / voz / nativo | 00, 05 |
| 09 | [Simulador de GPS / replay](prd/09-simulador-gps-replay.md) ✅ | Cerebro y contenido | 00 |
| 10 | [Onboarding por voz + perfil](prd/10-onboarding-por-voz-y-perfil.md) | App y producto | 00, 05 |

### P1 — lo que hace que impresione

| # | PRD | Carril sugerido | Depende de |
|---|---|---|---|
| 11 | [Conciliación de preferencias + propuestas con diff](prd/11-conciliacion-y-propuestas.md) | Cerebro y contenido | 01, 04 |
| 12 | [Itinerario por voz + re-planificación + plan B](prd/12-replanificacion-en-vivo.md) | Cerebro y contenido | 05, 11 |
| 13 | [Ubicación en vivo + privacidad + encuentros](prd/13-ubicacion-en-vivo.md) | Columna / voz / nativo | 04, 07 |
| 14 | [Memoria en 3 capas](prd/14-memoria.md) | Cerebro y contenido | 05 |
| 15 | [Compañero + guías locales](prd/15-companero-y-guias-locales.md) | App y producto | 05, 06 |
| 16 | [Contexto: clima y eventos](prd/16-contexto-clima-eventos.md) | Cerebro y contenido | 01 |
| 17 | [Notificaciones](prd/17-notificaciones.md) | Columna / voz / nativo | 05, 13 |
| 18 | [Modo explorador / "Tour acá, ahora"](prd/18-modo-explorador.md) | Cerebro y contenido | 06, 07 |
| 19 | [Pantalla "Ahora"](prd/19-pantalla-ahora.md) | App y producto | 02 |
| 20 | [Idiomas + traductor de bolsillo](prd/20-idiomas-y-traductor.md) | App y producto | 05 |
| 21 | [Modo "un celu para todos"](prd/21-un-celu-para-todos.md) | Columna / voz / nativo | 05 |

### P2 — pulido

| # | PRD | Carril sugerido | Depende de |
|---|---|---|---|
| 22 | [Votaciones opcionales](prd/22-votaciones.md) | App y producto | 04, 11 |
| 23 | [Gastos + presupuesto + ticket](prd/23-gastos-y-presupuesto.md) | Cerebro y contenido | 04 |
| 24 | [Diario + Wrapped + postal + podcast + quiz](prd/24-diario-y-wrapped.md) | Cerebro y contenido | 05, 07 |
| 25 | [Viaje en el tiempo](prd/25-viaje-en-el-tiempo.md) | App y producto | 08 |
| 26 | [Datos útiles cerca](prd/26-datos-utiles-cerca.md) | App y producto | 07 |
| 27 | [Seguidor web sin app](prd/27-seguidor-web.md) | App y producto | 04, 13 |
| 28 | [Lugares guardados](prd/28-lugares-guardados.md) | App y producto | 03, 01 |
| 29 | [Modo niños + accesibilidad](prd/29-modo-ninos-y-accesibilidad.md) | App y producto | 06, 07 |
| 30 | [Llamada grupal con LiveKit (fase 2)](prd/30-llamada-grupal-livekit.md) | Columna / voz / nativo | 05 |
| 31 | [Planificador colaborativo](prd/31-planificador-colaborativo.md) | Cerebro y contenido | 01, 04 |
