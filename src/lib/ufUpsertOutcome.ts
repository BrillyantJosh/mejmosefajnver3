/**
 * What the Unconditional Financing form says after the server answered
 * POST /requests/upsert.
 *
 * By then the request is already on the relays (the form publishes FIRST and the
 * server only mirrors it), so the only question is whether the server has LISTED
 * it. The form used to look at one status code, 403, and treat every other answer
 * as a success: a 503 ("I cannot tell whether you are a member": no relay answered,
 * or the Split calendar could not be read) came out as "Request published, funding
 * opens …" for a request that was not listed — and tempted people to publish it
 * again.
 *
 *  - 2xx → listed.
 *  - 503, 429 and other server trouble (5xx) → NOT LISTED YET. The relay indexer
 *    scans every 30 minutes and lists the request if its author qualifies, so the
 *    person is told exactly that, and told not to publish it again.
 *  - everything else (403 not eligible / not the author, 400 invalid, 409 an older
 *    version) → refused: the server will not list it; its own reason is shown.
 */
export type UpsertOutcome =
  | { kind: "listed" }
  | { kind: "pending"; message: string }
  | { kind: "refused"; message: string };

export function upsertOutcome(status: number, serverMessage: unknown, sl: boolean): UpsertOutcome {
  if (status >= 200 && status < 300) return { kind: "listed" };

  if (status === 503) {
    return {
      kind: "pending",
      message: sl
        ? "Zahtevek je objavljen, vendar ga strežnik še ni uvrstil na seznam: zdaj ne more preveriti tvojega članstva v Lana8Wonder. Če izpolnjuješ pogoje, se bo pojavil sam v približno pol ure. Ne objavljaj ga še enkrat."
        : "Your request is published, but the server has not listed it yet: it cannot check your Lana8Wonder membership right now. If you qualify, it will appear on its own within about half an hour. Please do not publish it again.",
    };
  }
  if (status === 429 || status >= 500) {
    return {
      kind: "pending",
      message: sl
        ? "Zahtevek je objavljen, vendar ga strežnik zdaj ni mogel uvrstiti na seznam. Pojavil se bo sam v približno pol ure. Ne objavljaj ga še enkrat."
        : "Your request is published, but the server could not list it right now. It will appear on its own within about half an hour. Please do not publish it again.",
    };
  }

  const reason = typeof serverMessage === "string" ? serverMessage.trim() : "";
  return {
    kind: "refused",
    message: reason || (sl ? "Zahtevek ni bil sprejet" : "Request was not accepted"),
  };
}
