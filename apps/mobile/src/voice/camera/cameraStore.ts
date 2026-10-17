// Cámara a pedido (PRD 08): la abren el botón de la llamada, la voz (herramienta del celu look_at_photo) o la pantalla
// de tour (PRD 07). Store fuera de React para que la herramienta de voz la abra sin componentes.
import { create } from 'zustand';

export type CameraSource = 'button' | 'voice' | 'tour';

type CameraState = {
  open: boolean;
  question: string | null;
  source: CameraSource;
  openCamera: (opts?: { question?: string | null; source?: CameraSource }) => void;
  close: () => void;
};

/** iOS no presenta dos Modal a la vez: quien abre la cámara con la vista de llamada abierta la minimiza antes. */
let beforeOpen: () => boolean = () => false;
export function setBeforeCameraOpen(fn: () => boolean) {
  beforeOpen = fn;
}

export const useCameraStore = create<CameraState>((set) => ({
  open: false,
  question: null,
  source: 'button',
  openCamera: (opts = {}) => {
    const next = { open: true, question: opts.question?.trim() || null, source: opts.source ?? 'button' };
    // Si hubo que cerrar otro modal, esperamos a que termine su animación.
    if (beforeOpen()) setTimeout(() => set(next), 400);
    else set(next);
  },
  close: () => set({ open: false, question: null }),
}));

/** API para otros PRDs (07: botón de cámara en la pantalla de tour). */
export const camera = {
  open: (opts?: { question?: string | null; source?: CameraSource }) => useCameraStore.getState().openCamera(opts),
};
