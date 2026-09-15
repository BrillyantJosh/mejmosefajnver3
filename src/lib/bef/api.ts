/**
 * The BEF Explorer API, called from this browser across origins.
 *
 * Ported from bef-explorer src/lib/api.ts (personRequest, the person, interest
 * and cards calls, and the public reads the calculator makes), with a base URL
 * and the rules a call to another site needs:
 *   - only a method and path in ./base.ts BEF_ROUTES is ever sent;
 *   - no cookies (credentials: 'omit'), no redirects followed, no referrer, no
 *     cache — a person's session travels only in the x-person-token header;
 *   - every call has a time limit, and a publish whose answer never came is
 *     said as "may have gone through", never as "failed".
 *
 * Every refusal arrives as a BefApiError whose `code` is BEF's own `error`
 * word, or 'network' / 'timeout' / 'rate_limited' when no usable answer came;
 * ./problems.ts turns codes into words. Nothing raw from BEF reaches a reader.
 *
 * Pure: the base and fetch are passed in, so scripts/testBef.ts drives it with
 * a fake fetch. ./config.ts makes the app's one client.
 */
import { isBefRoute, type BefMethod } from './base';
import type { InterestCurrency, InterestLimitError, InterestRound, InterestStatus } from './vendor/server/lib/interestEvent.ts';

export const BEF_TOKEN_HEADER = 'x-person-token';

/** How long each call may take before it counts as unanswered. A sign-in asks
 * the Lana Registrar; a publish waits for every relay (up to 10 s each on BEF);
 * a registration can wait on the Registrar three times and then the relays. */
export const BEF_TIMEOUTS = {
  read: 20_000,
  session: 45_000,
  cardStatus: 30_000,
  publish: 55_000,
  register: 90_000,
  logout: 10_000,
} as const;

/** Who is signed in, as BEF read it from the verified KIND 0 profile. BEF also
 * sends the e-mail and phone; they are dropped here and never kept. */
export interface BefPerson {
  hex: string;
  name: string | null;
  displayName: string | null;
  country: string | null;
  /** The wallet as the Lana Registrar knows it (the registered address form). */
  wallet: string;
}

export interface BefChallenge {
  challenge: string;
  sessionUrl: string;
  registerUrl: string;
  /** Unix SECONDS on BEF's clock. */
  serverTime: number;
}

export interface BefSession {
  token: string;
  hex: string;
  /** Milliseconds, on BEF's clock. */
  expiresAt: number;
  serverTime: number;
  person: BefPerson;
}

export interface BefMe {
  hex: string;
  expiresAt: number;
  serverTime: number;
  person: BefPerson;
}

/* ------------------------------------------------------------ interest -- */

export type CurrencyAmounts = Record<InterestCurrency, number | null>;

export interface InterestWindowRound {
  round: number;
  open: boolean;
  /** KIND 38888 round size per currency: null = not published, 0 = not offered. */
  size: CurrencyAmounts;
  perPerson?: CurrencyAmounts;
}

export interface InterestWindow {
  split: number;
  scope: 'current' | 'next';
  open: boolean;
  rounds: InterestWindowRound[];
  capacity: CurrencyAmounts;
}

export interface InterestWindows {
  currentSplit: number | null;
  /** The KIND 38888 event whose limits apply — signed into every interest. */
  paramsEventId: string;
  windows: InterestWindow[];
}

export interface InterestView {
  split: number;
  currency: InterestCurrency;
  rounds: InterestRound[];
  total: number;
  status: InterestStatus;
  eventId: string;
  createdAt: number;
  receivedAt: string;
  relaysAccepted: number | null;
  relaysTotal: number | null;
}

export interface InterestSubmitResult {
  interest: InterestView;
  relays: { accepted: number; total: number };
}

/* --------------------------------------------------------------- cards -- */

export type CardStatus = 'free' | 'yours' | 'taken' | 'own' | 'brought_you';

export interface CardView {
  hex: string;
  addedAt: string;
  name: string | null;
}

export interface CardListView {
  eventId: string;
  createdAt: number;
  receivedAt: string;
  relaysAccepted: number;
  relaysTotal: number;
  cards: CardView[];
}

export interface CardsMine {
  listedAsCard: boolean;
  allowance: { max: number; used: number; remaining: number; nextSlotAt: string | null };
  list: CardListView | null;
}

export interface CardPublishResult {
  list: CardListView;
  relays: { accepted: number; total: number };
  added: string[];
  removed: string[];
}

/* ------------------------------------------------- calculator (public) -- */

export interface SourceNote {
  label: string;
  detail?: string;
  fetchedAt?: string;
}

export interface Bootstrap {
  ok: boolean;
  notice: string;
  currentSplit: number | null;
  splitApproaching: boolean;
  rates: Record<string, number> | null;
  ratesSource: SourceNote | null;
  settings: { splitMultiplier: number; carryStatus: string; carryNote: string };
  directFund: { fetchedAt: string } | null;
}

export interface SplitRoundView {
  round: number;
  enabled: boolean;
  status: string;
  feePercent: number | null;
  buyFeePercent: number | null;
  raisedFiat: number | null;
  maxFiat: number | null;
  sizeIsPublished: boolean;
  maxPerPerson?: number | null;
  sizeConflict: boolean;
  investors: number | null;
  boughtLana: number | null;
  maxLana: number | null;
  percentFilled: number | null;
  indicativeReturnPercent: number | null;
  offerPrice: number | null;
  offerPriceIsPublished: boolean;
}

export interface SplitsResponse {
  notice: string;
  current: {
    number: number;
    status: string;
    effectiveDate: string | null;
    splitApproaching: boolean;
    maxInvestment: Record<string, number | null>;
    referencePrices?: Record<string, number> | null;
    priceMultipleVsPrevious?: Record<string, number> | null;
    durationMonths?: number | null;
    durationIsRunning?: boolean;
    byCurrency: Record<string, SplitRoundView[]>;
  } | null;
  next: {
    number: number;
    status: string;
    expectedDate: string | null;
    expectedDateIsEstimate: boolean;
    note: string | null;
    maxInvestment: Record<string, number | null>;
    byCurrency: Record<
      string,
      {
        round: number;
        plannedMaxAmount: number | null;
        maxPerPerson?: number | null;
        buyFeePercent: number | null;
        sellFeePercent: number | null;
        indicativeReturnPercent: number | null;
        plannedIsPublished: boolean;
        status: string;
      }[]
    >;
  } | null;
  historical: {
    number: number;
    completedDate: string | null;
    note: string | null;
    referencePrices?: Record<string, number> | null;
    durationMonths?: number | null;
    results: { round: number; currency: string; boughtAmount: number | null; realizedPercent: number | null; source: string | null }[];
  }[];
  sources: SourceNote[];
}

export interface Company {
  id: number;
  role: 'seller' | 'treasury';
  name: string;
  jurisdiction: string | null;
  country_code: string | null;
  asset: string;
  currency: string;
  currencies: string[];
  addresses?: { label: string | null; address: string }[];
  conditions: string | null;
  eligibility: string | null;
  website: string | null;
  status: string;
  source: string | null;
  published_at: string | null;
  last_verified: string | null;
  enabled: number;
  ord: number;
  self_published?: boolean;
}

export interface ScenarioParams {
  amount: number;
  currency: string;
  round: number;
  split?: 'current' | 'next';
  sellerId?: number | null;
  treasuryId?: number | null;
}

export interface ScenarioResponse {
  notice: string;
  input: { amount: number; currency: string; round: number; sellerId: number | null; treasuryId: number | null; split: 'current' | 'next' };
  currentSplit: number | null;
  purchaseSplit: number | null;
  saleSplit: number | null;
  result: {
    amount: number;
    rate: number;
    commissionPercent: number;
    splitMultiplier: number;
    feePercent: number;
    purchasePrice: number;
    purchasePriceIsPublished: boolean;
    lanaQty: number;
    lanaValue: number;
    postSplitRate: number;
    salePrice: number;
    salePriceIsPublished: boolean;
    saleGross: number;
    feeAmount: number;
    saleNet: number;
    difference: number;
    differencePercent: number;
  };
  statuses: { round: string; carry: string; purchaseLeg: string; saleLeg: string; seller: string | null; treasury: string | null };
  carryNote: string;
  limits: {
    applied: { label: string; amount: number }[];
    binding: { label: string; amount: number } | null;
    personLanaCap: { lana: number; exceeded: boolean; equivalentAmount: number | null } | null;
  };
  assumptions: { key: string; vars: Record<string, string | number>; text: string }[];
  sources: SourceNote[];
}

/* -------------------------------------------------------------- errors -- */

/** What a refusal may carry besides its code (BEF src/lib/api.ts PersonErrorBody). */
export interface BefErrorBody {
  error?: string;
  /** Sign-in gate and registration: the wallet as the Registrar knows it. */
  address?: string;
  /** Sign-in gate: whether the key already has a profile. */
  profile?: 'found' | 'not_found';
  /** Registration: which profile field BEF refused. */
  field?: string;
  detail?: string;
  /** Interest: the limits the amounts did not fit. */
  errors?: InterestLimitError[];
  accepted?: number;
  total?: number;
  /** Cards: the card ids a list was refused for. */
  cards?: string[];
  max?: number;
  remaining?: number;
  nextSlotAt?: string | null;
  /** Interest: the KIND 38888 event that applies now. */
  paramsEventId?: string;
  /** Scenario, amount_above_limit. */
  limit?: number;
  limitLabel?: string;
  currency?: string;
  serverTime?: number;
}

export class BefApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly body: BefErrorBody = {},
  ) {
    super(code);
  }
}

/** What a request without an answer is called: a publish that left the browser
 * may have happened even though nothing came back. */
export type UnknownOutcome = 'outcome_unknown' | 'registration_outcome_unknown';

export interface BefRequestOptions {
  method?: BefMethod;
  token?: string | null;
  body?: unknown;
  timeoutMs?: number;
  /** Set on a publish: no answer is `outcome_unknown`, not `network`. */
  unknownOutcome?: UnknownOutcome;
  /** Send even while the page unloads (logout). */
  keepalive?: boolean;
}

/* --------------------------------------------------------------- clock -- */

/** A server timestamp in milliseconds, whichever unit it came in. Seconds stay
 * below 1e11 until the year 5138 (BEF src/lib/api.ts timestampMs). */
export const timestampMs = (value: number): number => (value < 1e11 ? value * 1000 : value);

/** BEF's expiry restated on this device's clock (ms), so a device set hours off
 * is not signed out the moment it signs in. Port of BEF src/lib/api.ts:536. */
export const localExpiryMs = (expiresAt: number, serverTime: number, now: number = Date.now()): number =>
  now + (timestampMs(expiresAt) - timestampMs(serverTime));

/** Only what the pages read; e-mail and phone are left behind here. */
export function readPerson(raw: unknown): BefPerson {
  const fields = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === 'string' ? value : null);
  return {
    hex: text(fields.hex) ?? '',
    name: text(fields.name),
    displayName: text(fields.displayName),
    country: text(fields.country),
    wallet: text(fields.wallet) ?? '',
  };
}

const withPerson = <T extends { person: BefPerson }>(answer: T): T => ({ ...answer, person: readPerson(answer.person) });

/* -------------------------------------------------------------- client -- */

export function createBefClient({
  base,
  fetchImpl,
  now = Date.now,
}: {
  base: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
}) {
  const origin = new URL(base).origin;
  const doFetch: typeof fetch = fetchImpl ?? ((input, init) => fetch(input, init));

  /* BEF's clock. Events are signed with BEF's time rather than the device's,
   * so a phone set to the wrong time can still sign. */
  let serverOffsetMs = 0;
  const noteServerTime = (serverTime: unknown, receivedAtMs: number): void => {
    if (typeof serverTime === 'number' && Number.isFinite(serverTime) && serverTime > 0) {
      serverOffsetMs = timestampMs(serverTime) - receivedAtMs;
    }
  };
  /** Now on BEF's clock, in unix seconds. */
  const serverNowSeconds = (): number => Math.floor((now() + serverOffsetMs) / 1000);

  async function request<T>(path: string, options: BefRequestOptions = {}): Promise<T> {
    const method = options.method ?? 'GET';
    const url = new URL(path, origin);
    // Only BEF itself, only a listed route: anything else never leaves the browser.
    if (url.origin !== origin || !isBefRoute(method, url.pathname)) {
      throw new BefApiError('route_not_allowed', 0);
    }
    const headers: Record<string, string> = { accept: 'application/json' };
    if (method === 'POST') headers['content-type'] = 'application/json';
    if (options.token) headers[BEF_TOKEN_HEADER] = options.token;

    const unanswered = (fallback: 'network' | 'timeout') => new BefApiError(options.unknownOutcome ?? fallback, 0);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? BEF_TIMEOUTS.read);
    try {
      let res: Response;
      try {
        res = await doFetch(url.toString(), {
          method,
          headers,
          body: method === 'POST' ? JSON.stringify(options.body ?? {}) : undefined,
          mode: 'cors',
          credentials: 'omit',
          redirect: 'error',
          referrerPolicy: 'no-referrer',
          cache: 'no-store',
          keepalive: options.keepalive,
          signal: controller.signal,
        });
      } catch {
        // Across origins an nginx 502/504 page carries no CORS header and
        // arrives here too, as a TypeError: no answer either way.
        throw unanswered(controller.signal.aborted ? 'timeout' : 'network');
      }
      const receivedAt = now();
      if (res.status === 429) throw new BefApiError('rate_limited', 429);
      if (res.status === 204) return undefined as T;
      // An API path that falls through to BEF's page answers 200 with HTML, and
      // a proxy that gave up waiting answers with HTML: neither is data.
      if (!(res.headers.get('content-type') ?? '').includes('application/json')) {
        throw options.unknownOutcome && res.status >= 500 ? unanswered('network') : new BefApiError('network', res.status);
      }
      let body: (BefErrorBody & Record<string, unknown>) | null;
      try {
        body = await res.json();
      } catch {
        if (controller.signal.aborted) throw unanswered('timeout');
        throw options.unknownOutcome ? unanswered('network') : new BefApiError('network', res.status);
      }
      if (!res.ok) {
        const code = typeof body?.error === 'string' && /^[a-z_]{2,64}$/.test(body.error) ? body.error : `http_${res.status}`;
        throw new BefApiError(code, res.status, body && typeof body === 'object' ? body : {});
      }
      if (body && typeof body === 'object' && 'serverTime' in body) noteServerTime(body.serverTime, receivedAt);
      return body as T;
    } finally {
      clearTimeout(timer);
    }
  }

  const person = {
    /** A single-use challenge and the URLs the sign-in events must name. */
    challenge: () => request<BefChallenge>('/api/person/challenge'),
    /** { event } kind 27235 → a session, or the gate's refusal. */
    session: async (event: unknown) =>
      withPerson(await request<BefSession>('/api/person/session', { method: 'POST', body: { event }, timeoutMs: BEF_TIMEOUTS.session })),
    /** { event, registrarAuth, profile? } → Registrar first, then KIND 0, then a session. */
    register: async (body: { event: unknown; registrarAuth: unknown; profile?: unknown }) =>
      withPerson(
        await request<BefSession>('/api/person/register', {
          method: 'POST',
          body,
          timeoutMs: BEF_TIMEOUTS.register,
          unknownOutcome: 'registration_outcome_unknown',
        }),
      ),
    me: async (token: string) => withPerson(await request<BefMe>('/api/person/me', { token })),
    logout: (token: string, { keepalive = false }: { keepalive?: boolean } = {}) =>
      request<void>('/api/person/logout', { method: 'POST', token, keepalive, timeoutMs: BEF_TIMEOUTS.logout }),
  };

  const interest = {
    /** Public: the current and the next split, open or not, with their limits. */
    windows: () => request<InterestWindows>('/api/interest/windows'),
    mine: (token: string) => request<{ interests: InterestView[] }>('/api/interest/mine', { token }),
    /** { event } the signed KIND 30970. */
    submit: (token: string, event: unknown) =>
      request<InterestSubmitResult>('/api/interest', {
        method: 'POST',
        token,
        body: { event },
        timeoutMs: BEF_TIMEOUTS.publish,
        unknownOutcome: 'outcome_unknown',
      }),
  };

  const cards = {
    mine: (token: string) => request<CardsMine>('/api/cards/mine', { token }),
    /** A POST, so a card's id never sits in a URL or a request log. */
    status: (token: string, hex: string, profile = false) =>
      request<{ status: CardStatus; profile?: { found: boolean | null; name: string | null } }>('/api/cards/status', {
        method: 'POST',
        token,
        body: profile ? { hex, profile: true } : { hex },
        timeoutMs: BEF_TIMEOUTS.cardStatus,
      }),
    /** The signed KIND 30971, and the id of the list it was built on (null for a first list). */
    publish: (token: string, event: unknown, baseEventId: string | null) =>
      request<CardPublishResult>('/api/cards', {
        method: 'POST',
        token,
        body: { event, baseEventId },
        timeoutMs: BEF_TIMEOUTS.publish,
        unknownOutcome: 'outcome_unknown',
      }),
  };

  /** What the calculator reads. BEF is the single mathematical authority: the
   * module shows what these return and never recomputes a scenario. */
  const figures = {
    bootstrap: () => request<Bootstrap>('/api/bootstrap'),
    splits: () => request<SplitsResponse>('/api/splits'),
    companies: (role?: 'seller' | 'treasury') => request<{ companies: Company[] }>(`/api/companies${role ? `?role=${role}` : ''}`),
    scenario: (params: ScenarioParams) => {
      const q = new URLSearchParams({
        amount: String(params.amount),
        currency: params.currency,
        round: String(params.round),
        split: params.split ?? 'current',
      });
      if (params.sellerId) q.set('sellerId', String(params.sellerId));
      if (params.treasuryId) q.set('treasuryId', String(params.treasuryId));
      return request<ScenarioResponse>(`/api/scenario?${q}`);
    },
  };

  return { base: origin, request, noteServerTime, serverNowSeconds, person, interest, cards, figures };
}

export type BefClient = ReturnType<typeof createBefClient>;
