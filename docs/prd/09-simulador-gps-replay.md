---
nro: 9
prd: "09 · Simulador de GPS / replay"
prioridad: P0
estado: "Hecho (sin pantalla de demo con video)"
carril: Cerebro y contenido
tamano: M (1-3h)
depende_de: "00"
resumen: "LocationProvider simulado que reproduce un track JSON (play/pausa, 1x–10x, saltar a parada) desde un menú de debug oculto, con modo grabación del paseo real por Ciudad Vieja, suavizado del track y pantalla de demo con video + mapa sincronizados."
notion_url: https://app.notion.com/p/3fc81924a5c68131ac0be877ca0e17dc
---

# 09 · Simulador de GPS / replay

> **Estado (sáb 17/10):** hecho, salvo la pantalla de demo con video + mapa (necesita `expo-video` → recompilar; queda para después).
> - **Cómo se usa:** menú dev (long-press en el título "Mis viajes" o `build101:///dev`) → "Ubicación simulada" → ▶, 1x/2x/5x/10x, ±10 s / ±1 min, "Saltar a parada" (15 s antes). Badge **SIM** flotante con ▶/velocidad/tiempo (toque largo lo achica).
> - **Fuentes de track:** seed de Ciudad Vieja (por defecto), **"Desde un tour…"** (cualquier tour de la base → track sintético que camina sus paradas a 1,3 m/s con 30 s en cada una; o "Solo paradas" sobre el track actual), archivo JSON (picker de `expo-file-system`, sin módulos nuevos) y grabaciones del celu.
> - **Grabar:** menú dev → "Grabar track / grabaciones" (`/dev-record`): 1 Hz, marca de sync (flash + haptic, sin pitido), guarda cada 10 s en `Documents/tracks/<fecha>.raw.json`, al parar guarda también el suavizado `<fecha>.json`; "Compartir" abre la hoja del sistema (AirDrop/WhatsApp/Drive).
> - **Código:** lógica pura en `packages/shared/src/track.ts` (tests: `pnpm --filter @build101/shared test`); provider en `apps/mobile/src/location/simulated.ts`; controles en `useSimulator()` (`LocationContext.tsx`). Scripts: `pnpm track:smooth raw.json > out.json`, `pnpm track:check [track.json] [--stops stops.json]`.
> - **Desvíos:** la interfaz es la del código (`LocationFix`, `getCurrent()`), no la del PRD; zod como `TrackPointSchema`/`TrackSchema` (el tipo `TrackPoint` ya existía); barra de tiempo con botones en vez de arrastrable; el menú dev se abre como antes (no hay pantalla Perfil todavía).

## Objetivo

Poder hacer la demo del tour en FIUM sin estar en Ciudad Vieja. Implementar `LocationProvider` en modo `simulated` que reproduce un track grabado `[{t, lat, lng, heading, accuracy}]` como si fuera el GPS real, para que mapa, geofences, tour y cámara funcionen igual. Incluye: grabar el track caminando Ciudad Vieja con la misma app, suavizarlo, sincronizarlo con el video del paseo y una pantalla de demo con video y mapa en paralelo.

## Momento de la demo

Acto 2 completo: en la pantalla se ve el video del paseo por Ciudad Vieja arriba y el mapa abajo con el puntito avanzando sincronizado. Cuando el video llega a la Ciudadela, el puntito entra en la geofence y el guía arranca a narrar en vivo (PRD 07). El presentador puede saltar a una parada si el tiempo aprieta.

## Historias de usuario

- Como presentador, abro un menú de debug oculto, elijo GPS simulado y cargo el track de Ciudad Vieja.
- Como presentador, doy play, pauso, cambio la velocidad (1x a 10x) y salto a una parada.
- Como equipo, el viernes/sábado caminamos Ciudad Vieja con la app en modo grabación, mientras otro filma, y exportamos el track en JSON.
- Como presentador, abro la pantalla de demo y el video y el mapa avanzan juntos, sin desfasarse.
- Como dev, pruebo el tour en vivo desde mi escritorio sin moverme.

## Criterios de aceptación

- [ ] `SimulatedLocationProvider` implementa la misma interfaz que el real (PRD 00); ningún componente fuera de `apps/mobile/src/location/` sabe qué modo está activo (salvo el menú de debug y el badge).
- [ ] Emite ≥4 muestras por segundo de reloj durante la reproducción, interpolando lat/lng linealmente y `heading` por el ángulo más corto.
- [ ] A 10x no se saltea ninguna geofence: el paso máximo entre muestras emitidas es ≤10 m (si hace falta, subdividir la interpolación).
- [ ] Controles: play, pausa, velocidad 1x / 2x / 5x / 10x, barra de tiempo arrastrable y lista "Saltar a parada" con las paradas del tour activo.
- [ ] "Saltar a parada" posiciona el track en el punto más cercano a la parada **menos 15 s** de recorrido, para que `arrived_stop` se dispare naturalmente en ≤15 s a 1x.
- [ ] El modo elegido (real o simulado) y el track cargado se recuerdan entre reinicios (AsyncStorage). Un badge "SIM" visible en la esquina cuando está activo.
- [ ] Menú de debug: se abre tocando 5 veces la versión en la pantalla Perfil (PRD 10) o con el gesto de sacudir en builds de desarrollo. No aparece en ninguna otra navegación.
- [ ] Grabación: con la app en primer plano y la pantalla encendida, graba ≥1 muestra por segundo; 20 min de paseo dan ≥1100 muestras. Muestra en vivo: cantidad de puntos, precisión actual, distancia y tiempo.
- [ ] Exportar: guarda el JSON en el celu y abre la hoja de compartir (AirDrop, WhatsApp, Drive) con el archivo.
- [ ] Suavizado: descarta muestras con `accuracy` peor que 30 m y saltos de más de 3 m/s; el track suavizado no tiene ningún salto de más de 8 m entre muestras de 1 s.
- [ ] Pantalla de demo: video arriba y mapa abajo; el video manda el reloj y el desfase entre video y puntito es ≤0,5 s después de 10 min de reproducción y después de pausar/adelantar.
- [ ] El track final del seed está en `/supabase/seed/ciudad-vieja-track.json` y pasa a ≤20 m de cada una de las 10 paradas curadas (PRD 06), verificado con un script.

## Pantallas y estados

- **Menú de debug** (`app/debug.tsx`): selector Real / Simulado; "Cargar track" (el del seed incluido en el bundle o un archivo con `expo-document-picker`); controles de reproducción; "Saltar a parada"; "Mostrar círculo de precisión"; "Grabar track"; "Abrir pantalla de demo"; ajuste fino de desfase del video (±0,1 s).
- **Mini controles flotantes:** con modo simulado, una píldora arrastrable sobre cualquier pantalla con play/pausa, velocidad y tiempo; se oculta con un toque largo (para grabar pantalla limpia).
- **Grabación** (`app/debug/record.tsx`): botón grande Grabar/Parar, contador de puntos, precisión con color (verde ≤10 m, amarillo ≤25 m, rojo), distancia, cronómetro, botón "Marca de sync".
- **Pantalla de demo** (`app/demo.tsx`): video arriba (55% de alto), mapa abajo con ruta, paradas y puntito; la barra de llamada del guía visible; play/pausa único que controla los dos.
- **Vacío:** simulado sin track → "Cargá un track para empezar" (no emite nada).
- **Error:** JSON inválido → "El archivo no tiene el formato de track" con el detalle del error de Zod. Video no encontrado → "Elegí el video del paseo" con selector de archivo.
- **Cargando:** al abrir un track grande (≥5000 puntos), spinner mientras se suaviza.

## Datos

**Formato del track (Contratos):** `[{ t, lat, lng, heading, accuracy }]`. Se fija: `t` = segundos desde el inicio del track (número con decimales), `heading` en grados 0–360 o null, `accuracy` en metros.

```typescript
// packages/shared/location/track.ts
export const TrackPoint = z.object({
  t: z.number().min(0),
  lat: z.number(), lng: z.number(),
  heading: z.number().min(0).max(360).nullable(),
  accuracy: z.number().min(0),
});
export const Track = z.array(TrackPoint).min(2);
```

**Interfaz esperada de `LocationProvider`** (la define PRD 00; si no existe aún, usar esta y avisar):

```typescript
export type LocationSample = { at: number; lat: number; lng: number; heading: number | null; accuracy: number; speed: number | null; simulated: boolean };
export interface LocationProvider {
  kind: 'real' | 'simulated';
  start(): Promise<void>;
  stop(): void;
  getLast(): LocationSample | null;
  subscribe(cb: (s: LocationSample) => void): () => void;
}
export interface SimulatedControls {
  load(track: z.infer<typeof Track>): void;
  play(): void; pause(): void;
  setSpeed(x: 1 | 2 | 5 | 10): void;
  seek(tSeconds: number): void;
  seekToPoint(lat: number, lng: number, leadSeconds?: number): void;
  onState(cb: (s: { playing: boolean; t: number; duration: number; speed: number }) => void): () => void;
}
```

**Archivos:**

- `/supabase/seed/ciudad-vieja-track.json` (Contratos): track suavizado final. Se copia al bundle en `apps/mobile/assets/demo/` en el build.
- Grabaciones crudas: `FileSystem.documentDirectory + 'tracks/<fecha>.raw.json'` en el celu.
- Desfase del video: `video_offset_s` (segundos del video en los que el track vale `t=0`), guardado en AsyncStorage y como constante `DEMO_VIDEO_OFFSET_S` en `packages/shared/demo.ts`.
- Video del paseo: no va en el bundle (pesa). Se elige del celu con `expo-document-picker` o se baja una vez de Storage a `FileSystem.cacheDirectory`.

## Herramientas y endpoints

Ninguna herramienta nueva ni endpoint. Opcional: subir el track grabado a Storage con `POST /uploads/sign` (bucket `photos`, ruta `debug/tracks/`) como backup.

Librerías: `expo-location`, `expo-file-system`, `expo-sharing`, `expo-document-picker`, `expo-keep-awake`, `expo-video`, `expo-audio` (pitido de sync), `expo-haptics`, `@rnmapbox/maps`, `@react-native-async-storage/async-storage`.

## Notas técnicas

**Reproducción**

- Reloj interno: `requestAnimationFrame` o `setInterval` de 250 ms; `trackTime += deltaReal * speed`. Buscar el segmento con búsqueda binaria por `t` e interpolar. Si la distancia del paso supera 10 m, emitir sub-muestras.
- `speed` emitido = distancia/tiempo del segmento del track (no multiplicado por la velocidad de reproducción, para que el "silencio en vehículo" de PRD 07 no se active a 10x).
- `at` = `Date.now()` del momento de emisión (las lógicas de tiempo de PRD 07 usan reloj real; a 10x el tour "dura" 10 veces menos y eso es lo que queremos para probar `time_warning`).
- En modo simulado no se arrancan las tasks de ubicación en segundo plano ni los geofences nativos. Los timers de JS se pausan con la app en segundo plano en iOS: la demo se hace con la app en primer plano.

**Grabación**

- `Location.watchPositionAsync({ accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 0 })` + `Location.watchHeadingAsync`. `expo-keep-awake` activo mientras graba. En Android, pedir que desactiven el ahorro de batería para la app.
- Guardar cada 10 s a disco (append) para no perder el paseo si la app se cierra.
- **Sincronización con el video:** quien filma arranca a grabar video primero; después se toca "Marca de sync" con el celu del track frente a la cámara: pantalla blanca 300 ms + pitido de 1 kHz + haptic, y se guarda `t` de la marca. Después, en la pantalla de demo, el desfase inicial es el segundo del video donde aparece el flash (se ajusta a ojo con ±0,1 s).
- Ruta a caminar: las 10 paradas de PRD 06 en orden, quedarse ≈60 s en cada una (para que el video tenga tiempo de narración) y pasar por el centro de cada parada.

**Suavizado** (función pura `smoothTrack(raw): Track` en `packages/shared/location/smooth.ts`, con tests en vitest):

1. Descartar `accuracy` peor que 30 m.
2. Descartar saltos con velocidad implícita de más de 3 m/s respecto del último punto válido.
3. Filtro de Kalman 1D simple (o media móvil ponderada por precisión, ventana 5) sobre lat y lng.
4. Re-muestrear a 1 Hz con interpolación lineal.
5. `heading`: si falta o la velocidad es mayor a 0,5 m/s, usar el rumbo entre puntos suavizados; media circular en ventana de 3.
6. Script `pnpm track:check` que verifica la distancia mínima del track a cada parada del seed (≤20 m) y el salto máximo (≤8 m).

**Pantalla de demo**

- `expo-video` (`useVideoPlayer`, `timeUpdateEventInterval = 0.25`). En cada `timeUpdate`: `sim.seek(currentTime - video_offset_s)` si la diferencia con el reloj del simulador supera 0,3 s; si no, dejarlo correr (evita tirones). Pausar el video pausa el simulador.
- El video manda: no se puede cambiar la velocidad de reproducción en esta pantalla (siempre 1x).
- Audio del video silenciado por defecto (el audio es el del guía).
- Gotcha: Mapbox y video juntos en Android de gama media pueden bajar a 30 fps. Si se traba, desactivar 3D y edificios en esta pantalla.

**Orden de implementación sugerido:** (1) `Track` + `smoothTrack` + tests; (2) `SimulatedLocationProvider` con un track sintético generado entre las coordenadas aproximadas de PRD 06 (desbloquea a PRD 07 desde la primera hora); (3) menú de debug + mini controles; (4) modo grabación + exportar → **salir a grabar el paseo real** cuanto antes (depende del clima y la luz); (5) pantalla de demo con video; (6) `track:check` con el track real.

**PROPUESTA DE CAMBIO A CONTRATOS**

- Precisar en Contratos que `t` del track es "segundos desde el inicio" y que `heading` puede ser null.
- Constante `DEMO_VIDEO_OFFSET_S` (y los IDs del tour de demo) en `packages/shared/demo.ts`.

## Fuera de alcance

- Simular varios miembros del grupo moviéndose a la vez (`member_locations`, PRD 13).
- Grabar el track en segundo plano con la pantalla apagada.
- Editor visual de tracks (mover puntos en el mapa). Ajustes manuales se hacen editando el JSON.
- Grabar el video desde la misma app.

## Dependencias

- **PRD 00:** interfaz `LocationProvider`, Mapbox en el dev build, estructura de `packages/shared`.
- Lo usan: PRD 07 (tour en vivo), PRD 08 (ubicación de la foto) y la demo entera. Necesita las coordenadas de PRD 06 solo para `track:check` y "Saltar a parada".
- Para "Saltar a parada" usa el tour activo (PRD 07); sin tour, la lista muestra las 10 paradas del seed.

## Cómo probarlo

1. En el celu, Perfil → tocar 5 veces la versión → se abre el menú de debug. Elegir "Simulado" → aparece el badge SIM.
2. Cargar el track del seed → play a 1x → en el mapa el puntito avanza por Ciudad Vieja sin saltos.
3. Cambiar a 10x → el puntito recorre todo; con PRD 07 activo, se disparan las 10 llegadas en orden (contarlas en el transcript o en los logs).
4. "Saltar a parada" → Cabildo → en ≤15 s a 1x llega `arrived_stop` del Cabildo.
5. Cerrar y reabrir la app → sigue en Simulado con el mismo track.
6. **Grabación en la calle:** en Ciudad Vieja, "Grabar track", hacer la "Marca de sync" frente al celu que filma, caminar las 10 paradas, "Parar" → exportar por AirDrop. En la laptop: `pnpm track:smooth raw.json > supabase/seed/ciudad-vieja-track.json` y `pnpm track:check` en verde.
7. Pantalla de demo: elegir el video → ajustar el desfase hasta que el flash coincida → reproducir 10 min y comprobar que al cruzar la Puerta de la Ciudadela en el video el puntito está en la puerta (≤0,5 s). Pausar, adelantar 2 min y volver a comprobar.
