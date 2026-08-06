import { useMemo } from 'react';
import { useNostrWallets } from '@/hooks/useNostrWallets';
import { useWalletBalances } from '@/hooks/useWalletBalances';
import { useSystemParameters } from '@/contexts/SystemParametersContext';

/** Everyday wallets, measured against the Split cap. */
const WATCHED_TYPES = new Set(['Wallet', 'Main Wallet']);
/** Retail wallets have their own, separate limit. */
const RETAIL_TYPES = new Set(['Retail']);

export interface SplitLimitCheck {
  /** The published limit, or 0 when the authority has not set one. */
  limit: number;
  /** Combined balance of the wallets this limit applies to. */
  totalBalance: number;
  exceeded: boolean;
}

/**
 * The two balance limits a person is warned about before a Split, both taken
 * from the authority's KIND 38888 event — they used to be a number an admin
 * typed into settings, so every Split needed someone to remember to update it.
 *
 *  • everyday   — Wallet + Main Wallet against `max_cap_lanas_on_split`, the
 *                 most LANA a person may carry into a Split.
 *  • retail     — the sum of ALL Retail wallets against
 *                 `freeze_lana_retail_account_above`. Retail is measured on its
 *                 own: a shop's float is not the same thing as a person's
 *                 savings, and the authority publishes a separate figure for it.
 *
 * Not `freeze_lana_account_above` for the everyday limit: that is the much lower
 * balance at which an account is frozen outright, a different message.
 *
 * Lana.Discount wallets are excluded from both — they are managed separately.
 */
export function useWarningBeforeSplit() {
  const { wallets, isLoading: walletsLoading } = useNostrWallets();
  const { parameters, isLoading: paramsLoading } = useSystemParameters();

  const limit = parameters?.maxCapLanasOnSplit || 0;
  const retailLimit = parameters?.freezeRetailAccountAbove || 0;
  /** The authority's flag that a Split is coming — makes the warnings urgent. */
  const splitApproaching = !!parameters?.splitApproaching;

  const watchedAddresses = useMemo(() => {
    if (!limit || !wallets) return [];
    return wallets.filter(w => WATCHED_TYPES.has(w.walletType)).map(w => w.walletId);
  }, [wallets, limit]);

  const retailAddresses = useMemo(() => {
    if (!retailLimit || !wallets) return [];
    return wallets.filter(w => RETAIL_TYPES.has(w.walletType)).map(w => w.walletId);
  }, [wallets, retailLimit]);

  const { totalBalance, isLoading: balancesLoading } = useWalletBalances(watchedAddresses);
  const { totalBalance: retailBalance, isLoading: retailLoading } = useWalletBalances(retailAddresses);

  // Deliberately NOT gated on splitApproaching: being over a limit is the risk
  // itself, and hiding the warning until a flag flips would leave someone
  // exposed at exactly the wrong moment. The flag only sharpens the wording.
  const exceeded = limit > 0 && totalBalance > limit;
  const retailExceeded = retailLimit > 0 && retailBalance > retailLimit;

  const retail: SplitLimitCheck = {
    limit: retailLimit,
    totalBalance: retailBalance,
    exceeded: retailExceeded,
  };

  return {
    // everyday wallets (unchanged shape — existing callers keep working)
    exceeded,
    totalBalance,
    limit,
    // retail wallets, measured on their own limit
    retail,
    /** True when either limit is breached — for a single header signal. */
    anyExceeded: exceeded || retailExceeded,
    hasRetailWallets: retailAddresses.length > 0,
    splitApproaching,
    loading: walletsLoading || balancesLoading || retailLoading || paramsLoading,
  };
}
