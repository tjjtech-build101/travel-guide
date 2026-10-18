// Genera el estilo "mapa viejo" del Mapa: baja Mapbox Streets v12 y recolorea cada color en sepia
// (agua gris verdosa, parques oliva, papel en vez de blanco). Lo usa TripMapView vía `styleJSON`.
// Uso: pnpm map:vintage   (lee EXPO_PUBLIC_MAPBOX_TOKEN de apps/mobile/.env)
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../../', import.meta.url).pathname;
const OUT = join(ROOT, 'apps/mobile/src/features/map/vintageStyle.json');

type Hsla = { h: number; s: number; l: number; a: number };

function token(): string {
  const env = readFileSync(join(ROOT, 'apps/mobile/.env'), 'utf8');
  const m = env.match(/^EXPO_PUBLIC_MAPBOX_TOKEN=(.+)$/m);
  if (!m) throw new Error('Falta EXPO_PUBLIC_MAPBOX_TOKEN en apps/mobile/.env');
  return m[1].trim();
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function parse(c: string): Hsla | null {
  let m = c.match(/^hsla?\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*(?:,\s*([\d.]+)\s*)?\)$/);
  if (m) return { h: +m[1], s: +m[2] / 100, l: +m[3] / 100, a: m[4] == null ? 1 : +m[4] };
  m = c.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/);
  if (m) {
    const [h, s, l] = rgbToHsl(+m[1], +m[2], +m[3]);
    return { h, s, l, a: m[4] == null ? 1 : +m[4] };
  }
  m = c.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (m) {
    const hex = m[1].length === 3 ? [...m[1]].map((x) => x + x).join('') : m[1];
    const [h, s, l] = rgbToHsl(parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16));
    return { h, s, l, a: 1 };
  }
  return null;
}

/** Luminosidad original → papel envejecido: la tierra queda pergamino, las calles crema y la tinta marrón. */
const L_RAMP: [number, number][] = [
  [0, 0.16],
  [0.5, 0.45],
  [0.85, 0.76],
  [0.91, 0.84],
  [1, 0.94],
];
function ramp(l: number): number {
  for (let i = 1; i < L_RAMP.length; i++) {
    const [x0, y0] = L_RAMP[i - 1];
    const [x1, y1] = L_RAMP[i];
    if (l <= x1) return y0 + ((l - x0) / (x1 - x0)) * (y1 - y0);
  }
  return L_RAMP[L_RAMP.length - 1][1];
}

/** Paleta de mapa antiguo: todo en sepia; el agua y lo verde conservan un tono apagado. */
function vintage({ h, s, l, a }: Hsla): Hsla {
  const nl = ramp(l);
  if (s > 0.2 && h >= 175 && h <= 260) return { h: 186, s: 0.22, l: nl * 0.85, a };
  if (s > 0.15 && h >= 70 && h < 175) return { h: 58, s: 0.3, l: nl * 0.92, a };
  if (nl < 0.35) return { h: 25, s: 0.35, l: nl, a }; // tinta
  return { h: 40, s: Math.min(0.55, 0.3 + s * 0.25), l: nl, a };
}

const fmt = ({ h, s, l, a }: Hsla) => {
  const body = `${Math.round(h)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%`;
  return a < 1 ? `hsla(${body}, ${a})` : `hsl(${body})`;
};

/**
 * Los POI del mapa base (museos, hoteles, teatros) en segundo plano: los protagonistas son los pines del
 * viaje. Mismo tono, más transparentes. (Se aplica también a mano sobre el JSON ya generado.)
 */
export const POI_OPACITY = { text: 0.5, icon: 0.4 };
function quietPois(layers: { id: string; paint?: unknown }[]) {
  for (const l of layers) {
    if (l.id !== 'poi-label' && l.id !== 'transit-label') continue;
    l.paint = { ...((l.paint as object) ?? {}), 'text-opacity': POI_OPACITY.text, 'icon-opacity': POI_OPACITY.icon };
  }
}

let recolored = 0;
function walk(v: unknown): unknown {
  if (typeof v === 'string') {
    const c = parse(v.trim());
    if (!c) return v;
    recolored++;
    return fmt(vintage(c));
  }
  if (Array.isArray(v)) return v.map(walk);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
  return v;
}

async function main() {
  const res = await fetch(`https://api.mapbox.com/styles/v1/mapbox/streets-v12?access_token=${token()}`);
  if (!res.ok) throw new Error(`Mapbox respondió ${res.status}`);
  const style = (await res.json()) as { name: string; layers: { id: string; paint?: unknown; layout?: unknown }[] };

  style.name = 'Mapa viejo (build101)';
  style.layers = style.layers.map((layer) => ({ ...layer, paint: walk(layer.paint), layout: layer.layout }));

  // Costa con un trazo de tinta suave, como en los mapas grabados: una línea marrón clara y otra más tenue
  // hacia el agua. Antiguo no es oscuro: que el trazo no le sume peso al mapa.
  const waterIdx = style.layers.findIndex((l) => l.id === 'water');
  if (waterIdx < 0) throw new Error('No encontré la capa "water" en el estilo');
  const coast = (id: string, paint: Record<string, unknown>) => ({ id, type: 'line', source: 'composite', 'source-layer': 'water', paint });
  style.layers.splice(
    waterIdx + 1,
    0,
    coast('vintage-coast-echo', {
      'line-color': 'hsl(32, 30%, 50%)',
      'line-opacity': 0.25,
      'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.3, 16, 0.7],
      'line-offset': ['interpolate', ['linear'], ['zoom'], 10, 1.5, 16, 4],
    }),
    coast('vintage-coast-ink', {
      'line-color': 'hsl(32, 30%, 45%)',
      'line-opacity': 0.5,
      'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.5, 16, 1.2],
    }),
  );

  quietPois(style.layers as { id: string; paint?: unknown }[]);
  writeFileSync(OUT, JSON.stringify(style));
  console.log(`${recolored} colores recoloreados → ${OUT}`);
}

void main();
