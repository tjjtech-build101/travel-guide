// Menú colaborativo del tramo (PRD 31): /trip/[tripId]/menu?legId=<id>. Oculto de las tabs (href: null en _layout).
import { useLocalSearchParams } from 'expo-router';

import { MenuScreen } from '../../../../features/menu/MenuScreen';
import { useTripId } from '../../../../features/trips/TripContext';

export default function TripMenu() {
  const tripId = useTripId();
  const { legId } = useLocalSearchParams<{ legId?: string }>();
  return <MenuScreen tripId={tripId} legId={legId} />;
}
