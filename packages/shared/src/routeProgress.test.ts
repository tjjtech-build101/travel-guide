import { describe, expect, it } from 'vitest';

import { distanceMeters } from './location';
import { INITIAL_REROUTE, nextReroute, REROUTE_EVERY_MS, routeProgress } from './routeProgress';

// Ruta en L por Ciudad Vieja: ~300 m al oeste y después ~200 m al norte.
const A = { lat: -34.9066, lng: -56.199 };
const B = { lat: -34.9066, lng: -56.20228 }; // ~300 m al oeste de A
const C = { lat: -34.9048, lng: -56.20228 }; // ~200 m al norte de B
const points = [A, { lat: -34.9066, lng: -56.2006 }, B, { lat: -34.9057, lng: -56.20228 }, C];
const steps = [
  { end: B, distance_m: 300 },
  { end: C, distance_m: 200 },
];
const AB = distanceMeters(A, B);
const BC = distanceMeters(B, C);

describe('routeProgress', () => {
  it('al arrancar: paso 0, falta todo, sobre la ruta', () => {
    const p = routeProgress({ points, steps, here: A, totalMin: 7 });
    expect(p.stepIndex).toBe(0);
    expect(p.distanceToStepEndM).toBeCloseTo(AB, -1);
    expect(p.remainingM).toBeCloseTo(AB + BC, -1);
    expect(p.remainingMin).toBe(7);
    expect(p.offRouteM).toBeLessThan(2);
    expect(p.arrived).toBe(false);
  });

  it('a mitad del primer tramo (corrido 10 m de la línea)', () => {
    const here = { lat: -34.90669, lng: (A.lng + B.lng) / 2 };
    const p = routeProgress({ points, steps, here, totalMin: 7 });
    expect(p.stepIndex).toBe(0);
    expect(p.distanceToStepEndM).toBeGreaterThan(AB / 2 - 10);
    expect(p.distanceToStepEndM).toBeLessThan(AB / 2 + 10);
    expect(p.offRouteM).toBeGreaterThan(5);
    expect(p.offRouteM).toBeLessThan(15);
    expect(p.remainingMin).toBeGreaterThan(2);
    expect(p.remainingMin).toBeLessThan(7);
  });

  it('pasada la esquina: paso 1', () => {
    const here = { lat: -34.906, lng: B.lng };
    const p = routeProgress({ points, steps, here });
    expect(p.stepIndex).toBe(1);
    expect(p.distanceToStepEndM).toBeCloseTo(distanceMeters(here, C), -1);
  });

  it('justo en la esquina (dentro de 3 m) ya muestra el paso siguiente', () => {
    const p = routeProgress({ points, steps, here: B });
    expect(p.stepIndex).toBe(1);
  });

  it('lejos de la ruta: offRouteM grande', () => {
    const here = { lat: -34.9100, lng: -56.2006 };
    const p = routeProgress({ points, steps, here });
    expect(p.offRouteM).toBeGreaterThan(300);
    expect(p.arrived).toBe(false);
  });

  it('llegada: ≤ 35 m del destino', () => {
    const here = { lat: C.lat - 0.0002, lng: C.lng }; // ~22 m
    const p = routeProgress({ points, steps, here, totalMin: 7 });
    expect(p.arrived).toBe(true);
    expect(p.remainingM).toBe(0);
    expect(p.remainingMin).toBe(0);
    expect(p.stepIndex).toBe(1);
  });

  it('sin pasos (estimada, línea recta): stepIndex -1 y falta = distancia', () => {
    const p = routeProgress({ points: [A, C], here: A });
    expect(p.stepIndex).toBe(-1);
    expect(p.remainingM).toBeCloseTo(distanceMeters(A, C), -1);
    expect(p.distanceToStepEndM).toBe(p.remainingM);
    expect(p.remainingMin).toBeGreaterThan(0);
  });

  it('ruta que vuelve sobre sí misma: los pasos se ubican en orden', () => {
    // Ida y vuelta por la misma cuadra: el fin del paso 0 (B) y el del paso 1 (A) no se confunden.
    const loop = [A, B, A];
    const p = routeProgress({ points: loop, steps: [{ end: B }, { end: A }], here: { lat: A.lat, lng: (A.lng + B.lng) / 2 } });
    expect(p.stepIndex).toBe(0);
  });

  it('sin puntos no tira', () => {
    const p = routeProgress({ points: [], here: A });
    expect(p.remainingM).toBe(0);
    expect(p.arrived).toBe(false);
  });
});

describe('nextReroute', () => {
  it('pide 2 fixes seguidos fuera de ruta', () => {
    let s = INITIAL_REROUTE;
    let r = nextReroute(s, 80, 1000);
    expect(r.reroute).toBe(false);
    s = r.state;
    r = nextReroute(s, 80, 2000);
    expect(r.reroute).toBe(true);
  });

  it('volver a la ruta reinicia la cuenta', () => {
    let r = nextReroute(INITIAL_REROUTE, 80, 0);
    r = nextReroute(r.state, 10, 1000);
    r = nextReroute(r.state, 80, 2000);
    expect(r.reroute).toBe(false);
  });

  it('como mucho una vez cada 20 s', () => {
    let r = nextReroute(INITIAL_REROUTE, 80, 0);
    r = nextReroute(r.state, 80, 1000);
    expect(r.reroute).toBe(true);
    r = nextReroute(r.state, 80, 2000);
    r = nextReroute(r.state, 80, 3000);
    expect(r.reroute).toBe(false);
    r = nextReroute(r.state, 80, 1000 + REROUTE_EVERY_MS);
    expect(r.reroute).toBe(true);
  });
});
