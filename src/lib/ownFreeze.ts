/**
 * KIND 87057 — OWN ▲ Person Freeze / Unfreeze (READER)
 *
 * A facilitator's key-signed, PUBLIC, NON-REPLACEABLE notice that one named
 * person in a Self-Responsibility process is frozen — or released again. One
 * kind carries both directions via the `status` tag (frozen | live), so the
 * full history of every sanction and every release survives as evidence.
 *
 * THIS IS A PROCESS-LEVEL FACT, NOT A WALLET STATE. Whether any wallet is
 * actually frozen is answered only by the registrar (KIND 30889 / 87010).
 * Never render this as "this person's wallets are frozen".
 *
 * SECURITY — verification is mandatory and FAILS CLOSED for the sanction.
 * 87057 is unauthenticated public plaintext: anyone can sign one naming any
 * case and any person. If authority cannot be established, the freeze simply
 * does not count — discarded outright, not greyed out, not shown as pending.
 *
 * These rules are a deliberate, near-verbatim port of the reader that ships in
 * selfresponsible.life (`src/lib/ownFreeze.ts`), which is also where freezes
 * are published. Two surfaces that disagree about whether a person is frozen
 * is the exact failure this family of gates keeps producing — on 2026-07-30 a
 * guest being's silence muted someone here while the other surface let them
 * write. Keep these identical.
 */
import type { Event } from 'nostr-tools/pure';
import type { SimplePool } from 'nostr-tools';

export const PERSON_FREEZE_KIND = 87057;
const CASE_KIND = 87044;
const PROCESS_RECORD_KIND = 37044;

export type FreezeStatus = 'frozen' | 'live';

export interface FreezeNotice {
  id: string;
  /** The signing facilitator. Authority is checked against THIS, never a p tag. */
  author: string;
  created_at: number;
  status: FreezeStatus;
  /** The person frozen or released. Exactly one per event. */
  person: string;
  /** The case root (87044 id) this notice belongs to. */
  caseRoot: string;
  /** When the decision took effect. NEVER show created_at as the date. */
  effectiveAt: number;
  /** SPLIT round bound, or null for an open-ended freeze. */
  untilSplit: number | null;
  /** On status=live only: when the freeze being lifted originally began. */
  frozenAt: number | null;
  /** Plain-language reason. Required non-empty for `frozen`. */
  reason: string;
}

/** Read a role marker that may sit at tag index 2 or 3 — both shapes exist. */
const roleOf = (tag: string[]): string => (tag[3] || tag[2] || '').toLowerCase();
const lower = (s: string | undefined): string => (s || '').toLowerCase();
const HEX64 = /^[0-9a-f]{64}$/;

/**
 * The case root a notice refers to. Accepts marker `process` or `root` — the
 * OWN family is split on this — and never rejects on marker alone: an unmarked
 * `e` tag is accepted as a last resort so a valid notice is not silently
 * dropped over a cosmetic difference.
 */
export const caseRootOf = (event: Event): string | null => {
  const eTags = event.tags.filter((t) => t[0] === 'e' && t[1]);
  if (eTags.length === 0) return null;
  const marked = eTags.find((t) => ['process', 'root'].includes(roleOf(t)));
  return (marked || eTags[0])[1].toLowerCase();
};

/**
 * Structural validation. Returns null for anything malformed, so a broken or
 * hostile event can never reach the state machine.
 */
export const parseFreezeNotice = (event: Event): FreezeNotice | null => {
  if (event.kind !== PERSON_FREEZE_KIND) return null;

  // EXACT match. Accepting "Frozen"/"LIVE" would sanction or release a person
  // in this client only, for a public notice that has no other source of
  // truth. A closed enum stays exact, unlike identifiers and role markers.
  const status = event.tags.find((t) => t[0] === 'status')?.[1];
  if (status !== 'frozen' && status !== 'live') return null;

  // EXACTLY one frozen-marked p tag — an ambiguous decision is no decision.
  const frozenTags = event.tags.filter((t) => t[0] === 'p' && t[1] && roleOf(t) === 'frozen');
  if (frozenTags.length !== 1) return null;
  const person = lower(frozenTags[0][1]);
  if (!HEX64.test(person)) return null;

  const caseRoot = caseRootOf(event);
  if (!caseRoot) return null;

  const effectiveAt = Number(event.tags.find((t) => t[0] === 'effective_at')?.[1]);
  if (!Number.isFinite(effectiveAt) || effectiveAt <= 0) return null;

  const reason = (event.content || '').trim();
  if (status === 'frozen' && !reason) return null;

  // Absent means OPEN-ENDED, and a bad value must NOT invent an end date.
  // Strictly a positive whole number: '' / ' ' / '0' / '-3' / '7.5' / '1e9' /
  // '0x10' all fall back to open-ended. Without this, Number('0') === 0 would
  // produce a NON-REPLACEABLE freeze already lapsed the instant it was signed.
  const rawUntil = event.tags.find((t) => t[0] === 'until_split')?.[1]?.trim();
  const untilSplit =
    rawUntil && /^\d+$/.test(rawUntil) && Number(rawUntil) > 0 ? Number(rawUntil) : null;

  const rawFrozenAt = Number(event.tags.find((t) => t[0] === 'frozen_at')?.[1]);
  const frozenAt = Number.isFinite(rawFrozenAt) && rawFrozenAt > 0 ? rawFrozenAt : null;

  return {
    id: event.id, author: lower(event.pubkey), created_at: event.created_at,
    status, person, caseRoot, effectiveAt, untilSplit, frozenAt, reason,
  };
};

/**
 * The current SPLIT round as a number.
 *
 * `parameters.split` is a STRING off KIND 38888 and may be `''` before the
 * params resolve. Empty and junk are UNKNOWN — deliberately NOT 0, which would
 * read as "SPLIT zero" and lapse every bounded freeze in the system at once.
 * (Other callers in this app use `parseInt(...) : 0` and `: 5`; neither
 * fallback is safe for a sanction.)
 */
export const parseSplit = (raw: string | null | undefined): number | null => {
  const s = String(raw ?? '').trim();
  return /^\d+$/.test(s) ? Number(s) : null;
};

/**
 * Has a SPLIT-bounded freeze lapsed?
 *
 * Product rule: ENTERING the named round releases the person — `until_split:
 * 12` means that as SPLIT 12 opens they may go on. So it lapses once
 * `currentSplit >= untilSplit`. An absent bound is open-ended and never
 * lapses; an UNKNOWN current split never lapses either, because a reader that
 * cannot see the round must not release anyone on a guess.
 */
export const isSplitLapsed = (untilSplit: number | null, currentSplit: number | null): boolean => {
  if (untilSplit === null) return false;
  if (currentSplit === null || !Number.isFinite(currentSplit)) return false;
  return currentSplit >= untilSplit;
};

export interface RosterResolution {
  /**
   * Who may freeze. `null` means authority could NOT be established — the UI
   * must then assert NOTHING (neither frozen nor live), because an empty
   * allow-list and an unreadable roster are very different facts.
   */
  allow: Set<string> | null;
  /** Several claimants at own:<case_root> that the handover chain never links. */
  contested: boolean;
}

const UNVERIFIED: RosterResolution = { allow: null, contested: false };

/**
 * The per-case roster arm — FAIL CLOSED.
 *
 * Anchoring is the whole security of this kind: without it anyone may publish
 * a 37044 at own:<case_root> naming themselves facilitator and thereby fake a
 * freeze — or fake their own release.
 *
 * Authority root: the case-root (87044) author, OR the EARLIEST 37044 claimant
 * at own:<case_root>, because a case is opened by the initiator and then TAKEN
 * OVER by a facilitator (first claim wins). A forger publishing a fresh 37044
 * today is still rejected: they are neither the case author nor the earliest
 * claimant. From that root we follow `handover_to`, so a facilitator who
 * received the process is authorised and one who handed it away is not.
 *
 * NOTE this app's own roster hooks are NOT usable here: `useAllOwnProcesses`
 * promotes a record's own author to facilitator when no role tag is present,
 * and neither hook anchors the 37044 to its 87044. That is precisely the
 * forgery this function exists to stop.
 */
export const resolveFacilitatorAllowList = async (
  caseRoot: string,
  relays: string[],
  pool: SimplePool,
): Promise<RosterResolution> => {
  const root = lower(caseRoot);
  if (!HEX64.test(root)) return UNVERIFIED;

  const [caseEvents, records] = await Promise.all([
    pool.querySync(relays, { ids: [root], kinds: [CASE_KIND], limit: 1 }),
    pool.querySync(relays, { kinds: [PROCESS_RECORD_KIND], '#d': [`own:${root}`], limit: 200 }),
  ]);
  if (records.length === 0) return UNVERIFIED; // nothing to anchor to

  // Per author keep TWO things: the newest record (their current state) and
  // their EARLIEST created_at (when they first claimed the process). Ranking
  // claimants by the newest snapshot would hand authority to a forger the
  // moment the genuine facilitator saves an ordinary edit.
  const byAuthor = new Map<string, Event>();
  const claimedAt = new Map<string, number>();
  for (const r of records) {
    // Guard against a relay returning records for a different d.
    if (lower(r.tags.find((t) => t[0] === 'd')?.[1]) !== `own:${root}`) continue;
    const a = lower(r.pubkey);
    const prev = byAuthor.get(a);
    if (!prev || r.created_at > prev.created_at) byAuthor.set(a, r);
    const first = claimedAt.get(a);
    if (first === undefined || r.created_at < first) claimedAt.set(a, r.created_at);
  }
  if (byAuthor.size === 0) return UNVERIFIED;

  let rootAuthor: string | null = null;
  const caseAuthor = caseEvents[0] ? lower(caseEvents[0].pubkey) : null;
  if (caseAuthor && byAuthor.has(caseAuthor)) {
    // Signed anchor: the case author holds the record. Use ONLY this root — an
    // additional "earliest claimant" root would let a forged record back in.
    rootAuthor = caseAuthor;
  } else {
    let bestAt = Infinity;
    for (const [a, at] of claimedAt) if (at < bestAt) { bestAt = at; rootAuthor = a; }
  }
  if (!rootAuthor) return UNVERIFIED;

  const authorised = new Set<string>();
  const queue = [rootAuthor];
  while (queue.length) {
    const a = queue.shift() as string;
    if (authorised.has(a)) continue;
    authorised.add(a);
    const to = lower(byAuthor.get(a)?.tags.find((t) => t[0] === 'handover_to')?.[1]);
    if (to && byAuthor.has(to) && !authorised.has(to)) queue.push(to);
  }

  // A claimant the chain never reaches means the roster is DISPUTED. created_at
  // is self-asserted, so a back-dated record could otherwise silently install a
  // forger as the root. Refuse to decide and surface it instead.
  if ([...byAuthor.keys()].some((a) => !authorised.has(a))) return { allow: null, contested: true };

  // Every facilitator-marked p tag on the authorised records, EXCEPT those on a
  // record whose handover has completed: a facilitator who handed the process
  // on has lapsed and must not keep overriding their successor's decisions.
  const allow = new Set<string>();
  for (const a of authorised) {
    const rec = byAuthor.get(a);
    if (!rec) continue;
    const to = lower(rec.tags.find((t) => t[0] === 'handover_to')?.[1]);
    if (to && byAuthor.has(to)) continue; // relinquished
    for (const t of rec.tags) {
      if (t[0] === 'p' && t[1] && roleOf(t) === 'facilitator') allow.add(lower(t[1]));
    }
  }
  if (allow.size === 0) return UNVERIFIED;
  return { allow, contested: false };
};

/**
 * Merge the two arms of authority: this case's anchored roster, and the shared
 * registry of active facilitators. `null` from BOTH means nothing can be
 * asserted — unknown and empty are different facts, and only one of them is
 * safe to act on.
 */
export const unionAuthority = (
  caseAllow: Set<string> | null,
  registry: Set<string> | null,
): Set<string> | null => {
  if (!caseAllow && !registry) return null;
  const out = new Set<string>([...(caseAllow || []), ...(registry || [])]);
  return out.size ? out : null;
};

export interface PersonFreezeState {
  person: string;
  frozen: boolean;
  /** The notice that currently decides the state (newest honoured freeze). */
  decidedBy: FreezeNotice | null;
  /** True when a freeze existed but its until_split round has been reached. */
  lapsedBySplit: boolean;
}

/**
 * Current freeze state per person for ONE process.
 *
 * · Notices from anyone not on the allow-list are discarded outright.
 * · Group by (person, author); the highest created_at in each group wins.
 * · ANY-OF across co-facilitators: frozen if ANY current facilitator's latest
 *   notice says frozen and its SPLIT bound has not been reached.
 */
export const computeFreezeStates = (
  notices: FreezeNotice[],
  allowList: Set<string>,
  currentSplit: number | null,
): Map<string, PersonFreezeState> => {
  const latest = new Map<string, FreezeNotice>();
  for (const n of notices) {
    if (!allowList.has(n.author)) continue; // FAIL CLOSED
    const key = `${n.person}|${n.author}`;
    const prev = latest.get(key);
    if (!prev || n.created_at > prev.created_at) latest.set(key, n);
  }

  const perPerson = new Map<string, FreezeNotice[]>();
  for (const n of latest.values()) {
    const arr = perPerson.get(n.person) || [];
    arr.push(n);
    perPerson.set(n.person, arr);
  }

  const states = new Map<string, PersonFreezeState>();
  for (const [person, list] of perPerson) {
    // Newest first, tie-broken by author so the outcome never depends on relay
    // arrival order — otherwise the displayed explanation would flip at random.
    const sorted = [...list].sort(
      (a, b) => b.created_at - a.created_at || (a.author < b.author ? -1 : a.author > b.author ? 1 : 0),
    );
    const active = sorted.filter((n) => n.status === 'frozen' && !isSplitLapsed(n.untilSplit, currentSplit));
    if (active.length > 0) {
      states.set(person, { person, frozen: true, decidedBy: active[0], lapsedBySplit: false });
      continue;
    }
    const decidedBy = sorted[0] || null;
    states.set(person, {
      person, frozen: false, decidedBy,
      lapsedBySplit: !!decidedBy && decidedBy.status === 'frozen',
    });
  }
  return states;
};

/**
 * Does this freeze CLOSE THE PERSON'S COMPOSER?
 *
 * Deployment rule, decided by the process owner: only a SPLIT-BOUNDED freeze
 * stops someone writing, and only until that round opens. An open-ended freeze
 * is the public record of their standing and closes nothing — a sanction with
 * no named end must not quietly become a permanent ban on speaking.
 *
 * The beings' silence (KIND 37045) is a separate rule with its own end date,
 * so a person is held while EITHER applies, and a SPLIT bound can outlast a
 * silence that has already run out.
 *
 * Note the asymmetry with `isSplitLapsed`: an UNKNOWN split keeps a bounded
 * freeze in force. That is the same rule the publishing surface applies, and
 * parity between the two surfaces matters more here than leniency — but a
 * caller must still distinguish "still reading" from "read, and unknown".
 */
export const freezeBlocksWriting = (
  state: PersonFreezeState | undefined | null,
  currentSplit: number | null,
): boolean => {
  if (!state?.frozen) return false;
  const until = state.decidedBy?.untilSplit;
  if (until === null || until === undefined) return false; // open-ended → shown, never blocking
  return !isSplitLapsed(until, currentSplit);
};
