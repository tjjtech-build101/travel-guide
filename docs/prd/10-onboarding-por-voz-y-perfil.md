---
nro: 10
prd: "10 · Onboarding por voz + perfil"
prioridad: P0
estado: Por hacer
carril: App y producto
tamano: M (1-3h)
depende_de: "00, 05"
resumen: "Onboarding general de ≈2 min charlando con el compañero (o con chips), extracción estructurada a profiles, elección de nombre/voz/estilo del guía y pantalla Perfil transparente y editable (inferred_traits, memoria, lugares guardados, privacidad, notificaciones, idioma)."
notion_url: https://app.notion.com/p/3fc81924a5c68146adc1f2706dcbd479
---

# 10 · Onboarding por voz + perfil

## Objetivo

Que el guía te conozca desde el minuto uno sin formularios: una charla de ≈2 minutos con el compañero (o, si preferís, chips en ≤60 s) llena `profiles` con intereses con peso, ritmo, horario, presupuesto, comida, movilidad, idiomas, estilo y cosas que odiás. Elegís nombre, voz y estilo del guía. Después, la pantalla Perfil te muestra **qué cree el guía de vos** y te deja corregirlo, junto con memoria, lugares guardados, privacidad, notificaciones e idioma. El onboarding por viaje es del PRD 04.

## Momento de la demo

Gancho / previa del Acto 1 (opcional, 20–30 s): "la primera vez, la app no te pide un formulario: te presenta a tu guía". Se muestra un pedazo de la charla y la pantalla "Esto entendí de vos" llenándose. Más tarde, en el Perfil, "tu guía cree que te gusta la arquitectura" con ✓ / ✗.

## Historias de usuario

- Como usuario nuevo, después de entrar con Google elijo cómo se llama mi guía, su voz y su estilo.
- Como usuario, charlo 2 minutos con el guía sobre cómo me gusta viajar y al final veo un resumen de lo que entendió, que puedo corregir antes de guardar.
- Como usuario que no quiere hablar, completo lo mismo tocando chips.
- Como usuario, en Perfil veo "tu guía cree que te gusta…" y confirmo o descarto cada cosa.
- Como usuario, veo y borro lo que el guía recuerda de mí.
- Como usuario, controlo con quién comparto mi ubicación en cada viaje, cuándo me puede llamar el guía y en qué idioma está la app.

## Criterios de aceptación

- [ ] Si `profiles.onboarded_at` es null al entrar, la app abre el onboarding; si no, va al inicio.
- [ ] Elección del guía: nombre (texto libre, 1–20 caracteres, con 3 sugerencias), voz (≥4 opciones con muestra de audio de ≤5 s que suena en ≤500 ms) y estilo (`serious` / `neighbor` / `kids`, mostrados como "Serio", "Vecino", "Para chicos"). Se guardan en `profiles.guide_name`, `guide_voice`, `guide_style`.
- [ ] El permiso de micrófono se pide recién al tocar "Charlemos", con una línea previa que explica para qué.
- [ ] Charla: el guía usa el nombre, la voz y el estilo elegidos (se pasan en `POST /voice/session`). Cubre ≥8 de los 10 temas y cierra solo entre 90 y 150 s. A los 150 s el guía redondea y corta. Hay un botón "Terminar" siempre visible.
- [ ] Indicador de progreso con los 10 temas que se van marcando según la conversación avanza (basado en el transcript, ver Notas técnicas).
- [ ] Al terminar, la extracción está lista en ≤10 s (p50) y muestra "Esto entendí de vos" con todos los campos editables.
- [ ] La extracción llena ≥80% de los temas que el usuario mencionó (medido en 3 charlas de prueba con guion) y no inventa: lo no mencionado queda vacío.
- [ ] Alternativa de chips: ≤3 pantallas, completable en ≤60 s, mismos campos.
- [ ] Guardar escribe `profiles` (campos de abajo) + `onboarded_at = now()` en una sola actualización. Los rasgos inferidos van a `inferred_traits` con `source: 'onboarding'`.
- [ ] Perfil: la sección "Tu guía cree que te gusta…" lista `inferred_traits` no descartados; ✓ lo confirma (y si es un interés, lo suma a `interests` con peso 3), ✗ lo descarta (no vuelve a aparecer). Cambios visibles en ≤1 s.
- [ ] Cambiar nombre, voz o estilo del guía se refleja en la próxima sesión de voz.
- [ ] Memoria: lista de `memories` con `scope='personal'` del usuario y `deleted_at` null; "Olvidar" en cada una y "Borrar toda mi memoria" con confirmación.
- [ ] Lugares guardados: lista de `saved_places` con borrar (deslizar) y tocar → abre el mapa centrado.
- [ ] Privacidad: por cada viaje, selector de `trip_members.location_sharing` (Siempre / Solo bloques compartidos y tours / Nunca) y modo fantasma (`ghost_until`: 1 h / 3 h / hasta mañana / apagar).
- [ ] Notificaciones: horas de silencio, "el guía me puede llamar" (sí/no), tope de llamadas por día y categorías on/off; se guardan en `quiet_hours` y `notification_prefs`.
- [ ] Idioma: Español / English cambia toda la UI sin reiniciar y guarda `profiles.locale`.

## Pantallas y estados

**Onboarding** (`app/onboarding/*`):

1. Bienvenida: "Te presento a tu compañero de viaje" + "Empezar".
2. Tu guía: nombre, voces (tarjetas con ▶), estilo (3 tarjetas con un ejemplo de frase).
3. ¿Cómo seguimos?: "Charlemos 2 minutos" (principal) / "Prefiero tocar opciones".

4a. Charla: avatar del guía animado con la voz, subtítulos en vivo, anillo de progreso con los 10 temas, botón "Terminar".

4b. Chips: (i) intereses con peso (tocar = 1 a 3 estrellas), (ii) ritmo, horario, presupuesto, estilo de viaje, (iii) comida, movilidad, idiomas, cosas que odiás.

5. Esto entendí de vos: tarjetas por tema con valores editables + "Guardar".

- Cargando (después de la charla): "Armando tu perfil…" con las líneas de `agent_jobs.progress`.
- Error de micrófono o de voz: cae automáticamente a chips con el mensaje "No pude escucharte, sigamos con opciones".
- Error de extracción: "No pude armar el resumen" + "Reintentar" o "Completar con opciones" (precarga lo que haya).

**Perfil** (`app/(tabs)/profile.tsx`), secciones en este orden:

- Encabezado: avatar, nombre, "Hablar con [nombre del guía]".
- Tu guía cree que te gusta… (`inferred_traits` con ✓ / ✗ y la evidencia en gris: "lo dijiste en la charla del 17/10").
- Intereses (chips con peso) y Preferencias (ritmo, horario, presupuesto, comida, movilidad, idiomas, estilo, cosas que odiás): cada una editable en una hoja.
- Tu guía: nombre, voz, estilo.
- Memoria. Lugares guardados. Privacidad. Notificaciones. Idioma.
- Versión de la app (5 toques abren el menú de debug de PRD 09). Cerrar sesión.
- Vacíos: sin rasgos inferidos → "Todavía te estoy conociendo"; sin memoria → "No recordé nada todavía"; sin lugares → "Guardá lugares desde el mapa".

## Datos

Tablas: `profiles` (lectura/escritura del propio usuario por RLS), `memories`, `saved_places`, `trip_members`, `voice_sessions`, `agent_jobs`, `personas` (`kind='companion'` como base del guía).

**Campos de `profiles` que llena el onboarding:** `interests` (`{"arquitectura":3,"comida":4}`, pesos 1–5), `pace`, `chronotype`, `budget_level`, `dietary`, `mobility`, `languages`, `travel_style`, `avoid`, `guide_name`, `guide_voice`, `guide_style`, `inferred_traits`, `onboarded_at`. También `locale`, `quiet_hours`, `notification_prefs` desde Perfil.

**Formas jsonb y enums** (en `packages/shared/profile.ts`, no cambian nombres de Contratos):

```typescript
export const INTEREST_TAGS = ['historia','arquitectura','arte','museos','comida','mercados','vida_nocturna','musica','naturaleza','playa','compras','deporte','fotografia','religion','tecnologia'] as const;
export const BudgetLevel = z.enum(['low','mid','high','no_limit']);          // profiles.budget_level
export const Mobility = z.object({ step_free: z.boolean(), max_walk_km: z.number().nullable(), notes: z.string().nullable() });
export const InferredTrait = z.object({
  id: z.string(),                        // uuid generado en el cliente/servidor
  trait: z.string(),                     // "le gusta la arquitectura"
  kind: z.enum(['interest','avoid','pace','food','other']),
  value: z.string().optional(),          // p.ej. 'arquitectura' si kind='interest'
  confidence: z.number().min(0).max(1),
  evidence: z.string(),                  // frase corta del usuario o del contexto
  source: z.enum(['onboarding','implicit']),
  status: z.enum(['pending','confirmed','dismissed']),
  at: z.string().datetime(),
});
export const QuietHours = z.object({ start: z.string(), end: z.string(), tz: z.string() }); // "22:00"-"08:00"
export const NotificationPrefs = z.object({
  guide_can_call: z.boolean(), max_calls_per_day: z.number().int().min(0).max(5),
  categories: z.object({ proposals: z.boolean(), group: z.boolean(), tour: z.boolean(), expenses: z.boolean(), briefing: z.boolean() }),
});
```

Defaults al crear el perfil: `quiet_hours` 22:00–08:00 en la zona del celu; `notification_prefs` con todo en true, `max_calls_per_day: 2`.

**Los 10 temas de la charla:** intereses, ritmo, horario (madrugador / nocturno), presupuesto, comida y restricciones, movilidad, idiomas, estilo de viaje (planificado / mixto / espontáneo), cosas que odia, y cómo quiere que le hable el guía (se confirma la persona).

## Herramientas y endpoints

- `POST /voice/session` `{ mode: 'chat' }` + marca de onboarding (ver propuesta) → la API arma instrucciones de onboarding con `guide_name`, `guide_voice`, `guide_style` y el guion de los 10 temas.
- `POST /voice/session/:id/end` → además del resumen y las memorias, si la sesión fue de onboarding, corre la extracción de perfil como `agent_jobs` (`kind='profile_extract'`) y deja el borrador en `agent_jobs.result` (no escribe `profiles` directo: el usuario confirma).
- `forget` (PRD 14) para "Olvidar" una memoria; si PRD 14 no está, update directo de `memories.deleted_at = now()` por RLS.
- Escrituras de perfil, `saved_places` y `trip_members` (privacidad): directo con el cliente de Supabase (son datos propios, RLS lo permite) — no hace falta herramienta.
- Claude Opus 5.5 (`claude-opus-5-5`), effort `low`, salida estructurada `ProfileExtraction` (los campos de arriba + `inferred_traits`).

## Notas técnicas

**Extracción:** input = `voice_sessions.transcript` (lo guarda PRD 05). `client.messages.parse` con `output_config: { effort: 'low', format: zodOutputFormat(ProfileExtraction) }`, `thinking: { type: 'adaptive' }` (no se puede apagar en Opus 5.5). Prompt: "Extraé solo lo que el usuario dijo o confirmó; si un campo no se mencionó, dejalo null o vacío; los gustos deducidos (no dichos explícitamente) van a inferred_traits con confidence ≤ 0,7 y evidencia". Mapear "me encanta" = 5, "me gusta" = 3–4, "más o menos" = 2.

**Progreso de temas en vivo:** sin herramienta nueva: el cliente analiza los deltas del transcript de usuario con palabras clave por tema (diccionario en `packages/shared/onboardingTopics.ts`) y marca el tema. Es solo visual; la verdad la da la extracción.

**Prompt del guía en onboarding:** presentarse con su nombre, una pregunta por vez, repreguntar solo si la respuesta es ambigua, no más de 2 frases por turno, recapitular en una frase al final ("Entonces: arquitectura y comida, ritmo tranqui, nada de museos…") y despedirse. Tono según `guide_style`.

**Voces:** la lista sale de las voces soportadas por el modelo de OpenAI Realtime configurado en PRD 05 (tomarla de su documentación al implementar). Muestras: mp3 pregrabados en `apps/mobile/assets/voices/<voz>.mp3` (generados una vez con la misma voz), reproducidos con `expo-audio`. No abrir una sesión Realtime para la muestra.

**Idioma:** `i18next` + `react-i18next` + `expo-localization` (default = idioma del celu si es es/en). Cambio en caliente con `i18n.changeLanguage`. `profiles.locale` también se manda en `/voice/session` para el idioma del guía.

**Gotchas**

- iOS: `NSMicrophoneUsageDescription` en `app.config.ts` (texto en español e inglés). Si se negó antes, `requestPermissionsAsync` no muestra el diálogo: ir a Ajustes.
- La sesión de onboarding no tiene `trip_id`: no inyectar contexto de viaje ni herramientas de itinerario (lista de herramientas vacía o solo `remember`).
- Guardar el borrador de chips en AsyncStorage para no perderlo si la app se cierra.
- Optimistic updates en Perfil (✓ / ✗) con rollback si falla la escritura.

**Orden de implementación sugerido:** (1) esquemas en `packages/shared/profile.ts`; (2) pantalla Perfil leyendo y editando `profiles` (sirve para cargar a mano el perfil de los usuarios del seed); (3) chips + "Esto entendí de vos"; (4) elección de guía con muestras; (5) charla por voz + extracción; (6) memoria, lugares, privacidad, notificaciones, idioma.

**PROPUESTA DE CAMBIO A CONTRATOS**

- `POST /voice/session` acepta `purpose?: 'onboarding'` (con `mode: 'chat'`). Sin esto la API no sabe que tiene que usar el guion de onboarding ni correr la extracción al cerrar. `voice_sessions` debería guardarlo (`purpose text null`) para que `/end` lo lea.
- Documentar en Contratos las formas de `inferred_traits`, `mobility`, `quiet_hours`, `notification_prefs` y los valores de `budget_level` definidos arriba (hoy son jsonb/text sin forma).
- Opcional (P1): herramienta `update_profile` para que el guía guarde rasgos durante cualquier charla ("ahora sos vegetariano, ¿lo anoto?"). Mientras tanto, solo extracción al cerrar.

## Fuera de alcance

- Onboarding por viaje (objetivo, presupuesto, "sí o sí", "ni loco", con quién viaja): PRD 04.
- Aprendizaje implícito que genera `inferred_traits` con `source: 'implicit'` (memoria, PRD 14): acá solo se muestran y editan.
- Login con Google y creación de la fila en `profiles` (PRD 00).
- Clonar voces o voces personalizadas.
- Exportar o borrar la cuenta.

## Dependencias

- **PRD 00:** auth con Google, tabla `profiles` con RLS, cliente de Supabase, navegación (tabs).
- **PRD 05:** sesión Realtime, transcript en `voice_sessions`, `POST /voice/session` y `/end`, armado de instrucciones con persona.
- Usa si existen: PRD 14 (`forget`), PRD 09 (menú de debug desde la versión).

## Cómo probarlo

1. Borrar `onboarded_at` de tu perfil en Supabase y abrir la app → aparece la bienvenida.
2. Elegir nombre "Rafa", tocar ▶ en 2 voces (suenan al instante), estilo "Vecino" → "Charlemos 2 minutos" → aceptar micrófono.
3. Seguir el guion de prueba: "Me encanta la arquitectura y comer bien, odio los museos, soy vegetariano, camino bien pero no más de 10 km, me levanto tarde, presupuesto medio, hablo español e inglés". El anillo marca los temas; el guía cierra solo antes de los 2:30.
4. En "Esto entendí de vos": arquitectura 5, comida 4–5, `avoid` con museos, `dietary` vegetariano, `chronotype` night, `languages` es/en. Corregir uno y guardar. Ver en Supabase los campos y `onboarded_at`.
5. Repetir con "Prefiero tocar opciones" y cronometrar: ≤60 s.
6. Perfil → en "Tu guía cree que te gusta…" confirmar uno y descartar otro; cerrar y abrir la app: se mantiene.
7. Cambiar la voz del guía → abrir una charla → suena la nueva voz y se presenta con el nombre nuevo.
8. Cambiar idioma a English → toda la UI cambia sin reiniciar.
9. Privacidad → en el viaje de demo poner "Nunca" y modo fantasma 1 h → verificar `trip_members.location_sharing` y `ghost_until` en Supabase.
10. Modo avión en medio de la charla → cae a chips con el mensaje.
