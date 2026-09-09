import { SimplePool, finalizeEvent, nip44, getPublicKey } from 'nostr-tools';
import type { Event } from 'nostr-tools';

/**
 * KIND 87059 — a re-entry request, published by the excluded person.
 *
 * Signed with THEIR key, because an application nobody else can write is the
 * only kind that means anything. Encrypted to the self-responsibility platform
 * key, because this is a person's account of their own conduct written under
 * sanction: facilitators need to read it, and a public copy would follow them
 * permanently.
 */

export const REENTRY_KIND = 87059;

export interface ReentryAnswers {
  why_here: string;
  what_i_create: string;
  is_it_consistent: string;
  willing_to_change: string;
}

const hexToBytes = (hex: string): Uint8Array => {
  const a = new Uint8Array(hex.length / 2);
  for (let i = 0; i < a.length; i++) a[i] = parseInt(hex.slice(2 * i, 2 * i + 2), 16);
  return a;
};

const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T> =>
  Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

/** The platform key from KIND 38888 — who the answers are encrypted TO. */
async function platformPubkey(pool: SimplePool, relays: string[]): Promise<string | null> {
  try {
    const evs = (await withTimeout(pool.querySync(relays, { kinds: [38888], limit: 5 }), 8000)) as Event[];
    evs.sort((a, b) => b.created_at - a.created_at);
    const signers = JSON.parse(evs[0]?.content || '{}')?.trusted_signers?.LanaSelfResponsibility;
    const key = Array.isArray(signers) ? signers[0] : signers;
    return typeof key === 'string' && /^[0-9a-f]{64}$/i.test(key) ? key.toLowerCase() : null;
  } catch {
    return null;
  }
}

export async function publishReentryRequest(params: {
  privateKeyHex: string;
  relays: string[];
  answers: ReentryAnswers;
  note?: string;
  /** The KIND 87058 being answered, when it is known. */
  violationEventId?: string;
}): Promise<{ eventId: string; accepted: number }> {
  const { privateKeyHex, relays, answers, note, violationEventId } = params;
  if (!relays?.length) throw new Error('No relays configured');

  const sk = hexToBytes(privateKeyHex);
  const pubkey = getPublicKey(sk);
  const pool = new SimplePool();

  try {
    const platform = await platformPubkey(pool, relays);
    if (!platform) {
      // Refuse rather than fall back to plaintext. Publishing this in the clear
      // to "make it work" would expose exactly what encryption is here to protect.
      throw new Error('The self-responsibility key could not be read — nothing was published.');
    }

    const plaintext = JSON.stringify({ answers, note: note ?? '' });
    const conversationKey = nip44.v2.utils.getConversationKey(sk, platform);
    const content = nip44.v2.encrypt(plaintext, conversationKey);

    const submittedAt = Math.floor(Date.now() / 1000);
    const tags: string[][] = [
      ['d', crypto.randomUUID()],
      ['p', pubkey, 'applicant'],
      ['status', 'submitted'],
      ['submitted_at', String(submittedAt)],
      ['client', 'lana-own'],
    ];
    if (violationEventId) tags.push(['e', violationEventId, '', 'violation']);

    const signed = finalizeEvent({ kind: REENTRY_KIND, created_at: submittedAt, tags, content }, sk);

    let accepted = 0;
    await Promise.all(
      relays.map(async (r) => {
        try {
          await withTimeout(Promise.all(pool.publish([r], signed)), 8000);
          accepted += 1;
        } catch { /* one relay refusing is not a failure; none accepting is */ }
      }),
    );
    if (accepted === 0) throw new Error('No relay accepted the request — please try again.');

    return { eventId: signed.id, accepted };
  } finally {
    try { pool.close(relays); } catch { /* already closed */ }
  }
}

/**
 * The request this person has already sent, if any — with their own answers
 * readable again.
 *
 * They can open it themselves: NIP-44 derives one conversation key from
 * (their private key, platform public key), which is the same key the platform
 * derives from the other side. Nothing extra had to be stored for them to see
 * their own words again.
 */
export async function findOwnReentryRequest(params: {
  pubkey: string;
  privateKeyHex: string;
  relays: string[];
}): Promise<{ id: string; submittedAt: number; answers?: ReentryAnswers; note?: string } | null> {
  const { pubkey, privateKeyHex, relays } = params;
  if (!relays?.length) return null;

  const pool = new SimplePool();
  try {
    const evs = (await withTimeout(
      pool.querySync(relays, { kinds: [REENTRY_KIND], '#p': [pubkey.toLowerCase()] }),
      8000,
    )) as Event[];

    const mine = evs
      // Nobody applies on another's behalf — the signature must be the applicant's.
      .filter((e) => e.pubkey.toLowerCase() === pubkey.toLowerCase())
      // The EARLIEST is the request. Taking the newest would let someone bury an
      // inconvenient answer under a fresher one.
      .sort((a, b) => a.created_at - b.created_at);

    const ev = mine[0];
    if (!ev) return null;

    const submittedAt = Number(ev.tags.find((t) => t[0] === 'submitted_at')?.[1]) || ev.created_at;
    const base = { id: ev.id, submittedAt };

    const platform = await platformPubkey(pool, relays);
    if (!platform) return base;   // it exists; the words just could not be opened now

    try {
      const key = nip44.v2.utils.getConversationKey(hexToBytes(privateKeyHex), platform);
      const parsed = JSON.parse(nip44.v2.decrypt(ev.content, key)) as {
        answers?: ReentryAnswers; note?: string;
      };
      return { ...base, answers: parsed.answers, note: parsed.note };
    } catch {
      return base;
    }
  } catch {
    return null;
  } finally {
    try { pool.close(relays); } catch { /* already closed */ }
  }
}
