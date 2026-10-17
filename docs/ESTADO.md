# Estado del proyecto · sábado 17/10 (tarde)

> Resumen de todo lo que está en `main` (PRs #1–#13) y lo que falta. Ver también `docs/DECISIONES-SABADO.md`.

## Flujo principal
"Estés donde estés, el scout te arma un tour verificado y te guía por voz." Hoy funciona de punta a punta en el simulador con GPS simulado; la voz anda con OpenAI Realtime. **Bloqueante:** la key de Anthropic se quedó sin crédito (todo lo que usa Claude falla hasta cargar una key nueva).

## Qué hay en `main`

| Área | PRD | PR | Qué hace |
|---|---|---|---|
| Base | 00 | — | Monorepo, esquema Supabase + RLS, API Hono con herramientas, regla "el agente propone en lo compartido", deshacer, login demo |
| Planificación | 01 | — | Viaje armado por chat con Claude; el itinerario se llena en vivo |
| Planificación | 02 | — | Línea de tiempo, filtros, crear/editar bloques, banco de ideas, propuestas, .ics |
| App | 19 · vistas | #1, #2 | 3 vistas (Planificación · Mapa · Ahora); Ahora con "qué toca", "Salí en X" y botones del scout; avatar del scout |
| App | 10 (mín.) | #4 | Onboarding con chips + Perfil |
| App | 09 | #3 | Simulador de GPS (replay 1x–10x, saltar a parada, grabación de tracks, "Caminarlo" para cualquier tour) |
| App | 03 (2D) | #5 | Mapa del recorrido; tocás algo → "Hablar con Scout de esto" |
| UI | — | #7 | Paleta beige, tipografías, avatar del scout, mapa estilo antiguo |
| Voz | 05 | #6 | Llamada 1 a 1 con el scout (OpenAI Realtime), herramientas por el backend, tarjetas con Deshacer, `voice.injectEvent` |
| Tours | 06, 18 (API), 16 | #8 | `generate_tour` (investigación + verificador), `weather`, `events_search` |
| Cámara | 08 | #11 | `look_at_photo`: foto + GPS + orientación → qué estás mirando |
| Caminar | 07 | #9, #10, #12, #13 | Herramientas del tour, motor de caminata (llegada, desvío, reloj, permanencia, silencio), tour en vivo dentro de Ahora, plan B sin voz, GPS en segundo plano, "Tour acá, ahora", posición fresca en las herramientas de la voz |

## Infra
- Repo: github.com/tjjtech-build101/travel-guide · API: https://travel-guide-api-ten.vercel.app (21 herramientas) · Supabase nube: `veavkvhxmzzkgxhkqrub` (sa-east-1).
- Migraciones en la nube: por el SQL Editor (`pnpm db:bundle`), porque la red de FIUM bloquea Postgres. **Pendiente aplicar `20261017000008_nearby_place_library` si nadie lo hizo.**

## Pendiente
- 🚨 **Key de Anthropic con crédito** (Vercel + `.env`).
- **Vigilante de horarios** (este PR): avisar "salí ya / vas tarde / por empezar" por notificación local o, en llamada, con `[EVENTO:schedule_alert]`.
- Probar en un celu real: llamada con el scout hablando solo al llegar, pantalla bloqueada, batería.
- Tour real generado cerca del venue + grabar el paseo de la demo (quién camina: pendiente).
- Dormir/despertar al scout y botón del auricular (PRD 07, no hecho).
- `generate_tour`: `themes` y `extend_tour_id` se aceptan pero no se usan.
- `events_search`: repartir por días; fuentes son listados, no la página del evento.
- Pitch (3 min + 3 de preguntas) y declaración de trabajo previo.
