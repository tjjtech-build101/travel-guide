// Motor del tour en vivo (PRD 07) sobre tracks: llegada + histéresis, orden flexible, desvío, reloj, permanencia
// y silencio inteligente. Los tracks se arman con synthesizeTrack (mismo formato que el simulador de GPS).
import { describe, expect, it } from 'vitest';
import { CIUDAD_VIEJA_STOPS } from './demo';
import { distanceMeters } from './location';
import {
  createEngineState,
  engineMarkTold,
  engineOnFix,
  engineProgress,
  engineSkip,
  engineTick,
  engineView,
  estimateNeededMin,
  isVoiceEngineEvent,
  suggestSkips,
  type EngineFix,
  type EngineState,
  type EngineTour,
  type TourEngineEvent,
} from './tourEngine';
import { synthesizeTrack, type Track } from './track';

const T0 = Date.parse('2026-10-18T14:00:00Z');
const MIN = 60_000;

function tourOf(points: { name: string; lat: number; lng: number }[], opts: Partial<EngineTour> = {}): EngineTour {
  return {
    tour_id: 'tour-1',
    participants: ['Juan'],
    stops: points.map((p, i) => ({
      stop_id: `s${i + 1}`,
      place_id: `p${i + 1}`,
      name: p.name,
      sort_order: i + 1,
      lat: p.lat,
      lng: p.lng,
      radius_m: 35,
      dwell_min: 4,
    })),
    ...opts,
  };
}

const CV = tourOf(CIUDAD_VIEJA_STOPS.map((s) => ({ ...s })));

function fresh(tour: EngineTour, durationMin = 150): EngineState {
  return createEngineState(tour, { startedAt: T0, endsAt: T0 + durationMin * MIN });
}

/** Reproduce un track a 1 Hz (t del track en s → epoch ms) con tick de reloj cada 15 s. */
function play(tour: EngineTour, track: Track, state = fresh(tour), opts: { startMs?: number; speed?: number | null } = {}) {
  const start = opts.startMs ?? T0;
  const events: (TourEngineEvent & { at: number })[] = [];
  let s = state;
  let lastTick = start;
  for (const p of track) {
    const t = start + p.t * 1000;
    const fix: EngineFix = { t, lat: p.lat, lng: p.lng, speed: opts.speed === undefined ? 1.3 : opts.speed, accuracy: 5 };
    const r = engineOnFix(tour, s, fix);
    s = r.state;
    events.push(...r.events.map((e) => ({ ...e, at: t })));
    if (t - lastTick >= 15_000) {
      const k = engineTick(tour, s, t);
      s = k.state;
      events.push(...k.events.map((e) => ({ ...e, at: t })));
      lastTick = t;
    }
  }
  return { state: s, events };
}

/** Quedarse quieto en un punto `seconds` segundos. */
function stay(p: { lat: number; lng: number }, seconds: number, from = 0): Track {
  return Array.from({ length: seconds }, (_, i) => ({ t: from + i, lat: p.lat, lng: p.lng, heading: null, accuracy: 5 }));
}

/** Punto a `m` metros al norte de `p`. */
function north(p: { lat: number; lng: number }, m: number) {
  return { lat: p.lat + m / 111_195, lng: p.lng };
}
function south(p: { lat: number; lng: number }, m: number) {
  return { lat: p.lat - m / 111_195, lng: p.lng };
}

// Los eventos de play() traen `at` (epoch ms del fix/tick que los disparó).
type Timed<T extends TourEngineEvent['type']> = Extract<TourEngineEvent, { type: T }> & { at: number };
const ofType = <T extends TourEngineEvent['type']>(evs: TourEngineEvent[], type: T) =>
  evs.filter((e) => e.type === type) as Timed<T>[];
const arrivals = (evs: TourEngineEvent[]) => ofType(evs, 'arrived_stop');

describe('tourEngine · llegada', () => {
  it('recorrido completo en orden: un arrived_stop por parada, en orden, con el payload de Contratos', () => {
    const track = synthesizeTrack(CIUDAD_VIEJA_STOPS.map((s) => ({ ...s })), { dwellS: 20, leadInS: 40 });
    const { state, events } = play(CV, track);
    const arr = arrivals(events);
    // Una llegada por parada. El camino de Sarandí a la Matriz pasa por el Museo Torres García (la 9):
    // llega antes de tiempo (order_changed) y después no se repite al pasar de nuevo.
    expect(arr.map((e) => e.payload.stop_id)).toEqual(['s1', 's2', 's3', 's4', 's5', 's9', 's6', 's7', 's8', 's10']);
    expect(arr.filter((e) => e.payload.order_changed).map((e) => e.payload.stop_id)).toEqual(['s9']);
    expect(arr[2].payload).toEqual({
      stop_id: 's3',
      place_id: 'p3',
      name: 'Palacio Salvo',
      sort_order: 3,
      order_changed: false,
      layers_told: [],
      remaining_min: expect.any(Number),
      pending_stops: 7,
      participants: ['Juan'],
    });
    expect(Object.keys(arr[2].payload)).toEqual([
      'stop_id', 'place_id', 'name', 'sort_order', 'order_changed', 'layers_told', 'remaining_min', 'pending_stops', 'participants',
    ]);
    // Al salir de la última: fin.
    expect(events.some((e) => e.type === 'tour_done')).toBe(false); // todavía adentro de la última
    const out = engineOnFix(CV, state, { t: T0 + 3 * 3600_000, ...north(CIUDAD_VIEJA_STOPS[9], 200), speed: 1 });
    expect(out.events.map((e) => e.type)).toContain('tour_done');
    expect(out.state.status).toBe('done');
  });

  it('se dispara ≤ 3 s después de entrar al radio (muestras a 1 Hz)', () => {
    const stop = CV.stops[0];
    const approach: Track = Array.from({ length: 60 }, (_, i) => ({ t: i, ...north(stop, 100 - i * 1.5), heading: null, accuracy: 5 }));
    const { events } = play(CV, approach);
    const firstInside = approach.find((p) => distanceMeters(p, stop) <= stop.radius_m)!;
    const arr = arrivals(events)[0];
    expect(arr).toBeDefined();
    expect(arr.at - (T0 + firstInside.t * 1000)).toBeLessThanOrEqual(3000);
  });

  it('histéresis: oscilar en el borde no repite; salir (> radio+20) y volver antes de 5 min tampoco; después sí', () => {
    const stop = CV.stops[0];
    const wobble: Track = Array.from({ length: 120 }, (_, i) => ({ t: i, ...north(stop, i % 2 ? 30 : 45), heading: null, accuracy: 5 }));
    const a = play(CV, wobble);
    expect(arrivals(a.events)).toHaveLength(1);
    // Sale a 70 m (> 55) y vuelve a los 2 min: nada.
    const back = [...stay(north(stop, 70), 30, 120), ...stay(stop, 30, 150)];
    const b = play(CV, back, a.state);
    expect(ofType(b.events, 'left_stop')).toHaveLength(1);
    expect(arrivals(b.events)).toHaveLength(0);
    // Sale otra vez y vuelve a los 6 min de la primera llegada: nueva llegada (con layers_told actualizadas).
    const told = engineMarkTold(b.state, stop.stop_id, 'short');
    const later = [...stay(north(stop, 70), 30, 200), ...stay(stop, 5, 400)];
    const c = play(CV, later, told);
    const again = arrivals(c.events);
    expect(again).toHaveLength(1);
    expect(again[0].payload.layers_told).toEqual(['short']);
  });

  it('orden flexible: llegar a la 5 antes que a la 4 → order_changed y la 4 sigue pendiente', () => {
    const pts = CIUDAD_VIEJA_STOPS.slice(0, 5).map((s) => ({ ...s }));
    const track = synthesizeTrack([pts[0], pts[1], pts[2], pts[4]], { dwellS: 10, leadInS: 20 });
    const { state, events } = play(CV, track);
    const arr = arrivals(events);
    expect(arr.map((e) => e.payload.stop_id)).toEqual(['s1', 's2', 's3', 's5']);
    expect(arr[3].payload.order_changed).toBe(true);
    const v = engineView(CV, state, null, T0);
    expect(v.next?.stop_id).toBe('s4');
    expect(engineProgress(CV, state).visited.map((x) => x.stop_id)).toEqual(['s1', 's2', 's3', 's5']);
  });

  it('paradas salteadas no disparan llegada', () => {
    const s = engineSkip(CV, fresh(CV), 's1');
    const { events } = play(CV, stay(CV.stops[0], 10), s);
    expect(arrivals(events)).toHaveLength(0);
  });

  it('esperando inicio: nada proactivo hasta la primera llegada', () => {
    const far = stay(north(CV.stops[0], 400), 600);
    const { state, events } = play(CV, far, fresh(CV, 20));
    expect(events.filter(isVoiceEngineEvent)).toHaveLength(0);
    expect(state.status).toBe('waiting');
  });
});

describe('tourEngine · desvío', () => {
  // Llega a la parada 1 y se va al norte (la ruta de Ciudad Vieja corre al este y al sur de la parada 1).
  const s1 = CV.stops[0];
  const arrive = stay(s1, 10);

  it('> 150 m durante ≥ 30 s → left_route una sola vez, con el payload de Contratos', () => {
    const off = [...arrive, ...Array.from({ length: 120 }, (_, i) => ({ t: 10 + i, ...north(s1, 200), heading: null, accuracy: 5 }))];
    const { state, events } = play(CV, off);
    const lr = ofType(events, 'left_route');
    expect(lr).toHaveLength(1);
    // arrived_stop en t=0 → el aviso espera 90 s (silencio) aunque el desvío ya cumplió 30 s.
    expect(lr[0].at - T0).toBeGreaterThanOrEqual(90_000);
    expect(lr[0].payload.distance_m).toBeGreaterThan(150);
    expect(lr[0].payload.off_route_s).toBeGreaterThanOrEqual(30);
    const here = north(s1, 200);
    const nearest = CV.stops.slice(1).sort((a, b) => distanceMeters(here, a) - distanceMeters(here, b))[0];
    expect(lr[0].payload.nearest_pending_stop?.stop_id).toBe(nearest.stop_id);
    expect(Object.keys(lr[0].payload)).toEqual(['distance_m', 'off_route_s', 'nearest_pending_stop']);
    expect(state.status).toBe('off_route');
  });

  it('sin silencio previo: a los 30 s; se rearma al volver a < 100 m y puede volver a avisar', () => {
    const base = play(CV, arrive).state;
    const quiet = { ...base, lastProactiveAt: null };
    const t0 = 200;
    const away = Array.from({ length: 40 }, (_, i) => ({ t: t0 + i, ...north(s1, 200), heading: null, accuracy: 5 }));
    const a = play(CV, away, quiet);
    const lr = ofType(a.events, 'left_route');
    expect(lr).toHaveLength(1);
    expect(lr[0].at - (T0 + t0 * 1000)).toBeGreaterThanOrEqual(30_000);
    expect(lr[0].at - (T0 + t0 * 1000)).toBeLessThanOrEqual(31_000);
    // 120 m: todavía no se rearma.
    const mid = play(CV, stay(north(s1, 120), 20, 300), a.state);
    expect(ofType(mid.events, 'back_on_route')).toHaveLength(0);
    const backOn = play(CV, stay(north(s1, 50), 5, 330), mid.state);
    expect(ofType(backOn.events, 'back_on_route')).toHaveLength(1);
    expect(backOn.state.status).toBe('active');
    const again = play(CV, stay(north(s1, 220), 40, 500), backOn.state);
    expect(ofType(again.events, 'left_route')).toHaveLength(1);
  });

  it('salir y volver antes de 30 s no avisa', () => {
    const quiet = { ...play(CV, arrive).state, lastProactiveAt: null };
    const blip = [...stay(north(s1, 200), 20, 200), ...stay(s1, 20, 220), ...stay(north(s1, 200), 20, 240)];
    expect(ofType(play(CV, blip, quiet).events, 'left_route')).toHaveLength(0);
  });
});

describe('tourEngine · reloj', () => {
  it('avisa a los 30 y a los 10 min (una vez cada uno)', () => {
    const tour = tourOf(CIUDAD_VIEJA_STOPS.slice(0, 3).map((s) => ({ ...s })));
    let s = createEngineState(tour, { startedAt: T0, endsAt: T0 + 60 * MIN });
    s = engineOnFix(tour, s, { t: T0, lat: tour.stops[0].lat, lng: tour.stops[0].lng, speed: 0 }).state; // llegó a la 1
    const evs: TourEngineEvent[] = [];
    for (let m = 1; m <= 59; m++) {
      const r = engineTick(tour, s, T0 + m * MIN);
      s = r.state;
      evs.push(...r.events);
    }
    const tw = ofType(evs, 'time_warning');
    expect(tw.map((e) => e.payload.remaining_min)).toEqual([30, 10]);
    expect(Object.keys(tw[0].payload)).toEqual(['remaining_min', 'pending_stops', 'est_needed_min', 'suggest_skip']);
    expect(tw[0].payload.pending_stops).toBe(2);
  });

  it('tour de 30 min: no avisa "quedan 30" al arrancar', () => {
    const tour = tourOf(CIUDAD_VIEJA_STOPS.slice(0, 2).map((s) => ({ ...s })));
    let s = createEngineState(tour, { startedAt: T0, endsAt: T0 + 30 * MIN });
    const r = engineOnFix(tour, s, { t: T0 + 1000, lat: tour.stops[0].lat, lng: tour.stops[0].lng, speed: 0 });
    s = r.state;
    const k = engineTick(tour, s, T0 + 2 * MIN);
    expect(ofType([...r.events, ...k.events], 'time_warning')).toHaveLength(0);
  });

  it('si lo necesario supera lo restante + 5 min: time_warning con suggest_skip; máx. 1 cada 10 min', () => {
    // 10 paradas, 25 min: imposible (4 min por parada + caminata).
    let s = createEngineState(CV, { startedAt: T0, endsAt: T0 + 25 * MIN });
    s = engineOnFix(CV, s, { t: T0, lat: CV.stops[0].lat, lng: CV.stops[0].lng, speed: 0 }).state;
    const evs: (TourEngineEvent & { at: number })[] = [];
    for (let sec = 90; sec <= 14 * 60; sec += 15) {
      const r = engineTick(CV, s, T0 + sec * 1000);
      s = r.state;
      evs.push(...r.events.map((e) => ({ ...e, at: T0 + sec * 1000 })));
    }
    const tw = ofType(evs, 'time_warning');
    expect(tw.length).toBe(2);
    expect(tw[1].at - tw[0].at).toBeGreaterThanOrEqual(10 * MIN);
    const p = tw[0].payload;
    expect(p.est_needed_min).toBeGreaterThan(p.remaining_min + 5);
    expect(p.suggest_skip.length).toBeGreaterThan(0);
    expect(p.suggest_skip.length).toBeLessThanOrEqual(3);
    for (const x of p.suggest_skip) expect(Object.keys(x)).toEqual(['stop_id', 'name', 'saves_min']);
  });

  it('estimateNeededMin y suggestSkips', () => {
    const pend = CV.stops.slice(1, 4);
    const need = estimateNeededMin(CV.stops[0], pend);
    expect(need).toBeGreaterThanOrEqual(12); // 3 × 4 min de permanencia + caminata
    expect(suggestSkips(CV.stops[0], pend, need)).toEqual([]);
    expect(suggestSkips(CV.stops[0], pend, need - 6).length).toBeGreaterThan(0);
  });
});

describe('tourEngine · permanencia y silencio', () => {
  const s1 = CV.stops[0];

  it('dwell a los 90 s y a los 240 s dentro del radio (payload de Contratos)', () => {
    const { events } = play(CV, stay(s1, 260));
    const d = ofType(events, 'dwell');
    expect(d.map((e) => e.payload.dwell_s)).toEqual([expect.any(Number), expect.any(Number)]);
    expect(d[0].payload.dwell_s).toBeGreaterThanOrEqual(90);
    expect(d[0].payload.dwell_s).toBeLessThan(110);
    expect(d[1].payload.dwell_s).toBeGreaterThanOrEqual(240);
    expect(d[0].payload).toEqual({ stop_id: 's1', dwell_s: expect.any(Number), layers_told: [] });
  });

  it('si ya contó secret, a los 240 s no ofrece nada', () => {
    const told = engineMarkTold(fresh(CV), 's1', 'secret');
    const d = ofType(play(CV, stay(s1, 260), told).events, 'dwell');
    expect(d).toHaveLength(1);
    expect(d[0].payload.layers_told).toEqual(['secret']);
  });

  it('≥ 90 s entre proactivos: el dwell se difiere si hubo un aviso hace poco', () => {
    let s = play(CV, stay(s1, 60)).state; // llegó en t=0
    s = { ...s, lastProactiveAt: T0 + 60_000 }; // como si hubiera avisado algo a los 60 s
    const r = play(CV, stay(s1, 120, 60), s);
    const d = ofType(r.events, 'dwell');
    expect(d).toHaveLength(1);
    expect(d[0].at - T0).toBeGreaterThanOrEqual(150_000);
  });

  it('arrived_stop no espera el silencio de 90 s', () => {
    const near = synthesizeTrack([CV.stops[1], CV.stops[2]].map((x) => ({ lat: x.lat, lng: x.lng })), { dwellS: 5 });
    // De la 2 a la 3 hay ~100 m: llega a la 3 antes de 90 s de la 2.
    const { events } = play(CV, near);
    const arr = arrivals(events);
    expect(arr.map((e) => e.payload.stop_id)).toEqual(['s2', 's3']);
    expect(arr[1].at - arr[0].at).toBeLessThan(90_000);
  });

  it('en vehículo (> 2,5 m/s por > 20 s): ni llegadas ni avisos', () => {
    // Pasa por la parada 1 a 10 m/s después de 30 s acelerado.
    const drive: Track = Array.from({ length: 60 }, (_, i) => ({ t: i, ...north(s1, 300 - i * 10), heading: null, accuracy: 5 }));
    const { events } = play(CV, drive, fresh(CV), { speed: null });
    expect(arrivals(events)).toHaveLength(0);
    // Y al bajarse y caminar, sí.
    const walk = play(CV, stay(s1, 5, 100), play(CV, drive, fresh(CV), { speed: null }).state, { speed: 0.5 });
    expect(arrivals(walk.events)).toHaveLength(1);
  });
});

describe('tourEngine · estado persistible', () => {
  it('JSON ida y vuelta a mitad del tour sigue igual; progreso con la forma de Contratos', () => {
    const track = synthesizeTrack(CIUDAD_VIEJA_STOPS.slice(0, 4).map((s) => ({ ...s })), { dwellS: 10, leadInS: 10 });
    const half = Math.floor(track.length / 2);
    const a = play(CV, track.slice(0, half));
    const restored = JSON.parse(JSON.stringify(a.state)) as EngineState;
    const b = play(CV, track.slice(half), restored);
    const all = [...arrivals(a.events), ...arrivals(b.events)].map((e) => e.payload.stop_id);
    expect(all).toEqual(['s1', 's2', 's3', 's4']);
    const p = engineProgress(CV, b.state);
    expect(Object.keys(p)).toEqual(['current_stop_id', 'visited', 'skipped', 'started_at', 'ends_at']);
    expect(p.visited).toHaveLength(4);
  });

  it('createEngineState desde tours.progress (retomar en otro arranque)', () => {
    const p = {
      current_stop_id: 's3',
      visited: [
        { stop_id: 's1', arrived_at: new Date(T0).toISOString(), left_at: new Date(T0 + MIN).toISOString() },
        { stop_id: 's2', arrived_at: new Date(T0 + 5 * MIN).toISOString(), left_at: null },
      ],
      skipped: ['s4'],
      started_at: new Date(T0).toISOString(),
      ends_at: new Date(T0 + 60 * MIN).toISOString(),
    };
    const s = createEngineState(CV, { startedAt: T0, endsAt: T0 + 60 * MIN, progress: p, told: { s1: ['short'] } });
    expect(s.status).toBe('active');
    expect(Object.keys(s.visited)).toEqual(['s1', 's2']);
    expect(s.skipped).toEqual(['s4']);
    expect(engineView(CV, s, null, T0).next?.stop_id).toBe('s3');
  });
});
