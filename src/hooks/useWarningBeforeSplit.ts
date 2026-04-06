import { useMemo } from 'react';
import { useAdmin } from '@/contexts/AdminContext';
import { useNostrWallets } from '@/hooks/useNostrWallets';
import { useWalletBalances } from '@/hooks/useWalletBalances';

const WATCHED_TYPES = new Set(['Wallet', 'Main Wallet']);

/**
 * Checks if the user's combined balance on Wallet + Main Wallet
 * exceeds the admin-configured "warning_before_split" limit.
 * Lana.Discount wallets are excluded — they are managed separately.
 */
export function useWarningBeforeSplit() {
  const { appSettings } = useAdmin();
  const { wallets, isLoading: walletsLoading } = useNostrWallets();
  const limit = appSettings?.warning_before_split;

  // Filter wallets to only the watched types
  const watchedAddresses = useMemo(() => {
    if (!limit || !wallets) return [];
    return wallets
      .filter(w => WATCHED_TYPES.has(w.walletType))
      .map(w => w.walletId);
  }, [wallets, limit]);

  // Fetch balances only for the watched wallets (skip if no limit set)
  const { totalBalance, isLoading: balancesLoading } = useWalletBalances(watchedAddresses);

  const exceeded = !!limit && limit > 0 && totalBalance > limit;
  const loading = walletsLoading || balancesLoading;

  return {
    exceeded,
    totalBalance,
    limit: limit || 0,
    loading,
  };
}
