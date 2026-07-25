import { useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useCurrentMember } from '@/hooks/useCurrentMember';

// Legacy localStorage keys (pre user_ui_prefs table). Read once to seed the
// DB row so nobody loses the pins they made on this device, then cleared.
const legacyFavKey = (id) => `tch-nav-favorites-${id || 'anon'}`;
const legacyQaKey = (id) => `tch-quick-actions-${id || 'anon'}`;

function readLegacy(key) {
  try {
    const v = JSON.parse(localStorage.getItem(key) || 'null');
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

// Cross-device UI preferences: nav favorites + dashboard quick actions.
// One DB row per member (RLS: self only). All consumers share the
// ['ui-prefs', memberId] cache key with this exact fetch.
export function useUiPrefs() {
  const { member } = useCurrentMember();
  const queryClient = useQueryClient();
  const migrated = useRef(false);

  const { data: rows = [], isFetched } = useQuery({
    queryKey: ['ui-prefs', member?.id],
    queryFn: () => base44.entities.UserUiPref.filter({ teamMemberId: member.id }),
    enabled: !!member?.id,
    placeholderData: [],
  });
  const prefs = rows[0] || null;

  const saveMutation = useMutation({
    mutationFn: async (patch) => {
      if (prefs?.id) return base44.entities.UserUiPref.update(prefs.id, patch);
      return base44.entities.UserUiPref.create({ teamMemberId: member.id, ...patch });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['ui-prefs', member?.id] }),
  });

  // One-time import of this device's legacy localStorage prefs into the DB.
  useEffect(() => {
    if (!member?.id || !isFetched || prefs || migrated.current || saveMutation.isPending) return;
    const favs = readLegacy(legacyFavKey(member.id));
    const qa = readLegacy(legacyQaKey(member.id));
    if (favs?.length || qa?.length) {
      migrated.current = true;
      saveMutation.mutate(
        { navFavorites: favs || [], quickActions: qa || null },
        { onSuccess: () => {
            try {
              localStorage.removeItem(legacyFavKey(member.id));
              localStorage.removeItem(legacyQaKey(member.id));
            } catch { /* non-critical */ }
          } }
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [member?.id, isFetched, prefs]);

  return {
    favorites: prefs?.navFavorites || [],
    quickActions: prefs?.quickActions ?? null, // null = caller applies role defaults
    isFetched,
    setFavorites: (list) => saveMutation.mutate({ navFavorites: list }),
    setQuickActions: (list) => saveMutation.mutate({ quickActions: list }),
  };
}
