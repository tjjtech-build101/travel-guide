---
nro: 26
prd: "26 · Datos útiles cerca"
prioridad: P2
estado: Por hacer
carril: App y producto
tamano: M (1-3h)
depende_de: "07"
resumen: "\"¿Dónde hay un baño?\": café, baño, cajero, farmacia o comida cerca, con desvío estimado y abierto ahora, sin cortar el tour."
notion_url: https://app.notion.com/p/3fc81924a5c681769e10c572bc1b0c58
---

# 26 · Datos útiles cerca

## Objetivo

Resolver necesidades básicas en la calle (café, baño, cajero, farmacia, comida) en una frase o un toque, **sin salir del tour**: el tour sigue activo, el guía te espera y te ofrece volver.

## Momento de la demo

Acto 2, entre paradas: Ana dice "necesito un baño" → el guía: "Hay uno a 3 minutos, en el Café X, para clientes. ¿Te llevo? Después seguimos con el Cabildo". En el mapa aparece el pin y la ruta; al volver, el guía retoma.

## Historias de usuario

- Como turista, quiero encontrar un baño/café/cajero/farmacia cerca preguntando en voz alta.
- Como turista, quiero saber cuánto me desvía del tour.
- Como turista, quiero que el tour no se corte ni me rete por salirme de la ruta.

## Criterios de aceptación

- [ ] `nearby` `{lat, lng, kind, radius_m?, open_now?, limit?}` con `kind` = `cafe` / `bathroom` / `atm` / `pharmacy` / `food` (defaults: 600 m, `open_now=true`, 3 resultados) responde en menos de 2 s.
- [ ] Respuesta: `{results:[{google_place_id, name, lat, lng, distance_m, walk_min, open_now, closes_at?, rating?, price_level?, restroom_note?, detour_min?}]}` ordenada por `walk_min`.
- [ ] `walk_min` viene de Google Routes a pie (`route_eta`) para los 5 más cercanos por distancia en línea recta.
- [ ] Con tour activo, `detour_min` = (actual → lugar → próxima parada) − (actual → próxima parada).
- [ ] Baño: busca baños públicos de Places (New) y, además, cafés/shoppings/estaciones de servicio con `restroom=true`, con `restroom_note='para clientes'`.
- [ ] Sin resultados → amplía una vez a 1.200 m; si sigue vacío, el guía lo dice y sugiere la opción más cercana cerrada con su horario.
- [ ] Por voz el guía responde con la mejor opción en una frase (nombre, minutos, aclaración) y pregunta si te lleva; no lee la lista entera.
- [ ] Al aceptar "llevame": el tour queda `active`, entra en **desvío** (no se emite `[EVENTO:left_route]` mientras dure), el mapa muestra ruta a pie y pin. El desvío termina al llegar al lugar + volver a la ruta, o a los 20 min; ahí el guía ofrece seguir ("¿seguimos? el Cabildo está a 4 min").
- [ ] Si `profiles.mobility.step_free` es true, prioriza lugares con `accessibilityOptions.wheelchairAccessibleEntrance`.
- [ ] "Guardalo para después" → `add_idea` con el lugar.
- [ ] Funciona igual con `LocationProvider` real y simulado.

## Pantallas y estados

- **Chips rápidos** sobre el mapa del tour y en "Ahora": ☕ Café · 🚻 Baño · 🏧 Cajero · 💊 Farmacia · 🍴 Comida.
- **Hoja inferior** con hasta 3 resultados (nombre, a X min, abierto hasta HH:MM, desvío +N min, nota "para clientes") y botón **Llevame**.
- Pins en la capa "sugerencias" del mapa.
- **Banner de desvío**: "Desvío al baño · 3 min · Volver al tour".
- Estados: buscando / resultados / vacío / sin ubicación (usa la última posición conocida y lo avisa) / sin conexión.

## Datos

Sin tablas nuevas ni persistencia (solo `add_idea` si se guarda). Lee `profiles.mobility`, `tours`/`tour_stops` (próxima parada) y la posición del `LocationProvider`.

## Herramientas y endpoints

- `nearby` (Contratos, PRD 26).
- Reusa `route_eta`, `place_details` (al tocar un resultado), `add_idea`, `next_stop` / `tour_status` (PRD 07).

## Notas técnicas

- Google Places (New) `searchNearby` con `includedTypes` por `kind` (cafe: `cafe`, `coffee_shop`; atm: `atm`; pharmacy: `pharmacy`, `drugstore`; food: `restaurant`, `bakery`, `fast_food_restaurant`; bathroom: tipo de baño público si está en la tabla de tipos vigente + `restroom=true`) y `rankPreference=DISTANCE`.
- Field mask mínimo para costo: `id, displayName, location, currentOpeningHours, rating, priceLevel, restroom, accessibilityOptions`.
- Cache en memoria por (lat/lng redondeados a 3 decimales, `kind`) 5 min.
- El estado `detour` vive en el runtime del tour en el cliente (PRD 07) y es el que suprime `left_route`.
- Deuda conocida (Arquitectura): mostrar Places sobre Mapbox viola los términos de Google; OK para la hackathon.

## Fuera de alcance

Filtros por dieta o precio, reseñas, reservar, transporte público, baños de fuentes comunitarias (OSM/Flush), búsquedas sin tour fuera del chip.

## Dependencias

- PRD 07: tour en vivo (runtime, próxima parada, `left_route`).

## Cómo probarlo

1. Con `LocationProvider` simulado en el track de Ciudad Vieja y el tour activo, decir "necesito un baño" → respuesta en una frase con minutos y desvío.
2. Decir "llevame" → ruta en el mapa, banner de desvío; avanzar el track fuera de la ruta → no se dispara `left_route`.
3. Volver a la ruta → el guía ofrece seguir con la próxima parada.
4. Tocar el chip 🏧 → 3 cajeros ordenados por minutos a pie.
5. Llamar `nearby` en un punto en el medio del Río de la Plata → amplía a 1.200 m y devuelve vacío sin romper.
