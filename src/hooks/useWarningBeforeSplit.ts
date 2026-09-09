import { useMemo } from 'react';
import { useNostrWallets } from '@/hooks/useNostrWallets';
import { useWalletBalances } from '@/hooks/useWalletBalances';
import { useSystemParameters } from '@/contexts/SystemParametersContext';
import { evaluateSplitLimit } from '@/lib/splitWarning';

/** Everyday wallets, measured against the Split cap. */
const WATCHED_TYPES = new Set(['Wallet', 'Main Wallet']);
/** Retail wallets have their own, separate limit. */
const RETAIL_TYPES = new Set(['Retail']);

export interface SplitLimitCheck {
  /** The published limit, or 0 when the authority has not set one. */
  limit: number;
  /** Combined balance of the wallets this limit applies to. */
  totalBalance: number;
  /** Show the warning: over the limit AND a Split is approaching. */
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
 *
 * Both warnings are held shut unless KIND 38888 says `split_approaching` is
 * true. See src/lib/splitWarning.ts for that rule and why it is the flag, not
 * the balance, that decides whether anything is shown.
 */
export function useWarningBeforeSplit() {
  const { wallets, isLoading: walletsLoading } = useNostrWallets();
  const { parameters, isLoading: paramsLoading } = useSystemParameters();

  const limit = parameters?.maxCapLanasOnSplit || 0;
  const retailLimit = parameters?.freezeRetailAccountAbove || 0;
  /** The authority's flag that a Split is coming — nothing is warned without it. */
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

  // Gated on splitApproaching (Brilly, 9 September 2026): when the authority
  // has not flagged a Split as approaching, the warning must not be shown at
  // all. Between 6 August and that date it was shown whenever the balance was
  // over the cap; the rule now follows the flag. Nothing in the app states the
  // bare fact instead — no Split approaching means no sign at all.
  const everyday = evaluateSplitLimit(limit, totalBalance, splitApproaching);
  const retailVerdict = evaluateSplitLimit(retailLimit, retailBalance, splitApproaching);

  const retail: SplitLimitCheck = {
    limit: retailVerdict.limit,
    totalBalance: retailBalance,
    exceeded: retailVerdict.warn,
  };

  return {
    // everyday wallets (unchanged shape — existing callers keep working)
    exceeded: everyday.warn,
    totalBalance,
    limit,
    // retail wallets, measured on their own limit
    retail,
    /** True when either warning is live — for a single header signal. */
    anyExceeded: everyday.warn || retailVerdict.warn,
    hasRetailWallets: retailAddresses.length > 0,
    splitApproaching,
    loading: walletsLoading || balancesLoading || retailLoading || paramsLoading,
  };
}
