/**
 * A device that cannot reach any relay must not be what blocks a payment —
 * and nothing about "we never pay without the check" may get weaker for it.
 *
 *   npx tsx scripts/testPaymentServerDecides.ts
 *
 * 2026-09-17: a payer on an iPhone, on WiFi, was refused three times in a row
 * ("No relay answered — trying again (3 of 3)") while 41 other payers
 * confirmed 294 payments through the same page on the same relays. Her
 * network blocks WebSocket connections to all four relays; the app reaches
 * its own server fine. The server route runs the same duplicate guard, from a
 * data centre, and fails closed on its own (409 duplicate / 503 unverifiable)
 * before anything is broadcast. So the browser hands the decision over instead
 * of refusing — and everything below is what must hold for that to be safe:
 *
 *   - no relay answers the device        → the server is asked, not refused;
 *   - the server finds a duplicate (409) → shown, removed, nothing sent;
 *   - the server cannot verify (503)     → refused, "nothing was sent";
 *   - a 503 that is NOT the guard's      → no claim about the money at all;
 *   - the device CAN read and finds one  → refused before the key leaves;
 *   - after the money moves, a device that cannot publish still gets its
 *     confirmation onto the relays (saved on the server first, published by
 *     the server now), and the result page says which of those happened.
 */
import { readFileSync } from 'node:fs';

let failures = 0;
const check = (name: string, cond: boolean, detail?: unknown) => {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail)?.slice(0, 240) : ''); }
};

const secondsOf = (iso: string) => Math.floor(Date.parse(iso) / 1000);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const SEPT = {
  proposalId: 'ev-sept',
  proposalDTag: 'sub:lana:2026-09:aaaaaaaa:bbbbbbbbbbbb',
  recipientWallet: 'LWalletOfTheRecipient000000000000',
  service: 'https://selfresponsible.life/',
  proposalCreatedAt: secondsOf('2026-09-09T00:18:00Z'),
};
const PAID_SEPT = {
  id: 'conf-sept',
  created_at: secondsOf('2026-09-10T08:00:00Z'),
  tags: [
    ['proposal', SEPT.proposalDTag],
    ['to_wallet', SEPT.recipientWallet],
    ['service', SEPT.service],
    ['tx', 'ab'.repeat(32)],
  ],
};

const NO_RELAY_ANSWERED = { answered: [] as string[], events: [] as typeof PAID_SEPT[] };
const ANSWERED_NOTHING_PAID = { answered: ['wss://relay.lanavault.space'], events: [] as typeof PAID_SEPT[] };
const ANSWERED_ALREADY_PAID = { answered: ['wss://relay.lanavault.space'], events: [PAID_SEPT] };

// What the route really answers (server/routes/functions.ts, /send-unconditional-payment).
const SENT = { status: 200, body: { success: true, txid: 'f'.repeat(64), totalAmount: 1, fee: 0 } };
const DUPLICATE_409 = {
  status: 409,
  body: {
    success: false,
    error: `Already paid: "${SEPT.service}" (tx abababababab…) — refresh the pending list before paying.`,
    duplicates: [{ proposalId: SEPT.proposalId, proposalDTag: SEPT.proposalDTag, service: SEPT.service, txId: 'ab'.repeat(32), via: 'proposal reference' }],
  },
};
const UNVERIFIED_503 = { status: 503, body: { success: false, error: 'Could not verify previous payments — no relay answered. Try again.' } };
const NO_RELAY_LIST_503 = { status: 503, body: { success: false, error: 'Could not verify previous payments — no relays configured. Try again.' } };
const PROXY_503 = { status: 503, body: undefined };
const PROXY_504 = { status: 504, body: undefined };
const SERVER_500 = { status: 500, body: { success: false, error: 'Electrum call timed out' } };
const NETWORK_DOWN = { status: null, body: undefined, networkError: 'Load failed' };
const SENT_WITHOUT_TXID = { status: 200, body: { success: true } };

async function main() {
  let flow: any = null;
  try {
    flow = await import('../src/lib/unconditionalPaymentFlow.js');
  } catch (e) {
    check('the payment flow lives in src/lib/unconditionalPaymentFlow.ts, where it can be tested', false, String(e));
  }

  if (flow) {
    const run = async (read: unknown, response: unknown) => {
      const progress: (string | null)[] = [];
      let sends = 0;
      const result = await flow.guardAndSend([SEPT], {
        readPriorConfirmations: async () => read,
        send: async () => { sends++; return response; },
        onProgress: (text: string | null) => progress.push(text),
      });
      return { result, sends, progress };
    };

    console.log('— no relay answers the device: the server is asked instead of refusing —');
    {
      const { result, sends, progress } = await run(NO_RELAY_ANSWERED, SENT);
      check('the payment request goes to the server', sends === 1, { sends });
      check('and the payment goes through when the server verifies it', result.kind === 'sent' && result.txid === SENT.body.txid, result);
      check('the page knows this device reached no relay', result.kind === 'sent' && result.deviceReachedRelays === false, result);
      check('the wait says the server is checking — not "no relay answered"',
        progress.some((p) => typeof p === 'string' && /server/i.test(p) && !/no relay answered/i.test(p)), progress);
    }

    console.log('\n— …and the server still refuses a duplicate (409): shown, nothing sent —');
    {
      const { result, sends } = await run(NO_RELAY_ANSWERED, DUPLICATE_409);
      check('asked the server once', sends === 1, { sends });
      check('reported as already paid, not as sent', result.kind === 'already-paid', result);
      check('found by the server', result.foundBy === 'server', result);
      check('names the proposal so the page can take it out of the batch',
        result.alreadyPaid?.length === 1 && result.alreadyPaid[0].proposalId === SEPT.proposalId && result.alreadyPaid[0].service === SEPT.service, result);
      check('carries the existing transaction', result.alreadyPaid?.[0]?.txId === 'ab'.repeat(32), result);
    }

    console.log('\n— …and the server still refuses when IT cannot verify (503): "nothing was sent" —');
    for (const [name, response] of [['no relay answered the server', UNVERIFIED_503], ['server has no relay list', NO_RELAY_LIST_503]] as const) {
      const { result } = await run(NO_RELAY_ANSWERED, response);
      check(`${name}: refused`, result.kind === 'refused', result);
      check(`${name}: says nothing was sent`, /nothing was sent/i.test(result.message || ''), result);
      check(`${name}: says no LANA has left the wallet`, /no LANA has left your wallet/i.test(result.message || ''), result);
      check(`${name}: does not blame the payer's internet`, !/check your internet/i.test(result.message || ''), result);
    }

    console.log('\n— a failure that is NOT the guard\'s makes no claim about the money —');
    for (const [name, response] of [
      ['a 503 from the proxy, not the route', PROXY_503],
      ['a gateway timeout', PROXY_504],
      ['a server error after the guard', SERVER_500],
      ['the request never got an answer', NETWORK_DOWN],
      ['"success" without a transaction id', SENT_WITHOUT_TXID],
    ] as const) {
      const { result } = await run(NO_RELAY_ANSWERED, response);
      check(`${name}: not reported as sent`, result.kind === 'failed', result);
      check(`${name}: never says "nothing was sent"`, !/nothing was sent|no LANA has left/i.test(result.message || ''), result);
    }
    {
      const { result } = await run(ANSWERED_NOTHING_PAID, SERVER_500);
      check('the server\'s own error text is passed on', result.kind === 'failed' && result.message.includes('Electrum call timed out'), result);
    }

    console.log('\n— a device that CAN read still refuses a duplicate itself, before the key leaves —');
    {
      const { result, sends } = await run(ANSWERED_ALREADY_PAID, SENT);
      check('refused as already paid', result.kind === 'already-paid' && result.foundBy === 'device', result);
      check('the server was never called — the private key stayed on the page', sends === 0, { sends });
    }

    console.log('\n— the healthy path is unchanged —');
    {
      const { result, sends, progress } = await run(ANSWERED_NOTHING_PAID, SENT);
      check('sent', result.kind === 'sent' && result.deviceReachedRelays === true, result);
      check('one request', sends === 1, { sends });
      check('no "server is checking" line for a device that could check itself',
        !progress.some((p) => typeof p === 'string' && /server/i.test(p)), progress);
    }

    // ── After the money moved ───────────────────────────────────────────────
    const items = ['sub:lana:2026-09:aaaaaaaa:111111111111', 'sub:lana:2026-09:aaaaaaaa:222222222222', 'sub:lana:2026-09:aaaaaaaa:333333333333'];
    const RELAYS = ['wss://relay.lanavault.space', 'wss://relay.lana-eternity.com'];
    const deliver = async (
      deviceReachedRelays: boolean,
      opts: {
        queue?: (e: string, n: number) => Promise<boolean>;
        device?: (e: string) => Promise<{ proposalId: string; relay: string; success: boolean; error?: string }[]>;
        server?: (e: string) => Promise<boolean>;
        sign?: (dTag: string) => string;
        queueTimeoutMs?: number;
        serverPublishTimeoutMs?: number;
      } = {},
    ) => {
      const calls: string[] = [];
      const queueAttempts = new Map<string, number>();
      const report = await flow.deliverConfirmations(items, deviceReachedRelays, {
        sign: (dTag: string) => { calls.push(`sign ${dTag}`); return opts.sign ? opts.sign(dTag) : `event:${dTag}`; },
        queue: async (e: string) => {
          const n = (queueAttempts.get(e) || 0) + 1;
          queueAttempts.set(e, n);
          calls.push(`queue ${e}`);
          return opts.queue ? opts.queue(e, n) : true;
        },
        publishFromDevice: async (e: string, dTag: string) => {
          calls.push(`device ${e}`);
          return opts.device ? opts.device(e) : RELAYS.map((relay) => ({ proposalId: dTag, relay, success: true }));
        },
        publishFromServer: async (e: string) => {
          calls.push(`server ${e}`);
          return opts.server ? opts.server(e) : true;
        },
        queueTimeoutMs: opts.queueTimeoutMs ?? 2000,
        serverPublishTimeoutMs: opts.serverPublishTimeoutMs ?? 2000,
      });
      return { report, calls, queueAttempts };
    };
    const honest = (mode: string) => flow.describeConfirmationDelivery(mode);

    console.log('\n— a device that cannot reach relays: our server delivers the confirmation now —');
    {
      const { report, calls } = await deliver(false);
      check('every confirmation saved on the server', calls.filter((c) => c.startsWith('queue')).length === items.length, calls);
      check('the device does not burn a timeout on relays it just failed to reach 3 times', !calls.some((c) => c.startsWith('device')), calls);
      check('the server publishes every one of them', calls.filter((c) => c.startsWith('server')).length === items.length, calls);
      check('reported as delivered by the server', report.mode === 'server' && report.deliveredByServer === items.length, report);
      check('no relay table full of errors', report.relayResults.length === 0, report.relayResults);
      const text = honest('server');
      check('the page says the server delivered it', !!text && /server/i.test(`${text.title} ${text.detail}`), text);
      check('and does not say this device published it', !!text && !/published to Nostr relays/i.test(`${text.subtitle} ${text.title} ${text.detail}`), text);
    }

    console.log('\n— queued but not yet published: an honest success —');
    {
      const { report } = await deliver(false, { server: async () => false });
      check('reported as queued on the server', report.mode === 'queued' && report.savedForServer === items.length, report);
      const text = honest('queued');
      const all = text ? `${text.subtitle} ${text.title} ${text.detail}` : '';
      check('there is a message for it', !!text, text);
      check('says the payment went through', /payment went through|transaction sent/i.test(all), all);
      check('says our server is delivering the confirmation', /server/i.test(all) && /deliver/i.test(all), all);
      check('says it can take a few minutes to show as paid', /few minutes/i.test(all), all);
      check('tells the payer not to pay again', /do not pay (them|these|it) again/i.test(all), all);
      check('does not claim it is already on the relays', !/published to Nostr relays|can now verify|has been published/i.test(all), all);
      check('does not report relay errors', !/fail|error/i.test(all), all);
    }

    console.log('\n— saved on the server BEFORE anything slow —');
    {
      const { calls } = await deliver(true, { device: async (e) => { await sleep(20); return RELAYS.map((relay) => ({ proposalId: e, relay, success: true })); } });
      const firstPublish = calls.findIndex((c) => c.startsWith('device') || c.startsWith('server'));
      const lastQueue = calls.map((c) => c.startsWith('queue')).lastIndexOf(true);
      check('every queue call happens before the first publish', lastQueue >= 0 && firstPublish > lastQueue, calls);
      check('all confirmations are signed before any is published', calls.filter((c) => c.startsWith('sign')).length === items.length
        && calls.findIndex((c) => c.startsWith('sign')) < firstPublish, calls);
    }

    console.log('\n— a device that publishes fine: unchanged —');
    {
      const { report, calls } = await deliver(true);
      check('published from the device', report.mode === 'device' && report.deliveredByDevice === items.length, report);
      check('the server is not asked to publish what already landed', !calls.some((c) => c.startsWith('server')), calls);
      check('still saved on the server as before', calls.filter((c) => c.startsWith('queue')).length === items.length, calls);
      check('the relay table is kept', report.relayResults.length === items.length * RELAYS.length, report.relayResults.length);
      check('the result page keeps its existing text', honest('device') === null, honest('device'));
    }

    console.log('\n— one confirmation the device could not land: the server lands it —');
    {
      const { report, calls } = await deliver(true, {
        device: async (e) => RELAYS.map((relay) => ({ proposalId: e, relay, success: e !== `event:${items[1]}`, error: e === `event:${items[1]}` ? 'Connection timeout (10s)' : undefined })),
      });
      check('only that one goes to the server', calls.filter((c) => c.startsWith('server')).length === 1 && calls.includes(`server event:${items[1]}`), calls);
      check('reported as partly delivered by the server', report.mode === 'server' && report.deliveredByDevice === 2 && report.deliveredByServer === 1, report);
    }

    console.log('\n— nothing on the way can hang the page after the money moved —');
    {
      const t0 = Date.now();
      const { report, queueAttempts } = await deliver(false, {
        queue: () => new Promise<boolean>(() => { /* never answers */ }),
        server: () => new Promise<boolean>(() => { /* never answers */ }),
        queueTimeoutMs: 60,
        serverPublishTimeoutMs: 60,
      });
      const took = Date.now() - t0;
      check('it finishes on its own clock', took < 1500, `${took}ms`);
      check('a queue that never answers is tried again once', [...queueAttempts.values()].every((n) => n === 2), [...queueAttempts.values()]);
      check('and is reported as not delivered — never as delivered', report.mode === 'undelivered' && report.undelivered === items.length, report);
      const text = honest('undelivered');
      const all = text ? `${text.subtitle} ${text.title} ${text.detail}` : '';
      check('undelivered still says the payment went through', /payment went through|transaction sent/i.test(all), all);
      check('and tells the payer not to pay again', /do not pay (them|these|it) again/i.test(all), all);
    }
    {
      const { report } = await deliver(false, {
        queue: async (_e, n) => { if (n === 1) throw new Error('fetch failed'); return true; },
        server: async () => false,
      });
      check('a queue call that failed once is saved by the second try', report.mode === 'queued' && report.savedForServer === items.length, report);
    }
    {
      const { report } = await deliver(false, { sign: (d) => { if (d === items[2]) throw new Error('bad key'); return `event:${d}`; } });
      check('a confirmation that could not even be signed is counted as undelivered', report.mode === 'undelivered' && report.undelivered === 1 && report.deliveredByServer === 2, report);
    }
  }

  console.log('\n— the server route really is the fail-closed chokepoint this relies on —');
  {
    const server = readFileSync(new URL('../server/routes/functions.ts', import.meta.url), 'utf8');
    const start = server.indexOf("router.post('/send-unconditional-payment'");
    const end = server.indexOf('router.post(', start + 1);
    const route = start >= 0 ? server.slice(start, end > start ? end : undefined) : '';
    const broadcast = route.indexOf('sendBatchLanaTransaction(');
    check('the route exists', start >= 0 && route.length > 0);
    check('it reads KIND 90901 for the payer', /kinds:\s*\[90901\],\s*authors:\s*\[payer_pubkey\]/.test(route));
    check('with the shared matcher', route.includes('findDuplicateConfirmations('));
    check('it refuses when no relay answered', /answered\.length === 0\)[\s\S]{0,80}status\(503\)/.test(route));
    check('every 503 happens before the broadcast', broadcast > 0 && [...route.matchAll(/status\(503\)/g)].every((m) => (m.index ?? 0) < broadcast));
    check('the 409 happens before the broadcast', broadcast > 0 && route.indexOf('status(409)') > 0 && route.indexOf('status(409)') < broadcast);
    check('the 409 lists the duplicates', /status\(409\)[\s\S]{0,300}duplicates:/.test(route));
    const refusals = [...route.matchAll(/status\(503\)\.json\(\{[^}]*error:\s*'([^']*)'/g)].map((m) => m[1]);
    check('every 503 message is one the page recognises as the guard\'s',
      refusals.length >= 2 && refusals.every((m) => m.startsWith('Could not verify previous payments')), refusals);
    check('no request without the payer and the proposals gets past it', /!payer_pubkey \|\| !Array\.isArray\(proposalRefs\) \|\| proposalRefs\.length === 0/.test(route));
  }

  console.log('\n— the page is wired to it —');
  {
    const page = readFileSync(new URL('../src/pages/unconditional-payment/ConfirmPayment.tsx', import.meta.url), 'utf8');
    const result = readFileSync(new URL('../src/pages/unconditional-payment/Result.tsx', import.meta.url), 'utf8');
    check('the page decides through guardAndSend', page.includes('guardAndSend('));
    check('the page delivers through deliverConfirmations', page.includes('deliverConfirmations('));
    check('the page no longer refuses on its own read alone', !page.includes('answered.length === 0'));
    check('the queue call is awaited, not fire-and-forget', !/queue-relay-event['"][\s\S]{0,160}\.catch\(\(\) => \{\}\)/.test(page));
    check('the server publishes what the device could not', page.includes("'publish-dm-event'"));
    check('the result page tells the payer how the confirmation travelled', result.includes('describeConfirmationDelivery('));
    check('nothing was turned into a "pay anyway"', !/pay\s*anyway/i.test(page));
  }

  if (failures > 0) {
    console.error(`\n❌ ${failures} FAILED`);
    process.exit(1);
  }
  console.log('\n✅ a device that cannot reach relays can pay; the server still refuses what it cannot verify');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
