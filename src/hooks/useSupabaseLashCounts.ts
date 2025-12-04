import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

interface LashCountResult {
  lashCounts: Map<string, number>;
  isLoading: boolean;
}

export function useSupabaseLashCounts(eventIds: string[]): LashCountResult {
  const { data: lashCounts = new Map(), isLoading } = useQuery({
    queryKey: ['supabase-lash-counts', eventIds.sort().join(',')],
    queryFn: async () => {
      if (eventIds.length === 0) return new Map<string, number>();

      const { data, error } = await supabase
        .from('lash_users_history')
        .select('event_id')
        .in('event_id', eventIds);

      if (error) {
        console.error('Error fetching lash counts:', error);
        return new Map<string, number>();
      }

      // Count occurrences of each event_id
      const counts = new Map<string, number>();
      data?.forEach(row => {
        const current = counts.get(row.event_id) || 0;
        counts.set(row.event_id, current + 1);
      });

      return counts;
    },
    enabled: eventIds.length > 0,
    staleTime: 10000,
  });

  return { lashCounts, isLoading };
}
