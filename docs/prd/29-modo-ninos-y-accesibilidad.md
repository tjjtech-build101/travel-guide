---
nro: 29
prd: "29 · Modo niños + accesibilidad"
prioridad: P2
estado: Por hacer
carril: App y producto
tamano: L (2-4h)
depende_de: "06, 07"
resumen: "Modo niños (guía kids con misiones e insignias) y accesibilidad: rutas sin escalones, narración descriptiva para baja visión, ritmo lento, lectores de pantalla y texto dinámico."
notion_url: https://app.notion.com/p/3fc81924a5c681cbb8b9fca6d3d4d28c
---

# 29 · Modo niños + accesibilidad

## Objetivo

Que el tour sirva a familias con chicos y a personas con movilidad reducida o baja visión, sin productos aparte: el mismo tour cambia de tono, ritmo, ruta y forma de describir según el perfil. Y que la app sea usable con VoiceOver/TalkBack y texto grande.

## Momento de la demo

Acto 2 (30 s): Juan activa **Modo niños** → en la siguiente parada el guía dice "¡Misión! Buscá el escudo con dos leones arriba de la puerta"; Juan dice "¡lo encontré!" → sonido + haptic + insignia "Detective de la Ciudadela".

## Historias de usuario

- Como madre/padre, quiero que el guía le hable a mi hijo con misiones y premios.
- Como persona en silla de ruedas, quiero un recorrido sin escalones o avisado de antemano.
- Como persona con baja visión, quiero que el guía me describa lo que tengo adelante antes de contar la historia.
- Como persona mayor, quiero un ritmo más lento con descansos.
- Como usuario de lector de pantalla, quiero usar toda la app sin ver.

## Criterios de aceptación

**Modo niños**

- [ ] Toggle **Modo niños** en la pantalla de inicio del tour y en Perfil → escribe `profiles.guide_style='kids'` (desactivar vuelve al estilo anterior, guardado en estado local de la app).
- [ ] Con `guide_style='kids'`, `POST /voice/session` arma el prompt kids: frases cortas, preguntas, usa `narration_short` + `kid_mission`, no usa `narration_secret` ni `myth_vs_fact` con contenido sensible (violencia, muerte, esclavitud se cuentan solo si el adulto lo pide).
- [ ] `generate_tour` (PRD 06) con un participante en kids garantiza `kid_mission` en todas las paradas, máximo 6 paradas y 60 min.
- [ ] Al llegar a una parada con `kid_mission`, el guía la propone. Se completa por voz ("¡lo encontré!") o con foto (`look_at_photo` confirma que se ve el objeto).
- [ ] Misión completa → `remember` con `{scope:'personal', kind:'badge', text:'Detective de la Ciudadela · tour_stop <id>'}` + sonido + haptic + toast con la insignia.
- [ ] Pantalla **Insignias**: grilla con nombre, parada y fecha; al terminar el tour, tarjeta "diploma" compartible.

**Accesibilidad**

- [ ] Perfil → Accesibilidad edita `profiles.mobility` con claves `step_free`, `wheelchair`, `slow_pace`, `low_vision` (booleanos).
- [ ] `step_free`/`wheelchair`: `generate_tour` evita lugares sin `accessibilityOptions.wheelchairAccessibleEntrance` (Places) cuando hay alternativa; si no, la parada se mantiene y `nav_to_next` / el guía avisan "acceso con escalón" antes de llegar. El tour de Ciudad Vieja del seed tiene `nav_to_next` revisado a mano para rutas sin escalones.
- [ ] `slow_pace`: duraciones ×1.5, máximo 800 m entre paradas, el guía ofrece un descanso cada 30 min (usa `nearby` con `kind='cafe'`).
- [ ] `low_vision`: en cada parada el guía primero describe lo que hay adelante (forma, color, escala, ubicación con referencia horaria "a tus 2") a partir de `look_at`, y después narra; `look_at_photo` usa prompt descriptivo.
- [ ] Lector de pantalla: todos los elementos tocables tienen `accessibilityRole` y `accessibilityLabel` en el idioma de la app; navegación completa con VoiceOver y TalkBack por las pestañas principales y la pantalla del tour sin elementos sin etiqueta; la llegada a una parada se anuncia con `AccessibilityInfo.announceForAccessibility`.
- [ ] Texto dinámico: Plan, Tour, Gastos y Diario se ven sin cortes ni superposiciones al 200%; prohibido `allowFontScaling={false}` salvo íconos; chips con `maxFontSizeMultiplier` 1.6.
- [ ] Contraste AA (4.5:1) en texto y targets táctiles de 44 pt o más.
- [ ] Con "Reducir movimiento" del sistema activo, la vista previa animada del día y la cámara 3D no animan.
- [ ] Subtítulos en vivo de lo que dice el guía disponibles en la pantalla del tour.

## Pantallas y estados

- Inicio de tour: toggle Modo niños + resumen de ajustes de accesibilidad activos ("Sin escalones · Ritmo lento").
- Perfil → Accesibilidad: 4 switches con explicación de una línea.
- Insignias: grilla; vacío "Completá misiones en los tours para ganar insignias".
- Tour: tarjeta de misión (texto grande + botón "¡Lo encontré!"), aviso de escalón, subtítulos.

## Datos

- `profiles.guide_style` (`kids`), `profiles.mobility` (forma: `{step_free, wheelchair, slow_pace, low_vision}`), `tour_stops.kid_mission`, `tour_stops.look_at`, `tour_stops.nav_to_next`, `memories` (`kind='badge'`), `content_told`.
- Sin tablas nuevas.

## Herramientas y endpoints

- Reusa: `generate_tour`, `get_stop_content`, `next_stop`, `look_at_photo`, `remember`, `recall` (listar insignias), `nearby`, `route_eta`, `place_details`, `POST /voice/session`.

## Notas técnicas

- Google Routes no ofrece rutas a pie sin escalones: no prometerlo. La garantía es (1) filtrado de lugares por `accessibilityOptions`, (2) curaduría manual del seed y (3) aviso explícito cuando no se sabe.
- Las insignias como `memories` `kind='badge'` respetan "olvidá eso" (si se borra, desaparece la insignia). Listar con `recall` filtrando `kind='badge'`.
- Los modificadores kids / `low_vision` / `slow_pace` se agregan como bloques del system prompt en el builder de `/voice/session` (un solo lugar).
- Probar con VoiceOver en iOS real (el simulador no alcanza) y con Accessibility Inspector.

## Fuera de alcance

Cuentas de niños separadas, control parental, lengua de señas, braille, navegación indoor, rutas accesibles de transporte público, alto contraste propio (se usa el del sistema).

## Dependencias

- PRD 06: generación de tours (restricciones por perfil, `kid_mission`).
- PRD 07: tour en vivo (llegadas, narración, eventos).

## Cómo probarlo

1. Activar Modo niños, arrancar el replay simulado → en la parada 1 el guía propone la misión con lenguaje simple.
2. Decir "¡lo encontré!" → insignia en Insignias y fila `memories` con `kind='badge'`.
3. Activar `low_vision` → en la parada 2 la primera frase describe lo que hay adelante.
4. Activar `step_free` y regenerar un tour espontáneo → ninguna parada sin entrada accesible si había alternativa; si queda alguna, el guía avisa.
5. iOS: Texto más grande al máximo → recorrer Plan, Tour, Gastos y Diario sin cortes.
6. VoiceOver: completar "iniciar tour → escuchar parada → siguiente parada" sin mirar la pantalla.
