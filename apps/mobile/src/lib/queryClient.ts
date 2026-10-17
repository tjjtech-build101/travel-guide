import { focusManager, QueryClient } from '@tanstack/react-query';
import { AppState, Platform } from 'react-native';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Los datos se refrescan por Realtime (invalidateQueries), nunca por polling.
      staleTime: 30_000,
      retry: 1,
    },
  },
});

// React Query no conoce el foco en RN: lo conectamos a AppState.
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (status) => {
    focusManager.setFocused(status === 'active');
  });
}
