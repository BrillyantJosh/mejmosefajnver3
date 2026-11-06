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
