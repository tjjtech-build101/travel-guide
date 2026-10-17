// Entrega de los avisos del vigilante de horarios. Sin React Native (se testea con tsx): las dependencias se inyectan.
// - Llamada con el Scout abierta → voice.injectEvent('schedule_alert', payload), esperando 3 s de silencio si la
//   persona habla (como el motor del tour, PRD 07).
// - Sin llamada (o si se cortó con el aviso en cola) → notificación local.
import type { ScheduleAlert } from '@build101/shared';

export const AFTER_USER_SPEECH_MS = 3000;

export type DeliveryDeps = {
  isLive: () => boolean;
  /** La persona está hablando ahora. */
  userSpeaking: () => boolean;
  /** Cuándo terminó de hablar por última vez (ms). */
  lastUserSpeechAt: () => number;
  injectEvent: (type: 'schedule_alert', payload: unknown) => boolean;
  notify: (alert: ScheduleAlert) => void | Promise<void>;
  now?: () => number;
  log?: (text: string) => void;
};

export type Delivery = {
  deliver: (alert: ScheduleAlert) => 'voice' | 'queued' | 'notification';
  /** Reintento de la cola de voz (llamarlo ~cada 1 s). */
  flush: () => void;
  queueSize: () => number;
};

export function createDelivery(deps: DeliveryDeps): Delivery {
  const now = deps.now ?? Date.now;
  let queue: ScheduleAlert[] = [];

  const quiet = () => !deps.userSpeaking() && now() - deps.lastUserSpeechAt() >= AFTER_USER_SPEECH_MS;

  const toNotification = (a: ScheduleAlert) => {
    deps.log?.(`→ notificación ${a.payload.kind} ${a.payload.title}`);
    void deps.notify(a);
  };

  const sendVoice = (a: ScheduleAlert): boolean => {
    const ok = deps.injectEvent('schedule_alert', a.payload);
    deps.log?.(`→ voz [EVENTO:schedule_alert] ${a.payload.kind} ${ok ? '' : '(falló, notificación)'}`);
    if (!ok) toNotification(a);
    return ok;
  };

  const flush = () => {
    if (!queue.length) return;
    if (!deps.isLive()) {
      const q = queue;
      queue = [];
      q.forEach(toNotification);
      return;
    }
    if (!quiet()) return;
    const q = queue;
    queue = [];
    q.forEach(sendVoice);
  };

  return {
    deliver: (a) => {
      if (!deps.isLive()) {
        toNotification(a);
        return 'notification';
      }
      if (!quiet()) {
        // Un aviso por bloque en cola: si llega uno más nuevo del mismo bloque, pisa al anterior.
        queue = [...queue.filter((x) => x.payload.block_id !== a.payload.block_id), a];
        deps.log?.(`en cola (la persona está hablando): ${a.payload.kind}`);
        return 'queued';
      }
      return sendVoice(a) ? 'voice' : 'notification';
    },
    flush,
    queueSize: () => queue.length,
  };
}
