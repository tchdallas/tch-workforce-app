import { QueryClient } from '@tanstack/react-query';

export const queryClientInstance = new QueryClient({
  defaultOptions: {
    queries: {
      // Multi-user app: other people's changes must show up without a manual
      // reload. The old 5-minute staleTime + no focus refetch meant ten testers
      // saw each other's edits minutes late. 30s staleness + refetch when a
      // tab/app regains focus keeps screens honest without hammering the API
      // (focus refetches only fire for data older than staleTime).
      refetchOnWindowFocus: true,
      retry: 1,
      staleTime: 30 * 1000,
      gcTime: 30 * 60 * 1000,
    },
  },
});