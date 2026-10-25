/**
 * When may a person the commission excluded (KIND 87058) ask to re-enter
 * (KIND 87059)? Three months after the decision took effect.
 *
 * Brilly, 25. 10. 2026: "Ternutno imamo da če je nekdo izključen iz skupnosti
 * dobi formo za ponovni vstop... Ta forma se prikaze šele po 3 mesecih potem ko
 * je bil izključen". Until then the screen says from which day the form opens.
 *
 * Calendar months, in UTC, from the decision's own moment (its `effective_at`,
 * else when it was signed — src/lib/ownFreezeGate.ts). A day the target month
 * does not have becomes its last day: excluded on 30 November, the form opens
 * on 28 (or 29) February, never in March.
 *
 * No readable date, no form: the wait cannot be measured, so it is not skipped.
 * Pure — tested by scripts/testReentryWindow.ts.
 */
export const REENTRY_WAIT_MONTHS = 3;

/** Unix seconds at which the re-entry form opens, or null when the decision's date is not known. */
export function reentryOpensAt(since: number | null | undefined, months: number = REENTRY_WAIT_MONTHS): number | null {
  if (typeof since !== 'number' || !Number.isFinite(since) || since <= 0) return null;
  const d = new Date(since * 1000);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + months; // Date.UTC carries a month past December into the next year
  const lastDayOfTarget = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(d.getUTCDate(), lastDayOfTarget);
  return Math.floor(Date.UTC(year, month, day, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()) / 1000);
}

/** Whether the form may be shown now. */
export function reentryIsOpen(since: number | null | undefined, nowSeconds: number = Math.floor(Date.now() / 1000)): boolean {
  const opensAt = reentryOpensAt(since);
  return opensAt !== null && nowSeconds >= opensAt;
}
