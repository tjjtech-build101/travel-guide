// Sesión de audio de la llamada: InCallManager en modo voz (activa el AEC de hardware en iOS) y parlante por
// defecto (la demo es sin auriculares). Bluetooth lo maneja el sistema.
import InCallManager from 'react-native-incall-manager';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';

const KEEP_AWAKE_TAG = 'voice-call';

export function startCallAudio(speaker: boolean) {
  InCallManager.start({ media: 'audio' });
  InCallManager.setForceSpeakerphoneOn(speaker);
  // Android: sin servicio en primer plano de micrófono, mantenemos la pantalla viva (la demo es en iPhone).
  activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {});
}

export function setSpeaker(on: boolean) {
  InCallManager.setForceSpeakerphoneOn(on);
}

export function stopCallAudio() {
  try {
    InCallManager.setForceSpeakerphoneOn(false);
    InCallManager.stop();
  } catch {}
  deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {});
}
