import { verifyEvent, type Event } from 'nostr-tools';

/**
 * What a MejmoSefajn session keeps from the person's own KIND 0.
 *
 * It used to be read once, at sign-in, and kept for the whole life of the
 * session (30 or 90 days). A language changed afterwards — on the Profile page
 * itself, or in any other Lana app — was published and never reached the app:
 * the person chose English and went on reading Slovenian until they signed out.
 */
export interface SessionProfileFields {
  lanaWalletID?: string;
  lanoshi2lash?: string;
  profileName?: string;
  profileDisplayName?: string;
  profileLang?: string;
  profileCountry?: string;
  profileCurrency?: string;
}

/** A session as far as its profile is concerned. */
export interface SessionProfileState extends SessionProfileFields {
  nostrHexId: string;
  /** created_at (seconds) of the KIND 0 the fields were read from; absent in sessions older than this. */
  profileEventAt?: number;
}

/**
 * The fields a newer KIND 0 changes inside a running session: how the app
 * speaks to the person. The wallet and the LASH value are still read at
 * sign-in only, as they always were.
 */
export const REFRESHABLE_FIELDS = [
  'profileName',
  'profileDisplayName',
  'profileLang',
  'profileCountry',
  'profileCurrency',
] as const;

/** A KIND 0 as far as the session reads it. */
export type ProfileEvent = Pick<Event, 'pubkey' | 'created_at' | 'content'> & { tags?: string[][] };

// Sign-in has always kept any truthy value as it came; kept that way so a
// refresh reads a profile exactly as signing in again would.
const truthy = (value: unknown): string | undefined => (value ? (value as string) : undefined);

/** The session's fields from one KIND 0 — the single reading used at sign-in and on every refresh. */
export function sessionProfileFromKind0(event: Pick<ProfileEvent, 'content' | 'tags'>): SessionProfileFields {
  let content: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(event.content);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) content = parsed;
  } catch {
    // Content that is not JSON still carries its language tag.
  }
  const langTag = (event.tags ?? []).find((tag) => Array.isArray(tag) && tag[0] === 'lang');
  return {
    lanaWalletID: truthy(content.lanaWalletID),
    lanoshi2lash: truthy(content.lanoshi2lash),
    profileName: truthy(content.name),
    profileDisplayName: truthy(content.display_name),
    // The language lives in the content in older profiles and in a tag in the
    // ones this app publishes.
    profileLang: truthy(content.lang) ?? truthy(content.language) ?? truthy(langTag?.[1]),
    profileCountry: truthy(content.country),
    profileCurrency: truthy(content.currency),
  };
}

/**
 * The newest KIND 0 this person really signed, among what the relays returned.
 *
 * Every event is checked for its signature — the language a person reads in
 * follows only what they signed. Each is copied field by field first:
 * nostr-tools remembers a verification on the object itself, and that mark
 * survives a spread, so an altered copy of a verified event would pass.
 * Nothing usable (a silent relay, an error) returns null and changes nothing.
 */
export function newestOwnProfile(events: unknown, hexId: string): Event | null {
  if (!Array.isArray(events)) return null;
  let newest: Event | null = null;
  for (const raw of events) {
    if (!raw || typeof raw !== 'object') continue;
    const e = raw as Record<string, unknown>;
    if (e.kind !== 0 || e.pubkey !== hexId || typeof e.created_at !== 'number') continue;
    const plain = {
      id: e.id,
      pubkey: e.pubkey,
      created_at: e.created_at,
      kind: e.kind,
      tags: e.tags,
      content: e.content,
      sig: e.sig,
    } as Event;
    let genuine = false;
    try {
      genuine = verifyEvent(plain);
    } catch {
      genuine = false;
    }
    if (!genuine) continue;
    if (!newest || plain.created_at > newest.created_at) newest = plain;
  }
  return newest;
}

/**
 * The session as a newer KIND 0 describes it — or the very same object when
 * the event is not newer than what the session already reflects, or would
 * change nothing. An older event (a relay that has not caught up yet) never
 * takes back a newer choice.
 */
export function withProfile<S extends SessionProfileState>(
  session: S,
  event: ProfileEvent,
): S {
  if (event.pubkey !== session.nostrHexId) return session;
  if (session.profileEventAt !== undefined && event.created_at <= session.profileEventAt) return session;

  // A newer event that changes no field still moves the mark forward, so an
  // event from in between — newer than the old mark, older than this one —
  // cannot bring back what this one replaced.
  const fields = sessionProfileFromKind0(event);
  const next: S = { ...session, profileEventAt: event.created_at };
  for (const key of REFRESHABLE_FIELDS) (next as SessionProfileState)[key] = fields[key];
  return next;
}

/**
 * Whether the signed-in person has just chosen a different language in their
 * profile. Signing in, signing out or switching person is not a choice of
 * language; neither is a profile that stops naming one.
 */
export function profileLanguageChanged(
  before: { hexId?: string; lang?: string },
  after: { hexId?: string; lang?: string },
): boolean {
  if (!before.hexId || before.hexId !== after.hexId) return false;
  const was = before.lang?.trim().toLowerCase();
  const now = after.lang?.trim().toLowerCase();
  return !!now && now !== was;
}
