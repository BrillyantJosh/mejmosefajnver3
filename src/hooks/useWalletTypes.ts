import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface WalletType {
  id: string;
  name: string;
  description: string | null;
  display_order: number;
}

export const useWalletTypes = () => {
  return useQuery({
    queryKey: ['wallet-types'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('wallet_types')
        .select('id, name, description, display_order')
        .eq('is_active', true)
        .order('display_order', { ascending: true });

      if (error) throw error;
      return data as WalletType[];
    },
  });
};
