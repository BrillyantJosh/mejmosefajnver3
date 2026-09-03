/**
 * Keeping one lookup's answer from landing on another's screen.
 *
 * The wallet pages fetch balances in an effect keyed on the wallet list, with
 * nothing tying a response back to the search that asked for it. Look at
 * someone up, then look at someone else, and there are two requests in the air
 * whose order nobody controls. Whichever finishes last wins the screen.
 *
 * `newer()` hands out an increasing number per page. A response checks whether
 * it is still the newest before it is allowed to write anything; a stale one
 * drops silently, which is right — nobody is waiting for it any more.
 */
export function makeRequestGate() {
  let latest = 0;
  return {
    /** Call when a lookup starts. Keep the token. */
    newer(): number {
      return ++latest;
    },
    /** Call before writing state. False means a newer lookup has started. */
    isCurrent(token: number): boolean {
      return token === latest;
    },
  };
}
