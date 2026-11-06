/**
 * LanaCrowd writes are signed with the session's Nostr key (kind 27235, NIP-98
 * HTTP Auth). The server takes the identity from the signature, and the fields
 * travel inside the signed content, so what the person authorised is exactly what
 * gets written. See server/lib/lanacrowdSigned.ts. The key never leaves the browser.
 */
import { finalizeEvent } from "nostr-tools";

export const LANACROWD_ACTION_ADMIN = "lanacrowd-project-admin";
export const LANACROWD_ACTION_DELETE = "lanacrowd-project-delete";

const hexToBytes = (hex: string): Uint8Array =>
  new Uint8Array((hex.match(/.{1,2}/g) || []).map((b) => parseInt(b, 16)));

const randomHex = (bytes: number): string =>
  Array.from(crypto.getRandomValues(new Uint8Array(bytes)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

export function signLanacrowdAction(
  request: { method: "PATCH" | "DELETE"; url: string; action: string; id: string; fields?: Record<string, unknown> },
  privateKeyHex: string,
) {
  return finalizeEvent(
    {
      kind: 27235,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ["u", request.url],
        ["method", request.method],
        // Two otherwise identical events signed in the same second would be the
        // same event, and the second click would be refused as already used.
        ["nonce", randomHex(16)],
      ],
      content: JSON.stringify({ action: request.action, id: request.id, ...request.fields }),
    },
    hexToBytes(privateKeyHex),
  );
}

/** A project as a decision about it reads it. */
export interface DecisionProject {
  id: string;
  pubkey: string;
  wallet: string;
  fiatGoal: number;
  currency: string;
  status: string;
  isHidden: boolean;
  isApproved: boolean;
}

/**
 * The event an admin's change becomes on the relays, or null when it decides nothing there (a draft
 * is not shown anywhere yet). LetsBalance.world reads these and nothing else: an approval names the
 * project's address, wallet, goal and currency, and counts only for what it names.
 */
export function decisionFor(
  p: DecisionProject,
  fields: { is_hidden?: boolean; is_approved?: boolean; is_completed?: boolean; completion_comment?: string | null },
  signer: string,
  at: number,
): { kind: number; tags: string[][]; content: string } | null {
  if (fields.is_completed !== undefined) {
    const common = [['service', 'lanacrowd'], ['project', p.id], ['p', signer, 'reviewer']];
    return fields.is_completed
      ? { kind: 60201, tags: [...common, ['status', 'completed'], ['timestamp_completed', String(at)]], content: fields.completion_comment || '' }
      : { kind: 60201, tags: [...common, ['status', 'reopened']], content: '' };
  }
  if (fields.is_hidden === undefined && fields.is_approved === undefined) return null;
  const hidden = fields.is_hidden ?? p.isHidden,
    isApproved = fields.is_approved ?? p.isApproved;
  const base = (status: string) => [['d', p.id], ['service', 'lanacrowd'], ['status', status], ['a', `31234:${p.pubkey}:${p.id}`]];
  if (hidden) return { kind: 31235, tags: [...base('blocked'), ['reason', 'Hidden by an admin']], content: '' };
  if (!isApproved) return { kind: 31235, tags: [...base('blocked'), ['reason', 'Not approved']], content: '' };
  if (p.status !== 'active') return null;
  return { kind: 31235, tags: [...base('visible'), ['wallet', p.wallet], ['fiat_goal', String(p.fiatGoal)], ['currency', p.currency]], content: '' };
}

/** The signed decision for a change, or null when the change decides nothing on the relays. */
export function signLanacrowdDecision(p: DecisionProject, fields: Parameters<typeof decisionFor>[1], signer: string, privateKeyHex: string) {
  const at = Math.floor(Date.now() / 1000);
  const decision = decisionFor(p, fields, signer, at);
  return decision && finalizeEvent({ ...decision, created_at: at }, hexToBytes(privateKeyHex));
}
