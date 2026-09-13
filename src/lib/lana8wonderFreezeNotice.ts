/**
 * What a person with a frozen account is told on the Lana8Wonder page — and,
 * above all, what they must do FIRST.
 *
 * The page already refused a cash-out from a frozen wallet. What it did not do
 * was say what comes before the cash-out. Its notice read "Wallet Frozen …
 * unfreeze it on LanaWatch.us" for everyone, while the button right under it
 * was reason-aware — so someone frozen by the self-responsibility process was
 * told in words to go to a registrar page that cannot lift their freeze, and
 * told by the button to open their process. Two instructions, one wrong.
 *
 * This decides the notice from the plan's own wallets, not from every wallet
 * the person holds: six of the nineteen people with a frozen wallet in August
 * had it OUTSIDE their Lana8Wonder plan, and telling them their cash-out is
 * blocked would have been false.
 *
 *   account    — the registrar froze the person; nothing in the plan can move.
 *   plan       — some or all of the plan's wallets are frozen.
 *   unaffected — frozen wallets exist, but none of them is in the plan.
 *   none       — nothing frozen.
 *   unknown    — the registrar's list could not be read. Not "frozen", and
 *                certainly not "clear": the per-account gate already holds
 *                the Transfer button shut on its own.
 *
 * One step per distinct freeze reason, each pointing at the one place that can
 * lift it (src/lib/freezeResolution.ts) — the same routing the /wallet page uses.
 */
import { freezeResolution, type FreezeResolution } from './freezeResolution';

export interface NoticeWallet {
  walletId: string;
  /** Account-level status tag: 'active' | 'frozen'. */
  status?: string;
  /** Per-wallet freeze code (KIND 30889 `w` tag, 7th field). */
  freezeStatus?: string;
}

export type FreezeNoticeScope = 'account' | 'plan' | 'unaffected' | 'none' | 'unknown';

export interface FreezeNoticeStep {
  /** The registrar's code, e.g. 'frozen_max_cap'. */
  reason: string;
  /** Where this freeze is lifted, and what the button says. */
  resolution: FreezeResolution;
  /** The plan wallets held by this reason. */
  wallets: string[];
}

export interface FreezeNotice {
  scope: FreezeNoticeScope;
  /** Plan wallets that cannot pay out right now. */
  frozenPlanWallets: number;
  planWallets: number;
  /** One per distinct reason, in a stable order. Empty unless account/plan. */
  steps: FreezeNoticeStep[];
}

export function lana8wonderFreezeNotice(
  wallets: NoticeWallet[] | null | undefined,
  resolved: boolean,
  planWalletIds: string[],
): FreezeNotice {
  const plan = Array.from(new Set((planWalletIds || []).filter(Boolean)));
  const empty = (scope: FreezeNoticeScope): FreezeNotice => ({
    scope,
    frozenPlanWallets: 0,
    planWallets: plan.length,
    steps: [],
  });

  const list = wallets || [];
  // An outage and "nothing frozen" look identical from here; do not pick one.
  if (!resolved || list.length === 0) return empty('unknown');

  const accountFrozen = list.some(w => w.status === 'frozen');
  const byAddress = new Map(list.map(w => [w.walletId, w]));

  const held = new Map<string, string[]>(); // reason → plan wallets
  for (const address of plan) {
    const entry = byAddress.get(address);
    const reason = entry?.freezeStatus || (accountFrozen ? 'frozen' : '');
    if (!reason) continue;
    const bucket = held.get(reason) || [];
    bucket.push(address);
    held.set(reason, bucket);
  }

  const frozenPlanWallets = Array.from(held.values()).reduce((n, w) => n + w.length, 0);

  if (frozenPlanWallets === 0) {
    const anyFrozen = accountFrozen || list.some(w => !!w.freezeStatus);
    return empty(anyFrozen ? 'unaffected' : 'none');
  }

  // Stable order: the freezes a person can settle themselves come first, then
  // the process, then whatever the registrar reviews case by case.
  const rank = (r: FreezeResolution) => (r.kind === 'self' ? 0 : r.kind === 'own-process' ? 1 : 2);
  const steps: FreezeNoticeStep[] = Array.from(held.entries())
    .map(([reason, addresses]) => ({
      reason,
      // A per-wallet page (max-cap / late registration) needs a real address;
      // the first held wallet is where the person starts.
      resolution: freezeResolution(reason, addresses[0]),
      wallets: addresses,
    }))
    .sort((a, b) => rank(a.resolution) - rank(b.resolution) || a.reason.localeCompare(b.reason));

  return {
    scope: accountFrozen ? 'account' : 'plan',
    frozenPlanWallets,
    planWallets: plan.length,
    steps,
  };
}
