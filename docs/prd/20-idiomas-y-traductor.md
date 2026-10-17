---
nro: 20
prd: '20 · Idiomas (app ES/EN, guía en el idioma de cada uno, traducción de bloques compartidos con ver original) + traductor de bolsillo'
prioridad: P1
estado: Por hacer
carril: App y producto
tamano: M (1-3h)
depende_de: '05'
resumen: 'La app en español o inglés, el guía hablando el idioma de cada persona, los bloques compartidos traducidos con opción de ver el original y un traductor de bolsillo por voz.'
notion_url: https://app.notion.com/p/3fc81924a5c68100afcac69a6cad0fc9
---

# 20 · Idiomas (app ES/EN, guía en el idioma de cada uno, traducción de bloques compartidos con ver original) + traductor de bolsillo

## Objetivo
Que un grupo multilingüe use el mismo viaje: interfaz ES/EN, guía que habla el idioma de cada uno (y cambia en vivo si se lo pidís), bloques compartidos traducidos al vuelo con "Ver original", y un **traductor de bolsillo** para hablar con locales. El contenido vive en su idioma base (`place_library.base_lang`) y se traduce al vuelo.

## Momento de la demo
Opcional en Acto 1: Sofi tiene la app en inglés; ve "Lunch at Mercado del Puerto" con "Translated · See original". En Acto 2, "Lu, ayudame a pedir en portugués" → traductor: Juan habla en español y el celu dice la frase en portugués.

## Historias de usuario
- Como viajero angloparlante, quiero la app y el guía en inglés.
- Como viajero, quiero decir "hablame en inglés" y que cambie ya.
- Como miembro del grupo, quiero leer los bloques que escribieron otros en mi idioma, y ver el original si dudo.
- Como turista, quiero hablar con alguien que no habla mi idioma usando el celu.

## Criterios de aceptación
- [ ] 100% de los textos de la interfaz pasan por `t()` (i18next) con `es.json` y `en.json`; script `pnpm i18n:check` falla si hay claves faltantes en alguno.
- [ ] Idioma inicial = idioma del sistema (`expo-localization`) si es es/en, si no `es`; se cambia en Perfil y se guarda en `profiles.locale`; el cambio aplica sin reiniciar.
- [ ] Idioma del guía = `trip_members.language` si existe, si no `profiles.locale`; `/voice/session` lo pone en las instrucciones y el guía saluda en ese idioma (probado en es y en).
- [ ] "Hablame en inglés" (o cualquier idioma) → el guía cambia en la siguiente respuesta; si fue pedido explícito, al cerrar la sesión se guarda en `trip_members.language` (extracción del PRD 14).
- [ ] Narraciones de paradas en idioma base `es` se dicen traducidas en el idioma del usuario; nombres propios sin traducir.
- [ ] Bloques compartidos: si el idioma detectado de `title`/`description` difiere del de la interfaz, se muestra traducido con "Traducido · Ver original" (toggle); primera traducción ≤2 s, siguientes desde caché local ≤100 ms.
- [ ] Traductor de bolsillo: elegir idioma del otro (12 opciones + autodetectar); 2 botones grandes "Yo" / "Ellos" (mantener para hablar); cada turno se dice en el otro idioma y se muestran ambos textos. Del fin del habla al inicio del audio traducido ≤2 s (p50 en 5 pruebas).
- [ ] En modo traductor el modelo solo traduce: 0 comentarios propios en 10 turnos de prueba.

## Pantallas y estados
- **Perfil → Idioma de la app** (ES / EN) e **Idioma del guía** (por viaje).
- **Bloque traducido**: texto traducido + link "Ver original" / "Ver traducción".
- **Traductor**: selector de idioma arriba, 2 burbujas de subtítulos (yo / ellos, la de ellos rotable 180° para mostrarle el celu), 2 botones grandes abajo. Se entra desde Acciones rápidas (PRD 19) o pidiéndolo al guía.
- Cargando traducción: texto original con shimmer. Error: queda el original + "No se pudo traducir". Traductor sin conexión: "Necesito conexión para traducir".

## Datos
- `profiles.locale`, `profiles.languages`, `trip_members.language`, `place_library.base_lang`, `voice_sessions` (mode `chat`).
- Caché de traducciones en el celu: AsyncStorage `tr:{hash(texto)}:{lang}`.

## Herramientas y endpoints
- `POST /voice/session` con idioma en instrucciones.
- **PROPUESTA DE CAMBIO A CONTRATOS:** `POST /translate {texts: string[], target_lang}` → `{items:[{text, detected_lang, translated}]}` con Claude esfuerzo `low` (o el mismo modelo de Realtime en texto). Si `detected_lang == target_lang` devuelve el texto igual.
- **PROPUESTA DE CAMBIO A CONTRATOS:** `POST /voice/session` acepta `variant?: 'translator'` y `target_lang?` para armar instrucciones de traductor (sin herramientas, sin memoria). Se guarda como `voice_sessions.mode='chat'`.

## Notas técnicas
- i18n: `i18next` + `react-i18next` + `expo-localization`; claves por pantalla (`now.leave_in`); fechas y monedas con `Intl`.
- Traductor: sesión Realtime con turn detection desactivado (push-to-talk): al soltar el botón se hace `input_audio_buffer.commit` + `response.create` con instrucción "traducí al {idioma destino}" según el botón.
- Los bloques siguen guardándose en el idioma de quien los escribe; no se persisten traducciones en la DB.
- Idiomas del traductor: es, en, pt, fr, it, de, ja, zh, ko, he, ar, ru.

## Fuera de alcance
Más idiomas de interfaz que ES/EN, multilenguaje dentro de una misma sesión de varias personas, traducción offline, traducir fotos/carteles con la cámara, persistir traducciones en la DB.

## Dependencias
05 (sesión de voz). Usa PRD 14 para persistir el cambio de idioma.

## Cómo probarlo
1. Celu en inglés → app en inglés; `pnpm i18n:check` en verde.
2. Sofi (en) abre un bloque creado por Juan en español → traducido + Ver original.
3. Sesión en español → "hablame en inglés" → cambia; cerrar y reabrir → sigue en inglés.
4. Tour con contenido `es` y usuario `en` → narración en inglés.
5. Traductor es↔pt: 5 turnos, medir latencia (≤2 s p50) y que no agregue comentarios.
