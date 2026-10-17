// Frase de Scout en Ahora (docs/AHORA-V2.md). nowBriefRules es la versión por reglas: la usa la app al instante
// y la API cuando no hay Claude. Una sola frase, voseo, ≤ 110 caracteres, con números exactos.
import type { NowBriefSnapshotT } from './tools/nowTools';

/** Largo máximo de la frase (app y API). */
export const NOW_BRIEF_MAX = 110;

export function nowBriefRules(s: NowBriefSnapshotT): string {
  return clampBrief(rawRules(s));
}

function rawRules(s: NowBriefSnapshotT): string {
  const next = s.next?.title?.trim() || null;
  const rain = s.weather?.rain_soon === true;
  switch (s.hero) {
    case 'leave': {
      const to = next ? ` a ${next}` : '';
      const toward = next ? ` para ${next}` : '';
      const walk = s.walk_min ? `: son ${s.walk_min} min a pie` : '';
      if (s.leave_in_min == null) return next ? `Lo próximo es ${next}${walk}.` : `Ya casi es hora de salir.`;
      if (s.leave_in_min < 0) return `Vas ${-s.leave_in_min} min tarde${to}. ¿Aviso al grupo?`;
      if (s.leave_in_min === 0) return `Salí ya${toward}${walk}.`;
      return `Salí en ${s.leave_in_min} min${toward}${walk}.`;
    }
    case 'tour': {
      const title = s.current?.title?.trim() || next;
      return title ? `${title} está listo. Cuando quieras arrancamos.` : `Tu tour está listo. Cuando quieras arrancamos.`;
    }
    case 'current': {
      if (!next) return `Disfrutá, no hay apuro.`;
      if (s.leave_in_min != null && s.leave_in_min > 0 && s.leave_in_min <= 60) {
        return `Disfrutá. En ${fmt(s.leave_in_min)} salís para ${next}.`;
      }
      return `Disfrutá. Después sigue ${next}.`;
    }
    case 'free': {
      const gap = s.gap_min && s.gap_min > 0 ? `Tenés ${fmt(s.gap_min)} libres.` : `Tenés el resto del día libre.`;
      const sug = s.suggestions?.[0];
      if (sug) return `${gap} ${sug.title}${sug.walk_min != null ? ` queda a ${sug.walk_min} min` : ' te puede gustar'}.`;
      if (rain) return `${gap} Se viene lluvia: ¿te busco algo bajo techo?`;
      return `${gap} ¿Te armo algo cerca?`;
    }
    default:
      return `Acá estoy cuando me necesites.`;
  }
}

/** Corta a NOW_BRIEF_MAX en un límite de palabra (con "…"). */
export function clampBrief(text: string, max = NOW_BRIEF_MAX): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,.:;·-]+$/, '')}…`;
}

/** 45 → "45 min" · 60 → "1 h" · 75 → "1 h 15". */
function fmt(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const r = min % 60;
  return r ? `${h} h ${String(r).padStart(2, '0')}` : `${h} h`;
}
