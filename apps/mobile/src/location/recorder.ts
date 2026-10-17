// Grabación de tracks reales (PRD 09): expo-location a 1 Hz con la app en primer plano y la pantalla encendida.
// Guarda a disco cada 10 s (Documents/tracks/<fecha>.raw.json) para no perder el paseo si la app se cierra.
// El archivo es un TrackPoint[] de @build101/shared (t = segundos desde que se tocó Grabar).
import { distanceMeters, smoothTrack, type TrackPoint } from '@build101/shared';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { Directory, File, Paths } from 'expo-file-system';
import * as Location from 'expo-location';
import * as Sharing from 'expo-sharing';

import { Emitter } from './emitter';
import { LocationPermissionError } from './real';

const FLUSH_MS = 10_000;
const KEEP_AWAKE_TAG = 'track-recorder';
/** Para la distancia en vivo solo cuentan muestras razonables. */
const DISTANCE_MAX_ACCURACY_M = 30;

export type RecorderState = {
  recording: boolean;
  points: number;
  accuracy: number | null;
  distanceM: number;
  elapsedS: number;
  marks: number[];
  fileName: string | null;
  error: string | null;
};

export type RecordingFile = { name: string; uri: string; points: number | null; modified: number | null; smoothed: boolean };

export function tracksDir(): Directory {
  const dir = new Directory(Paths.document, 'tracks');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

function stamp(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export class TrackRecorder {
  private emitter = new Emitter<RecorderState>();
  private points: TrackPoint[] = [];
  private marks: number[] = [];
  private startedAt = 0;
  private distanceM = 0;
  private lastGood: TrackPoint | null = null;
  private accuracy: number | null = null;
  private heading: number | null = null;
  private positionSub: Location.LocationSubscription | null = null;
  private headingSub: Location.LocationSubscription | null = null;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private clockTimer: ReturnType<typeof setInterval> | null = null;
  private baseName: string | null = null;
  private error: string | null = null;

  get state(): RecorderState {
    return {
      recording: this.positionSub != null,
      points: this.points.length,
      accuracy: this.accuracy,
      distanceM: this.distanceM,
      elapsedS: this.startedAt ? (Date.now() - this.startedAt) / 1000 : 0,
      marks: [...this.marks],
      fileName: this.baseName,
      error: this.error,
    };
  }

  subscribe(cb: (s: RecorderState) => void): () => void {
    return this.emitter.subscribe(cb);
  }

  async start(): Promise<void> {
    if (this.positionSub) return;
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== 'granted') throw new LocationPermissionError(perm.canAskAgain);

    this.points = [];
    this.marks = [];
    this.distanceM = 0;
    this.lastGood = null;
    this.accuracy = null;
    this.error = null;
    this.startedAt = Date.now();
    this.baseName = stamp();

    await activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {});
    this.positionSub = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 0 },
      (loc) => this.onLocation(loc),
      (reason) => {
        this.error = reason;
        this.notify();
      },
    );
    try {
      this.headingSub = await Location.watchHeadingAsync((h) => {
        const v = h.trueHeading >= 0 ? h.trueHeading : h.magHeading;
        this.heading = Number.isFinite(v) && v >= 0 ? v % 360 : null;
      });
    } catch {
      // Sin brújula (simulador): heading del GPS.
    }
    this.flushTimer = setInterval(() => this.flush(), FLUSH_MS);
    this.clockTimer = setInterval(() => this.notify(), 1000);
    this.notify();
  }

  /** Marca de sincronización con el video: guarda el `t` actual. */
  mark(): number {
    const t = round((Date.now() - this.startedAt) / 1000, 2);
    this.marks.push(t);
    this.notify();
    return t;
  }

  /** Para la grabación y guarda el crudo, el suavizado y las marcas. Devuelve los archivos. */
  async stop(): Promise<{ raw: File; smoothed: File | null } | null> {
    if (!this.positionSub) return null;
    this.positionSub.remove();
    this.headingSub?.remove();
    this.positionSub = null;
    this.headingSub = null;
    if (this.flushTimer) clearInterval(this.flushTimer);
    if (this.clockTimer) clearInterval(this.clockTimer);
    this.flushTimer = null;
    this.clockTimer = null;
    deactivateKeepAwake(KEEP_AWAKE_TAG);
    const raw = this.flush();
    let smoothed: File | null = null;
    if (this.points.length >= 2 && this.baseName) {
      const s = smoothTrack(this.points);
      if (s.length >= 2) {
        smoothed = new File(tracksDir(), `${this.baseName}.json`);
        smoothed.writeSync(JSON.stringify(s));
      }
    }
    this.notify();
    return raw ? { raw, smoothed } : null;
  }

  private onLocation(loc: Location.LocationObject) {
    const t = round(Math.max(0, (loc.timestamp - this.startedAt) / 1000), 2);
    const last = this.points[this.points.length - 1];
    if (last && t <= last.t) return;
    const gpsHeading = loc.coords.heading != null && loc.coords.heading >= 0 ? loc.coords.heading % 360 : null;
    const point: TrackPoint = {
      t,
      lat: loc.coords.latitude,
      lng: loc.coords.longitude,
      heading: this.heading ?? gpsHeading,
      accuracy: round(loc.coords.accuracy ?? 99, 1),
    };
    this.points.push(point);
    this.accuracy = point.accuracy;
    if (point.accuracy <= DISTANCE_MAX_ACCURACY_M) {
      if (this.lastGood) this.distanceM += distanceMeters(this.lastGood, point);
      this.lastGood = point;
    }
    this.notify();
  }

  private flush(): File | null {
    if (!this.baseName) return null;
    try {
      const dir = tracksDir();
      const file = new File(dir, `${this.baseName}.raw.json`);
      file.writeSync(JSON.stringify(this.points));
      if (this.marks.length) new File(dir, `${this.baseName}.marks.json`).writeSync(JSON.stringify({ marks: this.marks }));
      return file;
    } catch (e) {
      this.error = `No pudimos guardar el track: ${e instanceof Error ? e.message : String(e)}`;
      this.notify();
      return null;
    }
  }

  private notify() {
    this.emitter.emit(this.state);
  }
}

/** Grabaciones guardadas en el celu, de la más nueva a la más vieja. */
export function listRecordings(): RecordingFile[] {
  const dir = tracksDir();
  return dir
    .list()
    .filter((f): f is File => f instanceof File && f.name.endsWith('.json') && !f.name.endsWith('.marks.json'))
    .map((f) => {
      const info = f.info();
      return {
        name: f.name,
        uri: f.uri,
        points: null,
        modified: info.modificationTime ?? null,
        smoothed: !f.name.endsWith('.raw.json'),
      };
    })
    .sort((a, b) => (b.modified ?? 0) - (a.modified ?? 0) || b.name.localeCompare(a.name));
}

export async function readTrackFile(uri: string): Promise<string> {
  return new File(uri).text();
}

/** Hoja de compartir del sistema (AirDrop, WhatsApp, Drive) con el JSON. */
export async function shareTrackFile(uri: string): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) throw new Error('Compartir no está disponible en este dispositivo');
  await Sharing.shareAsync(uri, { mimeType: 'application/json', UTI: 'public.json', dialogTitle: 'Compartir track' });
}

export function deleteTrackFile(uri: string) {
  const f = new File(uri);
  if (f.exists) f.delete();
  const marks = new File(uri.replace(/\.raw\.json$|\.json$/, '.marks.json'));
  if (marks.exists && uri.endsWith('.raw.json')) marks.delete();
}

function round(n: number, d: number) {
  const k = 10 ** d;
  return Math.round(n * k) / k;
}

/** Una sola instancia: la grabación sigue aunque se cierre la pantalla de grabación. */
export const trackRecorder = new TrackRecorder();
