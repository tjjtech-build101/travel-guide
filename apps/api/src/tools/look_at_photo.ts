// look_at_photo (PRD 08): foto + GPS + orientación + lugares cercanos (place_library con facts verificados) →
// Claude visión (effort low, salida estructurada) → narración corta que el scout dice. La foto queda en photos.
// Subida a Storage, cercanos y perfil corren en paralelo con lo que se pueda; Claude espera solo a los cercanos.
import { randomUUID } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { distanceMeters, LookAtPhotoModelOutput, type LookAtPhotoOutput, type ToolInput } from '@build101/shared';
import { PLANNER_MODEL } from '../agents/llm';
import { env } from '../env';
import { badInput, dbError, notConfigured, ToolFailure, upstream } from '../errors';
import type { Db } from '../supabase';
import type { ToolCtx, ToolOk } from './types';

export const PHOTOS_BUCKET = 'photos';
// 300 m: la Puerta de la Ciudadela está a ~203 m de Plaza Independencia y con 200 quedaba fuera de la lista.
const NEARBY_RADIUS_M = 300;
const MAX_NEARBY = 8;
const MAX_FACTS_PER_PLACE = 5;
/** ±0,0035° ≈ 390 m: caja para la consulta; después se filtra por distancia real. */
const BBOX_DEG = 0.0035;
const FRONT_DEG = 35;

type Fact = { text: string; source_url: string; verified?: boolean };
type PlaceRow = { id: string; name: string | null; lat: number | null; lng: number | null; tier: string | null; facts: Fact[] | null };

export type NearbyPlace = {
  place_id: string;
  name: string;
  distance_m: number;
  bearing_deg: number;
  /** Ángulo respecto a hacia dónde apunta el celu (−180..180); null sin brújula. */
  relative_deg: number | null;
  in_front: boolean;
  facts: { text: string; source_url: string }[];
};

/** Rumbo inicial de a → b en grados (0 = norte, sentido horario). */
export function bearingDeg(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const r = (d: number) => (d * Math.PI) / 180;
  const y = Math.sin(r(b.lng - a.lng)) * Math.cos(r(b.lat));
  const x = Math.cos(r(a.lat)) * Math.sin(r(b.lat)) - Math.sin(r(a.lat)) * Math.cos(r(b.lat)) * Math.cos(r(b.lng - a.lng));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export function relativeDeg(bearing: number, heading: number): number {
  return ((bearing - heading + 540) % 360) - 180;
}

/** Cercanos ordenados: primero los que están enfrente, después por distancia. */
export function rankNearby(rows: PlaceRow[], here: { lat: number; lng: number }, heading: number | null): NearbyPlace[] {
  return rows
    .filter((p) => p.lat != null && p.lng != null && p.name)
    .map((p) => {
      const pt = { lat: p.lat!, lng: p.lng! };
      const bearing = bearingDeg(here, pt);
      const rel = heading == null ? null : relativeDeg(bearing, heading);
      return {
        place_id: p.id,
        name: p.name!,
        distance_m: Math.round(distanceMeters(here, pt)),
        bearing_deg: Math.round(bearing),
        relative_deg: rel == null ? null : Math.round(rel),
        in_front: rel != null && Math.abs(rel) <= FRONT_DEG,
        facts: (p.facts ?? [])
          .filter((f) => f.verified === true && f.text && f.source_url)
          .slice(0, MAX_FACTS_PER_PLACE)
          .map((f) => ({ text: f.text, source_url: f.source_url })),
      };
    })
    .filter((p) => p.distance_m <= NEARBY_RADIUS_M)
    .sort((a, b) => Number(b.in_front) - Number(a.in_front) || a.distance_m - b.distance_m)
    .slice(0, MAX_NEARBY);
}

/**
 * La salida de Claude solo puede usar lo que le dimos: place_id de la lista, facts de ese lugar (verified) y texto
 * leído en la imagen. Lo demás se descarta; con confianza baja no se afirma un nombre.
 */
export function sanitizeOutput(out: LookAtPhotoModelOutput, nearby: NearbyPlace[]): LookAtPhotoModelOutput {
  const byId = new Map(nearby.map((p) => [p.place_id, p]));
  let place = out.place;
  if (place?.place_id && !byId.has(place.place_id)) place = { ...place, place_id: null, confidence: Math.min(place.confidence, 0.5) };
  const allowed = new Set(nearby.flatMap((p) => p.facts.map((f) => `${f.text}|${f.source_url}`)));
  const facts_used = out.facts_used.filter((f) => allowed.has(`${f.text}|${f.source_url}`));
  return { ...out, place, facts_used };
}

const SYSTEM = [
  'Sos los ojos de un guía de viaje. Te mandan una foto sacada con el celu, dónde está la persona y para dónde apunta, y una lista de lugares cercanos con DATOS VERIFICADOS.',
  'Identificá qué muestra la foto usando la imagen y la lista (los marcados "ENFRENTE" son los más probables). place.place_id solo puede ser un id de la lista; si es algo que no está en la lista, place_id null y el nombre que veas.',
  'confidence: 0 a 1. Si es menor a 0.6, en narration decí que no estás seguro y describí lo que ves, sin afirmar un nombre ni datos históricos.',
  'Podés usar SOLO los DATOS VERIFICADOS dados y el texto que se lee literalmente en la imagen. Nunca agregues años, nombres o cifras que no estén ahí. facts_used = los datos de la lista que usaste, copiados tal cual.',
  'inscriptions: máximo 3, las más relevantes (placas, nombres, carteles cercanos), con su idioma; translation al idioma de la persona si difiere, si no null. No transcribas carteles de publicidad uno por uno.',
  'Si te hacen una pregunta, respondela primero. narration: tono hablado, ≤60 palabras, en el idioma pedido, sin nombrar "la lista" ni "los datos".',
  'quality: blurry si está movida, dark si está oscura (en ese caso narration pide sacar otra).',
].join('\n');

/** VISION_MODEL permite comparar modelos por latencia (default Opus 5.5, Arquitectura). */
export function visionModel(): string {
  return process.env.VISION_MODEL?.trim() || PLANNER_MODEL;
}

export type VisionLLM = (args: { system: string; text: string; imageBase64: string }) => Promise<LookAtPhotoModelOutput>;

export const anthropicVision: VisionLLM = async ({ system, text, imageBase64 }) => {
  const apiKey = env().ANTHROPIC_API_KEY;
  if (!apiKey) throw notConfigured('Anthropic (ANTHROPIC_API_KEY)');
  const client = new Anthropic({ apiKey });
  const format = betaZodOutputFormat(LookAtPhotoModelOutput);
  // Mismo patrón que agents/llm.ts: output_config no está tipado en el SDK 0.70 → cast.
  const params = {
    model: visionModel(),
    max_tokens: 1200,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: format.schema } },
    system: [{ type: 'text', text: system }],
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 } },
          { type: 'text', text },
        ],
      },
    ],
  };
  let created: unknown;
  try {
    created = await client.beta.messages.create(params as never);
  } catch (err) {
    const m = (err as Error).message ?? '';
    // Sin saldo / sin acceso: error legible (el scout dice que ahora no puede mirar) en vez de un 500 crudo.
    if (/credit balance|billing|quota/i.test(m)) throw new ToolFailure(503, 'vision_unavailable', 'Ahora no puedo mirar fotos (sin saldo de Claude).');
    throw upstream(`Claude visión: ${m.slice(0, 200)}`);
  }
  const msg = created as unknown as {
    stop_reason: string | null;
    content: { type: string; text?: string }[];
  };
  if (msg.stop_reason === 'refusal') throw upstream('Claude no quiso describir la foto.');
  return format.parse(msg.content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join(''));
};

/** Inyectable en tests. */
export const visionDeps: { llm: VisionLLM } = { llm: anthropicVision };

let bucketReady: Promise<void> | null = null;
/** El bucket se crea solo la primera vez (privado): no hace falta migración. */
function ensureBucket(admin: Db): Promise<void> {
  bucketReady ??= (async () => {
    const { error } = await admin.storage.createBucket(PHOTOS_BUCKET, { public: false });
    if (error && !/exist/i.test(error.message)) {
      bucketReady = null;
      throw error;
    }
  })();
  return bucketReady;
}

async function loadNearby(admin: Db, lat: number, lng: number, heading: number | null): Promise<NearbyPlace[]> {
  const { data, error } = await admin
    .from('place_library')
    .select('id,name,lat,lng,tier,facts')
    .gte('lat', lat - BBOX_DEG)
    .lte('lat', lat + BBOX_DEG)
    .gte('lng', lng - BBOX_DEG)
    .lte('lng', lng + BBOX_DEG)
    .limit(60);
  if (error) throw dbError(error, 'place_library');
  return rankNearby((data ?? []) as PlaceRow[], { lat, lng }, heading);
}

function promptText(i: ToolInput<'look_at_photo'>, nearby: NearbyPlace[], lang: string): string {
  const where = `Ubicación: ${i.lat.toFixed(5)}, ${i.lng.toFixed(5)}${i.accuracy != null ? ` (±${Math.round(i.accuracy)} m)` : ''}. ${
    i.heading != null ? `El celu apunta a ${Math.round(i.heading)}° (0 = norte); la brújula puede fallar.` : 'Sin brújula.'
  }`;
  const list = nearby.length
    ? nearby
        .map((p) => {
          const dir = p.relative_deg == null ? `rumbo ${p.bearing_deg}°` : p.in_front ? 'ENFRENTE' : `${p.relative_deg > 0 ? 'a la derecha' : 'a la izquierda'} ${Math.abs(p.relative_deg)}°`;
          const facts = p.facts.length ? p.facts.map((f) => `    - ${f.text} [${f.source_url}]`).join('\n') : '    (sin datos verificados)';
          return `- id=${p.place_id} · ${p.name} · ${p.distance_m} m · ${dir}\n  DATOS VERIFICADOS:\n${facts}`;
        })
        .join('\n')
    : '(no hay lugares de la biblioteca cerca)';
  return `${where}\nIdioma de la persona: ${lang}.\n${i.question ? `Pregunta: "${i.question}"\n` : ''}Lugares cercanos:\n${list}`;
}

export async function look_at_photo(input: ToolInput<'look_at_photo'>, ctx: ToolCtx): Promise<ToolOk> {
  const t0 = Date.now();
  const timings: Record<string, number> = {};
  const lap = (k: string, from = t0) => (timings[k] = Date.now() - from);

  let imageBase64 = input.image_base64?.replace(/^data:image\/\w+;base64,/, '') ?? null;
  let storagePath: string | null = input.storage_path ?? null;

  // Foto ya subida (camino de Contratos): la bajamos con service role (misma región, rápido).
  if (!imageBase64 && storagePath) {
    const { data, error } = await ctx.admin.storage.from(PHOTOS_BUCKET).download(storagePath);
    if (error || !data) throw badInput(`No pude leer la foto ${storagePath}.`);
    imageBase64 = Buffer.from(await data.arrayBuffer()).toString('base64');
    lap('download');
  }
  if (!imageBase64) throw badInput('Falta la foto.');

  // Subida (si vino en base64), cercanos y perfil en paralelo.
  const uploadP = input.image_base64
    ? (async () => {
        const path = `${ctx.userId}/${input.trip_id ?? 'sin-viaje'}/${randomUUID()}.jpg`;
        await ensureBucket(ctx.admin);
        const { error } = await ctx.admin.storage
          .from(PHOTOS_BUCKET)
          .upload(path, Buffer.from(imageBase64!, 'base64'), { contentType: 'image/jpeg' });
        lap('upload');
        if (error) {
          console.warn('[look_at_photo] subida:', error.message);
          return null;
        }
        return path;
      })().catch((e) => {
        console.warn('[look_at_photo] subida:', (e as Error).message);
        return null;
      })
    : Promise.resolve(storagePath);
  const [nearby, profile] = await Promise.all([
    loadNearby(ctx.admin, input.lat, input.lng, input.heading ?? null).then((r) => (lap('nearby'), r)),
    ctx.admin.from('profiles').select('locale').eq('id', ctx.userId).maybeSingle(),
  ]);
  const lang = input.language ?? (profile.data?.locale as string | undefined) ?? 'es';

  const tLlm = Date.now();
  let raw: LookAtPhotoModelOutput;
  try {
    raw = await visionDeps.llm({ system: SYSTEM, text: promptText(input, nearby, lang), imageBase64 });
  } catch (err) {
    // Sin resultado no hay fila en photos: no dejar la foto huérfana en Storage (solo si la subimos nosotros).
    if (input.image_base64) {
      void uploadP.then(async (path) => {
        if (path) await ctx.admin.storage.from(PHOTOS_BUCKET).remove([path]);
      });
    }
    throw err;
  }
  lap('claude', tLlm);
  const out = sanitizeOutput(raw, nearby);

  storagePath = await uploadP;
  const confident = !!out.place && out.place.confidence >= 0.6;
  const { data: photo, error } = await ctx.admin
    .from('photos')
    .insert({
      trip_id: input.trip_id ?? null,
      user_id: ctx.userId,
      url: storagePath,
      lat: input.lat,
      lng: input.lng,
      heading: input.heading ?? null,
      taken_at: input.taken_at ?? new Date().toISOString(),
      kind: 'camera',
      caption: confident ? out.place!.name : 'Sin identificar',
      place_id: confident ? out.place!.place_id : null,
    })
    .select('id')
    .single();
  if (error) console.warn('[look_at_photo] photos:', error.message);
  lap('total');
  console.log(`[look_at_photo] ${JSON.stringify(timings)} · ${nearby.length} cercanos · ${out.place?.name ?? '—'} (${out.place?.confidence ?? 0})`);

  const data: LookAtPhotoOutput = { ...out, photo_id: (photo?.id as string | undefined) ?? null, storage_path: storagePath, timings };
  return { ok: true, data };
}
