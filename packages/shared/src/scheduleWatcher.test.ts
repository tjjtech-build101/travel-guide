// Vigilante de horarios: salí ya / vas tarde / por empezar, dedupe y silencios.
import { describe, expect, it } from 'vitest';
import {
  alertKey,
  evaluateSchedule,
  inQuietHours,
  leaveInMin,
  nextWatchTarget,
  scheduleAlertText,
  shouldRefreshEta,
  type ScheduleWatchInput,
  type WatchBlock,
} from './scheduleWatcher';
import { VOICE_EVENT_TYPES, formatVoiceEvent } from './voice';

// Seed: Teatro Solís (16:00) y la Puerta de la Ciudadela (~70 m) / Mercado del Puerto (~1 km).
const SOLIS: WatchBlock = { id: 'solis', title: 'Visita guiada al Teatro Solís', start_time: '16:00:00', time_flex: 'fixed', lat: -34.90722, lng: -56.20056 };
const CIUDADELA = { lat: -34.90674, lng: -56.20125 };
const MERCADO = { lat: -34.9067, lng: -56.2128 };
const H = (h: number, m = 0) => h * 60 + m;

function run(over: Partial<ScheduleWatchInput>) {
  return evaluateSchedule({ nowMin: H(15, 30), here: MERCADO, blocks: [SOLIS], etas: { solis: 14 }, sent: [], ...over });
}

/** Simula el runner: corre minuto a minuto acumulando lo enviado. */
function timeline(from: number, to: number, over: Partial<ScheduleWatchInput> = {}) {
  let sent: string[] = [];
  const out: { at: number; kind: string; leave_in: number | null }[] = [];
  for (let t = from; t <= to; t++) {
    const r = run({ ...over, nowMin: t, sent });
    sent = [...sent, ...r.markSent];
    for (const a of r.alerts) out.push({ at: t, kind: a.payload.kind, leave_in: a.payload.leave_in_min });
  }
  return out;
}

describe('contrato', () => {
  it('schedule_alert es un evento de voz', () => {
    expect(VOICE_EVENT_TYPES).toContain('schedule_alert');
    expect(formatVoiceEvent('schedule_alert', { kind: 'leave_now' })).toBe('[EVENTO:schedule_alert] {"kind":"leave_now"}');
  });
  it('"Salí en X" = inicio − ETA − 5 − ahora (mismo cálculo que Ahora)', () => {
    expect(leaveInMin(H(16), H(15, 30), 14)).toBe(11);
  });
});

describe('leave_now', () => {
  it('avisa a ≤10 min de salir y de nuevo a ≤5, una vez cada umbral', () => {
    // inicio 16:00, ETA 14, margen 5 → salir 15:41. ≤10 a las 15:31, ≤5 a las 15:36.
    expect(timeline(H(15, 20), H(15, 45))).toEqual([
      { at: H(15, 31), kind: 'leave_now', leave_in: 10 },
      { at: H(15, 36), kind: 'leave_now', leave_in: 5 },
    ]);
  });

  it('payload con los números exactos', () => {
    const r = run({ nowMin: H(15, 33) });
    expect(r.alerts).toEqual([
      {
        key: 'solis@16:00:leave_now:10',
        payload: { kind: 'leave_now', block_id: 'solis', title: SOLIS.title, start_time: '16:00', eta_min: 14, leave_in_min: 8, late_by_min: null },
      },
    ]);
    expect(r.markSent).toEqual(['solis@16:00:leave_now:10']);
  });

  it('si arranca con los dos umbrales cruzados, un solo aviso (el de 5) y marca ambos', () => {
    const r = run({ nowMin: H(15, 38) });
    expect(r.alerts.map((a) => a.key)).toEqual(['solis@16:00:leave_now:5']);
    expect(r.markSent.sort()).toEqual(['solis@16:00:leave_now:10', 'solis@16:00:leave_now:5']);
  });

  it('sin ETA de route_eta usa la estimación a pie', () => {
    const r = run({ nowMin: H(15, 30), etas: {} });
    expect(r.target?.estimated).toBe(true);
    expect(r.target?.eta_min).toBeGreaterThan(10);
  });

  it('si movieron el bloque de hora, se rearma', () => {
    const sent = ['solis@16:00:leave_now:10', 'solis@16:00:leave_now:5'];
    const moved = { ...SOLIS, start_time: '16:30' };
    const r = run({ nowMin: H(16, 3), blocks: [moved], sent });
    expect(r.alerts.map((a) => a.key)).toEqual(['solis@16:30:leave_now:10']);
  });
});

describe('running_late', () => {
  it('avisa cuando la llegada estimada supera el inicio por más de 5 min, una vez', () => {
    // 15:50 + 14 = 16:04 → 4 min tarde (no); 15:52 + 14 = 16:06 → 6 (sí).
    expect(run({ nowMin: H(15, 50), sent: ['solis@16:00:leave_now:10', 'solis@16:00:leave_now:5'] }).alerts).toEqual([]);
    const r = run({ nowMin: H(15, 52) });
    expect(r.alerts.map((a) => a.payload)).toEqual([
      { kind: 'running_late', block_id: 'solis', title: SOLIS.title, start_time: '16:00', eta_min: 14, leave_in_min: -11, late_by_min: 6 },
    ]);
    // Arrancó tarde: no apila los "salí ya".
    expect(r.markSent.sort()).toEqual(['solis@16:00:leave_now:10', 'solis@16:00:leave_now:5', 'solis@16:00:running_late']);
    expect(run({ nowMin: H(15, 55), sent: r.markSent }).alerts).toEqual([]);
  });

  it('en una línea de tiempo completa: 10, 5 y después tarde', () => {
    expect(timeline(H(15, 0), H(15, 59)).map((a) => [a.at, a.kind])).toEqual([
      [H(15, 31), 'leave_now'],
      [H(15, 36), 'leave_now'],
      [H(15, 52), 'running_late'],
    ]);
  });
});

describe('starting_soon', () => {
  it('empieza en ≤15 min y ya estás a ≤150 m', () => {
    expect(run({ nowMin: H(15, 40), here: CIUDADELA }).alerts).toEqual([]);
    const r = run({ nowMin: H(15, 45), here: CIUDADELA });
    expect(r.alerts.map((a) => a.payload.kind)).toEqual(['starting_soon']);
    expect(r.alerts[0].payload.leave_in_min).toBeNull();
    // Cerca no hay "salí ya" ni "vas tarde" para ese bloque.
    expect(run({ nowMin: H(15, 50), here: CIUDADELA, sent: r.markSent }).alerts).toEqual([]);
    expect(run({ nowMin: H(15, 50), here: MERCADO, etas: { solis: 20 }, sent: r.markSent }).alerts).toEqual([]);
  });
});

describe('qué bloques mira', () => {
  const lunch: WatchBlock = { id: 'lunch', title: 'Almuerzo', start_time: '13:00', time_flex: 'fixed', lat: MERCADO.lat, lng: MERCADO.lng };
  it('el próximo con hora fija y lugar; ignora pasados, enmascarados, sin lugar y de franja', () => {
    const blocks: WatchBlock[] = [
      lunch,
      { ...SOLIS, id: 'busy', masked: true, start_time: '15:40' },
      { ...SOLIS, id: 'noplace', lat: null, lng: null, start_time: '15:45' },
      { ...SOLIS, id: 'flex', time_flex: 'afternoon', start_time: '15:50' },
      SOLIS,
    ];
    expect(nextWatchTarget(blocks, H(15, 30))?.id).toBe('solis');
    expect(nextWatchTarget(blocks, H(12, 0))?.id).toBe('lunch');
    expect(nextWatchTarget(blocks, H(16, 0))).toBeNull();
    expect(run({ nowMin: H(16, 10) }).skipped).toBe('no_block');
  });

  it('no avisa para bloques a más de 30 km (mismo criterio que Ahora)', () => {
    const r = run({ nowMin: H(15, 38), here: { lat: 37.33, lng: -122.03 } });
    expect(r.alerts).toEqual([]);
    expect(r.skipped).toBe('far_away');
  });

  it('sin ubicación no avisa', () => {
    expect(run({ nowMin: H(15, 38), here: null }).skipped).toBe('no_location');
  });
});

describe('silencios', () => {
  it('nada durante un tour activo (manda time_warning) y no marca enviados', () => {
    const r = run({ nowMin: H(15, 38), tourActive: true });
    expect(r).toMatchObject({ alerts: [], markSent: [], skipped: 'tour' });
  });

  it('horas de silencio de profiles.quiet_hours (con vuelta de medianoche)', () => {
    expect(inQuietHours(H(23, 30), { start: '23:00', end: '08:00' })).toBe(true);
    expect(inQuietHours(H(7, 59), { start: '23:00', end: '08:00' })).toBe(true);
    expect(inQuietHours(H(8, 0), { start: '23:00', end: '08:00' })).toBe(false);
    expect(inQuietHours(H(15, 0), { start: '14:00', end: '16:00' })).toBe(true);
    expect(inQuietHours(H(15, 0), null)).toBe(false);
    expect(run({ nowMin: H(15, 38), quietHours: { start: '15:00', end: '17:00' } }).skipped).toBe('quiet_hours');
  });
});

describe('caché de ETA', () => {
  const entry = { block_id: 'solis', minutes: 14, at: 0, from: MERCADO };
  it('recalcula cada 2 min o al moverse >100 m', () => {
    expect(shouldRefreshEta(null, 'solis', MERCADO, 0)).toBe(true);
    expect(shouldRefreshEta(entry, 'otro', MERCADO, 1000)).toBe(true);
    expect(shouldRefreshEta(entry, 'solis', MERCADO, 60_000)).toBe(false);
    expect(shouldRefreshEta(entry, 'solis', MERCADO, 120_000)).toBe(true);
    expect(shouldRefreshEta(entry, 'solis', { lat: MERCADO.lat, lng: MERCADO.lng + 0.0013 }, 60_000)).toBe(true); // ~120 m
    expect(shouldRefreshEta(entry, 'solis', { lat: MERCADO.lat, lng: MERCADO.lng + 0.0005 }, 60_000)).toBe(false); // ~45 m
  });
});

describe('texto de la notificación', () => {
  it('salí en X / salí ya / vas tarde / por empezar', () => {
    const p = { block_id: 'solis', title: 'Visita guiada', start_time: '16:00', eta_min: 14, late_by_min: null };
    expect(scheduleAlertText({ ...p, kind: 'leave_now', leave_in_min: 8 }, 'Teatro Solís').title).toBe('Salí en 8 min para Teatro Solís');
    expect(scheduleAlertText({ ...p, kind: 'leave_now', leave_in_min: -2 }, 'Teatro Solís').title).toBe('Salí ya para Teatro Solís');
    expect(scheduleAlertText({ ...p, kind: 'running_late', leave_in_min: -12, late_by_min: 7 }, 'Teatro Solís').title).toBe('Vas 7 min tarde a Teatro Solís');
    expect(scheduleAlertText({ ...p, kind: 'starting_soon', leave_in_min: null }).title).toBe('Visita guiada empieza a las 16:00');
  });
  it('alertKey estable', () => {
    expect(alertKey({ id: 'x', start_time: '9:05:00' }, 'leave_now', 10)).toBe('x@09:05:leave_now:10');
  });
});
