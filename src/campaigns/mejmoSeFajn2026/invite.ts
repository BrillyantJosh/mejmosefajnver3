/**
 * TEMPORARY CAMPAIGN — the invitation to "Mejmo se f*cking fajn", Saturday 21. 11. 2026
 * at 16.00, Dancelife (Šmartinska 106, Ljubljana).
 *
 * Brilly, 11. 11. 2026: every signed-in user sees the flyer once a day at most, with a
 * countdown, and is invited to confirm like on the event page; someone who said
 * "no" is still told every day that there are X days left to change their mind.
 * Once the event is over it shows nothing, and this whole folder, the flyer
 * (public/campaigns/mejmo-se-fajn-2026-11-21.webp), the one line that mounts it in
 * MainLayout and scripts/testMejmoInvite.ts are to be deleted on Brilly's word.
 *
 * Pure: dates, counts and words — tested by scripts/testMejmoInvite.ts.
 */
export const EVENT_DTAG = 'event:1794396674815-ptvmzd';
/** 21. 11. 2026 16.00 in Ljubljana (CET, UTC+1). */
export const EVENT_START_MS = Date.UTC(2026, 10, 21, 15, 0, 0);
export const EVENT_DATE_LJ = '2026-11-21';
export const FLYER_URL = '/campaigns/mejmo-se-fajn-2026-11-21.webp';
export const IN_APP_EVENT_PATH = `/events/detail/${encodeURIComponent(EVENT_DTAG)}`;

/** The calendar day in Ljubljana, as YYYY-MM-DD. */
export function ljubljanaDay(ms: number): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Ljubljana', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
}

/** Whole calendar days (in Ljubljana) from today to the event day: 0 on the day itself. */
export function daysUntilEvent(nowMs: number): number {
  const [y, m, d] = ljubljanaDay(nowMs).split('-').map(Number);
  const [ey, em, ed] = EVENT_DATE_LJ.split('-').map(Number);
  return Math.round((Date.UTC(ey, em - 1, ed) - Date.UTC(y, m - 1, d)) / 86_400_000);
}

/** The campaign is on until the event begins. */
export function campaignIsOn(nowMs: number): boolean {
  return nowMs < EVENT_START_MS;
}

/** Once a day at most: shown unless it was already shown on this Ljubljana day. */
export function dueToday(nowMs: number, lastShownDay: string | null): boolean {
  return campaignIsOn(nowMs) && lastShownDay !== ljubljanaDay(nowMs);
}

/** Pages where a popup must never get in the way: signing a payment, entering a key, the event itself. */
export function quietPage(pathname: string): boolean {
  return /private-key|\/send-lana|\/consolidate|\/login|\/register|\/result|\/checkin/i.test(pathname)
    || pathname === IN_APP_EVENT_PATH || decodeURIComponent(pathname) === decodeURIComponent(IN_APP_EVENT_PATH);
}

/** "Še 10 dni", "Še 2 dneva", "JUTRI", "DANES ob 16.00" — the badge. */
export function countdownBadge(days: number, sl: boolean): string {
  if (days <= 0) return sl ? 'DANES ob 16.00! 🔥' : 'TODAY at 4 pm! 🔥';
  if (days === 1) return sl ? 'JUTRI! ⏳' : 'TOMORROW! ⏳';
  if (!sl) return `${days} days to go ⏳`;
  const word = days === 2 ? 'dneva' : days === 3 || days === 4 ? 'dnevi' : 'dni';
  return `Še ${days} ${word} ⏳`;
}

/** "imaš še 10 dni" — how long is left to change your mind (accusative in Slovenian). */
export function timeLeftToChange(days: number, sl: boolean): string {
  if (days <= 0) return sl ? 'imaš še nekaj ur' : 'you still have a few hours';
  if (!sl) return days === 1 ? 'you still have 1 day' : `you still have ${days} days`;
  const word = days === 1 ? 'dan' : days === 2 ? 'dneva' : 'dni';
  return `imaš še ${days} ${word}`;
}

export type InviteMood = 'invite' | 'declined' | 'going';
