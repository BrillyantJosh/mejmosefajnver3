/**
 * Unconditional Financing — who is asking? The SIGNATURE says, nothing else.
 *
 * Deleting a request and hiding one are not decided by anything the JSON body
 * claims: a public key is public, so "requesterPubkey" / "adminPubkey" in a body
 * proves nothing. The caller signs a short-lived event with their Nostr key and
 * the server takes the identity from that signature — the pattern
 * /api/functions/update-app-settings already uses (kind 27235, NIP-98 "HTTP
 * Auth": an ephemeral event made for authenticating a request, never published
 * to relays, so no Lana kind is spent).
 *
 * On top of that pattern the event is BOUND to what it authorises, so a captured
 * event cannot be turned into a different action:
 *   tags     ['method', 'DELETE' | 'PATCH']   (a ['u', <url>] tag is customary and
 *                                              ignored: the binding is method + action + id)
 *   content  JSON  { "action": "<name>", "id": "<request id>", …fields }
 * The fields (e.g. is_hidden) travel inside the signed content, so what the
 * caller authorised is exactly what gets written.
 * It is also single-use within its five-minute life: a replay of a hide/unhide
 * must not undo what an administrator did afterwards. The route SPENDS the event
 * (consumeSignedAction) only once the signer is authorised — an event from a
 * stranger is refused without leaving anything behind, so strangers cannot fill
 * the memory with events of their own.
 *
 * CLIENTS: add a random ['nonce', <16 random bytes, hex>] tag before signing.
 * An event id is the hash of everything EXCEPT the signature, so two otherwise
 * identical events signed in the same second are the same event — the second one
 * (a double-click) would be refused as a replay. (Same trap, same cure as the
 * NIP-98 tokens of self-responsibility.)
 */
import { verifyEvent } from 'nostr-tools';

export const UF_SIGNED_ACTION_KIND = 27235;
/** A captured event stops working after this many seconds (either side of now). */
export const UF_SIGNED_ACTION_MAX_AGE_SECONDS = 300;
/** Spent events remembered at once. Only authorised actions are remembered, so this is far above any real use. */
export const UF_SIGNED_ACTION_MAX_REMEMBERED = 10_000;

export const UF_ACTION_DELETE_REQUEST = 'uf-request-delete';
export const UF_ACTION_SET_HIDDEN = 'uf-request-set-hidden';

export interface SignedActionExpectation {
  /** HTTP method of the route being called. */
  method: string;
  /** Which action this route performs (UF_ACTION_*). */
  action: string;
  /** The request id (d-tag) the route was called for. */
  target: string;
  /** For tests: the clock. */
  now?: number;
}

export interface SignedActionAccepted {
  ok: true;
  /** The SIGNER — the only identity there is. */
  pubkey: string;
  eventId: string;
  createdAt: number;
  /** The signed content, parsed: action, id and the fields being authorised. */
  payload: Record<string, any>;
}
export interface SignedActionRefused {
  ok: false;
  status: 401 | 429;
  error: string;
}
export type SignedActionResult = SignedActionAccepted | SignedActionRefused;

/** A type guard rather than `!r.ok`: the server's tsconfig is not strict, so a boolean tag does not narrow. */
export const isRefused = (r: SignedActionResult): r is SignedActionRefused => r.ok === false;

/** event id → when it may be forgotten. In memory: the window is five minutes (a restart empties it). */
const spent = new Map<string, number>();

function forgetExpired(nowSec: number): void {
  for (const [id, until] of spent) if (until <= nowSec) spent.delete(id);
}

const refuse = (error: string, status: 401 | 429 = 401): SignedActionRefused => ({ ok: false, status, error });

/**
 * Checks the event WITHOUT spending it. The cheap checks come first: a Schnorr
 * verification costs about a millisecond, and anyone can send anything here.
 */
export function verifySignedAction(event: unknown, expect: SignedActionExpectation): SignedActionResult {
  const e = event as any;
  if (!e || typeof e !== 'object') return refuse('Signed event required');
  if (e.kind !== UF_SIGNED_ACTION_KIND) return refuse(`Expected kind ${UF_SIGNED_ACTION_KIND}`);

  const nowSec = expect.now ?? Math.floor(Date.now() / 1000);
  if (!Number.isFinite(e.created_at) || Math.abs(nowSec - e.created_at) > UF_SIGNED_ACTION_MAX_AGE_SECONDS) {
    return refuse('Event expired — check the device clock and retry');
  }

  const methodTag = Array.isArray(e.tags) ? e.tags.find((t: string[]) => t[0] === 'method')?.[1] : undefined;
  if (typeof methodTag !== 'string' || methodTag.toUpperCase() !== expect.method.toUpperCase()) {
    return refuse('Event was signed for a different request method');
  }

  let payload: any;
  try { payload = JSON.parse(e.content || ''); } catch { payload = null; }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
      || payload.action !== expect.action || payload.id !== expect.target) {
    return refuse('Event was signed for a different action or request');
  }

  forgetExpired(nowSec);
  if (typeof e.id === 'string' && spent.has(e.id)) return refuse('Event has already been used');

  try {
    if (!verifyEvent(e)) return refuse('Invalid event signature');
  } catch {
    return refuse('Invalid event signature');
  }

  return { ok: true, pubkey: e.pubkey, eventId: e.id, createdAt: e.created_at, payload };
}

/**
 * The route calls this once the signer is AUTHORISED and the action is about to
 * happen: from here on the event cannot be used again. Remembered until it could
 * no longer pass the freshness check anyway — an event dated up to five minutes
 * ahead stays valid until five minutes after ITS date, not after ours.
 */
export function consumeSignedAction(accepted: SignedActionAccepted, now?: number): SignedActionRefused | null {
  const nowSec = now ?? Math.floor(Date.now() / 1000);
  forgetExpired(nowSec);
  if (spent.size >= UF_SIGNED_ACTION_MAX_REMEMBERED) {
    return refuse('Too many signed actions in the last minutes — try again shortly', 429);
  }
  spent.set(accepted.eventId, Math.max(nowSec, accepted.createdAt) + UF_SIGNED_ACTION_MAX_AGE_SECONDS + 1);
  return null;
}
