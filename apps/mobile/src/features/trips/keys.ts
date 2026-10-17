// Query keys: ['trip', id, <tabla>] para que Realtime invalide por tabla.
export const tripKeys = {
  mine: () => ['trips', 'mine'] as const,
  all: (tripId: string) => ['trip', tripId] as const,
  table: (tripId: string, table: string) => ['trip', tripId, table] as const,
};
