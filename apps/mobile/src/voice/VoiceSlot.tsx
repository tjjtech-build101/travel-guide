// Slot global para el botón flotante de voz (PRD 05). Se monta encima de las tabs del viaje.
// En Ahora no se muestra: ahí ya está el dock con "Hablar con Scout" (docs/AHORA-V2.md).
import { useSegments } from 'expo-router';

import { FloatingVoiceButton } from './ui/FloatingVoiceButton';

export function VoiceSlot({ tripId }: { tripId: string }) {
  const segments = useSegments() as string[];
  const last = segments[segments.length - 1];
  // En "Cómo llego" tampoco: pantalla completa con el mapa y la indicación, sin nada encima.
  if (last === 'now' || last === 'route') return null;
  return <FloatingVoiceButton tripId={tripId} />;
}
