// Perfil propio: lectura y escritura directa en `profiles` (RLS: cada uno edita el suyo; PRD 10 no usa herramienta).
import type { ProfilePreferencesPatch, ProfileRow } from '@build101/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { create } from 'zustand';

import { supabase } from '../../lib/supabase';
import { useAuth } from '../auth/AuthProvider';

export const profileKeys = { me: (uid: string) => ['profile', uid] as const };

export function useMyProfile() {
  const { session } = useAuth();
  const uid = session?.user.id ?? '';
  return useQuery({
    queryKey: profileKeys.me(uid),
    enabled: !!uid,
    queryFn: async (): Promise<ProfileRow | null> => {
      const { data, error } = await supabase.from('profiles').select('*').eq('id', uid).maybeSingle();
      if (error) throw error;
      return (data as ProfileRow | null) ?? null;
    },
  });
}

export function useSaveProfile() {
  const { session } = useAuth();
  const uid = session?.user.id ?? '';
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ patch, markOnboarded }: { patch: ProfilePreferencesPatch; markOnboarded?: boolean }) => {
      const row: Record<string, unknown> = { ...patch };
      if (markOnboarded) row.onboarded_at = new Date().toISOString();
      const { data, error } = await supabase.from('profiles').update(row).eq('id', uid).select('*').single();
      if (error) throw error;
      return data as ProfileRow;
    },
    onSuccess: (row) => qc.setQueryData(profileKeys.me(uid), row),
  });
}

/** "Ahora no" en el onboarding: solo por esta sesión de la app (la próxima vez lo vuelve a ofrecer). */
export const useOnboardingSkip = create<{ skipped: boolean; skip: () => void }>((set) => ({
  skipped: false,
  skip: () => set({ skipped: true }),
}));
