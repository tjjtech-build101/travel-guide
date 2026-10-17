import { create } from 'zustand';

/** Estado del canal Realtime del viaje abierto. 'idle' = no hay viaje abierto. */
export type RealtimeStatus = 'idle' | 'connecting' | 'connected' | 'error' | 'closed';

type ConnectionState = {
  realtime: RealtimeStatus;
  realtimeError: string | null;
  setRealtime: (status: RealtimeStatus, error?: string | null) => void;
};

export const useConnectionStore = create<ConnectionState>((set) => ({
  realtime: 'idle',
  realtimeError: null,
  setRealtime: (realtime, error = null) => set({ realtime, realtimeError: error }),
}));
