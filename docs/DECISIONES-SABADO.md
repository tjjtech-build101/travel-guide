# Decisiones del sábado 17/10 (grill con el equipo, después del kickoff)

> Pisan a lo anterior en PRODUCT.md / README.md donde haya conflicto.

## Rúbrica (lo que más pesa)
Producto funcionando 35% · Problema y valor 25% · Calidad de la IA 20% · Experiencia 10% · Originalidad 10%.
- El jurado **prueba un caso nuevo** dentro del alcance declarado. Nada precargado presentado como IA.
- No hay puntos por cantidad de funciones. Pitch: 3 min de demo + 3 min de preguntas.
- Revisión técnica del repo e historial: **declarar** que specs y base técnica (PRD 00–02) se prepararon la noche anterior.

## Flujo principal (alcance declarado)
> Estés donde estés, le pedís al scout un tour (por voz o tocando "Tour acá, ahora"). En ~30 s te arma un recorrido con paradas **verificadas con fuentes**, adaptado a lo que te gusta y al tiempo que tenés, y te guía por voz: te habla solo al llegar a cada parada, le preguntás lo que quieras y le mostrás cosas con la cámara.

Alcance: cualquier zona urbana con cobertura de Wikipedia/OpenStreetMap, en español o inglés.

## Personaje
Un **boy scout** amigable, **el mismo para todos**, que hace todo (planificar, guiar, responder). Nombre, personalidad y voz: **se definen más adelante**. Mientras tanto, nombre provisorio **"Scout"** en una sola constante configurable (`packages/shared/src/scout.ts`).

## Vistas
1. **Planificación:** itinerario (ya hecho, PRD 01–02) con pestañas: Itinerario · Eventos · Tours · Gastos (solo si sobra tiempo).
2. **Mapa:** el recorrido que viene; tocás cualquier elemento y el scout lo recibe como contexto (PRD 03, en 2D primero).
3. **Ahora:** la vista principal en la calle, con acceso rápido a todo lo del scout (PRD 19).

## Alcance
| | PRDs |
|---|---|
| **Núcleo** | 05 Voz · 06 Tours + verificador · 18 Tour acá, ahora · 07 Tour en vivo · 19 Ahora · 09 Simulador GPS |
| **Segunda línea** | 08 Cámara · 03 Mapa 2D con contexto · 16 Eventos recomendados según perfil |
| **Simplificados** | 15 → un solo personaje (el scout) · 10 → onboarding mínimo con chips (sin voz) |
| **Afuera** | 04 Multiplayer (el seed muestra un grupo, no se construye el flujo de sumarse) · 11 · 12 · 13 · 14 · 17 · 20 · 21 · 22 · 24–30 |

## Voz
OpenAI Realtime (opción A). Claude sigue siendo el cerebro: arma y verifica los tours. Falta cargar `OPENAI_API_KEY`.

## Calidad de la IA (para el 20%)
- Cada parada guarda afirmaciones con fuente; un **verificador** (segunda pasada de Claude) descarta lo no respaldado. Botón **"Fuentes"** en la app.
- **Mini-evaluación** en 5 zonas (Ciudad Vieja, Pocitos, zona del venue, Colonia, otra ciudad): % de afirmaciones respaldadas antes/después del verificador, tiempo de armado, % de paradas abiertas. Limitaciones declaradas.

## Demo
- Paseo grabado **por la zona del venue** (Portones / LATU / Parque Baroffio), no Ciudad Vieja. El tour lo genera la IA con el pipeline real, sin edición a mano, **antes de las 14:30**. Quién lo camina y cuándo: **pendiente**.
- Contenido curado de Ciudad Vieja: **ya no hace falta**; Ciudad Vieja queda solo como zona de la evaluación.

## Carriles
| Carril | Quién | Orden |
|---|---|---|
| Voz y tour en vivo | **Tomás** | 05 Voz → 07 Tour en vivo → 08 Cámara |
| Cerebro de los tours | **Josefina** | 06 Tours + verificador → 18 (API) → mini-evaluación → 16 Eventos |
| App y vistas | **Agentes en la laptop de Juan** (12:00–17:30) → **Juan** | 09 Simulador GPS → 19 Ahora + avatar → 03 Mapa 2D → 10 mínimo → pestañas Eventos/Tours |

## Integración
- **13:00:** 09 listo (Tomás lo usa para probar el 07) · voz con herramientas en el simulador.
- **14:30:** tour real de la zona del venue generado y verificado.
- **15:30:** "el scout te arma un tour por voz" (05 + 06 + 18).
- **18:00:** flujo principal de punta a punta con un caso nuevo en vivo.
