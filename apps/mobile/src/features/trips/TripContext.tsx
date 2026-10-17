// El shell del viaje provee el tripId a sus tabs. (En las tabs hermanas de index,
// useLocalSearchParams no trae el [tripId] del layout padre.)
import { createContext, useContext, type ReactNode } from 'react';

const TripIdContext = createContext<string | null>(null);

export function TripIdProvider({ tripId, children }: { tripId: string; children: ReactNode }) {
  return <TripIdContext.Provider value={tripId}>{children}</TripIdContext.Provider>;
}

export function useTripId(): string {
  const id = useContext(TripIdContext);
  if (!id) throw new Error('useTripId fuera del shell del viaje');
  return id;
}
