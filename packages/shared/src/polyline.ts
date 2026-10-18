// Polilíneas codificadas de Google (Encoded Polyline Algorithm, precision 5 por defecto).
// "Cómo llego" embebido: route_eta con `detail: true` devuelve `detail.polyline` y la app la dibuja/sigue.

export type PolylinePoint = { lat: number; lng: number };

/** Decodifica una polilínea de Google. Entrada vacía o rota → lo que se pudo leer (nunca tira). */
export function decodePolyline(encoded: string | null | undefined, precision = 5): PolylinePoint[] {
  if (!encoded) return [];
  const factor = 10 ** precision;
  const points: PolylinePoint[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  const next = (): number | null => {
    let result = 0;
    let shift = 0;
    let b: number;
    do {
      if (index >= encoded.length) return null;
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (index < encoded.length) {
    const dLat = next();
    const dLng = next();
    if (dLat === null || dLng === null) break;
    lat += dLat;
    lng += dLng;
    points.push({ lat: lat / factor, lng: lng / factor });
  }
  return points;
}

/** Codifica puntos (tests y simulador). */
export function encodePolyline(points: PolylinePoint[], precision = 5): string {
  const factor = 10 ** precision;
  let prevLat = 0;
  let prevLng = 0;
  let out = '';
  const enc = (v: number) => {
    let n = v < 0 ? ~(v << 1) : v << 1;
    let s = '';
    while (n >= 0x20) {
      s += String.fromCharCode((0x20 | (n & 0x1f)) + 63);
      n >>= 5;
    }
    return s + String.fromCharCode(n + 63);
  };
  for (const p of points) {
    const lat = Math.round(p.lat * factor);
    const lng = Math.round(p.lng * factor);
    out += enc(lat - prevLat) + enc(lng - prevLng);
    prevLat = lat;
    prevLng = lng;
  }
  return out;
}
