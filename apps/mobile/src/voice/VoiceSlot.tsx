// Slot global para el botón flotante de voz (PRD 05). Se monta encima de las tabs del viaje.
// En Ahora no se muestra: ahí ya está el dock con "Hablar con Scout" (docs/AHORA-V2.md).
import { useSegments } from 'expo-router';
import { useEffect } from 'react';

import { FloatingVoiceButton } from './ui/FloatingVoiceButton';
import { startVoiceWarmup } from './warmup';

export function VoiceSlot({ tripId }: { tripId: string }) {
  // Con el viaje abierto la API queda despierta para el primer toque, también en Ahora y Cómo llego
  // (donde no se monta el botón flotante). El slot vive en el layout del viaje: se monta una vez.
  useEffect(() => startVoiceWarmup(), []);
  const segments = useSegments() as string[];
  const last = segments[segments.length - 1];
  // En "Cómo llego" tampoco: pantalla completa con el mapa y la indicación, sin nada encima.
  if (last === 'now' || last === 'route') return null;
  return <FloatingVoiceButton tripId={tripId} />;
}
