// Modo exterior de Ahora (docs/AHORA-V2.md): más contraste y letra más grande al sol. Se prende en Perfil
// ("Modo exterior") y se recuerda entre aperturas (AsyncStorage). Los componentes leen useOutdoorMode().outdoor.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

const STORAGE_KEY = 'now.outdoor';

type OutdoorState = { outdoor: boolean; setOutdoor: (on: boolean) => void };

export const useOutdoorStore = create<OutdoorState>((set) => ({
  outdoor: false,
  setOutdoor: (outdoor) => {
    set({ outdoor });
    AsyncStorage.setItem(STORAGE_KEY, outdoor ? '1' : '0').catch(() => {});
  },
}));

// Restaurar al abrir la app.
AsyncStorage.getItem(STORAGE_KEY)
  .then((v) => {
    if (v === '1') useOutdoorStore.setState({ outdoor: true });
  })
  .catch(() => {});

export function useOutdoorMode(): OutdoorState {
  const outdoor = useOutdoorStore((s) => s.outdoor);
  const setOutdoor = useOutdoorStore((s) => s.setOutdoor);
  return { outdoor, setOutdoor };
}
