/**
 * BEF's refusals → the words the module shows, and what the person can do.
 *
 * Every code BEF Explorer can answer on the routes the module calls is put
 * into words here — BEF's own text (src/i18n/modules/befVendor.ts) where it
 * fits a person who is already logged in, MejmoSefajn's own text
 * (src/i18n/modules/bef.ts) where BEF's would send them to type a key or to
 * another site. A code nobody should ever see (a broken signature, a malformed
 * event) says "please report it" with the code, never a raw server word.
 * scripts/testBef.ts reads BEF's routes and fails when a code is in neither
 * the tables nor GENERIC_CODES.
 *
 * Nothing here names who holds a wallet or a card.
 */
import type { BefTextKey } from '../../i18n/modules/befText';
import { BefApiError } from './api';
import { BefKeyError } from './signing';

export type { BefTextKey };

/** What the refusal card offers besides the words. */
export type BefAction = 'retry' | 'openProfile' | 'openBef' | 'none';

export interface BefProblem {
  code: string;
  text: BefTextKey;
  action: BefAction;
  vars?: Record<string, string | number>;
}

type Table = Record<string, readonly [BefTextKey, BefAction]>;

/** The sign-in door: /api/person/challenge, /session, /me, and the local key read. */
export const DOOR_PROBLEMS: Table = {
  // MejmoSefajn's own session does not hold together.
  key_unreadable: ['door.keyUnreadable', 'none'],
  pubkey_mismatch: ['door.keyUnreadable', 'none'],
  wallet_mismatch: ['door.keyUnreadable', 'none'],
  account_changed: ['door.accountChanged', 'retry'],
  // Decided by the Registrar or the profile.
  not_registered: ['door.notRegistered', 'retry'],
  profile_missing: ['door.notRegistered', 'retry'],
  wrong_key: ['door.wrongKey', 'none'],
  profile_incomplete: ['door.profileIncomplete', 'openProfile'],
  owner_unknown: ['person.gate.owner_unknown', 'retry'],
  // Nothing was decided: try again.
  registry_unavailable: ['person.gate.registry_unavailable', 'retry'],
  profile_unverified: ['person.gate.profile_unverified', 'retry'],
  busy: ['person.err.busy', 'retry'],
  server_error: ['person.err.busy', 'retry'],
  // No answer the page could read. A browser cannot tell this from BEF Explorer
  // not letting this site in — that refusal comes without a CORS header, so it
  // arrives here as a TypeError too — and the words say both (offersBef).
  network: ['door.unreachable', 'retry'],
  // Aborted after waiting: BEF answered nothing in time, whoever asks.
  timeout: ['person.err.network', 'retry'],
  rate_limited: ['person.err.rateLimited', 'retry'],
  not_signed_in: ['person.signIn.expired', 'retry'],
  session_expired: ['person.signIn.expired', 'retry'],
  // BEF changed what it accepts, or this build asks for something BEF does not have.
  bad_event: ['door.behind', 'openBef'],
  not_found: ['door.behind', 'openBef'],
  route_not_allowed: ['door.behind', 'openBef'],
  bad_challenge_url: ['door.behind', 'openBef'],
};

/** POST /api/person/register (BEF src/components/person/problems.ts REGISTRATION_ERRORS). */
export const REGISTRATION_PROBLEMS: Table = {
  wallet_not_empty: ['person.reg.err.wallet_not_empty', 'none'],
  account_frozen: ['person.reg.err.account_frozen', 'none'],
  registry_refused: ['person.reg.err.registry_refused', 'none'],
  registry_error: ['person.reg.err.registry_error', 'retry'],
  // Said with the address as "registered under the other form" (registrationProblem).
  registry_mismatch: ['person.reg.err.registry_error', 'retry'],
  registration_outcome_unknown: ['person.reg.err.registration_outcome_unknown', 'retry'],
  profile_publish_failed: ['person.reg.err.profile_publish_failed', 'none'],
  profile_required: ['person.reg.err.profile_required', 'none'],
  profile_invalid: ['person.reg.err.profile_invalid', 'none'],
  registration_disabled: ['person.reg.err.registration_disabled', 'none'],
  consent_invalid: ['person.reg.err.consent_invalid', 'none'],
};

/** POST /api/interest and GET /api/interest/windows. */
export const INTEREST_PROBLEMS: Table = {
  no_parameters: ['interest.noParameters', 'retry'],
  relay_writes_disabled: ['interest.err.relay_writes_disabled', 'none'],
  stale_clock: ['interest.err.stale_clock', 'retry'],
  stale_event: ['interest.err.stale_event', 'none'],
  split_not_available: ['interest.err.split_not_available', 'none'],
  window_closed: ['interest.err.window_closed', 'none'],
  params_changed: ['interest.err.params_changed', 'none'],
  limits: ['interest.err.limits', 'none'],
  nothing_to_withdraw: ['interest.err.nothing_to_withdraw', 'none'],
  publish_failed: ['interest.err.publish_failed', 'none'],
  outcome_unknown: ['interest.outcomeUnknown', 'none'],
};

/** POST /api/cards and /api/cards/status. */
export const CARD_PROBLEMS: Table = {
  bad_card: ['cards.err.badId', 'none'],
  bad_base: ['cards.err.stale_event', 'none'],
  stale_event: ['cards.err.stale_event', 'none'],
  publish_in_progress: ['cards.err.publish_in_progress', 'none'],
  monthly_card_limit: ['cards.err.monthly_card_limit', 'none'],
  card_brought_you: ['cards.err.card_brought_you', 'none'],
  card_taken: ['cards.err.card_taken', 'none'],
  check_unavailable: ['cards.err.check_unavailable', 'retry'],
  list_too_large_for_relays: ['cards.err.list_too_large_for_relays', 'none'],
  publish_failed: ['cards.err.publish_failed', 'none'],
  relay_writes_disabled: ['interest.err.relay_writes_disabled', 'none'],
  stale_clock: ['interest.err.stale_clock', 'retry'],
  outcome_unknown: ['cards.err.outcomeUnknown', 'none'],
};

/** GET /api/scenario. */
export const SCENARIO_PROBLEMS: Table = {
  amount_above_limit: ['calc.aboveLimitError', 'none'],
  bad_amount: ['calc.enterPositive', 'none'],
  bad_input: ['calc.unavailableError', 'retry'],
  company_currency_mismatch: ['calc.unavailableError', 'retry'],
  no_reference_rate: ['calc.unavailableError', 'retry'],
  no_round_parameters: ['calc.unavailableError', 'retry'],
};

/**
 * Codes said as "something is wrong in MejmoSefajn, please report it (code)":
 * a signature BEF could not check, an event it could not read, a request it
 * could not parse. The module builds these itself, so seeing one is a fault
 * here, not the person's.
 */
export const GENERIC_CODES = [
  'missing_event',
  'wrong_kind',
  'malformed_event',
  'malformed_signature',
  'wrong_method',
  'expired',
  'wrong_endpoint',
  'bad_challenge',
  'id_mismatch',
  'bad_signature',
  'address_mismatch',
  'bad_request',
  'too_large',
  'forbidden',
  // Only on routes the module never calls (GET /api/system-params, /api/splits/:n/payouts).
  'no_data_yet',
  'bad_split',
  'no_payouts_published',
  // Sent only without a CORS header: a browser never reads it, and it arrives as `network`.
  'cross_site',
] as const;

/** Every code with words of its own, in any table. */
export const MAPPED_CODES: ReadonlySet<string> = new Set([
  ...Object.keys(DOOR_PROBLEMS),
  ...Object.keys(REGISTRATION_PROBLEMS),
  ...Object.keys(INTEREST_PROBLEMS),
  ...Object.keys(CARD_PROBLEMS),
  ...Object.keys(SCENARIO_PROBLEMS),
]);

/**
 * The refusal card also links to befexplorer.com: when this build is behind BEF
 * (openBef), and when no answer came (`network`), because that is also how BEF
 * Explorer not letting this site in looks from here — and befexplorer.com
 * itself still works then.
 */
export const offersBef = (problem: BefProblem): boolean => problem.action === 'openBef' || problem.code === 'network';

export function problemCode(err: unknown): string {
  if (err instanceof BefApiError || err instanceof BefKeyError) return err.code;
  // Anything else thrown on the way (a bug, a crypto library) is not an answer from BEF.
  return 'network';
}

function lookup(err: unknown, ...tables: Table[]): BefProblem {
  const code = problemCode(err);
  for (const table of tables) {
    const hit = table[code];
    if (hit) return { code, text: hit[0], action: hit[1] };
  }
  return { code, text: 'door.generic', action: 'none', vars: { code } };
}

export const doorProblem = (err: unknown): BefProblem => lookup(err, DOOR_PROBLEMS);

export function registrationProblem(err: unknown): BefProblem {
  // With an address, the wallet IS registered — under its other form; without
  // one, the Registrar did not confirm anything.
  if (err instanceof BefApiError && err.code === 'registry_mismatch' && typeof err.body.address === 'string') {
    return { code: err.code, text: 'person.reg.err.registered_other_form', action: 'none' };
  }
  return lookup(err, REGISTRATION_PROBLEMS, DOOR_PROBLEMS);
}

export const interestProblem = (err: unknown): BefProblem => lookup(err, INTEREST_PROBLEMS, DOOR_PROBLEMS);
export const cardsProblem = (err: unknown): BefProblem => lookup(err, CARD_PROBLEMS, DOOR_PROBLEMS);
export const scenarioProblem = (err: unknown): BefProblem => lookup(err, SCENARIO_PROBLEMS, DOOR_PROBLEMS);
