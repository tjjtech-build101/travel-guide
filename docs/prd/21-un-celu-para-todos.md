---
nro: 21
prd: '21 · Modo "un celu para todos" (varias personas en una sesión 1 a 1 por altavoz; el guía distingue por nombre best-effort)'
prioridad: P1
estado: Por hacer
carril: Columna / voz / nativo
tamano: M (1-3h)
depende_de: '05'
resumen: 'Varias personas comparten una sesión de voz en un solo celu por altavoz; el guía sabe quiénes están, se dirige a cada uno por nombre y atribuye lo dicho best-effort, sin exponer memoria privada.'
notion_url: https://app.notion.com/p/3fc81924a5c681d28e57f252b3d927c3
---

# 21 · Modo "un celu para todos" (varias personas en una sesión 1 a 1 por altavoz; el guía distingue por nombre best-effort)

## Objetivo
Reemplazo barato de la llamada grupal (LiveKit queda para fase 2): una `voice_session` con varios `participants` en un mismo celu, por altavoz. El guía sabe quiénes escuchan, habla para el grupo, se dirige por nombre, pregunta "¿quién?" cuando importa (gastos, preferencias) y no trae memoria personal privada de nadie. Sin auriculares: el eco del parlante no debe hacer que el guía se interrumpa solo.

## Momento de la demo
Acto 2 (y toda la demo, que es sin auriculares): Juan, Ana y Leo alrededor de un celu en la Ciudadela. El guía: "Ana, vos que sos de arquitectura, mirá el arco…". Leo: "¿y esto de cuándo es?" → "Buena, Leo…".

## Historias de usuario
- Como grupo con un solo celu cargado, queremos escuchar todos al guía.
- Como participante, quiero que el guía me hable por mi nombre y tenga en cuenta lo que me gusta.
- Como participante, no quiero que el guía cuente delante de todos algo que le dije en privado.
- Como grupo, queremos anotar un gasto diciendo quién pagó.

## Criterios de aceptación
- [ ] Al iniciar una sesión (FAB de voz o "Iniciar tour"), opción "¿Quiénes escuchan?": chips con miembros del viaje (preseleccionados: yo + participantes del bloque actual) + hasta 3 invitados por nombre (no se guardan como usuarios).
- [ ] `voice_sessions.participants` guarda los `user_id` elegidos (≥2); los invitados van solo en las instrucciones.
- [ ] Instrucciones con, por participante: nombre, `interests` (top 3), `dietary`, `mobility`. 0 memorias `personal` en las instrucciones (verificado inspeccionando `session_config`).
- [ ] El guía se dirige por nombre a ≥2 participantes distintos en los primeros 5 min (cuando hay ≥2).
- [ ] Si alguien se presenta ("soy Ana") o el guía preguntó a alguien por nombre, atribuye lo siguiente a esa persona; si una acción depende de quién (gasto, preferencia, "anotame") y no está claro, pregunta "¿quién?" antes de llamar la herramienta (5 de 5 pruebas).
- [ ] Tocar un avatar en pantalla marca "habla Ana" y el guía lo usa para la próxima intervención.
- [ ] Eco por altavoz: en 10 respuestas del guía a volumen alto, ≥9 sin auto-interrupción falsa (objetivo 10/10).
- [ ] Al cerrar: memorias extraídas con `scope='trip'` por defecto; `personal` para un participante solo si la atribución fue explícita y no es sensible. Nunca se crean memorias para invitados.
- [ ] La sesión usa un solo idioma: el de quien la inicia (multilenguaje grupal fuera del MVP).

## Pantallas y estados
- **Hoja "¿Quiénes escuchan?"**: chips de miembros, campo "Agregar invitado", botón Empezar. Atajo "Solo yo".
- **Sesión multi**: fila de avatares de participantes (tocar = "habla X"), subtítulos con nombre cuando el guía se dirige a alguien, ícono de altavoz.
- Cargando: "Conectando…". Error de audio: "No pude usar el altavoz" + reintentar. Vacío: si el viaje tiene 1 miembro, la hoja no aparece.

## Datos
- `voice_sessions.participants uuid[]`, `persona_id`, `mode`, `summary`, `transcript`. `profiles` de cada participante (`display_name`, `interests`, `dietary`, `mobility`). `memories` al cerrar.

## Herramientas y endpoints
- **PROPUESTA DE CAMBIO A CONTRATOS:** `POST /voice/session` acepta `participants?: uuid[]` (default `[auth.uid()]`; todos deben ser miembros del viaje) y `guests?: string[]`.
- **PROPUESTA DE CAMBIO A CONTRATOS:** nuevo tipo de evento del mundo `speaker_changed` (`[EVENTO:speaker_changed] {user_id, name}`) para el "habla X" manual.
- Herramientas normales de la sesión (PRD 05). `add_expense` (PRD 23) recibe el `payer_id` que el guía resolvió preguntando.

## Notas técnicas
- Audio iOS: `AVAudioSession` categoría `playAndRecord`, modo `voiceChat` (activa AEC del sistema), opción `defaultToSpeaker`. Android: `MODE_IN_COMMUNICATION` + speakerphone. WebRTC con `echoCancellation`, `noiseSuppression`, `autoGainControl` en true.
- Turn detection: probar `semantic_vad` con eagerness `low`; si hay falsas interrupciones, `server_vad` con `threshold` 0.6–0.7 y `silence_duration_ms` 600. Elegir por la prueba de 10 respuestas.
- Prompt: "Estás hablando con un grupo por un altavoz: {lista}. No reveles nada que alguien te haya dicho en privado. Si no sabés quién habló y la acción depende de eso, preguntá. Repartí la atención."
- La regla de privacidad se refuerza en código: `/voice/session` con más de 1 participante no carga memorias `personal`.

## Fuera de alcance
Identificación de hablante por voz (diarización/biometría), varios celus en la misma sesión (LiveKit, fase 2), varios idiomas en una sesión, invitados como usuarios.

## Dependencias
05 (sesión de voz). Usa 14 (extracción de memorias) y 23 (gastos) si están.

## Cómo probarlo
1. Juan inicia sesión eligiendo Juan, Ana, Leo → `voice_sessions.participants` con 3 ids; `session_config` sin memorias personales.
2. Charla de 5 min por altavoz a volumen alto → el guía nombra a ≥2 personas; contar auto-interrupciones en 10 respuestas.
3. "Pagué 300 pesos el café" sin decir quién → el guía pregunta "¿quién pagó?".
4. Tocar avatar de Ana y hablar → el guía responde a Ana.
5. Juan le dijo algo privado en una sesión 1 a 1 previa → en la sesión grupal el guía no lo menciona.
6. Cerrar → memorias `trip` en DB, ninguna para invitados.
