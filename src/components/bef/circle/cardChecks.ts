/**
 * My Circle's steps that ask BEF Explorer something, apart from the page:
 * whether a card can go on the list, publishing the waiting changes as one new
 * list, and what each answer means for the page. Ported from bef-explorer
 * src/components/person/CardList.tsx (considerCard, runStatus, send), with the
 * MejmoSefajn session signing in place of a typed key.
 *
 * One check BEF's own page does not make: 64 hex characters typed as a card's
 * id may be a private key. They are asked about first by the public key they
 * open (CardCandidate.derived) — when a person stands behind that key, the text
 * was a private key and goes nowhere, least of all onto a public list.
 *
 * BEF only ever hears public ids here. It says whether a card is free for this
 * person, never who holds it, and nothing on this page names anyone else.
 *
 * Pure: the page passes its signed-in calls in, so scripts/testBefCircle.ts
 * drives these against BEF's own server with fakes for the relays.
 */
import {
  BefApiError,
  type BefClient,
  type CardListView,
  type CardPublishResult,
  type CardsMine,
  type CardStatus,
} from '../../../lib/bef/api';
import { cardsProblem } from '../../../lib/bef/problems';
import { nextCreatedAt, signCardList, type BefKey } from '../../../lib/bef/signing';
import { MAX_CARDS } from '../../../lib/bef/vendor/server/lib/cardListEvent.ts';
import { checkCardLocally, nextCardList, shortCardId } from '../../../lib/bef/vendor/src/lib/cardList.ts';
import { fmtDateTime } from '../../../lib/bef/vendor/src/lib/format.ts';
import type { BefCircleTextKey } from '../../../i18n/modules/befCircle';
import type { CardCandidate } from './cardInput';

export interface CircleMessage {
  key: BefCircleTextKey;
  vars?: Record<string, string | number>;
  /** A refusal or a failure (role="alert"); otherwise news (role="status"). */
  alert: boolean;
  /** The cards the message is about, as short ids. */
  ids?: string[];
}

export type CardAllowance = CardsMine['allowance'];

/** POST /api/cards/status, signed in. `profile`: also ask whether a KIND 0 stands behind the id. */
export type CardStatusCall = (
  hex: string,
  profile: boolean,
) => Promise<{ status: CardStatus; profile?: { found: boolean | null; name: string | null } }>;

export type CardVerdict =
  /** Free for this person: goes on the waiting additions. */
  | { kind: 'add'; hex: string; name: string | null; message: CircleMessage }
  /** Already on the list BEF holds — published from another window meanwhile. */
  | { kind: 'yours'; message: CircleMessage }
  | { kind: 'refused'; message: CircleMessage }
  /** Not decided: the same card may be asked about again (it is a public id by now). */
  | { kind: 'retry'; message: CircleMessage };

/** The waiting changes, read when publishing. */
export interface CircleChange {
  list: CardListView | null;
  adds: readonly string[];
  removes: readonly string[];
}

/** The new list would hold more than MAX_CARDS: refused here, before anything is signed. */
export const LIST_FULL = 'list_full';

const alert = (key: BefCircleTextKey, vars?: Record<string, string | number>): CircleMessage => ({ key, vars, alert: true });
const refused = (key: BefCircleTextKey, vars?: Record<string, string | number>): CardVerdict => ({ kind: 'refused', message: alert(key, vars) });

/** What the allowance allows, in words: none left for now, or fewer than wanted (BEF CardList.tsx allowanceProblem). */
export const allowanceProblem = (a: { max: number; remaining: number; nextSlotAt?: string | null }): CircleMessage =>
  a.remaining === 0 && a.nextSlotAt
    ? alert('cards.allowance.none', { max: a.max, date: fmtDateTime(a.nextSlotAt) })
    : alert('cards.err.monthly_card_limit', { max: a.max, remaining: a.remaining });

/** Codes that mean "no answer worth having": the same question may simply be asked again. */
const UNANSWERED = ['network', 'timeout', 'rate_limited', 'busy', 'server_error'];

/**
 * The checks that need no server, then — for a typed id — the private-key
 * check, then BEF's word on the card.
 */
export async function checkCard(
  card: CardCandidate,
  ctx: {
    self: string;
    published: readonly string[];
    pendingAdds: readonly string[];
    pendingRemoves: readonly string[];
    allowance: CardAllowance | null;
  },
  status: CardStatusCall,
): Promise<CardVerdict> {
  const verdict = checkCardLocally(card.hex, {
    self: ctx.self,
    published: ctx.published,
    pendingAdds: ctx.pendingAdds,
    pendingRemoves: ctx.pendingRemoves,
    remaining: ctx.allowance?.remaining ?? 0,
  });
  switch (verdict) {
    case 'own':
      return refused('cards.err.own');
    case 'alreadyYours':
      return refused('cards.err.alreadyYours');
    case 'alreadyPending':
      return refused('cards.err.alreadyPending');
    case 'monthlyLimit':
      return ctx.allowance && ctx.allowance.remaining > 0
        ? refused('cards.allowance.waiting', { max: ctx.allowance.max })
        : { kind: 'refused', message: allowanceProblem(ctx.allowance ?? { max: 0, remaining: 0 }) };
    case 'full':
      return refused('cards.err.full', { max: MAX_CARDS });
  }

  // 64 hex characters: asked about as a private key first, by the public key
  // they open. A key that is someone's — a profile stands behind it, or it is
  // on a list — means the text was a private key. Not known either way: nothing
  // is added, and the text is not kept to be asked about later.
  if (card.byId && card.derived) {
    try {
      const probe = await status(card.derived, true);
      if (probe.status !== 'free' || probe.profile?.found === true) return refused('circle.privateKey');
      if (probe.profile?.found !== false) return refused('circle.checkFailed');
    } catch (err) {
      const problem = cardsProblem(err);
      return refused(UNANSWERED.includes(problem.code) ? problem.text : 'circle.checkFailed', problem.vars);
    }
  }

  let answer: Awaited<ReturnType<CardStatusCall>>;
  try {
    answer = await status(card.hex, card.byId);
  } catch (err) {
    const problem = cardsProblem(err);
    if (problem.code === 'bad_card') return refused('cards.err.badId');
    if (UNANSWERED.includes(problem.code)) return { kind: 'retry', message: alert(problem.text, problem.vars) };
    // The session or the key did not hold: the door says so; nothing to ask again.
    if (problem.action === 'none' || problem.code === 'account_changed') return refused(problem.text, problem.vars);
    return { kind: 'retry', message: alert('cards.err.checkFailed') };
  }

  const id = shortCardId(card.hex);
  switch (answer.status) {
    case 'free': {
      const profile = answer.profile;
      if (card.byId && profile?.found !== true) {
        // Typed as an id: only a person with a public profile goes on the list.
        // Relays that did not answer are "not known", never "no profile".
        return profile?.found === false
          ? refused('cards.err.noProfile', { id })
          : { kind: 'retry', message: alert('cards.err.profileUnknown') };
      }
      const name = card.byId && profile?.name ? profile.name : null;
      return {
        kind: 'add',
        hex: card.hex,
        name,
        message: name
          ? { key: 'cards.add.readyNamed', vars: { name, id }, alert: false }
          : { key: 'cards.add.ready', vars: { id }, alert: false },
      };
    }
    case 'yours':
      return { kind: 'yours', message: alert('cards.err.alreadyYours') };
    case 'taken':
      return refused('cards.err.taken');
    case 'own':
      return refused('cards.err.own');
    case 'brought_you':
      return refused('cards.err.broughtYou');
    default:
      return { kind: 'retry', message: alert('cards.err.checkFailed') };
  }
}

/**
 * Sign the waiting changes as one new list, built on the list BEF holds, and
 * publish it. `withSession` is the provider's: a session BEF no longer knows is
 * replaced once and this runs again — signing again with a fresh created_at.
 */
export async function publishCards(
  withSession: <T>(fn: (auth: { token: string; key: BefKey }) => Promise<T>) => Promise<T>,
  client: Pick<BefClient, 'person' | 'cards' | 'serverNowSeconds'>,
  change: CircleChange,
): Promise<CardPublishResult> {
  const published = change.list?.cards.map((card) => card.hex) ?? [];
  const cards = nextCardList(published, change.adds, change.removes);
  if (cards.length > MAX_CARDS) throw new BefApiError(LIST_FULL, 0);
  return withSession(async ({ token, key }) => {
    // The session is still alive, and BEF's clock is fresh to sign with.
    await client.person.me(token);
    // Strictly newer than the stored list, or BEF keeps the old one.
    const createdAt = nextCreatedAt(client.serverNowSeconds(), change.list?.createdAt);
    const event = signCardList(key, cards, createdAt);
    return client.cards.publish(token, event, change.list?.eventId ?? null);
  });
}

/** What a published list says, with what it added and removed. */
export const publishedMessage = (result: CardPublishResult): CircleMessage => ({
  key: 'circle.published',
  vars: { accepted: result.relays.accepted, total: result.relays.total, added: result.added.length, removed: result.removed.length },
  alert: false,
});

export interface PublishAnswer {
  message: CircleMessage;
  /** Cards to take off the waiting additions. */
  drop?: string[];
  /**
   * Reload the list BEF holds: 'first' — say the message only once the list is
   * back (the person is asked to check it); 'quiet' — alongside the message.
   * Waiting changes the reloaded list already carries stop waiting.
   */
  reload?: 'first' | 'quiet';
}

const HEX64 = /^[0-9a-f]{64}$/;

/** A refused publish → what the page says and does. The waiting changes stay unless named here. */
export function publishAnswer(err: unknown): PublishAnswer {
  const code = err instanceof BefApiError ? err.code : '';
  const body = err instanceof BefApiError ? err.body : {};
  switch (code) {
    case LIST_FULL:
      return { message: alert('cards.err.full', { max: MAX_CARDS }) };
    case 'card_taken':
    case 'card_brought_you': {
      const cards = [...new Set((body.cards ?? []).filter((card) => typeof card === 'string' && HEX64.test(card)))];
      return {
        message: { ...alert(code === 'card_taken' ? 'cards.err.card_taken' : 'cards.err.card_brought_you', { count: cards.length }), ids: cards.map(shortCardId) },
        drop: cards,
      };
    }
    case 'stale_event':
    case 'bad_base':
      // Changed in another window: reloaded, the changes kept, pressed again.
      return { message: alert('cards.err.stale_event'), reload: 'first' };
    case 'monthly_card_limit':
      return {
        message: allowanceProblem({ max: body.max ?? 0, remaining: body.remaining ?? 0, nextSlotAt: body.nextSlotAt }),
        reload: 'quiet',
      };
    case 'publish_failed':
      return {
        message: body.total === 0 ? alert('cards.err.noRelays') : alert('cards.err.publish_failed', { accepted: body.accepted ?? 0, total: body.total ?? 0 }),
      };
    case 'relay_writes_disabled':
      return { message: alert('circle.relayWritesOff') };
    case 'outcome_unknown':
      // Sent, and no answer: it may have gone through. Signing again is safe —
      // a list that did go through changed the base, and a second one is
      // refused as stale rather than published twice.
      return { message: alert('cards.err.outcomeUnknown'), reload: 'first' };
    default: {
      const problem = cardsProblem(err);
      return { message: alert(problem.text, problem.vars) };
    }
  }
}
