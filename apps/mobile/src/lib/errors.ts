// Errores para la persona: cualquier falla (herramienta, job, red, texto viejo) → qué pasó de verdad, en criollo.
// La API ya clasifica los de proveedores (packages/shared/src/errors.ts: provider_no_credits, provider_auth…);
// acá se arma el texto lindo. Puro (sin React Native): lo usan ui/ErrorNotice, ui/States, los toasts y los tests.
import {
  isProvider,
  isProviderErrorCode,
  PROVIDER_LABEL,
  SCOUT,
  type Provider,
} from '@build101/shared';

import type { ScoutPose } from '../scout/ScoutRig';

/** Error normalizado (lo que traen ToolCallError, ToolError y las filas de agent_jobs). */
export type AppError = { code: string; message: string; provider?: Provider; detail?: string };

export type ErrorTone = 'danger' | 'warning' | 'info';

export type ErrorView = {
  code: string;
  /** La causa, corta: "Me quedé sin créditos". */
  title: string;
  /** Qué pasó, en una o dos frases. */
  body: string;
  /** Qué hacer (o quién tiene que hacer algo). */
  hint?: string;
  /** Etiqueta chica arriba: quién falló ("Claude (Anthropic)", "Conexión", "Tu sesión"). */
  tag?: string;
  tone: ErrorTone;
  pose: ScoutPose;
  /** ¿Tiene sentido "Reintentar"? (sin créditos o key inválida: no se arregla reintentando). */
  retryable: boolean;
  /** Acción sugerida además de reintentar. */
  action?: 'login' | 'settings';
  /** Texto técnico crudo (solo se muestra en desarrollo). */
  detail?: string;
};

// ───────────────────────── Normalizar

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object';

/**
 * Cualquier cosa → AppError. Entiende ToolCallError / ToolError ({code, message, provider?, detail?}), filas de
 * agent_jobs ({error, error_code, error_provider}), errores de fetch ("Network request failed") y strings sueltos
 * (jobs viejos sin error_code: se clasifican por el texto).
 */
export function toAppError(e: unknown): AppError {
  if (e == null) return { code: 'unknown', message: '' };
  if (typeof e === 'string') return fromText(e);
  if (isObj(e)) {
    // Fila de agent_jobs
    if ('error_code' in e || ('error' in e && typeof e.error === 'string' && 'status' in e)) {
      const text = typeof e.error === 'string' ? e.error : '';
      const code = typeof e.error_code === 'string' && e.error_code ? e.error_code : null;
      if (!code) return fromText(text);
      return { code, message: text, provider: isProvider(e.error_provider) ? e.error_provider : undefined };
    }
    // PostgrestError de supabase-js (consultas directas): { code: SQLSTATE | PGRSTnnn, message, details, hint }.
    if (typeof e.code === 'string' && ('details' in e || 'hint' in e) && /^(PGRST\d+|[0-9A-Z]{5})$/.test(e.code)) {
      return fromPostgrest(e.code, typeof e.message === 'string' ? e.message : '');
    }
    // { ok:false, error } (ToolResponse)
    if ('ok' in e && e.ok === false && isObj(e.error)) return toAppError(e.error);
    const message = typeof e.message === 'string' ? e.message : '';
    if (typeof e.code === 'string' && e.code) {
      const provider = isProvider(e.provider) ? e.provider : undefined;
      const detail = typeof e.detail === 'string' ? e.detail : undefined;
      // Códigos viejos o genéricos con un texto que delata la causa (p. ej. un upstream_error de Anthropic).
      if ((e.code === 'upstream_error' || e.code === 'internal') && !provider) {
        const guess = fromText(`${message} ${detail ?? ''}`);
        if (guess.code !== 'unknown') return { ...guess, detail: detail ?? message };
      }
      return { code: e.code, message, provider, detail };
    }
    if (e instanceof Error || message) {
      const name = typeof e.name === 'string' ? e.name : '';
      if (name === 'TimeoutError') return { code: 'timeout', message, detail: message };
      if (name === 'AbortError') return { code: 'aborted', message, detail: message };
      return fromText(message);
    }
  }
  return { code: 'unknown', message: String(e) };
}

function fromPostgrest(code: string, message: string): AppError {
  const detail = `${code}: ${message}`;
  if (code === 'PGRST301' || code === 'PGRST302' || code === 'PGRST303' || /jwt/i.test(message)) return { code: 'unauthorized', message: '', detail };
  if (code === '42501') return { code: 'forbidden', message: '', detail };
  if (NETWORK_RE.test(message)) return { code: 'network_error', message: '', detail };
  return { code: 'db_error', message: '', provider: 'supabase', detail };
}

const NETWORK_RE = /network request failed|failed to fetch|network ?error|internet connection appears to be offline|ENOTFOUND|ECONNREFUSED|fetch failed/i;

/** Clasificación por texto (errores crudos del SDK que guardaron jobs viejos, fetch, etc.). */
function fromText(raw: string): AppError {
  const t = raw.trim();
  const detail = t || undefined;
  if (!t) return { code: 'unknown', message: '' };
  const provider = guessProvider(t);
  if (/credit balance|insufficient[_ ]quota|billing|purchase credits|exceeded your current quota|sin saldo|sin créditos/i.test(t))
    return { code: 'provider_no_credits', message: t, provider: provider ?? 'anthropic', detail };
  if (/invalid[_ ]api[_ ]key|incorrect api key|api key not valid|authentication_error|invalid x-api-key/i.test(t))
    return { code: 'provider_auth', message: t, provider, detail };
  if (/rate.?limit|too many requests|\b429\b/i.test(t)) return { code: 'provider_rate_limited', message: t, provider, detail };
  if (/overloaded|\b529\b/i.test(t)) return { code: 'provider_overloaded', message: t, provider: provider ?? 'anthropic', detail };
  if (NETWORK_RE.test(t)) return { code: 'network_error', message: t, detail };
  if (/timed? ?out|tardó demasiado|se cortó por tiempo/i.test(t)) return { code: 'timeout', message: t, detail };
  return { code: 'unknown', message: t, detail };
}

function guessProvider(t: string): Provider | undefined {
  if (/anthropic|claude/i.test(t)) return 'anthropic';
  if (/openai|realtime/i.test(t)) return 'openai';
  if (/google|places/i.test(t)) return 'google';
  if (/supabase|postgres|jwt/i.test(t)) return 'supabase';
  return undefined;
}

/** ¿El texto del servidor se puede mostrar tal cual? (español, corto, sin JSON ni códigos HTTP). */
export function isReadable(msg: string | undefined): msg is string {
  if (!msg) return false;
  const t = msg.trim();
  if (t.length < 4 || t.length > 220) return false;
  if (/[{}[\]<>]|^\d{3}\b|\b(error|failed|undefined|null|exception|cannot|invalid|request|status|denied|permission|relation|column|violates|constraint|jwt|expired|unauthorized|forbidden|not found|timeout)\b/i.test(t)) return false;
  return true;
}

// ───────────────────────── Describir

type Opts = {
  /** Qué estaba haciendo la persona, en infinitivo: "armar el viaje", "guardar el bloque". */
  doing?: string;
};

const CONSOLE: Partial<Record<Provider, string>> = {
  anthropic: 'console.anthropic.com',
  openai: 'platform.openai.com',
  google: 'la consola de Google Cloud',
};

/** Para qué usa la app cada proveedor (para explicar qué deja de andar). */
const ROLE: Partial<Record<Provider, string>> = {
  anthropic: `pensar, investigar ni armar planes`,
  openai: 'hablar por voz',
  google: 'buscar lugares ni calcular recorridos',
};

const who = (p: Provider | undefined) => (p ? PROVIDER_LABEL[p] : 'Un servicio externo');

/** Texto del servidor si sirve, si no el genérico. */
const serverOr = (e: AppError, fallback: string) => (isReadable(e.message) ? e.message : fallback);

export function describeError(input: unknown, opts: Opts = {}): ErrorView {
  const e = toAppError(input);
  const doing = opts.doing;
  const couldnt = doing ? `No pude ${doing}` : 'No pude terminar eso';
  const detail = e.detail ?? (e.message || undefined);
  const base = { code: e.code, detail };
  const p = e.provider;
  const P = who(p);

  if (isProviderErrorCode(e.code)) {
    const tag = P;
    switch (e.code) {
      case 'provider_no_credits':
        return {
          ...base,
          tag,
          tone: 'warning',
          pose: 'think',
          retryable: false,
          title: p === 'anthropic' ? 'Me quedé sin nafta' : `${P} se quedó sin créditos`,
          body: `${P} se quedó sin créditos${ROLE[p ?? 'anthropic'] ? `, y sin eso no puedo ${ROLE[p ?? 'anthropic']}` : ''}. ${couldnt}.`,
          hint: `Quien administra la app tiene que cargar saldo${p && CONSOLE[p] ? ` en ${CONSOLE[p]}` : ''}. Reintentar no lo arregla.`,
        };
      case 'provider_auth':
        return {
          ...base,
          tag,
          tone: 'warning',
          pose: 'think',
          retryable: false,
          title: `La llave de ${P} no funciona`,
          body: `La API key de ${P} es inválida o la revocaron. ${couldnt}.`,
          hint: 'Hay que actualizar la key en el servidor (apps/api). Reintentar no lo arregla.',
        };
      case 'provider_denied':
        return {
          ...base,
          tag,
          tone: 'warning',
          pose: 'think',
          retryable: false,
          title: `${P} no nos deja usar este servicio`,
          body: `La key de ${P} no tiene permiso para esto${p === 'google' ? ' (puede que la API no esté habilitada o falte la facturación)' : ''}. ${couldnt}.`,
          hint: p && CONSOLE[p] ? `Hay que habilitarlo en ${CONSOLE[p]}.` : undefined,
        };
      case 'provider_rate_limited':
        return {
          ...base,
          tag,
          tone: 'info',
          pose: 'think',
          retryable: true,
          title: 'Muchos pedidos seguidos',
          body: `${P} nos pidió que bajemos un cambio. ${couldnt}.`,
          hint: 'Esperá un minuto y probá de nuevo.',
        };
      case 'provider_overloaded':
        return {
          ...base,
          tag,
          tone: 'info',
          pose: 'think',
          retryable: true,
          title: `${P} está saturado`,
          body: `Hay mucha demanda en ${P} ahora mismo. ${couldnt}.`,
          hint: 'Suele pasar en un rato. Probá de nuevo en unos minutos.',
        };
      case 'provider_timeout':
        return {
          ...base,
          tag,
          tone: 'info',
          pose: 'think',
          retryable: true,
          title: `${P} tardó demasiado`,
          body: `Esperé y no contestó a tiempo. ${couldnt}.`,
          hint: 'Probá de nuevo.',
        };
      case 'provider_unavailable':
        return {
          ...base,
          tag,
          tone: 'danger',
          pose: 'think',
          retryable: true,
          title: p === 'supabase' ? 'No llego a la base de datos' : `${P} no está respondiendo`,
          body:
            p === 'supabase'
              ? `El servidor no pudo hablar con la base de datos. ${couldnt}.`
              : `${P} está caído o con problemas. ${couldnt}.`,
          hint: 'Probá de nuevo en un rato.',
        };
      case 'provider_refused':
        return {
          ...base,
          tag,
          tone: 'info',
          pose: 'think',
          retryable: true,
          title: 'Eso no lo puedo hacer',
          body: `${serverOr(e, `${P} no quiso responder ese pedido.`)} Probá contándolo de otra forma.`,
        };
    }
  }

  switch (e.code) {
    case 'network_error':
    case 'offline':
      return {
        ...base,
        tag: 'Conexión',
        tone: 'warning',
        pose: 'map',
        retryable: true,
        title: 'Sin conexión',
        body: `No llego al servidor. ${couldnt}.`,
        hint: 'Revisá el wifi o los datos y probamos de nuevo.',
      };
    case 'timeout':
    case 'leg_timeout':
      return {
        ...base,
        tag: 'Tiempo',
        tone: 'info',
        pose: 'think',
        retryable: true,
        title: 'Tardó demasiado',
        body: `Lo corté porque se estaba haciendo eterno. ${couldnt}.`,
        hint: 'Probá de nuevo; suele salir a la segunda.',
      };
    case 'unauthorized':
    case 'unauthenticated':
      return {
        ...base,
        tag: 'Tu sesión',
        tone: 'warning',
        pose: 'wave',
        retryable: false,
        action: 'login',
        title: 'Se venció tu sesión',
        body: 'Por seguridad tenés que volver a entrar.',
      };
    case 'forbidden':
      return {
        ...base,
        tag: 'Permisos',
        tone: 'warning',
        pose: 'think',
        retryable: false,
        title: 'No tenés permiso',
        body: serverOr(e, 'Esto lo puede hacer solo quien organiza el viaje.'),
      };
    case 'not_found':
      return {
        ...base,
        tone: 'info',
        pose: 'map',
        retryable: true,
        title: 'No lo encuentro',
        body: serverOr(e, 'Puede que alguien lo haya borrado o movido.'),
      };
    case 'invalid_input':
      return {
        ...base,
        tone: 'warning',
        pose: 'think',
        retryable: false,
        title: 'Algo no cierra',
        body: serverOr(e, 'Revisá los datos que cargaste.'),
      };
    case 'not_configured':
      return {
        ...base,
        tag: p ? P : 'Servidor',
        tone: 'warning',
        pose: 'think',
        retryable: false,
        title: p ? `Falta configurar ${P}` : 'Falta configurar el servidor',
        body: serverOr(e, 'Al servidor le falta una configuración para hacer esto.'),
        hint: 'Quien administra la app tiene que cargar la variable que falta.',
      };
    case 'config_missing':
      return {
        ...base,
        tag: 'App',
        tone: 'warning',
        pose: 'think',
        retryable: false,
        title: 'La app está mal configurada',
        body: 'Falta la dirección del servidor (EXPO_PUBLIC_API_URL).',
      };
    case 'db_error':
      return {
        ...base,
        tag: 'Base de datos',
        tone: 'danger',
        pose: 'think',
        retryable: true,
        title: 'No pude guardar ni leer los datos',
        body: `La base de datos devolvió un error. ${couldnt}.`,
        hint: 'Probá de nuevo; si sigue, avisanos.',
      };
    case 'mic_denied':
      return {
        ...base,
        tag: 'Micrófono',
        tone: 'warning',
        pose: 'think',
        retryable: false,
        action: 'settings',
        title: 'Necesito el micrófono',
        body: 'Sin permiso de micrófono no te puedo escuchar.',
        hint: 'Activalo en Ajustes y volvé.',
      };
    case 'location_denied':
      return {
        ...base,
        tag: 'Ubicación',
        tone: 'warning',
        pose: 'compass',
        retryable: false,
        action: 'settings',
        title: 'No sé dónde estás',
        body: 'Sin permiso de ubicación no puedo guiarte ni avisarte cuándo salir.',
        hint: 'Activalo en Ajustes.',
      };
    case 'mic_unavailable':
      return {
        ...base,
        tag: 'Micrófono',
        tone: 'warning',
        pose: 'think',
        retryable: true,
        title: 'El micrófono no responde',
        body: serverOr(e, 'Puede que otra app lo esté usando.'),
        hint: 'Cerrá la otra app (o cortá la llamada) y probá de nuevo.',
      };
    case 'location_unavailable':
      return {
        ...base,
        tag: 'Ubicación',
        tone: 'warning',
        pose: 'compass',
        retryable: true,
        title: 'No encuentro tu ubicación',
        body: serverOr(e, 'El GPS no está dando señal o los servicios de ubicación están apagados.'),
        hint: 'Revisá que la ubicación esté prendida y probá de nuevo.',
      };
    case 'connect_failed':
      return {
        ...base,
        tag: 'Llamada',
        tone: 'warning',
        pose: 'think',
        retryable: true,
        title: 'No pude conectar la llamada',
        body: serverOr(e, 'Se cortó mientras armaba la conexión de voz.'),
        hint: 'Suele ser la red: probá de nuevo.',
      };
    case 'map_load_failed':
      return {
        ...base,
        tag: 'Mapa',
        tone: 'info',
        pose: 'map',
        retryable: true,
        title: 'No pude cargar el mapa',
        body: serverOr(e, 'No bajaron las imágenes del mapa; casi siempre es la conexión.'),
        hint: 'Probá de nuevo.',
      };
    // Dominio (jobs del planificador y del tour): el servidor manda un texto en español para mostrar.
    case 'skeleton_failed':
    case 'brief_failed':
    case 'shapes_failed':
      return {
        ...base,
        tone: 'info',
        pose: 'think',
        retryable: true,
        title: 'No entendí bien el viaje',
        body: serverOr(e, 'No llegué a armar la idea del viaje con lo que me contaste.'),
        hint: 'Probá de nuevo o contame un poco más (fechas, ciudades, quiénes van).',
      };
    case 'leg_failed':
    case 'catalog_small':
      return {
        ...base,
        tone: 'info',
        pose: 'map',
        retryable: true,
        title: 'Quedó a medias',
        body: serverOr(e, 'No pude completar alguna parte del viaje.'),
        hint: 'Reintentar completa solo lo que falta.',
      };
    case 'generate_failed':
    case 'not_enough_candidates':
      return {
        ...base,
        tone: 'info',
        pose: 'map',
        retryable: true,
        title: 'No me alcanzó para un buen recorrido',
        body: serverOr(e, 'No encontré suficientes lugares con historia por acá.'),
        hint: 'Probá desde otro punto o con un radio más grande.',
      };
    case 'job_stale':
      return {
        ...base,
        tone: 'info',
        pose: 'think',
        retryable: true,
        title: 'Se colgó',
        body: `Hace rato que no avanza. ${couldnt}.`,
        hint: 'Probá de nuevo.',
      };
    case 'internal':
      return {
        ...base,
        tone: 'danger',
        pose: 'think',
        retryable: true,
        title: 'Algo se rompió de nuestro lado',
        body: `No es tu culpa. ${couldnt}.`,
        hint: 'Probá de nuevo; si sigue pasando, avisanos.',
      };
  }

  // Conflictos y demás códigos con mensaje propio del servidor (proposal_decided, booked, trip_not_empty…).
  if (isReadable(e.message)) {
    return { ...base, tone: 'info', pose: 'think', retryable: false, title: doing ? `No pude ${doing}` : 'No se pudo', body: e.message };
  }
  const http = /^http_(\d{3})$/.exec(e.code);
  if (http) {
    const s = Number(http[1]);
    return {
      ...base,
      tag: 'Servidor',
      tone: 'danger',
      pose: 'think',
      retryable: s >= 500,
      title: s >= 500 ? 'El servidor tuvo un problema' : 'El servidor no entendió el pedido',
      body: s >= 500 ? `Respondió con un error (${s}). ${couldnt}.` : `Puede que la app esté desactualizada (${s}).`,
      hint: s >= 500 ? 'Probá de nuevo en un rato.' : 'Actualizá la app.',
    };
  }
  return {
    ...base,
    tone: 'danger',
    pose: 'think',
    retryable: true,
    title: doing ? `No pude ${doing}` : 'Algo salió mal',
    body: `${SCOUT.name} se trabó y no sé bien por qué.`,
    hint: 'Probá de nuevo.',
  };
}

/** Una línea para toasts y alerts: "Me quedé sin nafta: Claude (Anthropic) se quedó sin créditos…". */
export function errorLine(input: unknown, opts: Opts = {}): string {
  const v = describeError(input, opts);
  return `${v.title}. ${v.hint ?? v.body}`;
}

/** Título + cuerpo para Alert.alert(title, message). */
export function errorAlert(input: unknown, opts: Opts = {}): [string, string] {
  const v = describeError(input, opts);
  return [v.title, [v.body, v.hint].filter(Boolean).join('\n\n')];
}
