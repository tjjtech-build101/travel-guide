// Permiso de micrófono: explicación antes de pedirlo; si lo negó, link a Ajustes (PRD 05).
import { getRecordingPermissionsAsync, requestRecordingPermissionsAsync } from 'expo-audio';

export type MicPermission = 'granted' | 'undetermined' | 'denied';

export async function micPermission(): Promise<MicPermission> {
  try {
    const p = await getRecordingPermissionsAsync();
    if (p.granted) return 'granted';
    return p.canAskAgain ? 'undetermined' : 'denied';
  } catch {
    return 'undetermined';
  }
}

export async function requestMic(): Promise<boolean> {
  try {
    return (await requestRecordingPermissionsAsync()).granted;
  } catch {
    return false;
  }
}
