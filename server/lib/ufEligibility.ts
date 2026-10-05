/**
 * Unconditional Financing — "Lana8Wonder member for at least 4 completed Splits."
 *
 * ONE implementation, used by the REST route (new requests, GET /eligibility)
 * AND by the relay indexer (a request it has not seen before), so a request is
 * listed by both paths or by neither.
 *
 * enrolledAt = MIN(created_at) across ALL of the user's KIND 88888 events
 * (88888 is outside the replaceable ranges → relays retain every version).
 * completed = COUNT(split_history rows started after enrolledAt).
 * Grandfather: enrolled before our recorded history began → long-time member.
 *
 * WHO SIGNED THE PLAN MATTERS. The relays accept an event of any kind from
 * anyone, dated as far back as its signer likes, so a KIND 88888 "plan" that a
 * person signs about THEMSELVES, dated last year, would make them a long-time
 * member. A plan only counts when it is signed by the Lana8Wonder service key —
 * the one the signed KIND 38888 lists under trusted_signers.Lana8Wonder (the
 * same pin src/pages/transparency/FinancialFlow.tsx puts on the same events).
 * The relay's `authors` filter is asked for, but never relied on: every event
 * is re-checked here, signature included.
 *
 * It takes the relay reader as a parameter (rather than importing it) so this
 * file does not depend on nostr.ts, which depends on it.
 */
import { verifyEvent } from 'nostr-tools';

/** How many completed Splits of Lana8Wonder membership a requester needs. */
export const UF_REQUIRED_COMPLETED_SPLITS = 4;

/**
 * The Lana8Wonder service key (it signs every KIND 88888 plan). Used ONLY when
 * the stored KIND 38888 lists no Lana8Wonder signer, e.g. on a database that has
 * not synced yet — the events are never read unpinned.
 */
export const LANA8WONDER_SIGNER_FALLBACK = 'a56253e6232b2ab5a96b60d233434d4f759ba4c858a3cc0f4ec51906dce73ae6';

export interface RelayRead {
  events: any[];
  /** Relays that reached EOSE — "said there is nothing" is different from "never heard back". */
  answered: string[];
  failed: { url: string; reason: string }[];
}
export type RelayReader = (relays: string[], filter: Record<string, any>, timeout?: number) => Promise<RelayRead>;

export interface Eligibility {
  eligible: boolean;
  exists: boolean;
  enrolledAt: number | null;
  completedSplitsSinceEnrollment: number;
  grandfathered?: boolean;
  requiredSplits: number;
  currentSplit: number;
}
export interface EligibilityUnavailable {
  /** Nobody could be asked: the answer is unknown — never "not a member". */
  error: string;
}

export function relaysOf(db: any): string[] {
  const row = db.prepare('SELECT relays FROM kind_38888 ORDER BY created_at DESC LIMIT 1').get() as any;
  if (!row?.relays) return [];
  try {
    const parsed = JSON.parse(row.relays);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** The keys allowed to sign a Lana8Wonder plan, from the signed KIND 38888 (never empty). */
export function lana8WonderSigners(db: any): string[] {
  try {
    const row = db.prepare('SELECT trusted_signers FROM kind_38888 ORDER BY created_at DESC LIMIT 1').get() as any;
    const listed = JSON.parse(row?.trusted_signers || '{}')?.Lana8Wonder;
    if (Array.isArray(listed)) {
      const keys = listed.filter((k: unknown): k is string => typeof k === 'string' && /^[0-9a-f]{64}$/.test(k));
      if (keys.length > 0) return keys;
    }
  } catch { /* fall through to the pinned default */ }
  return [LANA8WONDER_SIGNER_FALLBACK];
}

export function currentSplitOf(db: any): number {
  try {
    const row = db.prepare('SELECT raw_event FROM kind_38888 ORDER BY created_at DESC LIMIT 1').get() as any;
    if (!row?.raw_event) return 0;
    const evt = JSON.parse(row.raw_event);
    const splitTag = evt.tags?.find((t: string[]) => t[0] === 'split');
    return splitTag ? parseInt(splitTag[1]) || 0 : 0;
  } catch {
    return 0;
  }
}

/** Only plans that are about `pubkey`, signed by a pinned signer, with a valid signature. */
function genuinePlans(events: any[], pubkey: string, signers: string[]): any[] {
  return (events || []).filter((e: any) => {
    if (!e || e.kind !== 88888 || !signers.includes(e.pubkey)) return false;
    if (!Array.isArray(e.tags) || !e.tags.some((t: string[]) => t[0] === 'p' && t[1] === pubkey)) return false;
    try { return verifyEvent(e); } catch { return false; }
  });
}

export async function computeEligibility(
  db: any,
  pubkey: string,
  read: RelayReader,
): Promise<Eligibility | EligibilityUnavailable> {
  const relays = relaysOf(db);
  if (relays.length === 0) {
    return { error: 'No relays available' };
  }

  const signers = lana8WonderSigners(db);
  const filter = { kinds: [88888], '#p': [pubkey], authors: signers, limit: 100 };

  // One retry — a transient relay failure must not read as "not a member".
  let result = await read(relays, filter, 15000);
  if (!result.events || result.events.length === 0) {
    result = await read(relays, filter, 15000);
  }
  // If nobody answered, we did not learn that there is no plan — we learned nothing.
  if (result.answered.length === 0) {
    return { error: 'No relay answered the membership check' };
  }

  const plans = genuinePlans(result.events, pubkey, signers);
  if (plans.length === 0) {
    return {
      eligible: false,
      exists: false,
      enrolledAt: null,
      completedSplitsSinceEnrollment: 0,
      requiredSplits: UF_REQUIRED_COMPLETED_SPLITS,
      currentSplit: currentSplitOf(db),
    };
  }

  const enrolledAt = Math.min(...plans.map((e: any) => e.created_at));
  const history = db.prepare('SELECT split, started_at FROM split_history ORDER BY split ASC').all() as any[];
  const earliestRecorded = history.length > 0 ? Math.min(...history.map(h => h.started_at)) : null;
  const completedSince = history.filter(h => h.started_at > enrolledAt).length;

  const grandfathered = earliestRecorded !== null && enrolledAt < earliestRecorded
    && completedSince < UF_REQUIRED_COMPLETED_SPLITS;
  const eligible = grandfathered || completedSince >= UF_REQUIRED_COMPLETED_SPLITS;

  return {
    eligible,
    exists: true,
    enrolledAt,
    completedSplitsSinceEnrollment: completedSince,
    grandfathered,
    requiredSplits: UF_REQUIRED_COMPLETED_SPLITS,
    currentSplit: currentSplitOf(db),
  };
}
