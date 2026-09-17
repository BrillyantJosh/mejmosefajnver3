/**
 * What happens between "Confirm & Send Payment" and the result page, as plain
 * decisions — outside the component, so they can be tested.
 *
 * WHO DECIDES WHETHER WE PAY. Two duplicate guards read the same KIND 90901
 * for the same payer and use the same matcher (unconditionalPaymentGuard.ts):
 * the page's, and the one in POST /send-unconditional-payment. The route's is
 * the authority. It is the mandatory chokepoint in front of the broadcast, it
 * reads the relays from a data centre, and it fails closed on its own: 409
 * when something was already paid, 503 when no relay answered — both before
 * anything is sent.
 *
 * The page's check is the early one. When the device gets an answer, the page
 * still refuses a duplicate itself, before the private key leaves the page.
 * When NO relay answers after every retry, the page no longer refuses on its
 * own: it lets the route decide. A device whose network blocks WebSocket
 * connections to every relay (a DNS or content filter, a router that drops
 * WebSocket upgrades) could otherwise never pay at all — although nothing about
 * its payment is unverifiable, because the server can still verify it. If the
 * server cannot verify either, it refuses and nothing is sent: "unverifiable is
 * never unpaid" holds end to end.
 *
 * 2026-09-17: a payer on an iPhone on WiFi was refused three times in a row
 * ("No relay answered — trying again (3 of 3)") while 41 other payers had
 * confirmed 294 payments through this page on the same four relays since the
 * morning before. The relays sit with four providers; the same read answered
 * in under a second from elsewhere; the app reached its own server fine.
 *
 * AFTER THE MONEY MOVES. A device like that cannot publish the payment
 * confirmation either, and the confirmation is the only thing that marks the
 * obligation paid: the pending list and both guards read it off the relays.
 * So its delivery does not rest on the device:
 *   1. every confirmation is signed and saved on the server FIRST — the queue
 *      the heartbeat republishes from — before anything slow can happen;
 *   2. the device publishes directly, when it could reach relays at all;
 *   3. whatever the device did not land, the server publishes right away.
 *      The heartbeat alone drains 10 queued events per 5 minutes: over the
 *      30 days to 2026-09-17, 192 of 1 620 queued confirmations took more than
 *      10 minutes to reach the relays, the slowest 33. One obligation has
 *      already been paid twice 31 minutes apart; a bill that still shows
 *      "unpaid" for half an hour after paying invites exactly that.
 * The result page is told which of these actually happened, and says no more.
 */
import {
  findDuplicateConfirmations,
  GUARD_UNVERIFIABLE_MESSAGE,
  type ConfirmationEvent,
  type SelectedObligation,
} from './unconditionalPaymentGuard';

/** Shown while the server runs the check this device could not. */
export const SERVER_CHECKS_PROGRESS =
  'This device could not reach the relays — our server is checking your previous payments…';

/** Shown once the transaction is out, while its confirmation is delivered. */
export const DELIVERING_CONFIRMATION_PROGRESS =
  'Payment sent — delivering the payment confirmation…';

/** A route "success" without a transaction id: the money may have moved. */
export const PAYMENT_STATUS_UNKNOWN_MESSAGE =
  'The server reported the payment as sent but returned no transaction ID. ' +
  'Check your wallet before paying again.';

/** Every guard refusal the route sends as 503 starts with this. */
const SERVER_GUARD_503_PREFIX = 'Could not verify previous payments';

/** One obligation either guard found already paid — enough to take it out of the batch. */
export interface AlreadyPaid {
  proposalId: string;
  service: string;
  txId: string;
  via: string;
}

/** The browser's own read of this payer's KIND 90901 (relayRead.ts). */
export interface PriorConfirmationsRead {
  /** Relays that sent a real EOSE. Empty = this device learned nothing. */
  answered: string[];
  events: ConfirmationEvent[];
}

/** The route's answer, before any interpretation. */
export interface SendResponse {
  /** HTTP status; null when no response came back at all. */
  status: number | null;
  /** Parsed JSON body; undefined when there was none, or it was not JSON. */
  body: unknown;
  /** Set when the request itself failed. */
  networkError?: string;
}

export type SendOutcome =
  | { kind: 'sent'; txid: string }
  | { kind: 'already-paid'; alreadyPaid: AlreadyPaid[] }
  | { kind: 'unverifiable' }
  | { kind: 'failed'; message: string };

/**
 * Only the route's two guard refusals may be read as "nothing was sent", and
 * only because both return before sendBatchLanaTransaction is ever called
 * (scripts/testPaymentServerDecides.ts reads the route to keep that true).
 * They are recognised by the route's own JSON, never by a status code alone:
 * a 503 or 504 from the proxy in front of the app says nothing about whether
 * the transaction went out, so it gets no promise about the money either way.
 */
export function classifySendResponse(response: SendResponse): SendOutcome {
  if (response.networkError !== undefined || response.status === null) {
    return { kind: 'failed', message: response.networkError || 'Payment transaction failed' };
  }

  const body = response.body && typeof response.body === 'object'
    ? (response.body as Record<string, unknown>)
    : {};
  const error = typeof body.error === 'string' ? body.error : '';

  if (response.status === 409 && body.success === false && Array.isArray(body.duplicates) && body.duplicates.length > 0) {
    return {
      kind: 'already-paid',
      alreadyPaid: body.duplicates.map((d: any) => ({
        proposalId: String(d?.proposalId || ''),
        service: String(d?.service || ''),
        txId: String(d?.txId || ''),
        via: String(d?.via || ''),
      })),
    };
  }

  if (response.status === 503 && body.success === false && error.startsWith(SERVER_GUARD_503_PREFIX)) {
    return { kind: 'unverifiable' };
  }

  if (response.status >= 200 && response.status < 300 && body.success === true) {
    const txid = typeof body.txid === 'string' ? body.txid : '';
    return txid ? { kind: 'sent', txid } : { kind: 'failed', message: PAYMENT_STATUS_UNKNOWN_MESSAGE };
  }

  return { kind: 'failed', message: error || 'Payment transaction failed' };
}

export interface GuardAndSendSteps {
  /** This device's read of the payer's confirmations — retried, never throws. */
  readPriorConfirmations: () => Promise<PriorConfirmationsRead>;
  /** Prepares the outputs and asks the route to pay. Called at most once. */
  send: () => Promise<SendResponse>;
  /** The line under the button; null clears it. */
  onProgress?: (text: string | null) => void;
}

export type GuardAndSendResult =
  /** Broadcast. deviceReachedRelays: whether THIS device could talk to any relay. */
  | { kind: 'sent'; txid: string; deviceReachedRelays: boolean }
  /** Nothing was sent: these are paid already. */
  | { kind: 'already-paid'; alreadyPaid: AlreadyPaid[]; foundBy: 'device' | 'server' }
  /** Nothing was sent: the server could not verify, so it refused. */
  | { kind: 'refused'; message: string }
  /** Anything else — no claim about the money either way. */
  | { kind: 'failed'; message: string };

export async function guardAndSend(
  selected: SelectedObligation[],
  steps: GuardAndSendSteps,
): Promise<GuardAndSendResult> {
  const prior = await steps.readPriorConfirmations();
  const deviceReachedRelays = prior.answered.length > 0;

  if (deviceReachedRelays) {
    const matches = findDuplicateConfirmations(selected, prior.events);
    if (matches.length > 0) {
      return {
        kind: 'already-paid',
        foundBy: 'device',
        alreadyPaid: matches.map((m) => ({
          proposalId: m.obligation.proposalId,
          service: m.obligation.service,
          txId: m.txId,
          via: m.via,
        })),
      };
    }
  } else {
    // Not a verdict. The route reads the same relays for the same payer with
    // the same matcher, and refuses by itself when it cannot.
    steps.onProgress?.(SERVER_CHECKS_PROGRESS);
  }

  const outcome = classifySendResponse(await steps.send());
  switch (outcome.kind) {
    case 'sent':
      return { kind: 'sent', txid: outcome.txid, deviceReachedRelays };
    case 'already-paid':
      return { kind: 'already-paid', foundBy: 'server', alreadyPaid: outcome.alreadyPaid };
    case 'unverifiable':
      return { kind: 'refused', message: GUARD_UNVERIFIABLE_MESSAGE };
    default:
      return { kind: 'failed', message: outcome.message };
  }
}

/* ─── Delivering the payment confirmations ─────────────────────────────────── */

export interface RelayPublishResult {
  proposalId: string;
  relay: string;
  success: boolean;
  error?: string;
}

export interface DeliverySteps<Item, Signed> {
  /** Signs one confirmation. A throw means that one cannot be delivered. */
  sign: (item: Item) => Signed;
  /** Saves it in the server's retry queue; true only when the server said so. */
  queue: (event: Signed) => Promise<boolean>;
  /** Publishes from this device; one result per relay. */
  publishFromDevice: (event: Signed, item: Item) => Promise<RelayPublishResult[]>;
  /** Asks our server to publish it now; true when a relay accepted it. */
  publishFromServer: (event: Signed) => Promise<boolean>;
  queueTimeoutMs?: number;
  serverPublishTimeoutMs?: number;
}

/**
 * How the confirmations travelled, worst case across the batch:
 *   device      — every one landed on a relay from this device (the old page);
 *   server      — our server published what the device could not;
 *   queued      — saved on the server, which is still delivering it;
 *   undelivered — at least one was neither delivered nor saved.
 */
export type DeliveryMode = 'device' | 'server' | 'queued' | 'undelivered';

export interface DeliveryReport {
  mode: DeliveryMode;
  total: number;
  deliveredByDevice: number;
  deliveredByServer: number;
  savedForServer: number;
  undelivered: number;
  relayResults: RelayPublishResult[];
}

/** Resolves with the promise's value, or `fallback` on a throw or after `ms`. */
function settle<T>(promise: Promise<T>, ms: number | undefined, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    let done = false;
    const finish = (value: T) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      resolve(value);
    };
    const timer = ms === undefined ? null : setTimeout(() => finish(fallback), ms);
    promise.then(finish, () => finish(fallback));
  });
}

export async function deliverConfirmations<Item, Signed>(
  items: Item[],
  deviceReachedRelays: boolean,
  steps: DeliverySteps<Item, Signed>,
): Promise<DeliveryReport> {
  const queueTimeoutMs = steps.queueTimeoutMs ?? 10_000;
  const serverPublishTimeoutMs = steps.serverPublishTimeoutMs ?? 15_000;

  const events: (Signed | null)[] = items.map((item) => {
    try { return steps.sign(item); } catch { return null; }
  });

  // 1. Saved on the server before anything slow: once saved, a confirmation
  //    can no longer be lost to a closed page or a dead socket. The insert is
  //    idempotent on the event id, so a second try after a timeout is safe.
  const queueOnce = (event: Signed) =>
    settle(Promise.resolve().then(() => steps.queue(event)), queueTimeoutMs, false);
  const queued = await Promise.all(
    events.map(async (event) => event !== null && ((await queueOnce(event)) || (await queueOnce(event)))),
  );

  // 2. From the device — unless it just failed to reach every relay after all
  //    of its retries, where each attempt would only burn a timeout.
  const relayResults: RelayPublishResult[] = [];
  const byDevice = events.map(() => false);
  if (deviceReachedRelays) {
    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      if (event === null) continue;
      const results = await settle(
        Promise.resolve().then(() => steps.publishFromDevice(event, items[i])),
        undefined,
        [] as RelayPublishResult[],
      );
      relayResults.push(...results);
      byDevice[i] = results.some((r) => r.success);
    }
  }

  // 3. Our server publishes, now, whatever the device did not land.
  const byServer = await Promise.all(
    events.map((event, i) =>
      event === null || byDevice[i]
        ? Promise.resolve(false)
        : settle(Promise.resolve().then(() => steps.publishFromServer(event)), serverPublishTimeoutMs, false),
    ),
  );

  let deliveredByDevice = 0;
  let deliveredByServer = 0;
  let savedForServer = 0;
  let undelivered = 0;
  events.forEach((event, i) => {
    if (event !== null && byDevice[i]) deliveredByDevice++;
    else if (event !== null && byServer[i]) deliveredByServer++;
    else if (event !== null && queued[i]) savedForServer++;
    else undelivered++;
  });

  const mode: DeliveryMode =
    undelivered > 0 ? 'undelivered'
      : savedForServer > 0 ? 'queued'
        : deliveredByServer > 0 ? 'server'
          : 'device';

  return { mode, total: items.length, deliveredByDevice, deliveredByServer, savedForServer, undelivered, relayResults };
}

export interface DeliveryDescription {
  /** Replaces "Transaction confirmed and published to Nostr relays". */
  subtitle: string;
  title: string;
  detail: string;
}

/**
 * What the result page says about the confirmation. null for 'device': that
 * page — per-relay results and all — was already true for it.
 */
export function describeConfirmationDelivery(mode: DeliveryMode | undefined): DeliveryDescription | null {
  switch (mode) {
    case 'server':
      return {
        subtitle: 'Transaction sent — the payment confirmation was delivered by our server',
        title: 'Payment confirmation delivered by our server',
        detail:
          'This device could not deliver the payment confirmation to the Nostr relays itself, ' +
          'so our server delivered it for you. Recipients can verify the payment on the network.',
      };
    case 'queued':
      return {
        subtitle: 'Transaction sent — the payment confirmation is being delivered by our server',
        title: 'Payment confirmation on its way',
        detail:
          'Your payment went through. This device could not deliver the payment confirmation to the Nostr relays itself, ' +
          'so our server has saved it and is delivering it. Until it arrives — usually within a few minutes — ' +
          'these payments can still show as unpaid. Do not pay them again; you can follow the confirmation under Relay Retry.',
      };
    case 'undelivered':
      return {
        subtitle: 'Transaction sent — the payment confirmation is not delivered yet',
        title: 'Payment confirmation not delivered yet',
        detail:
          'Your payment went through, but its confirmation could not be delivered to the Nostr relays or saved on our server, ' +
          'so these payments may still show as unpaid. Do not pay them again — keep the transaction ID below and let us know.',
      };
    default:
      return null;
  }
}
