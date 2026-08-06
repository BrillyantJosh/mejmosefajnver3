import { useMemo } from 'react';
import { useNostrWallets } from '@/hooks/useNostrWallets';
import { useWalletBalances } from '@/hooks/useWalletBalances';
import { useSystemParameters } from '@/contexts/SystemParametersContext';

const WATCHED_TYPES = new Set(['Wallet', 'Main Wallet']);

/**
 * Warns when the user's combined Wallet + Main Wallet balance is above the
 * amount at which an account is frozen at a Split.
 *
 * The limit comes from KIND 38888 (`freeze_lana_account_above`), published by
 * the authority — it used to be a number an admin typed into settings, which
 * meant every new Split needed someone to remember to update it. Now the
 * authority's event carries it, the app picks it up on the next parameter
 * refresh, and the warnings appear on their own.
 *
 * Lana.Discount and Retail wallets are excluded: Retail has its own threshold
 * (`freeze_lana_retail_account_above`) and Discount is managed separately.
 */
export function useWarningBeforeSplit() {
  const { wallets, isLoading: walletsLoading } = useNostrWallets();
  const { parameters, isLoading: paramsLoading } = useSystemParameters();

  const limit = parameters?.freezeAccountAbove || 0;
  /** The authority's flag that a Split is coming — makes the warning urgent. */
  const splitApproaching = !!parameters?.splitApproaching;

  // Fetch balances only for the watched wallets (skip if no limit is published)
  const watchedAddresses = useMemo(() => {
    if (!limit || !wallets) return [];
    return wallets
      .filter(w => WATCHED_TYPES.has(w.walletType))
      .map(w => w.walletId);
  }, [wallets, limit]);

  const { totalBalance, isLoading: balancesLoading } = useWalletBalances(watchedAddresses);

  // Deliberately NOT gated on splitApproaching: being over the freeze threshold
  // is the risk itself, and hiding the warning until a flag flips would leave
  // someone exposed at exactly the wrong moment. The flag only sharpens it.
  const exceeded = limit > 0 && totalBalance > limit;
  const loading = walletsLoading || balancesLoading || paramsLoading;

  return {
    exceeded,
    totalBalance,
    limit,
    splitApproaching,
    loading,
  };
}
