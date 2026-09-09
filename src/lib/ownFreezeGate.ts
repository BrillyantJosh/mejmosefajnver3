import { SimplePool, type Event } from 'nostr-tools';

/**
 * Is this person frozen by a commission gross-violation decision?
 *
 * WHERE THE TRUTH COMES FROM. The registrar's KIND 30889 is the ecosystem's
 * answer to "are these wallets frozen" and is signed by a key KIND 38888 names,
 * so the decision is taken from there rather than re-derived in a browser. The
 * KIND 87058 report is read only for the WORDS shown to the person — text on a
 * screen, never the thing that decides.
 *
 * WHY THE REASON MATTERS. Only `frozen_own_person` closes this gate. A wallet
 * frozen for being too wild, or by a cap, is a money matter and must not lock
 * anyone out of their own conversations.
 */

const FREEZE_REASON = 'frozen_own_person';
const CACHE_PREFIX = 'lana_own_freeze_';
const VIOLATION_KIND = 87058;

export interface FreezeVerdict {
  frozen: boolean;
  /** The commission's own words. Absent when the report could not be read. */
  reason?: string;
  /** Unix seconds the decision took effect. */
  since?: number;
  /** True when nothing could be determined — the caller decides what to do. */
  unknown?: boolean;
  /**
   * The person's own language, captured before their session ends.
   * Without it the page falls back to English at exactly the moment someone
   * most needs to read it in their own words.
   */
  lang?: string;
}

const cacheKey = (pubkey: string) => `${CACHE_PREFIX}${pubkey.toLowerCase()}`;

const readCache = (pubkey: string): FreezeVerdict | null => {
  try {
    const raw = localStorage.getItem(cacheKey(pubkey));
    return raw ? (JSON.parse(raw) as FreezeVerdict) : null;
  } catch {
    return null;
  }
};

const writeCache = (pubkey: string, v: FreezeVerdict) => {
  try {
    localStorage.setItem(cacheKey(pubkey), JSON.stringify({ frozen: v.frozen, reason: v.reason, since: v.since, lang: v.lang }));
  } catch { /* private mode — the live check still runs every time */ }
};

const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T> =>
  Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

/**
 * A frozen verdict, once seen, survives a later failure to read.
 *
 * The gate cannot simply fail closed: an unreachable relay would lock out
 * everyone, which is a far larger harm than a delayed sanction. It must not
 * fail open either, or a sanctioned person gets in the moment the network
 * wobbles. Remembering the last KNOWN freeze resolves both: an outage cannot
 * release anyone, and it cannot block anyone who was never frozen.
 */
/**
 * Who may say a wallet is frozen, and who may publish a violation report.
 *
 * Resolved from KIND 38888 here rather than taken from app state: this gate
 * runs before a session exists, and it must work identically wherever it is
 * used — including outside the browser.
 */
async function trustedSigners(
  pool: SimplePool,
  relays: string[],
): Promise<{ registrar: string[]; platform: string[] }> {
  try {
    const evs = (await withTimeout(
      pool.querySync(relays, { kinds: [38888], limit: 5 }),
      8000,
    )) as Event[];
    evs.sort((a, b) => b.created_at - a.created_at);
    const content = JSON.parse(evs[0]?.content || '{}');
    const list = (v: unknown): string[] =>
      (Array.isArray(v) ? v : v ? [v] : []).map((x) => String(x).toLowerCase());
    return {
      registrar: list(content?.trusted_signers?.LanaRegistrar),
      platform: list(content?.trusted_signers?.LanaSelfResponsibility),
    };
  } catch {
    return { registrar: [], platform: [] };
  }
}

export async function checkGrossViolationFreeze(
  pubkey: string,
  relays: string[],
): Promise<FreezeVerdict> {
  const hex = pubkey.toLowerCase();
  const cached = readCache(hex);

  if (!relays?.length) {
    return cached?.frozen ? { ...cached } : { frozen: false, unknown: true };
  }

  const pool = new SimplePool();
  try {
    const { registrar: registrarSigners, platform: platformSigners } = await trustedSigners(pool, relays);
    if (registrarSigners.length === 0) {
      // Without a signer list there is nothing to trust a wallet record
      // against, so no new verdict can be formed.
      return cached?.frozen ? { ...cached } : { frozen: false, unknown: true };
    }
    const walletEvents = (await withTimeout(
      pool.querySync(relays, { kinds: [30889], '#d': [hex] }),
      8000,
    )) as Event[];

    const trusted = walletEvents.filter((e) => registrarSigners.includes(e.pubkey));
    if (trusted.length === 0) {
      return cached?.frozen ? { ...cached } : { frozen: false, unknown: true };
    }

    trusted.sort((a, b) => b.created_at - a.created_at);
    const latest = trusted[0];
    // w tag: [w, address, label, unit, split, amount, freeze_reason]
    const frozen = latest.tags.some((t) => t[0] === 'w' && t[6] === FREEZE_REASON);

    if (!frozen) {
      const verdict: FreezeVerdict = { frozen: false };
      writeCache(hex, verdict);
      return verdict;
    }

    // Frozen. Now find the words to show — display only, never the decision.
    let reason: string | undefined;
    let since: number | undefined;
    try {
      const reports = (await withTimeout(
        pool.querySync(relays, { kinds: [VIOLATION_KIND], '#p': [hex] }),
        8000,
      )) as Event[];

      const honoured = reports
        .filter((e) => platformSigners.length === 0 || platformSigners.includes(e.pubkey))
        .filter((e) => e.tags.find((t) => t[0] === 'status')?.[1] === 'active')
        .sort((a, b) => b.created_at - a.created_at);

      const report = honoured[0];
      if (report) {
        try {
          const content = JSON.parse(report.content || '{}');
          if (typeof content.subject === 'string' && content.subject.trim()) reason = content.subject.trim();
        } catch { /* unreadable content — the freeze still stands */ }
        since = Number(report.tags.find((t) => t[0] === 'effective_at')?.[1]) || report.created_at;
      }
    } catch { /* the reason is a courtesy; its absence never unfreezes anyone */ }

    // Their own language, read from their profile. On the sign-in path there
    // is no session to take it from, and this page is the one place it matters
    // most: it is all they will see.
    let lang: string | undefined;
    try {
      const profile = (await withTimeout(
        pool.querySync(relays, { kinds: [0], authors: [hex], limit: 1 }),
        6000,
      )) as Event[];
      const content = JSON.parse(profile[0]?.content || '{}');
      const raw = String(content?.lang || content?.language || '').toLowerCase().split(/[-_]/)[0];
      if (raw) lang = raw;
    } catch { /* the page still renders, in the reader's default */ }

    const verdict: FreezeVerdict = { frozen: true, reason, since, lang };
    writeCache(hex, verdict);
    return verdict;
  } catch {
    return cached?.frozen ? { ...cached } : { frozen: false, unknown: true };
  } finally {
    try { pool.close(relays); } catch { /* already closed */ }
  }
}

/**
 * The specific ground, without the standard re-entry text.
 *
 * Commissions have been pasting the four questions and the community
 * principles into the report itself. The page renders that block from
 * translations, so printing it again would show the same words twice — once in
 * whatever language it was written in, once in the reader's. Only the boilerplate
 * is trimmed; the commission's own account of what happened is never edited.
 */
export function specificGround(reason?: string): string | undefined {
  if (!reason) return reason;
  const marks = [
    /\n\s*Kako lahko ponovno vstopi[sš]\??/i,
    /\n\s*How can you come back\??/i,
  ];
  for (const m of marks) {
    const hit = reason.search(m);
    if (hit > 40) return reason.slice(0, hit).trim();
  }
  return reason;
}

/** Thrown by login so the caller can show the person why, rather than "failed". */
export class FrozenOutError extends Error {
  readonly verdict: FreezeVerdict;
  constructor(verdict: FreezeVerdict) {
    super('Account frozen by a commission gross-violation decision');
    this.name = 'FrozenOutError';
    this.verdict = verdict;
  }
}
