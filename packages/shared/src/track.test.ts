import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { distanceMeters, type TrackPoint } from './location';
import {
  advanceClock,
  bearingDeg,
  circularMean,
  distancesToPoints,
  lerpHeading,
  maxJumpMeters,
  parseTrack,
  smoothTrack,
  synthesizeTrack,
  TrackCursor,
} from './track';

const seedTrack: TrackPoint[] = JSON.parse(
  readFileSync(resolve(__dirname, '../../../supabase/seed/ciudad-vieja-track.json'), 'utf8'),
);

const A = { lat: -34.9067, lng: -56.2 };
const B = { lat: -34.9067, lng: -56.199 }; // ~91 m al este

describe('parseTrack', () => {
  it('acepta el track del seed', () => {
    const r = parseTrack(JSON.stringify(seedTrack));
    expect(r.ok).toBe(true);
  });
  it('rechaza JSON roto y formato inválido con detalle', () => {
    expect(parseTrack('{nope')).toMatchObject({ ok: false });
    const r = parseTrack([{ t: 0, lat: 1, lng: 2 }, { t: 1, lat: 1, lng: 2, heading: null, accuracy: 3 }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/0/);
  });
  it('ordena por t y descarta t repetidos', () => {
    const r = parseTrack([
      { t: 2, ...B, heading: null, accuracy: 5 },
      { t: 0, ...A, heading: null, accuracy: 5 },
      { t: 0, ...A, heading: 90, accuracy: 5 },
    ]);
    expect(r.ok && r.track.map((p) => p.t)).toEqual([0, 2]);
  });
});

describe('rumbos', () => {
  it('bearing al este ≈ 90', () => {
    expect(bearingDeg(A, B)).toBeCloseTo(90, 0);
  });
  it('interpola por el ángulo más corto', () => {
    expect(lerpHeading(350, 10, 0.5)).toBeCloseTo(0, 5);
    expect(lerpHeading(10, 350, 0.25)).toBeCloseTo(5, 5);
    expect(lerpHeading(null, 40, 0.5)).toBe(40);
  });
  it('media circular cruza el norte', () => {
    expect(circularMean([350, 10])).toBeCloseTo(0, 5);
    expect(circularMean([null, null])).toBeNull();
  });
});

describe('TrackCursor', () => {
  const track: TrackPoint[] = [
    { t: 0, ...A, heading: null, accuracy: 4 },
    { t: 10, ...B, heading: 90, accuracy: 8 },
  ];
  const c = new TrackCursor(track);

  it('interpola lat/lng/accuracy linealmente', () => {
    const s = c.sampleAt(5);
    expect(s.lng).toBeCloseTo(-56.1995, 6);
    expect(s.accuracy).toBeCloseTo(6, 6);
    expect(s.speed).toBeCloseTo(c.totalDistance / 10, 6);
  });
  it('clampa fuera de rango', () => {
    expect(c.sampleAt(-5).lng).toBe(A.lng);
    expect(c.sampleAt(99).lng).toBe(B.lng);
  });
  it('stepsBetween nunca separa más de 10 m (a 10x con tick de 250 ms y de 5 s)', () => {
    const cv = new TrackCursor(seedTrack);
    for (const tick of [2.5, 50]) {
      let t = 0;
      let prev = cv.sampleAt(0);
      let maxStep = 0;
      while (t < cv.duration) {
        const next = Math.min(cv.duration, t + tick);
        for (const ts of cv.stepsBetween(t, next, 10)) {
          const s = cv.sampleAt(ts);
          maxStep = Math.max(maxStep, distanceMeters(prev, s));
          prev = s;
        }
        t = next;
      }
      expect(maxStep).toBeLessThanOrEqual(10.01);
    }
  });
  it('timeAtDistance es la inversa de distanceAt', () => {
    const cv = new TrackCursor(seedTrack);
    for (const t of [40, 300, 1000, 1700]) {
      const d = cv.distanceAt(t);
      expect(cv.distanceAt(cv.timeAtDistance(d))).toBeCloseTo(d, 3);
    }
  });
  it('seekTargetFor deja la parada a ~15 s de recorrido', () => {
    const cv = new TrackCursor(seedTrack);
    const cabildo = { lat: -34.90745, lng: -56.20525 };
    const n = cv.nearest(cabildo);
    expect(n.distanceM).toBeLessThan(1);
    const target = cv.seekTargetFor(cabildo, 15);
    expect(n.t - target).toBeCloseTo(15, 5);
    // En ≤15 s a 1x llega a ≤35 m (radio de geofence por defecto).
    expect(distanceMeters(cv.sampleAt(target + 15), cabildo)).toBeLessThan(35);
  });
});

describe('advanceClock', () => {
  it('avanza con la velocidad y se detiene al final', () => {
    expect(advanceClock({ t: 0, playing: true }, 250, 10, 100)).toEqual({ t: 2.5, playing: true, ended: false });
    expect(advanceClock({ t: 99, playing: true }, 1000, 2, 100)).toEqual({ t: 100, playing: false, ended: true });
    expect(advanceClock({ t: 5, playing: false }, 1000, 2, 100).t).toBe(5);
  });
});

describe('smoothTrack', () => {
  // Paseo hacia el este a 1.3 m/s con ruido, un punto de mala precisión y un salto absurdo.
  const raw: TrackPoint[] = [];
  const mPerDegLng = 111_320 * Math.cos((A.lat * Math.PI) / 180);
  for (let s = 0; s <= 300; s++) {
    const noise = Math.sin(s * 1.7) * 2.5; // ±2,5 m
    raw.push({
      t: s + 0.37,
      lat: A.lat + noise / 111_320,
      lng: A.lng + (1.3 * s) / mPerDegLng,
      heading: s % 7 === 0 ? null : 90,
      accuracy: s === 50 ? 45 : 6,
    });
  }
  raw[120] = { ...raw[120], lat: raw[120].lat + 0.002 }; // salto de ~220 m

  const out = smoothTrack(raw);

  it('re-muestrea a 1 Hz desde 0', () => {
    expect(out[0].t).toBe(0);
    expect(out[1].t - out[0].t).toBe(1);
    expect(out.length).toBeGreaterThan(290);
  });
  it('descarta precisión mala y saltos', () => {
    expect(out.every((p) => p.accuracy <= 30)).toBe(true);
    expect(maxJumpMeters(out)).toBeLessThanOrEqual(8);
  });
  it('heading coherente con el movimiento', () => {
    const mid = out[150];
    expect(mid.heading).not.toBeNull();
    expect(Math.abs(((mid.heading! - 90 + 540) % 360) - 180)).toBeLessThan(15);
  });
  it('el track del seed suavizado sigue pasando por las paradas', () => {
    const smoothed = smoothTrack(seedTrack);
    expect(maxJumpMeters(smoothed)).toBeLessThanOrEqual(8);
    const d = distancesToPoints(smoothed, [{ name: 'Cabildo', lat: -34.90745, lng: -56.20525 }]);
    expect(d[0].distanceM).toBeLessThan(20);
  });
});

describe('synthesizeTrack', () => {
  it('camina por todas las paradas con saltos chicos', () => {
    const stops = [A, B, { lat: -34.9075, lng: -56.199 }];
    const tr = synthesizeTrack(stops, { dwellS: 10, leadInS: 20 });
    expect(parseTrack(tr).ok).toBe(true);
    expect(maxJumpMeters(tr)).toBeLessThan(2);
    for (const d of distancesToPoints(tr, stops.map((s, i) => ({ ...s, name: String(i) })))) {
      expect(d.distanceM).toBeLessThan(1);
    }
    // con leadIn arranca lejos de la primera parada
    expect(distanceMeters(tr[0], A)).toBeGreaterThan(20);
  });
});
