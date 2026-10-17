---
nro: 8
prd: "08 · Cámara a pedido"
prioridad: P0
estado: Por hacer
carril: Columna / voz / nativo
tamano: M (1-3h)
depende_de: "00, 05"
resumen: "look_at_photo: sacás una foto (botón o por voz), Claude visión con GPS, orientación y lugares cercanos identifica qué es, lee placas, y el guía lo narra vía [EVENTO:photo_result] en ≤4 s; la foto queda en el diario."
notion_url: https://app.notion.com/p/3fc81924a5c681689084f5989c39b4c8
---

# 08 · Cámara a pedido

## Objetivo

Apuntás el celu a algo y preguntás "¿qué es esto?": en ≤4 s el guía te dice qué estás mirando, usando contenido verificado si el lugar está en `place_library`, y te lee o traduce placas e inscripciones. La cámara es una herramienta (`look_at_photo`), no una feature aparte: el resultado entra a la conversación como `[EVENTO:photo_result]` y la foto queda en `photos` para el diario.

## Momento de la demo

Acto 2: con el GPS simulado parado en Ciudad Vieja, el presentador apunta la cámara a una **foto impresa** (p. ej. la Puerta de la Ciudadela o una placa) y toca el botón de cámara. En ≤4 s el guía dice qué es y agrega un dato con fuente. Variante: "¿qué dice esa placa?" por voz.

## Historias de usuario

- Como viajero en un tour, toco el botón grande de cámara, saco la foto y el guía me cuenta qué es.
- Como viajero, digo "mirá esto" o "¿qué dice esa placa?" y se abre la cámara.
- Como viajero que no habla el idioma, saco foto a un cartel y el guía me lo traduce.
- Como viajero, si el guía no reconoce el lugar, me lo dice en vez de inventar.
- Como viajero, después encuentro esas fotos en el diario del día con el nombre del lugar.

## Criterios de aceptación

- [ ] La cámara se abre desde: el botón de la pantalla de tour (PRD 07), el botón de cámara de la barra de llamada (PRD 05) y por voz (el modelo llama `look_at_photo`).
- [ ] Latencia, del disparo a la primera palabra del guía: p50 ≤4 s y p95 ≤6 s en 4G/Wi-Fi, medido en 10 fotos. Se loguean los tiempos de cada tramo (captura, subida, Claude, inyección).
- [ ] Identificación: en 10 fotos de prueba (impresas o reales) de las paradas curadas de Ciudad Vieja, con la ubicación del lugar, ≥8 devuelven `place.place_id` correcto.
- [ ] Si `place.confidence` es menor a 0,6, el guía dice que no está seguro y describe lo que ve; nunca afirma un nombre ni un dato histórico.
- [ ] Todo año, nombre propio o cifra de `narration` viene de `place_library.facts` con `verified=true` o está leído literalmente en la imagen (inscripción).
- [ ] Inscripciones: si hay texto legible, `inscriptions` trae el original y, si el idioma difiere de `profiles.locale`, la traducción.
- [ ] El resultado se inyecta como `[EVENTO:photo_result]` en la sesión activa; si no había sesión, se abre una (`POST /voice/session`, modo según contexto) en paralelo con la subida.
- [ ] Por voz no hay doble respuesta: la function call devuelve enseguida `{ status: 'capturing' }` y la narración llega solo por el evento.
- [ ] Se inserta una fila en `photos` con `kind='camera'`, `lat`, `lng`, `taken_at` y `caption` = nombre del lugar (o "Sin identificar").
- [ ] La imagen subida pesa ≤400 KB (lado mayor 1280 px, JPEG calidad 0,7).
- [ ] La cámara despierta al guía si estaba dormido (PRD 07).

## Pantallas y estados

- **Cámara** (modal pantalla completa, `app/camera.tsx`): visor, botón de disparo grande (≥80 pt) abajo al centro, cerrar arriba a la izquierda, chip con la pregunta si vino por voz ("¿Qué dice esa placa?").
- **Mirando:** la foto congelada con un brillo animado y "Mirando…". Haptic suave al disparar. Si pasan 2,5 s, se agrega "Un segundo…".
- **Resultado:** tarjeta sobre la foto con el nombre del lugar (o "No lo reconozco"), chip "Curado" o "Investigado", inscripciones con traducción, botón "Fuentes" y "Listo". El modal se cierra solo a los 6 s si el guía está hablando; la tarjeta queda en el transcript.
- **Error de permiso:** explicación + "Abrir Ajustes".
- **Error de subida o de servidor:** 2 reintentos automáticos; después "No pude mandar la foto" + "Reintentar". El guía no dice nada en ese caso.
- **Vacío:** no aplica (siempre hay foto). Si la imagen sale negra o movida (Claude lo marca en `quality`), "Salió movida, probá de nuevo".

## Datos

Tablas: `photos` (escritura, `kind='camera'`), `place_library` (lectura de cercanos y facts), `tour_stops` (si hay tour activo), `profiles` (`locale`), `voice_sessions`.

**Storage:** bucket `photos`, ruta `<user_id>/<trip_id o 'sin-viaje'>/<uuid>.jpg`. `photos.url` guarda la ruta de Storage (no una URL firmada que expira).

**Contrato de `look_at_photo`** (`packages/shared/tools/look_at_photo.ts`):

```typescript
export const LookAtPhotoInput = z.object({
  storage_path: z.string(),                 // la llena la app después de subir
  lat: z.number(), lng: z.number(),
  heading: z.number().min(0).max(360).nullable(), // grados, norte verdadero; null si no hay brújula
  accuracy: z.number().nullable(),
  question: z.string().optional(),          // "¿qué dice esa placa?"
  trip_id: z.string().uuid().optional(),
  tour_id: z.string().uuid().optional(),
  taken_at: z.string().datetime(),
});

export const LookAtPhotoOutput = z.object({
  narration: z.string(),                    // ≤60 palabras, para que el guía lo diga
  place: z.object({ place_id: z.string().uuid().nullable(), name: z.string(), confidence: z.number() }).nullable(),
  inscriptions: z.array(z.object({ original: z.string(), language: z.string(), translation: z.string().nullable() })),
  facts_used: z.array(z.object({ text: z.string(), source_url: z.string() })),
  quality: z.enum(['ok', 'blurry', 'dark']),
  photo_id: z.string().uuid(),
});
```

**Evento:** `[EVENTO:photo_result] {"photo_id":"…","question":null,"place":{"place_id":"…","name":"Puerta de la Ciudadela","confidence":0.92},"narration":"…","inscriptions":[],"facts_used":[…]}`

## Herramientas y endpoints

- `POST /uploads/sign` → URL firmada de subida a Supabase Storage (PRD 00). La app sube con `uploadToSignedUrl` o `PUT`.
- `POST /tools/look_at_photo` (este PRD) con el input de arriba. Devuelve `{ ok, data: LookAtPhotoOutput }`.
- Para el modelo de voz, la herramienta `look_at_photo` se expone con un esquema reducido `{ question?: string }`: la app intercepta la llamada, abre la cámara, completa el resto y llama al endpoint.
- Inyección: helper de PRD 05 (`[EVENTO:photo_result]`).
- Claude Opus 5.5 (`claude-opus-5-5`), effort `low`, imagen base64 + texto.

## Notas técnicas

**Cliente (orden del flujo, todo lo posible en paralelo):**

1. `expo-camera` (`CameraView`, `takePictureAsync({ quality: 0.7, exif: false })`). Pedir el permiso recién al abrir la cámara por primera vez.
2. En paralelo: tomar `lat`, `lng`, `accuracy` y `heading` de `LocationProvider` (en modo simulado salen del track: así funciona la demo con foto impresa). En modo real, `heading` de `Location.watchHeadingAsync` (`trueHeading`; si vale -1, mandar null). Si no había sesión de voz, abrirla ya.
3. `expo-image-manipulator`: resize a 1280 px de lado mayor, JPEG 0,7 (≈150–300 KB).
4. `POST /uploads/sign` → subir. Meta: ≤800 ms en 4G.
5. `POST /tools/look_at_photo` → al volver, inyectar `[EVENTO:photo_result]`.

**Servidor** (`apps/api/src/tools/lookAtPhoto.ts`):

1. Descargar la imagen de Storage con la service key (misma región, rápido) y pasarla como `{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } }`. Hacerlo en paralelo con la consulta de cercanos.
2. Cercanos: `place_library` con `ST_DWithin(geo, punto, 200)` ordenado por distancia, máx. 8, más las paradas del tour activo. Para cada uno calcular distancia, rumbo y ángulo relativo al `heading` (marcar "enfrente" si está a ±35°). Mandar a Claude nombre, distancia, ángulo y sus facts verificados (máx. 5 por lugar).
3. `client.messages.parse({ model: 'claude-opus-5-5', max_tokens: 2000, thinking: { type: 'adaptive' }, output_config: { effort: 'low', format: zodOutputFormat(LookAtPhotoModelOutput) } })`, donde `LookAtPhotoModelOutput` es el output sin `photo_id`. No usar `tool_choice` forzado (400 en Opus 5.5). Chequear `stop_reason === 'refusal'`.
4. Prompt: "Identificá qué muestra la foto usando la imagen y la lista de lugares cercanos con su dirección. Podés usar solo los FACTS dados y el texto visible. Si no estás seguro, decílo. Respondé en el idioma del usuario, en un tono hablado de ≤60 palabras." Si viene `question`, priorizar responderla.
5. Insertar en `photos` y devolver con `photo_id`.

**Presupuesto de latencia (meta 4 s):** captura + resize 300 ms · subida 800 ms · descarga + cercanos 200 ms · Claude `low` ≈2 s · inyección + primera palabra de Realtime 600 ms. Si Claude se pasa de 3 s de forma sistemática: bajar la imagen a 1024 px y achicar el prompt. No usar `web_search` acá: rompe la latencia.

**Gotchas**

- La cámara y WebRTC comparten la sesión de audio en iOS: abrir `CameraView` sin audio (`mode='picture'`) para no cortar al guía.
- En Android, `takePictureAsync` puede tardar 1 s en algunos equipos: mostrar el freeze frame con el primer frame del visor para que se sienta instantáneo.
- La brújula en iOS necesita calibración y adentro de edificios falla: tratar `heading` como pista, no como verdad.
- La foto impresa en la demo: no hay pista de profundidad, así que el peso lo llevan la imagen y la lista de cercanos. Probar con las fotos impresas reales que se van a usar.

**Orden de implementación sugerido:** (1) endpoint `look_at_photo` probado con curl y una imagen de la Ciudadela; (2) pantalla de cámara + subida; (3) inyección del evento y respuesta del guía; (4) disparo por voz; (5) medir latencia y ajustar.

**PROPUESTA DE CAMBIO A CONTRATOS**

- `photos.place_id uuid null references place_library` y `photos.heading double null`: para que el diario muestre el lugar identificado (hoy solo se puede poner en `caption`).
- `photos.trip_id` nullable: un tour espontáneo puede no tener viaje.

## Fuera de alcance

- Video o cámara continua (tipo "modo AR").
- Fotos desde la galería (`kind='gallery'`) y tickets (`read_receipt`, PRD 23).
- Imagen "cómo era" (`time_travel_image`, PRD 25).
- Cola offline de fotos.
- Investigar lugares desconocidos con `web_search` en vivo (se puede ofrecer "lo investigo para después" en otro PRD).

## Dependencias

- **PRD 00:** `POST /uploads/sign`, bucket `photos`, tabla `photos`, `LocationProvider`.
- **PRD 05:** sesión de voz, barra de llamada, reenvío de function calls, helper de inyección.
- Usa si existe: PRD 07 (botón en la pantalla de tour, despertar) y el seed de PRD 06 (facts de Ciudad Vieja). Sin PRD 06 funciona, pero sin datos verificados.

## Cómo probarlo

1. Imprimir (o tener en otra pantalla) fotos de 3 paradas curadas y una placa con texto en otro idioma.
2. Activar GPS simulado y saltar a la parada "Puerta de la Ciudadela" (PRD 09).
3. Desde la barra de llamada, tocar la cámara → aceptar el permiso → apuntar a la foto impresa → disparar. Cronometrar hasta que el guía empieza a hablar: ≤4 s.
4. Verificar que dice el nombre correcto y que el dato que menciona aparece en `place_library.facts` (Studio).
5. Decir "¿qué dice esa placa?" → se abre la cámara con el chip de la pregunta → disparar a la placa → el guía la lee y la traduce. No hay dos respuestas.
6. Apuntar a algo random (una taza) → el guía dice que no lo reconoce como lugar y describe lo que ve, sin inventar historia.
7. Revisar en Supabase: filas en `photos` con `kind='camera'` y `caption`; abrir el diario del día y ver las fotos.
8. Con el modo avión activado, disparar → aparece "No pude mandar la foto" + "Reintentar".
