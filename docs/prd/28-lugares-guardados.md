---
nro: 28
prd: "28 · Lugares guardados \"Want to go\""
prioridad: P2
estado: Por hacer
carril: App y producto
tamano: M (1-3h)
depende_de: "03, 01"
resumen: "Lugares guardados a nivel usuario (saved_places): se guardan desde el mapa o la ficha, se reutilizan en cualquier viaje y el planificador los propone cuando el viaje pasa por esa ciudad."
notion_url: https://app.notion.com/p/3fc81924a5c681e791bbf76bcd9bf197
---

# 28 · Lugares guardados "Want to go"

## Objetivo

Una lista personal de lugares "quiero ir", reutilizable en cualquier viaje. Guardar es un toque desde el mapa o la ficha; cuando un viaje pasa por esa ciudad, el planificador los trae solo.

## Momento de la demo

Acto 1: al crear el tramo Buenos Aires, el feed dice "Tenés 3 lugares guardados en Buenos Aires" y el planificador incluye "Café Tortoni · ⭐ guardado por Sofi" en el día 4.

## Historias de usuario

- Como usuario, quiero guardar un lugar desde el mapa o su ficha con una nota ("me lo recomendó Caro").
- Como usuario, quiero ver mis guardados agrupados por país y ciudad.
- Como viajero, quiero que al planificar en una ciudad el agente me proponga lo que tengo guardado ahí.
- Como viajero, quiero pasar un guardado al banco de ideas de un viaje.

## Criterios de aceptación

- [ ] Botón ⭐ **Guardar** en la ficha de lugar (datos de `place_details`) y en el resultado de "¿qué hay acá?" (mantener apretado en el mapa); inserta en `saved_places` con `google_place_id`, `name`, `lat`, `lng`, `city`, `country`.
- [ ] `city` y `country` salen de `addressComponents` de Places (`locality` / `country`, código ISO-2 en `country`).
- [ ] Si ya está guardado (mismo usuario + `google_place_id`), la estrella aparece llena y tocarla lo borra, con toast **Deshacer** de 5 s. No se crean duplicados.
- [ ] Nota opcional de hasta 140 caracteres, editable.
- [ ] Pantalla **Mis lugares** (en Perfil): agrupada país → ciudad, buscador por nombre, deslizar para borrar, **Agregar a un viaje** → elegir viaje y tramo → `add_idea` (bloque sin día).
- [ ] En el mapa, mis guardados dentro del área visible se muestran como pin ⭐ en la capa "ideas".
- [ ] `plan_trip` y `plan_day`/`replan` reciben los guardados de los miembros del tramo que caen en ese destino (misma `city`+`country` o a 30 km o menos de `legs.lat`/`lng`) y los priorizan si encajan en horario y ritmo; el bloque generado lleva en `notes` "⭐ Guardado por Sofi" y en el diff de la propuesta se ve igual.
- [ ] Al crear un tramo en una ciudad con guardados de sus miembros, se escribe en `activity_feed` (`saved_places_match`) "Tenés N lugares guardados en Buenos Aires" con botón **Sumarlos al banco de ideas** (varios `add_idea`).
- [ ] RLS: cada usuario lee y escribe solo sus `saved_places`; el planificador los lee con service role y solo los de miembros del tramo.

## Pantallas y estados

- Ficha de lugar y hoja de "¿qué hay acá?": estrella vacía/llena, "Guardado" con nota.
- **Mis lugares**: lista agrupada; vacío: "Guardá lugares con ⭐ desde el mapa y te los propongo cuando viajes ahí".
- Mapa: pins ⭐ en la capa "ideas".
- Feed: tarjeta de coincidencia con botón.

## Datos

- `saved_places` (Contratos) tal cual. `blocks.notes` para la marca "⭐ Guardado por …".
- Lee `legs` (`city`, `country`, `lat`, `lng`) y `leg_members`.
- Distancia: haversine sobre `lat`/`lng` (la tabla no tiene `geo`; con pocos registros por usuario alcanza).

## Herramientas y endpoints

- Guardar/borrar desde la app: insert/delete directo en `saved_places` con supabase-js (dato personal, RLS por `user_id`).
- Reusa `place_details`, `search_places`, `add_idea`, `plan_trip` (PRD 01), `plan_day` / `replan`.
- **PROPUESTA DE CAMBIO A CONTRATOS:** herramienta `save_place` `{google_place_id, note?}` para guardar por voz ("guardame este lugar") y desde el agente; resuelve `name`/`lat`/`lng`/`city`/`country` con `place_details`. Sin ella, guardar es solo por UI.

## Notas técnicas

- En el planificador, inyectar los guardados en el contexto como lista compacta `{name, google_place_id, saved_by, note}` (máximo 20 por tramo, los más recientes) e instruir: "incluí guardados cuando encajen; no fuerces; mencioná quién lo guardó".
- Mostrar "guardado por Sofi" a los compañeros de tramo es aceptable (no es contenido de una charla 1 a 1); no se muestran guardados de gente fuera del tramo.
- Unicidad usuario + lugar se controla en código (select antes de insert). Índice único `(user_id, google_place_id)` recomendado (cambio menor de esquema, anotar en Contratos si se agrega).

## Fuera de alcance

Importar listas de Google Maps, listas múltiples o compartidas, carpetas/etiquetas, guardar lugares sin `google_place_id`.

## Dependencias

- PRD 03: mapa (fichas, "¿qué hay acá?", capas).
- PRD 01: planificador (`plan_trip`).

## Cómo probarlo

1. Como Sofi, mantener apretado sobre el Café Tortoni en el mapa → Guardar con nota.
2. Tocar de nuevo la estrella → se borra; Deshacer → vuelve; verificar que no hay duplicados en la tabla.
3. Mis lugares muestra Argentina → Buenos Aires → Tortoni.
4. Crear el tramo Buenos Aires con Sofi → aparece la tarjeta "Tenés 1 lugar guardado" en el feed.
5. Correr `plan_trip` del tramo → un bloque Tortoni con "⭐ Guardado por Sofi".
6. Como Juan, consultar `saved_places` con supabase-js → no ve los de Sofi.
