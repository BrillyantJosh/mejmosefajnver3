# Proposal: a stable identity for unconditional-payment obligations (KIND 90900)

*Status: proposal only. The generator lives in the **`lana-subscriptions`** repo
(`server/lib/billing.ts`), not here — mejmosefajnver3 only reads 90900/90901.*

## Correction: payer `9b1267aa…` was NOT double-charged

The investigation started from the premise that this payer paid one batch of 7 obligations
twice, ~15 h apart (`bbea05f8…` then `d3714d99…`, identical amounts). Reading the d-tags
disproves it: the timestamp inside each `d` dates the two sets to **different subscription
months**.

- `bbea05f8…` (2026-08-08 15:09) settled d-tags minted **2026-07-19** → the July bill, paid late.
- `d3714d99…` (2026-08-09 06:06) settled d-tags minted **2026-08-09 00:18** → the August bill.

The generator bills once per `(subscriber, service, billing_month)` and enforces it with a
DB pre-check plus `UNIQUE(subscriber_hex_id, service_id, billing_month)`
(`lana-subscriptions/server/lib/billing.ts`). The identical amounts are simply the same 7
subscriptions at the same prices. **Two legitimate payments, one month apart in what they
paid for, 15 hours apart in when.**

## What a real double payment looks like (found by scanning the relays)

A full sweep — 14 108 KIND 90900 and 8 157 KIND 90901 across 377 payers,
`scripts/auditUnconditionalPayments.ts` per payer — turned up two genuine shapes:

1. **The same proposal paid twice.** Payer `c895854d…` settled five 2026-05 proposals at
   18:43 and again at 19:14 on 2026-06-19 — 31 minutes apart, the second transaction
   quoting the *same* d-tags. Consistent with an ambiguous first attempt: on error
   `ConfirmPayment.tsx` leaves `pendingUnconditionalPayment` in sessionStorage, so
   re-confirming re-broadcasts.
2. **Two proposals for one month, each paid.** 17 obligation-months across the fleet have
   more than one proposal (e.g. `6ae127d1…`, lanaheartvoice, 2026-02: proposals 10 minutes
   — one heartbeat — apart, paid separately on 02-17 and 02-19). The generator's dedup did
   not hold on those runs.

Both are now blocked before broadcast. Different months never match, so a late payer is
never blocked.

## `billing_day` cannot identify anything

`billing_day` on the 90900 is `service.billing_day` at run time
(`lana-subscriptions/server/lib/billing.ts`), and the runs land on different days of the
month (the 2026-07 set carries `19`, the 2026-08 set `9`, 2026-03 `16`, 2026-04 `4`). It is
neither a stable subscription anchor nor a cycle key, and it collides across months
(Feb 1 vs Mar 1). Readers must not use it for identity. The billing month is currently
recoverable only from the epoch-ms inside the `d`-tag, which is what
`billingMonthOfDTag()` in `src/lib/unconditionalPaymentGuard.ts` parses.

## Proposed `d` format

```
sub:lana:<payer8>:<service-slug>:<YYYY-MM>
```

- `payer8` — first 8 hex chars of the payer pubkey (as today).
- `service-slug` — the `service` tag, lowercased, `[^a-z0-9]+` → `-`.
- `YYYY-MM` — the billing month the proposal charges for. This is exactly the
  `billing_month` the generator already computes and already enforces uniqueness on; the
  d-tag simply stops hiding it behind `Date.now()`.

Deterministic: a second run inside one billing month **reproduces the same `d`** instead of
minting a new identity. That closes failure shape 2 above (17 obligation-months with more
than one proposal) at the source, and makes the billing month legible to every reader
without parsing timestamps. Adding a plain `['billing_month', 'YYYY-MM']` tag alongside
would be even better and is backwards compatible.

## Important protocol caveat: 90900 is not relay-replaceable

KIND 90900 is outside the NIP-33 addressable range (30000–39999), so relays will **not**
replace an event by `(pubkey, kind, d)` — a regenerated event is *stored alongside* the old
one even with a deterministic `d`. That is fine, because the identity works at the app
layer:

- `/fetch-donation-proposals` already dedups by `d` (newest per `d` wins), so regenerations
  collapse to one visible proposal;
- the existing exact-`d` paid match then holds **across regenerations** — a single 90901
  marks every regeneration of that obligation paid, permanently.

No kind change and no reader change is required. (Moving to an addressable kind, e.g.
30900, would give true relay-level replacement but is a breaking change for every reader —
this repo, the being3 port, and the generator — and is *not* proposed here.)

## What would have to change, and where

| Where | Change |
|---|---|
| **Generator — `lana-subscriptions/server/lib/billing.ts:146`** | `d` construction only (`Date.now()` → billing month). Everything else unchanged. Worth pairing with a look at why the `sent_proposals` dedup let 17 obligation-months through twice, often exactly one heartbeat apart. |
| This repo — server `/fetch-donation-proposals` | Nothing required. `d`-dedup and exact-`d` matching already behave correctly under a deterministic `d`; the same-month inheritance simply stops being needed. |
| This repo — client | Nothing required. |

## Effect on existing proposals

- **Nothing breaks.** Old timestamp-`d` events stay on relays and their 90901s keep matching
  exactly as before; `billingMonthOfDTag()` already dates both the `sub:lana:` and
  `pay:lana:` formats.
- **No migration hazard.** A deterministic `d` only ever collapses duplicates; it never
  creates a new identity for an obligation that already has one.
- Optionally the generator can publish NIP-09 deletes for superseded timestamp-`d` events.
  Note the fleet's relays run strfry, where NIP-09 handling has historically required
  server-side deletion — treat cleanup as cosmetic, not as a correctness mechanism.

## Verification tooling

`scripts/auditUnconditionalPayments.ts` prints, for a payer pubkey, every 90900/90901 with
relay-answer status, groups confirmations by tx, and flags obligations that exist under
multiple `d`-tags — running it against `9b1267aa…` reproduces the incident finding directly.
