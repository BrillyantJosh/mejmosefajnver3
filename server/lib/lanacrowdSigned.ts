/**
 * LanaCrowd (100millionideas) — what a write is allowed to rest on: a signature.
 *
 * Who is asking and what is being written both come from a signed Nostr event.
 *   PATCH  /projects/:id/admin   a signed action (kind 27235, ufSignedAction.ts);
 *                                the signer must be a 100 Million Ideas admin and
 *                                the fields travel inside the signed content
 *   DELETE /projects/:id         a signed action from the owner or an admin, or the
 *                                owner's own KIND 5 deletion request for the project
 *   POST   /projects/upsert      the KIND 31234 the owner just published
 *   POST   /donations/record     the KIND 60200 the donor just published
 *
 * An admin's decision is also an event of its own (decisionFor): the row changes only
 * once the relays have that event, so what this app shows and what LetsBalance.world
 * reads from the relays stay the same.
 *
 * The published events are what a server without the person's key can pass on
 * (LetsBalance.world holds them, never the key), and they read exactly like the
 * relay indexer reads them (indexLanacrowdFromRelays in nostr.ts), so a row written
 * here is the row the indexer would write next.
 */
import { verifyEvent, type Event } from 'nostr-tools';
import type { SignedActionRefused } from './ufSignedAction.js';

export const LANACROWD_ACTION_ADMIN = 'lanacrowd-project-admin';
export const LANACROWD_ACTION_DELETE = 'lanacrowd-project-delete';

export const PROJECT_KIND = 31234;
export const DONATION_KIND = 60200;
export const DELETION_KIND = 5;

/** A deletion request stays usable this long: LetsBalance may retry the same signed KIND 5 for a day. */
export const DELETION_MAX_AGE_SECONDS = 86400;
/** How far ahead of this clock an event may be dated. */
export const MAX_FUTURE_SECONDS = 300;

export interface SignedEventAccepted {
  ok: true;
  event: Event;
}
export type SignedEventResult = SignedEventAccepted | SignedActionRefused;

/** A type guard rather than `!r.ok`: the server's tsconfig is not strict, so a boolean tag does not narrow. */
export const isEventRefused = (r: SignedEventResult): r is SignedActionRefused => r.ok === false;

const refuse = (error: string): SignedActionRefused => ({ ok: false, status: 401, error });

/** The cheap checks come first: a Schnorr verification costs about a millisecond and anyone can send anything here. */
export function readSignedEvent(event: unknown, kind: number): SignedEventResult {
  const e = event as any;
  if (!e || typeof e !== 'object') return refuse('Signed event required');
  if (e.kind !== kind) return refuse(`Expected kind ${kind}`);
  if (!Array.isArray(e.tags) || !e.tags.every((t: unknown) => Array.isArray(t) && t.every((v) => typeof v === 'string'))) {
    return refuse('Invalid event tags');
  }
  try {
    if (!verifyEvent(e)) return refuse('Invalid event signature');
  } catch {
    return refuse('Invalid event signature');
  }
  return { ok: true, event: e };
}

const tagValue = (evt: Event, name: string): string | undefined => evt.tags.find((t) => t[0] === name)?.[1];
const tagsNamed = (evt: Event, name: string): string[][] => evt.tags.filter((t) => t[0] === name);
/** A role sits at tag index 2 in this app's events and at index 3 in being3's and LetsBalance's. */
const personWithRole = (evt: Event, role: string): string | undefined =>
  evt.tags.find((t) => t[0] === 'p' && (t[2] === role || t[3] === role))?.[1];

export function projectFromEvent(evt: Event) {
  const id = tagValue(evt, 'd');
  const title = tagValue(evt, 'title');
  if (!id || !title) return null;
  const images = tagsNamed(evt, 'img');
  return {
    id,
    eventId: evt.id,
    pubkey: evt.pubkey,
    ownerPubkey: personWithRole(evt, 'owner') || evt.pubkey,
    title,
    shortDesc: tagValue(evt, 'short_desc') || '',
    content: evt.content || '',
    fiatGoal: parseFloat(tagValue(evt, 'fiat_goal') || '0') || 0,
    currency: tagValue(evt, 'currency') || 'EUR',
    wallet: tagValue(evt, 'wallet') || '',
    responsibilityStatement: tagValue(evt, 'responsibility_statement') || '',
    projectType: tagValue(evt, 'project_type') || 'Inspiration',
    whatType: tagValue(evt, 'what_type') || null,
    status: tagValue(evt, 'status') || 'active',
    coverImage: images.find((t) => t[2] === 'cover')?.[1] || null,
    galleryImages: images.filter((t) => t[2] === 'gallery').map((t) => t[1]),
    videos: tagsNamed(evt, 'video').map((t) => t[1]),
    files: tagsNamed(evt, 'file').map((t) => t[1]),
    participants: evt.tags.filter((t) => t[0] === 'p' && (t[2] === 'participant' || t[3] === 'participant')).map((t) => t[1]),
    nostrCreatedAt: evt.created_at,
  };
}

/**
 * The donor is the signer. Null when this is not a donation to a project: a
 * mentor-fee event is the commission, not a donation (the indexer skips it too).
 */
export function donationFromEvent(evt: Event) {
  const projectId = tagValue(evt, 'project');
  if (!projectId || tagValue(evt, 'type') === 'mentor_fee') return null;
  const amountLanoshis = parseInt(tagValue(evt, 'amount_lanoshis') || '0') || 0;
  const amountFiat = parseFloat(tagValue(evt, 'amount_fiat') || '0') || 0;
  if (!Number.isFinite(amountFiat) || amountFiat < 0 || !Number.isSafeInteger(amountLanoshis) || amountLanoshis < 0) return null;
  return {
    id: evt.id,
    projectId,
    supporterPubkey: evt.pubkey,
    projectOwnerPubkey: personWithRole(evt, 'project_owner') || '',
    amountLanoshis,
    amountFiat,
    currency: tagValue(evt, 'currency') || 'EUR',
    fromWallet: tagValue(evt, 'from_wallet') || '',
    toWallet: tagValue(evt, 'to_wallet') || '',
    txId: tagValue(evt, 'tx') || null,
    message: evt.content && evt.content.trim() ? evt.content : null,
    nostrCreatedAt: evt.created_at,
  };
}

/** Is this KIND 5 its signer's own deletion request for exactly this project? */
export function deletionNames(evt: Event, projectId: string): boolean {
  return tagValue(evt, 'k') === String(PROJECT_KIND)
    && tagValue(evt, 'a') === `${PROJECT_KIND}:${evt.pubkey}:${projectId}`;
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
