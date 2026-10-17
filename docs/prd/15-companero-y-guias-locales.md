---
nro: 15
prd: '15 · Compañero + guías locales (personas, voces, traspaso en tours)'
prioridad: P1
estado: Por hacer
carril: App y producto
tamano: M (1-3h)
depende_de: '05, 06'
resumen: 'El usuario elige nombre, voz y estilo de su compañero, cada tour lo narra un guía local con voz propia, y el traspaso entre ambos es fluido y con la misma memoria.'
notion_url: https://app.notion.com/p/3fc81924a5c681238931fa31f9376234
---

# 15 · Compañero + guías locales (personas, voces, traspaso en tours)

## Objetivo
Darle identidad al guía: un **compañero** fijo (`persona(kind=companion)`) con nombre, voz y estilo elegibles, y **guías locales** (`persona(kind=local)`) que narran los tours de cada ciudad (ej. "Don Julio, vecino de Ciudad Vieja"). Comparten memoria. El traspaso compañero ↔ guía local al iniciar y terminar un tour es natural y corto.

## Momento de la demo
Acto 2: Juan toca "Iniciar tour". Su compañero ("Lu") dice "Te paso con Don Julio, que vive acá hace 60 años" y en ≤3 s entra otra voz: "¡Buenas, Juan! Lu me contó que te gusta el art déco…". Al terminar, vuelve Lu.

## Historias de usuario
- Como viajero, quiero elegir cómo se llama, cómo suena y qué tono tiene mi compañero.
- Como viajero, quiero que en cada ciudad me guíe alguien "de ahí", con otra voz y personalidad.
- Como viajero, quiero que el guía local ya sepa lo que le conté al compañero.
- Como familia con chicos, quiero un estilo para chicos.

## Criterios de aceptación
- [ ] Selector de compañero (onboarding y perfil): nombre libre (1–20 caracteres, default "Lu"), 6 voces de OpenAI Realtime con preview de ≤5 s, estilo `serious` / `neighbor` / `kids`. Guarda en `profiles.guide_name`, `guide_voice`, `guide_style`.
- [ ] La preview suena en ≤500 ms al tocar (mp3 locales empaquetados).
- [ ] Seed de `personas`: 1 `companion` base con `system_prompt` genérico; `local` "Don Julio" (Montevideo) y "Martina" (Buenos Aires), cada uno con `voice`, `style` y `system_prompt` de ≤300 palabras.
- [ ] `generate_tour` asigna `tours.persona_id` con la persona local de esa ciudad; si no existe, crea una nueva (nombre, estilo, voz distinta a la del compañero del usuario, prompt) en ≤10 s.
- [ ] Traspaso al iniciar tour: el compañero dice 1 frase de presentación, se cierra su sesión y se abre una `voice_session` `mode='tour'` con `persona_id` local; silencio entre la última palabra y la primera del local ≤3 s (medir 3 veces).
- [ ] El guía local saluda por nombre y hace referencia a ≥1 memoria del usuario cuando existe.
- [ ] Al terminar el tour (o "pasame con Lu"), traspaso inverso con las mismas reglas; el compañero menciona 1 cosa del tour.
- [ ] En un traspaso nunca suenan dos personas con la misma voz.
- [ ] Si le preguntan "¿sos una persona real?", la persona local responde que es un personaje creado por la app (regla en todos los prompts).
- [ ] Durante la sesión se ve quién habla: avatar + nombre de la persona en el header y en los subtítulos.

## Pantallas y estados
- **Elegir compañero**: input nombre, grilla de 6 voces (play), 3 estilos con ejemplo de frase, botón Guardar.
- **Header de sesión**: avatar (inicial + color derivado del `personas.id`), nombre, ciudad si es local.
- **Transición**: animación de 2 avatares cruzándose + texto "Lu te pasa con Don Julio".
- Cargando: "Conectando con Don Julio…". Error de conexión en el traspaso: volver al compañero y mostrar "No pude conectar con el guía local" + Reintentar. Vacío: sin persona elegida → se usa el default.

## Datos
- `personas` (kind, name, city, style, voice, system_prompt). `profiles.guide_name`, `guide_voice`, `guide_style`. `tours.persona_id`. `voice_sessions.persona_id`, `mode`.
- El compañero del usuario = fila `companion` base + override con los campos de `profiles` (no se crea una fila por usuario).

## Herramientas y endpoints
- `POST /voice/session {mode, trip_id?, tour_id?}`: con `tour_id` usa `tours.persona_id`; sin tour usa el compañero. Arma instrucciones = `system_prompt` de la persona + estilo + memoria (PRD 14) + idioma.
- `generate_tour` (PRD 06) llama la función interna `pickOrCreateLocalPersona(city, country, avoidVoice)`.
- `start_tour` (PRD 07) dispara el traspaso en la app.

## Notas técnicas
- En OpenAI Realtime la voz no se puede cambiar después de que la sesión emitió audio, por eso el traspaso es **cerrar y abrir otra sesión**. Para ganar tiempo: pedir el token de la sesión local mientras el compañero dice la frase de presentación (esperar `response.done` y recién ahí cortar).
- Voces: elegir 6 de las disponibles en el modelo Realtime configurado (ej. `marin`, `cedar`, `coral`, `sage`, `ash`, `verse`); validar contra la lista vigente al arrancar.
- Previews: script `apps/api/scripts/gen-voice-previews.ts` que genera 1 mp3 por voz con la TTS de OpenAI y los deja en `apps/mobile/assets/voices/`.
- Estilos: `serious` (datos y contexto), `neighbor` (anécdotas, rioplatense, humor), `kids` (frases cortas, preguntas, misiones). El estilo del usuario modula a la persona local, no la reemplaza.
- La persona local recibe en sus instrucciones: "Venís de parte de {guide_name}" para el saludo.

## Fuera de alcance
Clonación de voces, voces del pasado, avatares ilustrados o animados, elegir guía local entre varios por ciudad, marketplace de guías.

## Dependencias
05 (sesión de voz), 06 (generación de tours). Usa memoria del PRD 14 si está.

## Cómo probarlo
1. Perfil → Elegir compañero: nombre "Lu", voz `marin`, estilo `neighbor`; previews suenan.
2. Hablar con Lu → se presenta como Lu con esa voz.
3. Iniciar el tour Ciudad Vieja → traspaso a Don Julio; medir silencio con cronómetro (≤3 s).
4. Generar un tour en una ciudad sin persona local (ej. Colonia) → nueva fila en `personas` con voz distinta.
5. "¿Sos real?" → admite que es un personaje.
6. Terminar tour → vuelve Lu y menciona algo del recorrido.
