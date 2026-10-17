---
title: "🎯 1 · Producto"
notion_url: https://app.notion.com/p/3fc81924a5c681f1be4ce49704ebf276
---

# 🎯 1 · Producto

## Visión

Un compañero de viaje con IA para **cualquier turista en cualquier lugar del mundo**. Planificás todo el viaje (varios destinos y países, solo o en grupo) y cuando llegás a un lugar lanzás un **tour guiado por un agente de voz** que es proactivo, sigue un recorrido, usa contenido verificado y recuerda lo que te interesa. Ciudad Vieja (Montevideo) es el escenario de la demo, no el límite del producto.

## Por qué no "ChatGPT con voz"

- **Proactivo:** te habla solo al llegar a cada parada (GPS + geofence). No esperás a preguntar.
- **Sigue un recorrido y un plan:** sabe dónde estás, qué viene, cuánto tiempo queda, y re-planifica.
- **Contenido verificado:** cada dato con fuente; si no sabe, lo admite. Nunca inventa fechas, nombres ni cifras.
- **Memoria:** recuerda qué te interesó y no te repite historias.
- **Multiplayer:** planificación compartida + personal, conciliación de preferencias del grupo.
- **Hace trabajo real:** arma y re-arma itinerarios, crea propuestas, anota gastos, guía en la calle.

## Glosario (usar estos nombres en código y UI)

| Término | En código | Qué es |
| --- | --- | --- |
| Viaje | `trip` | Unidad multiplayer. Tiene miembros, tramos, bloques, gastos, diario. |
| Miembro | `trip_member` | Persona en el viaje con rol: organizador, viajero o seguidor. |
| Tramo | `leg` | Destino + fechas + participantes (subset del viaje). Puede haber tramos paralelos (el grupo se separa). |
| Día | `day` | Un día dentro de un tramo. |
| Bloque | `block` | Unidad del itinerario (actividad, comida, tour, traslado, alojamiento, libre, encuentro). Tiene participantes. Sin día = banco de ideas. |
| Propuesta | `agent_proposal` | Cambio sugerido (diff) sobre bloques compartidos. Se acepta o rechaza. |
| Votación | `poll` | Opcional. 2–4 opciones, fecha límite. El organizador puede decidir directo. |
| Compañero | `persona(kind=companion)` | El guía fijo del usuario: planifica, media, anota gastos. Nombre y voz elegibles. |
| Guía local | `persona(kind=local)` | Personaje local que narra los tours (ej. "Don Julio, vecino de Ciudad Vieja"). Comparte memoria con el compañero. |
| Sesión de voz | `voice_session` | Llamada con el guía. Modo `chat` o `tour`. MVP: 1 persona (o varias en un mismo celu). |
| Tour | `tour` | Recorrido con paradas. Planificado, espontáneo o explorador. |
| Parada | `tour_stop` | Lugar del tour con geofence, "qué mirar", narración en capas y fuentes. |
| Biblioteca de lugares | `place_library` | Contenido verificado por lugar, global y reutilizable entre usuarios. |

## Decisiones cerradas (grill del 16/10)

### Alcance y prioridades

- Planificador y guía son **igual de importantes**. Viaje **multiplayer**.
- Fuera del MVP: edición en tiempo real con presencia/cursores, voces del pasado, multilenguaje dentro de la llamada grupal, modo offline, panel B2B, analytics para gobierno, marca blanca, tours comunitarios, AR, reservas reales, álbum imprimible/PDF.
- **Llamada grupal (LiveKit)**: fase 2 / si sobra tiempo. MVP = 1 a 1 + modo "un celu para todos".
- Regla de construcción: **no se arranca un P1 hasta que el P0 corra punta a punta**.

### Estructura del viaje

- Viaje → Tramos (destino+fechas+participantes) → Días → Bloques. Traslados entre tramos como bloques `transfer`.
- **Varios destinos y varios países.** Un solo viaje aunque el grupo se separe: cada tramo tiene sus participantes, se permiten tramos paralelos; reencuentros = tramo con la unión.
- Visibilidad: **todos ven todo el viaje**, pero planificar, notificaciones y gastos involucran solo a los del tramo/bloque. Lo personal privado se ve como "ocupado".

### Bloques

- Tipos: `activity`, `meal`, `tour`, `transfer`, `lodging`, `free`, `meetup`.
- Cada bloque tiene participantes (todos = grupo, subset = subgrupo, yo = personal; puede ser privado).
- Estados: `idea → proposed → confirmed → booked`.
- Banco de ideas: bloques sin día.
- **El agente propone en lo compartido (diff a aceptar) y aplica directo en lo personal.** Los humanos editan directo.

### Mapa

- Superficie de planificación: niveles viaje / día / tour, **3D**, capas (mi ruta / grupo / personas / ideas / sugerencias / participantes en vivo), sincronizado con la línea de tiempo, arrastrar para reordenar, tocar lugar → agregar, mantener apretado → "¿qué hay acá?", vista previa animada del día.
- **Lugares guardados** ("Want to go") a nivel usuario, reutilizables en cualquier viaje.

### Perfil y onboarding

- Onboarding general por voz (~2 min) con alternativa de chips: intereses con peso, ritmo, horario, presupuesto, comida, movilidad, idiomas, estilo, cosas que odia, persona del guía.
- Onboarding por viaje (~30 s): objetivo, presupuesto (o sin límite), "sí o sí", "ni loco", con quién viaja.
- Aprendizaje implícito + **perfil transparente y editable**. Login con Google.

### Multiplayer

- Roles: **organizador** (todo), **viajero** (edita sus tramos, agrega personal, propone), **seguidor** (solo ve; ubicación si se la habilitan). Seguidor puede ver por web sin app.
- Invitar por link/QR/WhatsApp, a todo el viaje o a tramos específicos.
- Cambios ajenos aparecen solos (sync en vivo, sin presencia). Feed de actividad.
- Ubicación en vivo: opt-in por viaje (siempre / solo bloques compartidos y tours [default] / nunca), modo fantasma temporal, se apaga al terminar el viaje. Llegada a encuentros, "¿dónde está todo el mundo?", aviso de rezagado, punto de reencuentro.
- Votaciones **opcionales**: el organizador puede decidir directo. El agente genera opciones, explica trade-offs, propone separarse; votación hablada.
- Gastos: presupuesto (opcional; "sin límite" = solo reales) + gastos tipo Splitwise liviano, multi-moneda, sin pagos en app, por voz y por foto de ticket.

### El guía

- **Compañero fijo** (concierge) + **guías locales** en los tours, misma memoria.
- Memoria en 3 capas: personal (privada), del viaje (compartida), de contenido (qué se contó). **Lo dicho en 1 a 1 es privado por defecto.** Callbacks, no repetir, "¿qué me perdí?", "olvidá eso".
- Sesión de voz = participantes + modo (`chat`/`tour`). Entrar: botón flotante, "iniciar tour", sumarse a una en curso, el guía te llama (configurable).
- En tour: **activo/dormido**. Lo despiertan geofence, botón del auricular, botón en pantalla, cámara, eventos del agente. Silencio inteligente. Sin wake word en el MVP.
- Herramientas: **todo lo interno sí; nada externo** (reservas = deep link preparado, sin mensajes a terceros, sin pagos).

### Tours

- Origen: planificado (bloque tour), espontáneo ("Tour acá, ahora"), curado (base editorial). Contenido escrito **por adelantado** con fuentes.
- Parada: geofence, "qué mirar", narración en 3 capas (corta / contame más / lo que nadie sabe), mito vs realidad, punto de foto, misión para niños, fuentes. Narraciones de tramo + navegación por voz. Trama opcional.
- Reglas: orden flexible; si te salís, ofrece volver o explorar; **modo explorador** (radar de historias); profundidad según permanencia; respeta el reloj; tour grupal arranca cuando llega la mayoría.

### Contenido y confianza

- 3 niveles: curado / investigado con fuentes (verificación en 2 pasadas) / improvisado (admite no saber o busca con fuente).
- Cámara: foto + GPS + orientación. Fuentes visibles, "reportar error", biblioteca global de lugares (foso defensivo).

### Re-planificación, notificaciones, después

- Re-planificar lo mínimo (tour → día → días siguientes), diff visible, aceptación por voz, urgencias aplican y avisan, **plan B pre-generado** (lluvia/cerrado). Ánimo detectado solo *ofrece*.
- Canales: llamada del guía (urgente) / push / feed / briefing (matinal + cierre del día). Horas de silencio, tope de llamadas, agrupar, control por categoría.
- Diario vivo por día (grupo + personal), Wrapped del viaje, postal, podcast 3 min, quiz, link público, recuerdo "hace un año".

### Idiomas

- Contenido en idioma base + traducción al vuelo. El guía habla el idioma de cada persona; cambio en vivo. App ES/EN. Bloques compartidos traducidos con opción de ver original. **Traductor de bolsillo.**

### UX (mejoras adoptadas)

Tarjetas de acción de lo que hace la voz · deshacer universal · llamada con contexto (mantener apretado → hablar de esto) · sonidos/haptics para modo bolsillo · pantalla "Ahora" en días de viaje · Live Activities / notificación fija · alertas en bloques · nunca pantalla vacía + progreso del agente en vivo · permisos en el momento justo · seguidor web sin app · una mano + modo exterior · tolerante a mala conexión · exportar a calendario / compartir día · subtítulos y accesibilidad.

## Demo (borrador, no cerrado)

Gancho → Acto 1 planificar juntos (itinerario se llena en vivo en mapa 3D, compañero se suma por QR, conciliación con diff) → Acto 2 guía en la calle (replay del paseo grabado + GPS simulado, narración proactiva en la Ciudadela, interrupción, cámara a foto impresa, "se largó a llover" → plan B) → Acto 3 modo explorador en vivo en FIUM + Wrapped → negocio. **Sin auriculares en la demo:** probar eco del parlante.
