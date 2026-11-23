/**
 * Unconditional Financing — what an administrator does, signed with the session's Nostr key
 * (kind 27235, never published). The server takes the identity from the signature and the
 * decision from the signed content (server/lib/ufSignedAction.ts, server/lib/ufApproval.ts).
 * The key never leaves the browser.
 *
 *  - approve:  the exact version seen — its event id, amount and currency are signed, so an
 *              edit landing in between is not approved in its place;
 *  - archive / restore: the module's hide flag (out of every public list, not fundable);
 *  - review:   the requests that wait for approval and the archived ones.
 *  - pin / unpin: on top of the "Odprti" tab, or off it (display order only, src/lib/ufPinned.ts).
 */
import { finalizeEvent } from "nostr-tools";
import { UF_API, type UfRequest } from "@/hooks/useUFData";

export const UF_ACTION_APPROVE = "uf-request-approve";
export const UF_ACTION_SET_HIDDEN = "uf-request-set-hidden";
export const UF_ACTION_REVIEW = "uf-requests-review";
export const UF_REVIEW_TARGET = "review";
export const UF_ACTION_SET_PINNED = "uf-request-set-pinned";

const hexToBytes = (hex: string): Uint8Array =>
  new Uint8Array((hex.match(/.{1,2}/g) || []).map((b) => parseInt(b, 16)));

const randomHex = (bytes: number): string =>
  Array.from(crypto.getRandomValues(new Uint8Array(bytes)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

export function signUfAction(
  request: { method: "POST" | "PATCH"; url: string; action: string; id: string; fields?: Record<string, unknown> },
  privateKeyHex: string,
) {
  return finalizeEvent(
    {
      kind: 27235,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ["u", request.url],
        ["method", request.method],
        // Two otherwise identical events signed in the same second would be the same event,
        // and the second click would be refused as already used.
        ["nonce", randomHex(16)],
      ],
      content: JSON.stringify({ action: request.action, id: request.id, ...request.fields }),
    },
    hexToBytes(privateKeyHex),
  );
}

export class UfAdminError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
  }
}

async function send(method: "POST" | "PATCH", url: string, action: string, id: string, privateKeyHex: string, fields?: Record<string, unknown>) {
  const event = signUfAction({ method, url, action, id, fields }, privateKeyHex);
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new UfAdminError(data?.error || `HTTP ${res.status}`, res.status, data?.code);
  return data;
}

/** Approve exactly this version of the request (as loaded on the page). */
export const approveUfRequest = (request: Pick<UfRequest, "id" | "eventId" | "fiatGoal" | "currency">, privateKeyHex: string) =>
  send("POST", `${UF_API}/requests/${encodeURIComponent(request.id)}/approve`, UF_ACTION_APPROVE, request.id, privateKeyHex, {
    event_id: request.eventId,
    fiat_goal: Number(request.fiatGoal),
    currency: request.currency,
  });

/** Archive (true) or restore (false). */
export const setUfRequestArchived = (id: string, archived: boolean, privateKeyHex: string) =>
  send("PATCH", `${UF_API}/requests/${encodeURIComponent(id)}/admin`, UF_ACTION_SET_HIDDEN, id, privateKeyHex, { is_hidden: archived });

/** Put on top of the "Odprti" tab (true) or take it off (false). */
export const setUfRequestPinned = (id: string, pinned: boolean, privateKeyHex: string): Promise<{ success: boolean; pinnedAt: number | null }> =>
  send("POST", `${UF_API}/requests/${encodeURIComponent(id)}/pin`, UF_ACTION_SET_PINNED, id, privateKeyHex, { pinned });

export const fetchUfReview = (privateKeyHex: string): Promise<{ pending: UfRequest[]; archived: UfRequest[] }> =>
  send("POST", `${UF_API}/requests/review`, UF_ACTION_REVIEW, UF_REVIEW_TARGET, privateKeyHex);

/** Slovene/English words for the server's refusals, so the administrator reads what happened. */
export function ufAdminErrorText(err: unknown, sl: boolean): string {
  const e = err as UfAdminError;
  switch (e?.code) {
    case "CHANGED":
      return sl ? "Zahtevek se je medtem spremenil — osveži stran in ga poglej znova." : "The request changed meanwhile — reload and look again.";
    case "ARCHIVED":
      return sl ? "Zahtevek je arhiviran — najprej ga vrni iz arhiva." : "The request is archived — restore it first.";
    case "ALREADY_APPROVED":
      return sl ? "Zahtevek je že odobren." : "The request is already approved.";
    case "DRAFT":
      return sl ? "Osnutka ni mogoče odobriti." : "A draft cannot be approved.";
  }
  if (e?.status === 403) return sl ? "Tega lahko stori samo skrbnik." : "Only an administrator can do this.";
  return e?.message || (sl ? "Ni uspelo." : "It did not work.");
}
