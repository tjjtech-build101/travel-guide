// Notificaciones LOCALES del vigilante de horarios (expo-notifications, ya en el dev build; sin servidor de push).
// - Permiso en el momento justo: la primera vez que hay un aviso, con una explicación antes del diálogo del sistema.
//   Si dice "Ahora no" no insistimos (se guarda en AsyncStorage).
// - Tocar la notificación abre Ahora (data.url = /trip/<id>/now), también con la app cerrada.
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Alert, AppState } from 'react-native';

const ASKED_KEY = 'schedule.notif.asked.v1';

// Con la app abierta también se muestra el banner (si no, iOS la descarta en primer plano).
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export type NotifPermission = 'granted' | 'denied' | 'undetermined';

export async function notificationPermission(): Promise<NotifPermission> {
  try {
    const p = await Notifications.getPermissionsAsync();
    if (p.granted || p.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL) return 'granted';
    return p.status === 'undetermined' ? 'undetermined' : 'denied';
  } catch {
    return 'denied';
  }
}

let asking: Promise<boolean> | null = null;

/**
 * Pide permiso con explicación (solo con la app en primer plano y una sola vez). Devuelve si se pueden mandar.
 * En segundo plano no se puede preguntar: devuelve false y se pregunta la próxima vez que esté abierta.
 */
export function ensureNotificationPermission(): Promise<boolean> {
  if (asking) return asking;
  asking = (async () => {
    const now = await notificationPermission();
    if (now === 'granted') return true;
    if (now === 'denied') return false;
    if (AppState.currentState !== 'active') return false;
    const asked = await AsyncStorage.getItem(ASKED_KEY).catch(() => null);
    if (asked) return false;
    const yes = await new Promise<boolean>((resolve) =>
      Alert.alert(
        'Te aviso cuándo salir',
        'Con el celu en el bolsillo te mando un aviso cuando tengas que salir para llegar a tiempo a lo que sigue en tu plan, o si vas tarde. ¿Activo las notificaciones?',
        [
          { text: 'Ahora no', style: 'cancel', onPress: () => resolve(false) },
          { text: 'Activar', onPress: () => resolve(true) },
        ],
        { cancelable: true, onDismiss: () => resolve(false) },
      ),
    );
    await AsyncStorage.setItem(ASKED_KEY, '1').catch(() => {});
    if (!yes) return false;
    try {
      const r = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true, allowBadge: false } });
      return r.granted || r.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
    } catch (e) {
      console.warn('[schedule] permiso de notificaciones', e);
      return false;
    }
  })().finally(() => {
    asking = null;
  });
  return asking;
}

// ───────────────────────── Botones en las notificaciones (categorías de iOS; sin rebuild nativo)

/** Categorías del vigilante. Sin ':' ni '-' en los ids (lo pide expo-notifications). */
export const NOTIF_CATEGORY = { leave: 'scheduleLeave', late: 'scheduleLate' } as const;
export const NOTIF_ACTION = { callScout: 'callScout', snooze: 'snooze5', left: 'alreadyLeft' } as const;

const SNOOZE_S = 5 * 60;

let categoriesReady: Promise<void> | null = null;
function registerCategories(): Promise<void> {
  categoriesReady ??= Promise.all([
    Notifications.setNotificationCategoryAsync(NOTIF_CATEGORY.leave, [
      { identifier: NOTIF_ACTION.left, buttonTitle: 'Ya salí', options: { opensAppToForeground: false } },
      { identifier: NOTIF_ACTION.snooze, buttonTitle: 'Avisame en 5 min', options: { opensAppToForeground: false } },
      { identifier: NOTIF_ACTION.callScout, buttonTitle: 'Hablar con el Scout', options: { opensAppToForeground: true } },
    ]),
    Notifications.setNotificationCategoryAsync(NOTIF_CATEGORY.late, [
      { identifier: NOTIF_ACTION.callScout, buttonTitle: 'Que el Scout lo reacomode', options: { opensAppToForeground: true } },
      { identifier: NOTIF_ACTION.left, buttonTitle: 'Ya voy', options: { opensAppToForeground: false } },
    ]),
  ])
    .then(() => undefined)
    .catch((e) => {
      categoriesReady = null;
      console.warn('[schedule] categorías de notificación', e);
    });
  return categoriesReady;
}

/** Notificación local inmediata. `url` = ruta de la app a abrir al tocarla; `category` suma botones. */
export async function sendLocalNotification(n: {
  title: string;
  body: string;
  url: string;
  data?: Record<string, unknown>;
  category?: (typeof NOTIF_CATEGORY)[keyof typeof NOTIF_CATEGORY];
  /** Atraviesa los modos de concentración (iOS, con el permiso de "Avisos urgentes"). */
  timeSensitive?: boolean;
}): Promise<boolean> {
  if (!(await ensureNotificationPermission())) return false;
  try {
    if (n.category) await registerCategories();
    await Notifications.scheduleNotificationAsync({
      content: {
        title: n.title,
        body: n.body,
        sound: true,
        data: { ...n.data, url: n.url },
        ...(n.category ? { categoryIdentifier: n.category } : {}),
        ...(n.timeSensitive ? { interruptionLevel: 'timeSensitive' as const } : {}),
      },
      trigger: null,
    });
    return true;
  } catch (e) {
    console.warn('[schedule] no pude mandar la notificación', e);
    return false;
  }
}

/** Solo dev: olvidar el "Ahora no" para volver a probar el pedido de permiso. */
export async function resetNotificationAsk(): Promise<void> {
  await AsyncStorage.removeItem(ASKED_KEY).catch(() => {});
}

/** "Avisame en 5 min": la misma notificación (con sus botones) de nuevo en 5 minutos. */
async function snooze(n: Notifications.Notification): Promise<void> {
  const c = n.request.content;
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: c.title ?? '',
        body: c.body ?? '',
        sound: true,
        data: c.data ?? {},
        ...(c.categoryIdentifier ? { categoryIdentifier: c.categoryIdentifier } : {}),
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: SNOOZE_S },
    });
  } catch (e) {
    console.warn('[schedule] no pude posponer el aviso', e);
  }
}

/**
 * Tocar una notificación con data.url navega ahí (también si abrió la app desde cerrada). Los botones: "Hablar con el
 * Scout" abre la llamada (build101://scout), "Avisame en 5 min" la repite y "Ya salí" la descarta.
 * Montar una vez con sesión.
 */
export function useNotificationTapRouter(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    void registerCategories();
    const go = (r: Notifications.NotificationResponse) => {
      const n = r.notification;
      const data = n.request.content.data ?? {};
      const url = data.url;
      const tripId = typeof data.trip_id === 'string' ? data.trip_id : null;
      if (__DEV__) console.log('[schedule] notificación →', r.actionIdentifier, url);
      Notifications.clearLastNotificationResponse();
      switch (r.actionIdentifier) {
        case NOTIF_ACTION.callScout:
          router.push({ pathname: '/scout', params: tripId ? { tripId } : {} });
          return;
        case NOTIF_ACTION.snooze:
          void snooze(n);
          return;
        case NOTIF_ACTION.left:
          // "Ya salí": solo descarta el aviso.
          return;
      }
      if (typeof url === 'string' && url.startsWith('/')) router.push(url as never);
    };
    const last = Notifications.getLastNotificationResponse();
    if (last?.notification) go(last);
    const sub = Notifications.addNotificationResponseReceivedListener(go);
    return () => sub.remove();
  }, [enabled]);
}
