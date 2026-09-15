/**
 * The Interest page's reasoning, without React: what a split's form says,
 * which published limits it does not fit, which splits get a card, and the one
 * way an interest is signed and sent.
 *
 * Ported from bef-explorer src/components/person/InterestForm.tsx — readForm,
 * the calculator's prefill in loadAll, `visible`, `dropped`, `beyond`,
 * limitText and send — with the key read from the MejmoSefajn session instead
 * of typed (BefPersonProvider withSession). The limits are checked with the
 * vendored checkInterestLimits, the very function BEF refuses with, BEFORE
 * anything is signed.
 *
 * Relative imports only, so scripts/testBefInterest.ts can run it — against
 * BEF Explorer's own interest route where bef-explorer is at hand.
 */
import { BefApiError, timestampMs, type BefClient, type InterestSubmitResult, type InterestView, type InterestWindow, type InterestWindows } from '../../../lib/bef/api';
import { parseWholeAmount, type InterestPrefill } from '../../../lib/bef/prefill';
import { interestProblem, offersBef } from '../../../lib/bef/problems';
import { nextCreatedAt, signInterest } from '../../../lib/bef/signing';
import {
  checkInterestLimits,
  limitsFromWindow,
  normaliseRounds,
  type InterestCurrency,
  type InterestDraft,
  type InterestLimitError,
  type InterestRound,
  type InterestStatus,
  type InterestWindowLimits,
} from '../../../lib/bef/vendor/server/lib/interestEvent.ts';
import { currencyForCountry } from '../../../lib/bef/vendor/server/lib/personProfile.ts';
import { fmtMoney } from '../../../lib/bef/vendor/src/lib/format.ts';
import befInterestText, { type BefInterestTextKey } from '../../../i18n/modules/befInterest';
import type { BefAuth } from '../../../pages/bef/BefPersonProvider';

export interface InterestEditor {
  currency: InterestCurrency;
  /** As typed, per round. Kept per round when the currency changes. */
  amounts: Record<number, string>;
  /** Changing an existing active interest. */
  editing: boolean;
  /** A send was attempted: now also say what is missing. */
  tried: boolean;
}

/** A round size that offers the round: published, and more than 0. */
export const offeredIn = (size: number | null | undefined): size is number => size != null && size > 0;

/** The currency a first interest starts in: the profile country's (GB → GBP, US → USD), else EUR. */
export const defaultCurrency = (country: string | null | undefined): InterestCurrency => (country ? currencyForCountry(country) : 'EUR');

/** A split's editor before anything was typed: in the currency of the interest the person already has there. */
export const blankEditor = (existing: InterestView | undefined, fallback: InterestCurrency): InterestEditor => ({
  currency: existing?.currency ?? fallback,
  amounts: {},
  editing: false,
  tried: false,
});

/** Some split has a round open for interest right now. */
export const anyRoundOpen = (windows: InterestWindows): boolean => windows.windows.some((w) => w.open && w.rounds.some((r) => r.open));

export interface InterestReading {
  draft: InterestDraft;
  /** Rounds whose text is not a whole number — refused, never rounded. */
  notWhole: number[];
  limitErrors: InterestLimitError[];
}

/** The draft the form describes, and what is wrong with it before signing. */
export function readInterestForm(win: InterestWindow, editor: InterestEditor, wallet: string, paramsEventId: string): InterestReading {
  const rounds: InterestRound[] = [];
  const notWhole: number[] = [];
  for (const r of win.rounds) {
    // A round the parameters do not open, or one not offered in this currency, is
    // not part of the interest whatever was typed there for another currency.
    if (!r.open || !offeredIn(r.size?.[editor.currency])) continue;
    const amount = parseWholeAmount(editor.amounts[r.round] ?? '');
    if (amount == null) continue;
    if (Number.isNaN(amount)) notWhole.push(r.round);
    else rounds.push({ round: r.round, amount });
  }
  const draft: InterestDraft = {
    split: win.split,
    currency: editor.currency,
    rounds: normaliseRounds(rounds),
    status: 'active',
    wallet,
    paramsEventId,
  };
  return { draft, notWhole, limitErrors: checkInterestLimits(draft, limitsFromWindow(win, editor.currency)) };
}

/** A withdrawal is the same event with no rounds, in the currency of what it withdraws. */
export const withdrawalDraft = (existing: InterestView, wallet: string, paramsEventId: string): InterestDraft => ({
  split: existing.split,
  currency: existing.currency,
  rounds: [],
  status: 'withdrawn',
  wallet,
  paramsEventId,
});

/**
 * The calculator's choice as an editor: only into an open split, never over an
 * interest the person already has there, and the amount only into its round
 * when that round is open.
 */
export function prefillEditor(
  prefill: InterestPrefill,
  windows: InterestWindows,
  mine: InterestView[],
  fallback: InterestCurrency,
): { split: number; editor: InterestEditor } | null {
  if (prefill.split == null) return null;
  const win = windows.windows.find((x) => x.split === prefill.split && x.open);
  if (!win || mine.some((i) => i.split === prefill.split && i.status === 'active')) return null;
  const amounts: Record<number, string> = {};
  const round = win.rounds.find((r) => r.round === prefill.round && r.open);
  if (round && prefill.amount != null && prefill.amount > 0) amounts[round.round] = String(prefill.amount);
  return { split: win.split, editor: { currency: prefill.currency ?? fallback, amounts, editing: false, tried: false } };
}

/**
 * The splits that get a card: open ones, ones where the person holds an active
 * interest (it can still be withdrawn), and one closed while the person was
 * filling it in, for as long as its refusal is shown — otherwise the card would
 * vanish on reload without saying that nothing was sent.
 */
export function visibleWindows(windows: InterestWindows, mine: InterestView[], problemSplits: readonly number[]): InterestWindow[] {
  return [...windows.windows]
    .filter((w) => w.open || problemSplits.includes(w.split) || mine.some((i) => i.split === w.split && i.status === 'active'))
    .sort((a, b) => a.split - b.split);
}

/**
 * While changing an interest: amounts in rounds this change can no longer
 * carry (closed since, or not offered in the chosen currency). readInterestForm
 * leaves them out and BEF would refuse them, so the change removes them — said
 * before signing, not discovered afterwards.
 */
export function droppedRounds(existing: InterestView, win: InterestWindow, currency: InterestCurrency) {
  return existing.rounds
    .map((r) => ({ ...r, window: win.rounds.find((x) => x.round === r.round) }))
    .filter((r) => !r.window?.open || !offeredIn(r.window.size?.[currency]))
    .map((r) => ({ round: r.round, amount: r.amount, stillOpen: !!r.window?.open }));
}

/**
 * Limits are checked when an interest is sent, never again: one accepted
 * before a lower maximum was published stays exactly as signed (only the person
 * can sign a change). What it no longer fits is said in a refusal's words.
 * Every round counts as open here — a round closed for NEW interest does not
 * make one held too large.
 */
export function beyondLimits(existing: InterestView, win: InterestWindow, wallet: string, paramsEventId: string): InterestLimitError[] {
  if (existing.status !== 'active') return [];
  return checkInterestLimits(
    { split: win.split, currency: existing.currency, rounds: existing.rounds, status: 'active', wallet, paramsEventId },
    limitsFromWindow({ ...win, open: true, rounds: win.rounds.map((r) => ({ ...r, open: true })) }, existing.currency),
  );
}

/** One limit a round or the total does not fit, in BEF's words. */
export function limitMessage(e: InterestLimitError, currency: InterestCurrency): { key: BefInterestTextKey; vars: Record<string, string | number> } {
  switch (e.code) {
    case 'round_above_size':
      return { key: 'interest.err.round_above_size', vars: { round: e.round, limit: fmtMoney(e.limit, currency) } };
    case 'round_above_person_max':
      return { key: 'interest.err.round_above_person_max', vars: { round: e.round, amount: fmtMoney(e.limit, currency) } };
    case 'total_above_capacity':
      return { key: 'interest.err.total_above_capacity', vars: { limit: fmtMoney(e.limit, currency) } };
    case 'round_not_offered':
      return { key: 'interest.err.round_not_offered', vars: { round: e.round } };
    case 'round_not_open':
      return { key: 'interest.err.round_not_open', vars: { round: e.round } };
    default: {
      // A code this build does not know: BEF answered with a limit added after
      // the vendored copy was synced. BEF's own words for it when this build has
      // them, as limitText's default does; else a plain refusal. Never nothing —
      // the card reads message.key, and undefined would take the page down.
      const { code, round, limit } = e as { code: string; round?: number; limit?: number };
      const vars: Record<string, string | number> = {};
      if (typeof round === 'number') vars.round = round;
      if (typeof limit === 'number') vars.limit = fmtMoney(limit, currency);
      const key = `interest.err.${code}` as BefInterestTextKey;
      return { key: Object.prototype.hasOwnProperty.call(befInterestText.en, key) ? key : 'interest.err.rejected', vars };
    }
  }
}

/* ----------------------------------------------------------------- send -- */

export interface SendInterestOptions {
  client: Pick<BefClient, 'person' | 'interest' | 'serverNowSeconds'>;
  withSession: <T>(fn: (auth: BefAuth) => Promise<T>) => Promise<T>;
  /** The window the form was read from: the limits the person saw. */
  win: InterestWindowLimits;
  draft: InterestDraft;
  /** The interest BEF holds for this split, whatever its status: the new event must be newer. */
  previous?: Pick<InterestView, 'createdAt'> | null;
  /** Every event signed, by id — so an answer that never came can be looked for afterwards. */
  onSigned?: (eventId: string) => void;
}

/**
 * Sign and send one interest (or its withdrawal).
 *
 * 1. The amounts are checked against the published limits; what does not fit
 *    is refused here as `limits`, and nothing is signed.
 * 2. Inside withSession: GET /me — the session is alive, and BEF's clock is
 *    fresh to sign with — then created_at = max(BEF now, previous + 1), so a
 *    change right after a send still replaces it.
 * 3. Signed with the MejmoSefajn key, for the wallet BEF signed the person in
 *    with, and sent. A `stale_clock` refusal is signed again once, on a clock
 *    read again; a second one is said.
 */
export async function sendInterest({ client, withSession, win, draft, previous, onSigned }: SendInterestOptions): Promise<InterestSubmitResult> {
  // The form never lets these through; were one to come, it is a fault here
  // (BEF's own shape errors of the same names), and nothing is signed.
  if (draft.status === 'active' && draft.rounds.length === 0) throw new BefApiError('active_without_rounds', 0);
  if (draft.status === 'withdrawn' && draft.rounds.length > 0) throw new BefApiError('withdrawn_with_rounds', 0);
  if (draft.status === 'active') {
    const errors = checkInterestLimits(draft, limitsFromWindow(win, draft.currency));
    if (errors.length > 0) throw new BefApiError('limits', 0, { error: 'limits', errors });
  }
  const previousSeconds = previous ? Math.floor(timestampMs(previous.createdAt) / 1000) : null;

  const attempt = async ({ token, key, person }: BefAuth): Promise<InterestSubmitResult> => {
    const me = await client.person.me(token);
    if (me.hex !== key.hex) throw new BefApiError('account_changed', 0);
    const event = signInterest(key, { ...draft, wallet: person.wallet }, nextCreatedAt(client.serverNowSeconds(), previousSeconds));
    onSigned?.(event.id);
    return client.interest.submit(token, event);
  };

  return withSession(async (auth) => {
    try {
      return await attempt(auth);
    } catch (err) {
      if (!(err instanceof BefApiError && err.code === 'stale_clock')) throw err;
      return attempt(auth);
    }
  });
}

/* ------------------------------------------------------------- answers -- */

/** What a card says after a send BEF took. `relays` is null when the answer came
 * too late and the interest was found among the person's own afterwards. */
export interface InterestOutcome {
  status: InterestStatus;
  eventId: string;
  relays: { accepted: number; total: number } | null;
}

export interface InterestProblem {
  code: string;
  text: BefInterestTextKey;
  vars?: Record<string, string | number>;
  /** The limits BEF (or the check before signing) refused, each said in `currency`. */
  limits?: InterestLimitError[];
  currency?: InterestCurrency;
  /** Link to befexplorer.com itself: this build is behind it, or no answer came (offersBef). */
  openBef?: boolean;
  /** What to read again before the words are true: the limits, or the person's own interests. */
  reload: 'windows' | 'mine' | null;
}

/** A refused or unanswered send, in words — ported from InterestForm.tsx send()'s catch. */
export function interestSendProblem(err: unknown, currency: InterestCurrency): InterestProblem {
  const code = err instanceof BefApiError ? err.code : '';
  const body = err instanceof BefApiError ? err.body : {};
  switch (code) {
    case 'limits':
      return { code, text: 'interest.err.limits', limits: body.errors ?? [], currency, reload: null };
    case 'publish_failed':
      return { code, text: 'interest.err.publish_failed', vars: { accepted: body.accepted ?? 0, total: body.total ?? 0 }, reload: null };
    case 'relay_writes_disabled':
      return { code, text: 'interest.relayWritesOff', reload: null };
    // The limits or the split moved on meanwhile: read them again, then say it.
    case 'params_changed':
      return { code, text: 'interest.err.params_changed', reload: 'windows' };
    case 'window_closed':
      return { code, text: 'interest.err.window_closed', reload: 'windows' };
    case 'split_not_available':
      return { code, text: 'interest.err.split_not_available', reload: 'windows' };
    // BEF holds something newer (or nothing to withdraw): read it again.
    case 'stale_event':
      return { code, text: 'interest.err.stale_event', reload: 'mine' };
    case 'nothing_to_withdraw':
      return { code, text: 'interest.err.nothing_to_withdraw', reload: 'mine' };
    case 'outcome_unknown':
      // It may have gone through: what BEF holds now is read before anything is said.
      return { code, text: 'interest.outcomeUnknown', reload: 'mine' };
  }
  const problem = interestProblem(err);
  // A server fault with no word of its own: busy, as BEF says it — not "report it".
  if (problem.text === 'door.generic' && err instanceof BefApiError && err.status >= 500) {
    return { code: problem.code, text: 'person.err.busy', reload: null };
  }
  return { code: problem.code, text: problem.text, vars: problem.vars, openBef: offersBef(problem), reload: null };
}

/** After an answer that never came: the interest BEF holds now for this split,
 * if it is one of the events this send signed — then it went through. */
export const arrivedInterest = (mine: InterestView[] | null, split: number, signedIds: readonly string[]): InterestView | null =>
  mine?.find((i) => i.split === split && signedIds.includes(i.eventId)) ?? null;

/** The status the answer is about, for the words of a success. */
export const sentText = (status: InterestStatus): BefInterestTextKey => (status === 'withdrawn' ? 'interest.withdrawnSent' : 'interest.sent');
