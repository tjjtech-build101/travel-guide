---
nro: 31
prd: "31 · Planificador colaborativo"
prioridad: P1
estado: "En curso"
carril: "Cerebro y contenido"
tamano: "XL"
depende_de: "01, 04"
resumen: "El planificador deja de imponer: entrevista corta, 2-3 formas del viaje, un catálogo del destino que asegura que no se pierda ningún imperdible, un menú por tramo donde el grupo reacciona, días armados por zona con lugares 'elegí 1 de N' y un reporte de cobertura."
---

# 🧭 31 · Planificador colaborativo

> 📌 Evoluciona el PRD 01. Contratos: ver "Cambios PRD 31" en [Contratos](../CONTRACTS.md).

## Objetivo

Que planificar un viaje se sienta como armarlo con un amigo que conoce cada ciudad: te pregunta solo lo que importa, te muestra opciones con sus pros y contras, se asegura de que no te pierdas nada imperdible y deja que el grupo elija. El plan final es personal (dice para quién es cada cosa), geográficamente lógico (un barrio por vez), factible (horarios, cierres, clima, ritmo) y explica lo que quedó afuera.

## Problemas del planificador anterior (PRD 01)

1. Ninguna lista de imperdibles: cada tramo improvisaba con búsquedas cortas; nada medía cobertura.
2. Imponía: todo `confirmed`, sin alternativas ni participación del grupo.
3. Entrevista fija de 5 preguntas, sin llegada/salida, alojamiento, presupuesto, primera vez ni chicos.
4. Sin geografía: días en zigzag.
5. Clima, eventos y cierres semanales disponibles pero sin usar.
6. Perfiles como JSON en el prompt; sin puntaje por persona.
7. Sin chequeo final de factibilidad.

## Flujo

1. **Contame** (texto libre) → `trip_brief`: "lo que entendí" + 0-4 preguntas con opciones y default. Precalienta el catálogo de cada destino en segundo plano.
2. **Formas del viaje** → `trip_shapes`: 2-3 variantes (reparto de días, escapadas) con pros/contras; una recomendada.
3. **¿Cómo lo armamos?** → `plan_trip` con la forma elegida:
   - `mode:'menu'` ("Armémoslo juntos"): tramos + días + traslados + **menú por tramo** (`leg_options`).
   - `mode:'auto'` ("Armalo vos"): lo mismo y arma los días con lo preseleccionado.
4. **Menú** (pantalla `/trip/[tripId]/menu`): secciones Imperdibles · Para ustedes · Joyas locales · Comida · Escapadas · En tus fechas. Cada miembro reacciona "Me copa / Paso / Sí o sí" (`react_option`), en vivo por Realtime.
5. **Armar los días** → `compose_days`: zonas → días (cierres, clima, eventos, llegada/salida, ritmo) → orden → comidas cerca → lugares "elegí 1 de N" (cena siempre; como mucho una actividad por día; nunca con un imperdible) → chequeo y reparación → **cobertura** ("11/12 imperdibles; quedó afuera X porque…").
6. **Elegir** en el plan → `choose_option`: confirma una opción, las demás van al banco de ideas. Deshacer siempre.

## Catálogo del destino

- Investigador (Claude + web search) en 2 pasadas independientes: **generar** (35-60 candidatos por categoría) y **revisar** (crítico que busca lo que falta). Imperdible solo con ≥2 fuentes o notoriedad alta.
- Cada ítem se resuelve en Google Places (nunca inventado), con horarios para lo que importa, duración, mejor franja, cubierto/al aire libre, reserva, costo aproximado, por qué, tip local y fuentes.
- Cache global por ciudad (`destination_catalog`, 30 días): el segundo viaje a la misma ciudad no paga investigación.
- Fallback: si el catálogo falla o queda chico, ese tramo usa el relleno por LLM del PRD 01.

## Criterios de aceptación

- [ ] `trip_brief` responde en ≤ 8 s y nunca pregunta algo que el usuario ya dijo.
- [ ] `trip_shapes` devuelve 2-3 variantes válidas (pasan `normalizeSkeleton`) en ≤ 25 s.
- [ ] Con `mode:'menu'`, cada tramo tiene ≥ 20 opciones y todos los imperdibles con `google_place_id` real.
- [ ] Reaccionar en un celu se ve en el otro en ≤ 2 s.
- [ ] `compose_days`: cada día con almuerzo y cena; nada agendado en un día cerrado; eventos en su fecha; escapadas fuera del día de llegada/salida; lo de afuera evita el día de lluvia ≥ 60 %; cena como elección de 3.
- [ ] Cobertura en el resultado y en la app; cada imperdible faltante con motivo y "Sumar a ideas".
- [ ] `choose_option` y `compose_days` se deshacen con un toque.
- [ ] Sin catálogo (sin key, error) el viaje se arma igual con el método del PRD 01.

## Cómo medirlo (eval)

Lista curada de imperdibles para 5 ciudades (Montevideo, Buenos Aires, Lisboa, Ciudad de México, Roma). Métricas por corrida: recall de imperdibles en el catálogo y en el plan, violaciones del chequeo (cerrado, comidas, traslados), elecciones por día, costo y tiempo. Cada cambio de prompt se mide contra eso.
