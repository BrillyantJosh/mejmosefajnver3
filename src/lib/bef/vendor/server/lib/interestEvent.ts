// Copied byte for byte into mejmosefajnver3/src/lib/bef/vendor — after changing, run scripts/syncBef.ts there.
/**
 * KIND 30970 — BEF Co-creation Interest. The ONE definition of the event,
 * shared by the server (which verifies and publishes) and the browser (which
 * builds and signs), so the two can never disagree about its shape.
 *
 * A person, signing with their own key, says: "for Split N, in this currency,
 * I would co-create this much in these rounds". It is non-binding: not an
 * order, not a reservation and not a co-creation agreement. BEF Explorer
 * receives no money and is never a party. Any agreement is concluded directly
 * with an independent company.
 *
 * Addressable (NIP-33): one live interest per person per split — `d` is
 * `split:<n>`, so a newer event from the same key replaces the older one on the
 * relays. Withdrawing is the same event with `status` `withdrawn` and no rounds.
 *
 * Pure TypeScript: no Node or browser APIs, so both sides can import it.
 *
 * Canonical event (tags in exactly this order; `round` tags ascending):
 *
 *   ["d", "split:9"]
 *   ["split", "9"]
 *   ["currency", "EUR"]
 *   ["round", "1", "5000"]            one per round with an amount, whole units
 *   ["round", "2", "10000"]
 *   ["total", "15000"]                the sum of the rounds ("0" when withdrawn)
 *   ["status", "active"]              or "withdrawn"
 *   ["wallet", "L…"]                  the person's registered LANA wallet
 *   ["params", "<64 hex>"]            the KIND 38888 event whose limits applied
 *   ["non_binding", "true"]
 *   ["client", "befexplorer.com"]
 *   ["alt", "<human-readable summary>"]  (NIP-31)
 *
 *   content = JSON mirror of the same facts, built by buildInterestContent().
 */

export const INTEREST_KIND = 30970;
export const INTEREST_CLIENT = 'befexplorer.com';
export const INTEREST_CURRENCIES = ['EUR', 'GBP', 'USD'] as const;
export type InterestCurrency = (typeof INTEREST_CURRENCIES)[number];
export const INTEREST_ROUNDS = [1, 2, 3] as const;
export type InterestStatus = 'active' | 'withdrawn';

/** Whole currency units, 1 … 999 999 999 999, no leading zeros. */
const AMOUNT = /^[1-9]\d{0,11}$/;
const HEX64 = /^[0-9a-f]{64}$/;
/** A LANA address: base58, starts with L. */
const LANA_ADDRESS = /^L[1-9A-HJ-NP-Za-km-z]{25,34}$/;

export interface InterestRound {
  round: number;
  /** Whole units of `currency`. */
  amount: number;
}

export interface InterestDraft {
  split: number;
  currency: InterestCurrency;
  /** Ascending by round, each round at most once; empty when withdrawn. */
  rounds: InterestRound[];
  status: InterestStatus;
  wallet: string;
  /** Id of the KIND 38888 event whose limits the person saw and accepted. */
  paramsEventId: string;
}

export const interestD = (split: number): string => `split:${split}`;

export const interestTotal = (rounds: InterestRound[]): number => rounds.reduce((sum, r) => sum + r.amount, 0);

export function interestAltText(draft: InterestDraft): string {
  if (draft.status === 'withdrawn') {
    return `Withdrawn co-creation interest for Split ${draft.split} (BEF Explorer, non-binding)`;
  }
  return `Non-binding co-creation interest for Split ${draft.split}: ${draft.currency} ${interestTotal(draft.rounds)} (BEF Explorer)`;
}

/** Order the rounds and drop empty ones — what a draft looks like before signing. */
export function normaliseRounds(rounds: InterestRound[]): InterestRound[] {
  return rounds
    .filter((r) => Number.isFinite(r.amount) && r.amount > 0)
    .map((r) => ({ round: r.round, amount: r.amount }))
    .sort((a, b) => a.round - b.round);
}

export function buildInterestTags(draft: InterestDraft): string[][] {
  const tags: string[][] = [
    ['d', interestD(draft.split)],
    ['split', String(draft.split)],
    ['currency', draft.currency],
  ];
  for (const r of draft.rounds) tags.push(['round', String(r.round), String(r.amount)]);
  tags.push(
    ['total', String(interestTotal(draft.rounds))],
    ['status', draft.status],
    ['wallet', draft.wallet],
    ['params', draft.paramsEventId],
    ['non_binding', 'true'],
    ['client', INTEREST_CLIENT],
    ['alt', interestAltText(draft)],
  );
  return tags;
}

/** Fixed key order: the server rebuilds this string and requires equality. */
export function buildInterestContent(draft: InterestDraft): string {
  return JSON.stringify({
    split: draft.split,
    currency: draft.currency,
    rounds: draft.rounds.map((r) => ({ round: r.round, amount: String(r.amount) })),
    total: String(interestTotal(draft.rounds)),
    status: draft.status,
    wallet: draft.wallet,
    params: draft.paramsEventId,
    non_binding: true,
  });
}

/** The unsigned template the browser signs. `created_at` is the caller's. */
export function buildInterestTemplate(draft: InterestDraft, createdAt: number) {
  return {
    kind: INTEREST_KIND,
    created_at: createdAt,
    tags: buildInterestTags(draft),
    content: buildInterestContent(draft),
  };
}

export type InterestShapeError =
  | 'wrong_kind'
  | 'malformed_tags'
  | 'bad_split'
  | 'bad_d'
  | 'bad_currency'
  | 'bad_round'
  | 'duplicate_round'
  | 'rounds_not_ascending'
  | 'bad_amount'
  | 'bad_total'
  | 'bad_status'
  | 'active_without_rounds'
  | 'withdrawn_with_rounds'
  | 'bad_wallet'
  | 'bad_params'
  | 'missing_non_binding'
  | 'bad_client'
  | 'unexpected_tag'
  | 'non_canonical';

/**
 * Read an event's tags and content back into a draft, accepting ONLY the
 * canonical form: exactly the tags above, in that order, and content equal to
 * buildInterestContent() of what the tags say. Signature and author are the
 * caller's to check; this checks shape.
 */
export function parseInterestEvent(event: {
  kind: unknown;
  tags: unknown;
  content: unknown;
}): { ok: true; draft: InterestDraft } | { ok: false; error: InterestShapeError } {
  if (event.kind !== INTEREST_KIND) return { ok: false, error: 'wrong_kind' };
  const tags = event.tags;
  if (
    !Array.isArray(tags) ||
    !tags.every((t) => Array.isArray(t) && t.length >= 2 && t.every((v) => typeof v === 'string')) ||
    typeof event.content !== 'string'
  ) {
    return { ok: false, error: 'malformed_tags' };
  }
  const list = tags as string[][];
  let i = 0;
  const take = (name: string, length: number): string[] | null => {
    const t = list[i];
    if (!t || t[0] !== name || t.length !== length) return null;
    i += 1;
    return t;
  };

  const d = take('d', 2);
  const splitTag = take('split', 2);
  if (!splitTag || !/^[1-9]\d{0,5}$/.test(splitTag[1])) return { ok: false, error: 'bad_split' };
  const split = Number(splitTag[1]);
  if (!d || d[1] !== interestD(split)) return { ok: false, error: 'bad_d' };
  const currencyTag = take('currency', 2);
  if (!currencyTag || !(INTEREST_CURRENCIES as readonly string[]).includes(currencyTag[1])) {
    return { ok: false, error: 'bad_currency' };
  }

  const rounds: InterestRound[] = [];
  while (list[i]?.[0] === 'round') {
    const t = list[i];
    if (t.length !== 3 || !/^[1-3]$/.test(t[1])) return { ok: false, error: 'bad_round' };
    if (!AMOUNT.test(t[2])) return { ok: false, error: 'bad_amount' };
    const round = Number(t[1]);
    if (rounds.some((r) => r.round === round)) return { ok: false, error: 'duplicate_round' };
    if (rounds.length && rounds[rounds.length - 1].round > round) return { ok: false, error: 'rounds_not_ascending' };
    rounds.push({ round, amount: Number(t[2]) });
    i += 1;
  }

  const totalTag = take('total', 2);
  if (!totalTag || totalTag[1] !== String(interestTotal(rounds))) return { ok: false, error: 'bad_total' };
  const statusTag = take('status', 2);
  if (!statusTag || (statusTag[1] !== 'active' && statusTag[1] !== 'withdrawn')) return { ok: false, error: 'bad_status' };
  const status = statusTag[1] as InterestStatus;
  if (status === 'active' && rounds.length === 0) return { ok: false, error: 'active_without_rounds' };
  if (status === 'withdrawn' && rounds.length > 0) return { ok: false, error: 'withdrawn_with_rounds' };
  const walletTag = take('wallet', 2);
  if (!walletTag || !LANA_ADDRESS.test(walletTag[1])) return { ok: false, error: 'bad_wallet' };
  const paramsTag = take('params', 2);
  if (!paramsTag || !HEX64.test(paramsTag[1])) return { ok: false, error: 'bad_params' };
  const nonBinding = take('non_binding', 2);
  if (!nonBinding || nonBinding[1] !== 'true') return { ok: false, error: 'missing_non_binding' };
  const client = take('client', 2);
  if (!client || client[1] !== INTEREST_CLIENT) return { ok: false, error: 'bad_client' };

  const draft: InterestDraft = {
    split,
    currency: currencyTag[1] as InterestCurrency,
    rounds,
    status,
    wallet: walletTag[1],
    paramsEventId: paramsTag[1],
  };

  const alt = take('alt', 2);
  if (!alt || alt[1] !== interestAltText(draft)) return { ok: false, error: 'non_canonical' };
  if (i !== list.length) return { ok: false, error: 'unexpected_tag' };
  if (event.content !== buildInterestContent(draft)) return { ok: false, error: 'non_canonical' };
  return { ok: true, draft };
}

/* -------------------------------------------------------- the limits -- */

/** What KIND 38888 allows for one split, in one currency. */
export interface InterestLimits {
  /** Rounds open for interest in this split (KIND 38888 split_interest_open). */
  openRounds: number[];
  /** Published round size in this currency; 0 = not offered; absent = not published. */
  roundSize: Partial<Record<number, number>>;
  /** Published split capacity (split_max_investment) in this currency, or null. */
  capacity: number | null;
  /**
   * Published most ONE person may put into a round (split_max_per_person) in
   * this currency; absent = not published. Optional so a caller written before
   * it existed still compiles — and then only the round size binds.
   */
  perPerson?: Partial<Record<number, number>>;
}

export type InterestLimitError =
  | { code: 'round_not_open'; round: number }
  | { code: 'round_not_offered'; round: number }
  | { code: 'round_above_size'; round: number; limit: number }
  | { code: 'round_above_person_max'; round: number; limit: number }
  | { code: 'total_above_capacity'; limit: number };

/**
 * The most one person may put into a round: the smaller of the round size and
 * the published per-person maximum. `perPerson` says which of the two it is —
 * on a tie the round size, because then that is the whole truth. Null when the
 * round is not offered (size absent or 0); a per-person maximum cannot open a
 * round the round size does not.
 */
export function roundLimit(
  size: number | null | undefined,
  perPerson: number | null | undefined,
): { limit: number; perPerson: boolean } | null {
  if (size == null || !Number.isFinite(size) || size <= 0) return null;
  if (perPerson != null && Number.isFinite(perPerson) && perPerson > 0 && perPerson < size) {
    return { limit: perPerson, perPerson: true };
  }
  return { limit: size, perPerson: false };
}

type WindowAmounts = Partial<Record<InterestCurrency, number | null>>;

/** One window as GET /api/interest/windows sends it — only what limits are read from. */
export interface InterestWindowLimits {
  open: boolean;
  rounds: { round: number; open: boolean; size?: WindowAmounts; perPerson?: WindowAmounts }[];
  capacity?: WindowAmounts | null;
}

/**
 * The limits the page checks BEFORE signing, read from the window the server
 * sent. It lives here rather than in the form so a test can hold it to the
 * answer POST /api/interest gives: `perPerson` is optional in InterestLimits,
 * so a per-person maximum lost on the way would still compile, and the person
 * would sign an amount the server refuses only afterwards.
 */
export function limitsFromWindow(win: InterestWindowLimits, currency: InterestCurrency): InterestLimits {
  const roundSize: Partial<Record<number, number>> = {};
  const perPerson: Partial<Record<number, number>> = {};
  for (const r of win.rounds) {
    const size = r.size?.[currency];
    if (size != null) roundSize[r.round] = size;
    const personMax = r.perPerson?.[currency];
    if (personMax != null) perPerson[r.round] = personMax;
  }
  return {
    openRounds: win.open ? win.rounds.filter((r) => r.open).map((r) => r.round) : [],
    roundSize,
    capacity: win.capacity?.[currency] ?? null,
    perPerson,
  };
}

/**
 * Every amount must fit what is published. A withdrawal carries no rounds and
 * always fits. The same function runs in the browser (to say it before signing)
 * and on the server (to refuse it anyway). A round above its limit gets ONE
 * error, against the limit that binds — two errors for one amount would state
 * the looser limit as if it mattered.
 */
export function checkInterestLimits(draft: InterestDraft, limits: InterestLimits): InterestLimitError[] {
  const errors: InterestLimitError[] = [];
  for (const r of draft.rounds) {
    if (!limits.openRounds.includes(r.round)) {
      errors.push({ code: 'round_not_open', round: r.round });
      continue;
    }
    const binding = roundLimit(limits.roundSize[r.round], limits.perPerson?.[r.round]);
    if (!binding) {
      errors.push({ code: 'round_not_offered', round: r.round });
      continue;
    }
    if (r.amount > binding.limit) {
      errors.push({ code: binding.perPerson ? 'round_above_person_max' : 'round_above_size', round: r.round, limit: binding.limit });
    }
  }
  if (limits.capacity != null && limits.capacity > 0 && interestTotal(draft.rounds) > limits.capacity) {
    errors.push({ code: 'total_above_capacity', limit: limits.capacity });
  }
  return errors;
}
