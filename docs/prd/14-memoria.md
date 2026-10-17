---
nro: 14
prd: '14 · Memoria en 3 capas + perfil transparente + callbacks + "¿qué me perdí?" + "olvidá eso"'
prioridad: P1
estado: Por hacer
carril: Cerebro y contenido
tamano: M (1-3h)
depende_de: '05'
resumen: 'El guía recuerda lo que te importa (personal privado, del viaje compartido, de contenido ya contado), lo muestra en un perfil editable, hace callbacks, resume lo que te perdiste y olvida cuando se lo pedís.'
notion_url: https://app.notion.com/p/3fc81924a5c681e99c7cfa68e7b591ca
---

# 14 · Memoria en 3 capas + perfil transparente + callbacks + "¿qué me perdí?" + "olvidá eso"

## Objetivo
Memoria en 3 capas: **personal** (privada, `memories.scope='personal'`), **del viaje** (compartida, `scope='trip'`) y **de contenido** (`content_told`: qué se contó de cada lugar y en qué capa). Lo dicho en 1 a 1 es privado por defecto. El usuario ve y edita todo lo que el guía sabe o dedujo de él.

## Momento de la demo
Acto 2: en la segunda parada el guía dice "Como ayer me dijiste que te copa el art déco, mirá la fachada de enfrente…". Al pasar de nuevo por la Plaza Matriz no repite la historia: "Esta ya te la conté; ¿querés la que nadie sabe?". Juan dice "olvidá lo de que odio el candombe" → "Listo, lo olvidé" y desaparece de "Lo que sé de vos".

## Historias de usuario
- Como viajero, quiero que el guía se acuerde de lo que me gusta sin repetírselo.
- Como viajero, quiero ver qué sabe y qué dedujo de mí, y borrarlo.
- Como miembro que se separó del grupo, quiero preguntar "¿qué me perdí?" y tener un resumen corto.
- Como viajero, quiero que lo que le cuento en privado no lo sepa el grupo.

## Criterios de aceptación
- [ ] Al cerrar sesión (`POST /voice/session/:id/end`) se extraen de 0 a 8 memorias con Claude esfuerzo `low`; con el transcript de prueba (3 preferencias + 2 datos triviales) se guardan las 3 y ninguna trivial.
- [ ] Memorias de una sesión 1 a 1 se guardan `scope='personal'`; pasan a `scope='trip'` solo si el usuario lo pidió explícito ("anotalo para el grupo", "contale a todos").
- [ ] Si el usuario dijo "olvidá eso" o "no lo guardes" en la sesión, la extracción no guarda eso (verificado con transcript de prueba).
- [ ] `remember` guarda en ≤1 s y el guía confirma ("Me lo anoto").
- [ ] `forget` hace soft delete (`deleted_at`) en ≤1 s, borra también los `inferred_traits` derivados y el guía confirma qué olvidó. `forget {last:true}` borra la última memoria creada por ese usuario.
- [ ] `/voice/session` arma instrucciones con hasta 10 memorias relevantes (personales del usuario + del viaje) y los lugares de `content_told` del día; el guía hace ≥1 callback en los primeros 2 min cuando hay una memoria relacionada con la parada.
- [ ] No repetir: si `content_told` tiene `(user_id, place_id, 'short')`, el guía no repite esa capa y ofrece `more` o `secret`; cada capa narrada se registra en `content_told` (upsert).
- [ ] `recall {mode:'missed', since}` devuelve ≤5 bullets en ≤8 s con lo que pasó en el viaje desde `since`: `activity_feed`, memorias `trip`, `voice_sessions.summary` de sesiones del viaje con 2 o más participantes. Nunca incluye memorias personales de otros.
- [ ] RLS: con el JWT de Ana, `select` a `memories` personales de Juan devuelve 0 filas.
- [ ] "Lo que sé de vos" refleja cambios en la próxima sesión (editar o borrar → no aparece en las instrucciones).

## Pantallas y estados
- **Perfil → "Lo que sé de vos"** con 4 secciones: *Lo que me dijiste* (campos de `profiles` editables), *Lo que deduje* (`inferred_traits` con evidencia y botones Confirmar / Borrar), *Recuerdos* (memorias personales, borrar con 1 toque + confirmación), *Del viaje* (memorias `trip` del viaje actual; borra el autor o el organizador).
- Vacío: "Todavía no sé mucho de vos. Hablemos un rato." Cargando: skeleton. Error: "No pude cargar tu perfil" + Reintentar.
- Tarjeta de acción en la sesión: "Anoté: te gusta el art déco" / "Olvidé: …" con Deshacer.

## Datos
- `memories` (scope, user_id, trip_id, kind, text, source_session_id, deleted_at). Valores de `kind`: `preference`, `dislike`, `fact`, `story_interest`, `plan_note`.
- `content_told` (user_id, place_id, layer ∈ `short`/`more`/`secret`, told_at).
- `profiles.inferred_traits` con forma `[{key, value, evidence, source_session_id, confidence, updated_at}]`; en la UI se muestran solo con `confidence` ≥ 0.6. "Confirmar" mueve el dato al campo de perfil correspondiente (ej. `interests`).
- `voice_sessions.summary`, `transcript`.

## Herramientas y endpoints
- `remember` input `{scope:'personal'|'trip', kind, text, trip_id?}`.
- `forget` input `{memory_id?, query?, last?:boolean}` (con `query` borra la memoria más parecida y la devuelve para que el guía confirme).
- `recall` input `{trip_id?, query?, mode:'relevant'|'missed', since?, limit?}`.
- `POST /voice/session` (inyecta memorias) y `POST /voice/session/:id/end` (extracción) del PRD 05.

## Notas técnicas
- Relevancia sin embeddings: filtrar por `kind` + coincidencia de texto (ILIKE con palabras clave de la parada/lugar/tema) + recencia; tope de 10 en el prompt. Si hace falta más, Claude `low` elige entre las últimas 50.
- Extracción: un solo llamado `claude-opus-5-5` esfuerzo `low` con salida estructurada `{memories:[{scope, kind, text}], inferred_traits:[…], language_change?}`; la regla de privacidad va en el prompt y se reverifica en código (si la sesión tiene 1 participante y no hay pedido explícito → forzar `personal`).
- `since` para "¿qué me perdí?" lo manda la app: último `ended_at` de sesión del usuario o el último momento en que abrió la app (guardado en AsyncStorage).
- El guía nunca dice "según mi memoria": hace el callback natural.

## Fuera de alcance
Búsqueda semántica con embeddings, memoria entre viajes de otros usuarios, exportar memorias, compartir memorias personales selectivamente.

## Dependencias
05 (sesión de voz, herramientas, cierre de sesión). `content_told` se completa también desde 07 (`get_stop_content`).

## Cómo probarlo
1. Sesión 1: "me encanta el art déco, odio el candombe". Cerrar → ver 2 memorias personales en DB y en "Lo que sé de vos".
2. Sesión 2 en tour: en una parada con fachada art déco el guía hace callback.
3. Volver a la Plaza Matriz → no repite la corta.
4. "Olvidá lo del candombe" → `deleted_at` seteado, desaparece de la pantalla.
5. Con Ana: `select` a memorias de Juan → 0. Ana pregunta "¿qué me perdí?" después de un bloque grupal → ≤5 bullets sin datos personales de Juan.
