// Slot global para el botón flotante de voz (PRD 05). Se monta encima de las tabs del viaje.
import { FloatingVoiceButton } from './ui/FloatingVoiceButton';

export function VoiceSlot({ tripId }: { tripId: string }) {
  return <FloatingVoiceButton tripId={tripId} />;
}
