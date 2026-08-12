# Proposal: a stable identity for unconditional-payment obligations (KIND 90900)

*Status: proposal only — the 90900 generator does NOT live in this repository (verified:
`server/lib/aiTasks.ts` only READS 90900/90901 into AI context; repo-wide, 90900 appears
only in read paths). Nothing here changes the protocol silently; this documents what the
generator side would need to change and what this repo already handles.*

## The incident this addresses

Payer `9b1267aa…` (wallet `LQzbjcvK2V8fD3jZtj6jyHmeqKG59uSTL9`) paid the same batch of 7
obligations twice — tx `bbea05f8…` and tx `d3714d99…`, byte-identical outputs, ~15 h apart.
Each KIND 90901 confirmation points at a **different** proposal `d`-tag: the generator had
minted a *second proposal set* for the same obligation.

Root of the identity problem: `d = sub:lana:<ms>:<payer8>` embeds a millisecond timestamp,
so **every generator run creates a brand-new obligation identity**. All paid-state matching
(server `/fetch-donation-proposals`, Dashboard, AI advisor) is exact-`d`/exact-event-id, so
a 90901 confirming set A can never mark set B as paid. Worse, the server's obligation-level
dedup (`payer|service|wallet`, newest wins, `server/routes/functions.ts`) keeps exactly the
newer **unpaid** duplicate — so even with perfectly healthy relays the obligation resurfaced
as payable.

## What the on-chain audit showed about `billing_day`

Running `scripts/auditUnconditionalPayments.ts` against the payer shows `billing_day` is
the **day-of-month of the generator run** (the 2026-07-19 set carries `19`, the 2026-08-09
set carries `9`) — it is *not* a stable subscription anchor and cannot distinguish "same
cycle regenerated" from "next month's bill". Any stable identity must therefore introduce a
real cycle key. The incident timeline: the payer settled the 07-19 set on 2026-08-08 15:09
(`bbea05f8…`); the generator minted a fresh set nine hours later (2026-08-09 00:18); that
set showed unpaid and was settled again at 06:06 (`d3714d99…`).

## Proposed `d` format

```
sub:lana:<payer8>:<service-slug>:<YYYY-MM>
```

- `payer8` — first 8 hex chars of the payer pubkey (as today).
- `service-slug` — the `service` tag, lowercased, `[^a-z0-9]+` → `-`.
- `YYYY-MM` — the billing month the proposal charges for (a true cycle key, replacing the
  run-derived `billing_day` for identity purposes; the `billing_day` tag can stay as-is).

Deterministic: regenerating a batch within the same billing month **reproduces the same
`d`** instead of inventing a new one. One billing cycle = one obligation identity — the
incident's 00:18 regeneration would have carried the `d` the 15:09 payment already
confirmed.

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
| **Generator (external repo/service, signs as `f5f2bb8b…`)** | `d` construction only: deterministic format above. Everything else (tags, content, kind) unchanged. |
| This repo — server `/fetch-donation-proposals` | Nothing required. `d`-dedup + exact-`d` matching already behave correctly under deterministic `d`. `billing_day` is now parsed and returned (added with the duplicate-guard change). |
| This repo — client | Nothing required. New 90901s now also carry a `billing_day` tag, which strengthens obligation-level matching either way. |

## Effect on the ~43 existing proposals for this payer

- **Nothing breaks.** Old timestamp-`d` events stay on relays; old 90901s keep matching
  them exactly as before.
- **One migration hazard:** the *first* deterministic-`d` regeneration of an obligation
  whose old set is already paid repeats the incident shape once (new `d`, no 90901 for it).
  Two mitigations already shipped in this repo cover it: the server inherits paid-state
  across proposal sets sharing `payer|service|wallet` whenever the older set's payment
  postdates the newer set's mint minus a 3-day margin, and both the confirm page and the
  `/send-unconditional-payment` route refuse to broadcast when a prior 90901 for the same
  service+wallet was paid since the selected proposal set was minted.
- Optionally the generator can publish NIP-09 deletes for superseded timestamp-`d` events.
  Note the fleet's relays run strfry, where NIP-09 handling has historically required
  server-side deletion — treat cleanup as cosmetic, not as a correctness mechanism.

## Verification tooling

`scripts/auditUnconditionalPayments.ts` prints, for a payer pubkey, every 90900/90901 with
relay-answer status, groups confirmations by tx, and flags obligations that exist under
multiple `d`-tags — running it against `9b1267aa…` reproduces the incident finding directly.
