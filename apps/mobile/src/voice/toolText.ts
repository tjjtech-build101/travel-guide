// Partes puras del puente de herramientas (sin React Native): parseo, textos de tarjetas y nombres amigables.
import type { ToolResponse } from '@build101/shared';

export function parseArgs(raw: string): Record<string, unknown> | null {
  if (!raw || raw.trim() === '') return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Output para el modelo: compacto (el modelo no necesita filas enteras con ids internos de Supabase). */
export function toModelOutput(res: ToolResponse): string {
  const s = JSON.stringify(res);
  return s.length > 12_000 ? `${s.slice(0, 12_000)}…(recortado)` : s;
}

/**
 * El modelo a veces anuncia que va a buscar/averiguar y termina el turno sin llamar la herramienta (visto en el iPhone
 * con research). Si el texto de una respuesta sin function_call suena a eso, se le recuerda que la llame.
 */
export function promisedWithoutCalling(text: string): boolean {
  return /\b(lo|te lo) (averiguo|busco|investigo|reviso|chequeo|fijo)\b|\b(ya|ahora) (lo )?(busco|averiguo|me fijo)\b|\bdame un (segundo|toque)\b|\bte (aviso|cuento) (cuando|apenas|en cuanto)\b/i.test(text);
}

const FRIENDLY: Record<string, string> = {
  search_places: 'Buscando lugares',
  place_details: 'Mirando el lugar',
  route_eta: 'Calculando tiempos',
  get_trip_overview: 'Mirando el viaje',
  get_day_plan: 'Mirando el plan',
  add_block: 'Agendando',
  update_block: 'Cambiando el plan',
  move_block: 'Moviendo',
  remove_block: 'Sacando del plan',
  add_idea: 'Guardando la idea',
  undo: 'Deshaciendo',
  plan_trip: 'Armando el viaje',
  tour_brief: 'Pensando el tour',
  generate_tour: 'Armando el tour',
  generate_indoor_tour: 'Armando el recorrido',
  at_stop: 'Marcando la llegada',
  look_at_photo: 'Mirando la foto',
  research: 'Averiguando',
};

export function friendlyToolName(name: string): string {
  return FRIENDLY[name] ?? 'Trabajando';
}

type BlockLike = { title?: string; start_time?: string | null };

/** Texto de la tarjeta de acción ("Agregué «Café» · 17:00"). null = la herramienta no deja tarjeta. */
export function actionText(name: string, res: ToolResponse): { text: string; proposed: boolean } | null {
  if (!res.ok || !res.undo_token) return null;
  const data = (res.data ?? {}) as { mode?: string; block?: BlockLike };
  if (data.mode === 'proposed') return { text: 'Propuesta enviada al grupo', proposed: true };
  const b = data.block;
  const title = b?.title ? `«${b.title}»` : '';
  const at = b?.start_time ? ` · ${b.start_time.slice(0, 5)}` : '';
  switch (name) {
    case 'add_block':
      return { text: `Agregué ${title}${at}`.trim(), proposed: false };
    case 'add_idea':
      return { text: `Guardé la idea ${title}`.trim(), proposed: false };
    case 'update_block':
      return { text: `Cambié ${title}${at}`.trim(), proposed: false };
    case 'move_block':
      return { text: `Moví ${title}${at}`.trim(), proposed: false };
    case 'remove_block':
      return { text: 'Saqué un bloque del plan', proposed: false };
    default:
      return { text: 'Listo', proposed: false };
  }
}
