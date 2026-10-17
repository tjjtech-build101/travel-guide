// "Mostrale algo al scout" desde fuera de la llamada (vista Ahora, pantalla de tour): abre la cámara y, si no hay
// llamada y el micrófono ya está permitido, abre una en paralelo sin saludo, así el scout narra la foto apenas llega
// el resultado (PRD 08: "si no había sesión, se abre una en paralelo con la subida").
import { micPermission } from '../permissions';
import { useVoiceStore } from '../store';
import { camera } from './cameraStore';

export async function showToScout(opts: { tripId?: string | null; tourId?: string | null; question?: string | null } = {}) {
  camera.open({ question: opts.question ?? null, source: 'button' });
  const v = useVoiceStore.getState();
  if (v.status !== 'idle' && v.status !== 'summary' && v.status !== 'error') return;
  // Sin permiso todavía: la explicación del permiso es otro modal; la tarjeta de la cámara alcanza.
  if ((await micPermission()) !== 'granted') return;
  if (v.status === 'summary') v.dismissSummary();
  void useVoiceStore.getState().startCall({ mode: opts.tourId ? 'tour' : 'chat', tripId: opts.tripId ?? null, tourId: opts.tourId ?? null, silentOpen: true });
}
