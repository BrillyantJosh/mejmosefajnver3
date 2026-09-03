/**
 * Share a request that is already on the wire.
 *
 * Several components mounting the same hook fire the same fetch at the same
 * moment — MainLayout alone mounts useNostrWallets three times, and that route
 * runs three relay filters against every relay, so it was three identical
 * round trips per page load per user.
 *
 * Concurrent only, by design. Nothing is remembered once the request settles,
 * so no caller is ever handed an answer that was true a moment ago. Where the
 * data decides whether money may move — a wallet's freeze status, for one — a
 * cache with a lifetime is the wrong trade, and this deliberately is not one.
 */
const inFlight = new Map<string, Promise<unknown>>();

export function singleFlight<T>(key: string, run: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key) as Promise<T> | undefined;
  if (existing) return existing;

  // Start it, and make sure the slot is freed however it ends — a rejected
  // request that stayed in the map would wedge that key forever.
  const p = (async () => {
    try {
      return await run();
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, p);
  return p;
}

/** For tests. */
export function singleFlightSize(): number {
  return inFlight.size;
}
