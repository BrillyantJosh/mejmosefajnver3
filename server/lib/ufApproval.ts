/**
 * Unconditional Financing — a request is public only once an administrator has approved it,
 * and from then on what was approved is what everyone reads and funds.
 *
 * Jasna (admin) asked, Brilly confirmed, 16. 11. 2026: like 100 Million Ideas, a new request
 * is seen by nobody but its author and the administrators until an administrator approves it;
 * the author may change it until then and not after — above all not the amount.
 *
 * Approval lives in this server's database, like hiding already did: the decision is a signed
 * kind 27235 action (ufSignedAction.ts) that is never published, so no Lana kind is spent
 * (31241 stays reserved in the 31240 definition for a relay-visible moderation kind, should
 * another app ever need to read approvals from the relays).
 *
 * Why the amount holds on the READ side and not only in the form: a 31240 is addressable, and
 * its author can publish a new version straight to the relays at any time. So:
 *   • approval pins the version it was given for — its event id, amount and currency
 *     (approved_event_id, approved_fiat_goal, approved_currency);
 *   • every writer (the route and the relay re-index) refuses a later version that changes
 *     anything an approval covers (frozenContent below). The one thing that may still change
 *     is the receiving wallet, and only to another of the owner's OWN registered wallets
 *     (ufWallet.ts, Brilly 11. 11. 2026) — money can only ever land with the owner;
 *   • every reader asks approvalHolds(): approved, AND the amount and currency stored are still
 *     the ones pinned. Should they ever differ, the request reads as NOT approved — out of the
 *     lists and not fundable — until an administrator looks at it again (fail-closed).
 *
 * Archived = the existing is_hidden flag (an administrator's signed set-hidden action):
 * out of every public list and not fundable, and reversible. Repayments stay possible —
 * an archived request's financiers are still owed.
 *
 * "Not fundable" is decided by the request's STATE when a contribution is counted (the route
 * refuses it, the relay re-index leaves it for a later scan), not by comparing dates with the
 * approval. That is deliberate: approvals live in this database only, and a database rebuilt
 * from the relays knows none of them — every request waits for approval again. When an
 * administrator approves it again, its real contributions must come back on the next scan, not
 * be refused for good as "older than the approval". For the same reason approval does not move
 * the maturing window. The price: a contribution someone publishes straight to the relays while
 * a request waits (the app never lets anyone pay it) is counted once the request is approved —
 * it stands for money that really reached the owner's wallet. Refusing those for good needs the
 * approval on the relays (31241), which a rebuilt database could read back.
 */

/** Marker in approved_by for requests that existed before approval did (16. 11. 2026). */
export const UF_GRANDFATHERED = 'grandfathered';

/** Everything an approval covers: what readers show and financiers rely on. Not the wallet. */
export interface UfFrozenContent {
  title: string;
  shortDesc: string;
  content: string;
  requestType: string;
  fiatGoal: number;
  currency: string;
  coverImage: string | null;
  galleryImages: string[];
  crowdfundingRefs: string[];
  status: string;
}

const parseList = (v: unknown): string[] => {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === 'string') { try { const a = JSON.parse(v); return Array.isArray(a) ? a.map(String) : []; } catch { return []; } }
  return [];
};

/** The frozen part of a stored row. */
export function frozenContentOfRow(row: any): UfFrozenContent {
  return {
    title: row.title ?? '',
    shortDesc: row.short_desc ?? '',
    content: row.content ?? '',
    requestType: row.request_type ?? '',
    fiatGoal: Number(row.fiat_goal) || 0,
    currency: row.currency ?? '',
    coverImage: row.cover_image || null,
    galleryImages: parseList(row.gallery_images),
    crowdfundingRefs: parseList(row.crowdfunding_refs),
    status: row.status ?? '',
  };
}

/** Same amount: both sides come from parseFloat of a tag, so equal means equal; the slack only absorbs float noise. */
const sameAmount = (a: number, b: number) => Math.abs((Number(a) || 0) - (Number(b) || 0)) < 1e-9;
const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i]);

export function sameFrozenContent(a: UfFrozenContent, b: UfFrozenContent): boolean {
  return a.title === b.title
    && a.shortDesc === b.shortDesc
    && a.content === b.content
    && a.requestType === b.requestType
    && sameAmount(a.fiatGoal, b.fiatGoal)
    && a.currency === b.currency
    && (a.coverImage || null) === (b.coverImage || null)
    && sameList(a.galleryImages, b.galleryImages)
    && sameList(a.crowdfundingRefs, b.crowdfundingRefs)
    && a.status === b.status;
}

/** Was this row ever approved (whether or not the approval still holds)? */
export const wasApproved = (row: any): boolean => !!row && Number(row.approved_at) > 0;

/**
 * Does the approval still cover what the row says? Approved, and the amount and currency are
 * exactly the ones pinned. Anything else reads as not approved.
 */
export function approvalHolds(row: any): boolean {
  return wasApproved(row)
    && row.approved_currency === row.currency
    && row.approved_fiat_goal !== null && row.approved_fiat_goal !== undefined
    && sameAmount(row.approved_fiat_goal, row.fiat_goal);
}

/** The same rule as approvalHolds, for a WHERE clause on uf_requests aliased `r`. */
export const APPROVAL_HOLDS_SQL =
  'r.approved_at > 0 AND r.approved_fiat_goal IS NOT NULL AND r.approved_fiat_goal = r.fiat_goal AND r.approved_currency = r.currency';

/** What the public may see: approved, not archived, not a draft. */
export const PUBLIC_REQUEST_SQL = `r.status != 'draft' AND r.is_hidden = 0 AND ${APPROVAL_HOLDS_SQL}`;

/**
 * A later version of an APPROVED request: may it be written? Only when it changes nothing an
 * approval covers (the receiving wallet is judged separately, by ufWallet.ts).
 */
export function editAllowedAfterApproval(existingRow: any, incoming: UfFrozenContent): boolean {
  if (!wasApproved(existingRow)) return true;
  return sameFrozenContent(frozenContentOfRow(existingRow), incoming);
}

export interface FundingRefusal {
  code: 'NOT_APPROVED' | 'ARCHIVED' | 'DRAFT';
  error: string;
}

/**
 * May a NEW contribution be counted for this request right now? (The maturing window is checked
 * on top of this, as before.) Not for one awaiting approval, nor an archived one, nor a draft.
 */
export function fundingRefusal(row: any): FundingRefusal | null {
  if (row?.status === 'draft') return { code: 'DRAFT', error: 'This request is a draft and cannot be funded' };
  if (!approvalHolds(row)) return { code: 'NOT_APPROVED', error: 'This request is waiting for an administrator to approve it and cannot be funded yet' };
  if (row.is_hidden) return { code: 'ARCHIVED', error: 'This request is archived and cannot be funded' };
  return null;
}
