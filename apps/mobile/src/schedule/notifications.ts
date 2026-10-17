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

/** Notificación local inmediata. `url` = ruta de la app a abrir al tocarla. */
export async function sendLocalNotification(n: { title: string; body: string; url: string; data?: Record<string, unknown> }): Promise<boolean> {
  if (!(await ensureNotificationPermission())) return false;
  try {
    await Notifications.scheduleNotificationAsync({
      content: { title: n.title, body: n.body, sound: true, data: { ...n.data, url: n.url } },
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

/** Tocar una notificación con data.url navega ahí (también si abrió la app desde cerrada). Montar una vez con sesión. */
export function useNotificationTapRouter(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const go = (n: Notifications.Notification) => {
      const url = n.request.content.data?.url;
      if (__DEV__) console.log('[schedule] tocaron la notificación →', url);
      if (typeof url === 'string' && url.startsWith('/')) {
        router.push(url as never);
        Notifications.clearLastNotificationResponse();
      }
    };
    const last = Notifications.getLastNotificationResponse();
    if (last?.notification) go(last.notification);
    const sub = Notifications.addNotificationResponseReceivedListener((r) => go(r.notification));
    return () => sub.remove();
  }, [enabled]);
}
