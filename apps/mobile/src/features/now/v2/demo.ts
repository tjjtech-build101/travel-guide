// Pedidos del menú dev a la pantalla Ahora (el menú no sabe en qué viaje estás): "Ubicación cerca".
import { create } from 'zustand';

export const useNowDemo = create<{ nearReq: number; requestNear: () => void }>((set) => ({
  nearReq: 0,
  requestNear: () => set((s) => ({ nearReq: s.nearReq + 1 })),
}));
