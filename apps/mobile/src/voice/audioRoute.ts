// Sesión de audio de la llamada: InCallManager en modo voz (activa el AEC de hardware en iOS) y la categoría con
// las opciones de iOS que InCallManager no pone (las deja en 0):
//   - allowBluetoothHFP: AirPods / auriculares bluetooth (audio y micrófono) cuando están conectados.
//   - defaultToSpeaker: sin auriculares sale por el parlante (la demo es con el celu en la mano o el bolsillo).
// El orden lo decide iOS: auriculares conectados > parlante. Forzar el parlante (overrideOutputAudioPort) le
// ganaba a los AirPods, por eso ya no se fuerza: "Usar auricular" solo saca defaultToSpeaker (sale por el oído).
// Con el celu bloqueado sigue: UIBackgroundModes audio (app.config.ts) + la sesión activa de WebRTC.
import { setAudioModeAsync } from 'expo-audio';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import InCallManager from 'react-native-incall-manager';

const KEEP_AWAKE_TAG = 'voice-call';

function applyRoute(speaker: boolean) {
  // setCategory(options:) no toca el modo voiceChat que dejó InCallManager.
  setAudioModeAsync({
    playsInSilentMode: true,
    allowsRecording: true,
    interruptionMode: 'doNotMix',
    shouldPlayInBackground: true,
    allowsBackgroundRecording: true,
    shouldRouteThroughEarpiece: !speaker,
  }).catch((e) => console.warn('[voice] audio route', e));
  InCallManager.setForceSpeakerphoneOn(false);
}

export function startCallAudio(speaker: boolean) {
  InCallManager.start({ media: 'audio' });
  applyRoute(speaker);
  // Android: sin servicio en primer plano de micrófono, mantenemos la pantalla viva (la demo es en iPhone).
  activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {});
}

export function setSpeaker(on: boolean) {
  applyRoute(on);
}

export function stopCallAudio() {
  try {
    InCallManager.setForceSpeakerphoneOn(false);
    InCallManager.stop();
  } catch {}
  deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {});
}
