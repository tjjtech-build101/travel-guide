---
nro: 25
prd: "25 · Viaje en el tiempo"
prioridad: P2
estado: Por hacer
carril: App y producto
tamano: M (1-3h)
depende_de: "08"
resumen: "\"¿Cómo era esto?\": imagen recreada con IA de una parada en otra época, armada solo con hechos verificados y siempre rotulada como recreación, nunca como foto histórica."
notion_url: https://app.notion.com/p/3fc81924a5c681d6b9cad9273463bb9a
---

# 25 · Viaje en el tiempo

## Objetivo

Momento wow en el tour: ver una recreación de cómo era el lugar en otra época, anclada en hechos verificados de `place_library`, con honestidad explícita: es una **recreación generada con IA, no una foto histórica real**.

## Momento de la demo

Acto 2, frente a la Puerta de la Ciudadela, después de la cámara: "¿cómo era esto en 1800?" → la imagen aparece (pre-generada, menos de 1 s) con el sello "Recreación con IA · no es una foto real", slider antes/ahora con la foto que sacó Juan, y el guía narra 2 datos con fuente sobre la muralla.

## Historias de usuario

- Como turista, quiero ver cómo era el lugar donde estoy parado en otra época.
- Como turista, quiero elegir la época entre las que tienen datos.
- Como turista, quiero saber claramente que es una recreación y en qué datos se basa.

## Criterios de aceptación

- [ ] `time_travel_image` `{place_id, year?, era_label?, photo_id?, tour_id?}` devuelve `{image_url, caption, year, disclaimer, facts_used:[{text, source_url}], cached}`; si no está en cache devuelve `{job_id}` y el resultado llega por `agent_jobs`.
- [ ] El prompt de imagen se arma **solo** con `place_library.facts` con `verified=true` del lugar; si no hay hechos para esa época devuelve `ok:false` con `reason='sin_fuentes'` y el guía dice que no tiene datos suficientes para recrearlo.
- [ ] Toda imagen lleva el sello quemado en los píxeles ("Recreación con IA — no es una foto histórica") y `caption` empieza con "Recreación". El guía nunca dice "esta es una foto de…" (regla en el prompt de la persona).
- [ ] La pantalla muestra debajo los `facts_used` con su fuente tocable.
- [ ] Cache por `(place_id, year)` en Storage `time-travel/{place_id}/{year}.jpg`: la segunda llamada responde en menos de 1 s con `cached=true`.
- [ ] Si viene `photo_id` (foto de `look_at_photo`) y el proveedor soporta imagen de referencia, se usa para mantener el encuadre; si no, texto a imagen. La foto del usuario se muestra en el slider antes/ahora igual.
- [ ] Timeout 30 s → mensaje amable ("No me salió, sigamos"); el tour nunca se bloquea.
- [ ] Prompt de imagen sin personas reales identificables, sin texto en la imagen, sin violencia.
- [ ] Script `pnpm seed:time-travel` pre-genera las 10 paradas del tour de demo para 1–2 épocas cada una.

## Pantallas y estados

- Botón **¿Cómo era?** en la ficha de la parada y en el resultado de la cámara (PRD 08).
- Selector de época: chips sugeridos desde los facts (ej. "1726 fundación", "1830", "1900"); solo épocas con hechos.
- Visor: imagen a pantalla completa con sello; slider antes/ahora si hay foto del usuario; hechos con fuentes; Compartir (el sello viaja con la imagen).
- Estados: generando (progreso del job, "Mezclando planos y crónicas…") / listo / sin fuentes / error.

## Datos

- Lee: `place_library` (`facts`, `name`, `lat`, `lng`), `tour_stops`, `photos` (entrada).
- Escribe: archivo en Storage; `agent_jobs` (`kind='time_travel'`); `activity_feed` (`time_travel`, payload con `image_url`).
- No se guarda en `photos` (su `kind` no admite imágenes generadas), así que no entra al diario.

## Herramientas y endpoints

- `time_travel_image` (Contratos, PRD 25). Disponible para el guía de voz y como botón.
- Reusa `look_at_photo` (PRD 08) para identificar `place_id` desde la cámara, `POST /uploads/sign`, `GET /jobs/:id`.
- Al terminar un job iniciado desde la llamada, la app inyecta `[EVENTO:photo_result]` con payload `{"source":"time_travel", "caption", "facts_used"}` para que el guía lo narre.

## Notas técnicas

- **Proveedor de generación de imágenes: DECISIÓN PENDIENTE.** Implementar detrás de una interfaz `ImageGenProvider.generate({prompt, referenceImageUrl?, size})` elegida por la env `IMAGE_PROVIDER`. Candidatos a comparar: OpenAI gpt-image-1 (key ya en el servidor), Google Imagen/Gemini, Flux (fal/Replicate). Criterios: latencia menor a 15 s, imagen de referencia, calidad arquitectónica, costo. Hasta decidir: proveedor `mock` que devuelve imágenes placeholder del seed.
- Prompt builder: Claude `claude-opus-5-5`, esfuerzo `low`, convierte facts + época en un prompt visual (arquitectura, materiales, calles, vestimenta genérica, luz). Devuelve también `facts_used`.
- Sello: composición server-side con `sharp` (franja inferior semitransparente + texto).
- Llamada asíncrona: la herramienta responde enseguida con `job_id` para no trabar la sesión de voz.
- **PROPUESTA DE CAMBIO A CONTRATOS** (opcional): agregar `'generated'` al check de `photos.kind` para poder sumar recreaciones al diario.

## Fuera de alcance

Video o animación, superposición en AR, recrear personas históricas reales, "voces del pasado" (fuera del MVP), elegir año libre sin hechos.

## Dependencias

- PRD 08: cámara (`look_at_photo`) e identificación del lugar.

## Cómo probarlo

1. Con `IMAGE_PROVIDER=mock`, pedir por voz en la parada 1 del seed "¿cómo era en 1800?" → imagen con sello y hechos con fuente.
2. Repetir → `cached=true`, menos de 1 s.
3. Pedir una época sin hechos ("en el año 1500") → el guía dice que no tiene datos.
4. Con el proveedor elegido, correr `pnpm seed:time-travel` y verificar las 10 imágenes en Storage.
5. Revisar el transcript: el guía nunca la llama "foto" sin aclarar que es recreación.
