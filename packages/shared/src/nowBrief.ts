// Frase de Scout en Ahora (docs/AHORA-V2.md). nowBriefRules es la versión por reglas: la usa la app al instante
// y la API cuando no hay Claude. Una sola frase, voseo, ≤ 110 caracteres, con números exactos.
import type { NowBriefSnapshotT } from './tools/nowTools';

export function nowBriefRules(s: NowBriefSnapshotT): string {
  const next = s.next?.title;
  switch (s.hero) {
    case 'leave':
      if (s.leave_in_min != null && s.leave_in_min < 0) return `Vas ${-s.leave_in_min} min tarde a ${next}. ¿Aviso al grupo?`;
      if (s.leave_in_min != null && s.leave_in_min <= 0) return `Salí ya para ${next}.`;
      return `En ${s.leave_in_min} min salimos para ${next}${s.walk_min ? `: son ${s.walk_min} min a pie` : ''}.`;
    case 'tour':
      return `Tu tour está listo. Cuando quieras arrancamos.`;
    case 'current':
      return next ? `Disfrutá. Después sigue ${next}.` : `Disfrutá, no hay apuro.`;
    case 'free': {
      const sug = s.suggestions?.[0];
      if (sug) return `Tenés ${fmt(s.gap_min)} libres. ${sug.title}${sug.walk_min != null ? ` queda a ${sug.walk_min} min` : ''}.`;
      return s.gap_min ? `Tenés ${fmt(s.gap_min)} libres. ¿Te armo algo cerca?` : `Tenés el resto del día libre. ¿Te armo algo?`;
    }
    default:
      return `Acá estoy cuando me necesites.`;
  }
}

function fmt(min: number | null | undefined): string {
  if (!min || min < 60) return `${min ?? 0} min`;
  const h = Math.floor(min / 60);
  const r = min % 60;
  return r ? `${h} h ${String(r).padStart(2, '0')}` : `${h} h`;
}
