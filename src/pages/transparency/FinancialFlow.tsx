import { useState, useEffect, useMemo, ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { SimplePool } from "nostr-tools";
import {
  Activity,
  Banknote,
  Coins,
  Gift,
  HandCoins,
  Landmark,
  Lightbulb,
  PiggyBank,
  Search,
  ShoppingCart,
  TrendingDown,
  Wallet as WalletIcon,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { supabase } from "@/integrations/supabase/client";
import { useSystemParameters } from "@/contexts/SystemParametersContext";
import { useNostrKind0Profiles } from "@/hooks/useNostrKind0Profiles";
import { useNostrProfileCache } from "@/hooks/useNostrProfileCache";
import { useNostrUserWallets } from "@/hooks/useNostrUserWallets";
import { useNostrInvestorPayments } from "@/hooks/useNostrInvestorPayments";
import {
  addCurrency,
  analyzeAnnuityPlan,
  bucketWallets,
  newestPerD,
  parseLanaFundUnits,
  perCurrencyEntries,
  summarizeDiscount,
  summarizeDonationsMade,
  summarizeLanaFund,
  summarizePlan15,
  summarizeProjects,
  summarizeSpending,
  summarizeUnconditionalPayments,
  tagOf,
  type AnnuityPlan,
  type DiscountSummary,
  type DonationsSummary,
  type FlowEvent,
  type L8WSummary,
  type LanaFundSummary,
  type LanacrowdProjectRow,
  type PerCurrency,
  type Plan15Summary,
  type ProjectsSummary,
  type SpendingSummary,
  type UpSummary,
  type WalletBucket,
} from "@/lib/financialFlowData";

const API_URL = import.meta.env.VITE_API_URL ?? "";

/**
 * Known fleet publishers, pinned as constants. The KIND 38888 trusted_signers
 * object only carries LanaRegistrar in practice, and every "look up the key,
 * fall back to no filter" reader fails OPEN — which on this page would mean a
 * forged event silently becomes someone's published financial record.
 */
const LANA8WONDER_PUBKEY = "a56253e6232b2ab5a96b60d233434d4f759ba4c858a3cc0f4ec51906dce73ae6";
const DIRECT_FUND_PUBKEY = "79730aba75d71584e8a4f9d0cc1173085e75590ce489760078d2bf6f5210d692";
/** Any of these 38888 keys may hold the purchase processor (brain) signers. */
const PROCESSOR_SIGNER_KEYS = ["LanaPaysUs", "LanaPays", "Processor", "Brain"];

/**
 * Transparency → Financial Flow: everything the fleet knows about one
 * person's money, on one page. Each section loads independently so a slow
 * source never blocks the rest, and a section that fails says so instead of
 * pretending the flow is zero.
 */

// ── shared fetch helpers ────────────────────────────────────────────────

async function relayQuery(relays: string[], filter: Record<string, unknown>, timeoutMs = 12000): Promise<FlowEvent[]> {
  const pool = new SimplePool();
  try {
    const events = await Promise.race([
      pool.querySync(relays, filter as never),
      new Promise<FlowEvent[]>((_, reject) => setTimeout(() => reject(new Error("relay timeout")), timeoutMs)),
    ]);
    return events as FlowEvent[];
  } finally {
    try { pool.close(relays); } catch { /* sockets already gone */ }
  }
}

/**
 * Page a full-kind fetch backwards. `until` is INCLUSIVE of the boundary
 * second — publishers batch-publish within one second, and `oldest - 1` would
 * drop whatever shared that second beyond the page limit. Progress is decided
 * by new ids appearing, so re-reading the boundary costs one duplicate page
 * at worst. Throws when the page budget runs out with a full page still
 * arriving: a truncated financial history must not read as a complete one.
 */
async function relayQueryAll(relays: string[], baseFilter: Record<string, unknown>, maxPages = 12): Promise<FlowEvent[]> {
  const byId = new Map<string, FlowEvent>();
  let until: number | undefined;
  for (let page = 0; page < maxPages; page++) {
    const filter = { ...baseFilter, limit: 500, ...(until ? { until } : {}) };
    const events = await relayQuery(relays, filter);
    let added = 0;
    let oldest = Infinity;
    for (const ev of events) {
      if (!byId.has(ev.id)) { byId.set(ev.id, ev); added++; }
      if (ev.created_at < oldest) oldest = ev.created_at;
    }
    if (added === 0 || !Number.isFinite(oldest)) return [...byId.values()];
    until = oldest;
    if (page === maxPages - 1) {
      throw new Error(`history longer than ${maxPages * 500} events — totals would be incomplete`);
    }
  }
  return [...byId.values()];
}

/** A REST read that fails loudly — a swallowed error would render as a zero. */
async function getJson(url: string): Promise<any> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

/**
 * Balances keyed by address. An address whose Electrum lookup errored is left
 * OUT of the map rather than mapped to 0 — a zero balance and an unreadable
 * one mean very different things (see analyzeAnnuityPlan).
 */
async function fetchBalancesMap(addresses: string[], electrumServers: unknown): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (addresses.length === 0) return map;
  const { data, error } = await supabase.functions.invoke("get-wallet-balances", {
    body: { wallet_addresses: addresses, electrum_servers: electrumServers },
  });
  if (error) throw new Error(error.message || "balance fetch failed");
  for (const w of data?.wallets || []) {
    if (w.error) continue;
    map.set(w.wallet_id, w.balance || 0);
  }
  return map;
}

// ── shared UI bits ──────────────────────────────────────────────────────

const fmtLana = (n: number) =>
  `${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} LANA`;

function FiatList({ pc, prefix = "", muted = false }: { pc: PerCurrency; prefix?: string; muted?: boolean }) {
  const entries = perCurrencyEntries(pc);
  if (entries.length === 0) return <span className={muted ? "text-muted-foreground" : ""}>—</span>;
  return (
    <span className={muted ? "text-muted-foreground" : ""}>
      {entries.map(([cur, amount], i) => (
        <span key={cur}>
          {i > 0 && " · "}
          {prefix}
          {amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {cur}
        </span>
      ))}
    </span>
  );
}

function StatRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{children}</span>
    </div>
  );
}

interface SectionState<T> { data: T | null; loading: boolean; error: string | null }

/** One-shot fetch per (pubkey, ready) with a cancel guard — every section uses it. */
function useSection<T>(pubkey: string, ready: boolean, fetcher: () => Promise<T>, deps: unknown[] = []): SectionState<T> {
  const [state, setState] = useState<SectionState<T>>({ data: null, loading: true, error: null });
  useEffect(() => {
    if (!pubkey || !ready) return;
    let cancelled = false;
    setState({ data: null, loading: true, error: null });
    fetcher()
      .then((data) => { if (!cancelled) setState({ data, loading: false, error: null }); })
      .catch((err) => { if (!cancelled) setState({ data: null, loading: false, error: err?.message || "failed" }); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pubkey, ready, ...deps]);
  return state;
}

function Section({ icon: Icon, title, loading, error, children }: {
  icon: typeof Activity;
  title: string;
  loading: boolean;
  error: string | null;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Icon className="h-5 w-5" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-5 w-1/2" />
          </div>
        ) : error ? (
          <p className="text-sm text-destructive">Could not load: {error}</p>
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
}

// ── sections ────────────────────────────────────────────────────────────

function BalancesSection({ pubkey, fiatRate, fiatCurrency }: { pubkey: string; fiatRate: number; fiatCurrency: string }) {
  const { parameters } = useSystemParameters();
  const { wallets, isLoading: walletsLoading } = useNostrUserWallets(pubkey || null);
  const ready = !walletsLoading && !!parameters;
  const state = useSection(pubkey, ready, async () => {
    const balances = await fetchBalancesMap(wallets.map((w) => w.walletId), parameters?.electrumServers);
    return bucketWallets(wallets, balances);
  }, [wallets.map((w) => w.walletId).join(",")]);

  const renderBucket = (bucket: WalletBucket) => (
    <div key={bucket.label} className="rounded-lg border p-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-semibold">{bucket.label}</p>
        <p className="font-bold text-green-500">{fmtLana(bucket.totalLana)}</p>
      </div>
      {fiatRate > 0 && (
        <p className="text-right text-xs text-muted-foreground">
          ≈ {(bucket.totalLana * fiatRate).toFixed(2)} {fiatCurrency}
        </p>
      )}
      <div className="mt-2 space-y-1">
        {bucket.wallets.map((w) => (
          <div key={w.walletId} className="flex items-center justify-between gap-2 text-xs">
            <span className="truncate font-mono text-muted-foreground">
              {w.walletId}
              {w.note ? ` · ${w.note}` : ""}
              {w.freezeStatus ? " ❄" : ""}
            </span>
            <span className="shrink-0">{fmtLana(w.balance)}</span>
          </div>
        ))}
        {bucket.wallets.length === 0 && <p className="text-xs text-muted-foreground">No wallets of this type.</p>}
      </div>
    </div>
  );

  return (
    <Section icon={WalletIcon} title="Current balances" loading={walletsLoading || state.loading} error={state.error}>
      {state.data && (
        <div className="space-y-3">
          {renderBucket(state.data.lana8wonder)}
          {renderBucket(state.data.spending)}
          {renderBucket(state.data.lanapays)}
          {state.data.other.wallets.length > 0 && renderBucket(state.data.other)}
          <div className="flex items-baseline justify-between border-t pt-2">
            <p className="font-semibold">Total registered</p>
            <p className="text-lg font-bold">{fmtLana(state.data.totalLana)}</p>
          </div>
        </div>
      )}
    </Section>
  );
}

function ProjectsSection({ pubkey }: { pubkey: string }) {
  const state = useSection<ProjectsSummary>(pubkey, true, async () => {
    const [projectsRes, receivedRes] = await Promise.all([
      getJson(`${API_URL}/api/lanacrowd/my-projects/${pubkey}`),
      getJson(`${API_URL}/api/lanacrowd/my-donations/${pubkey}`),
    ]);
    // /my-projects has no visibility gate at all — it returns drafts, hidden
    // and unapproved rows. This page is public, so apply the same policy the
    // public listing does instead of exposing them.
    const projects = (projectsRes?.projects || []).filter(
      (p: LanacrowdProjectRow & { isApproved?: number | boolean }) =>
        p.status !== "draft" && !p.isHidden && p.isApproved !== 0 && p.isApproved !== false,
    );
    // my-donations keys on project_owner_pubkey, which is empty on legacy rows —
    // merge per-project donation lists so old projects still count.
    const perProject = await Promise.all(
      projects.map((p: { id: string }) => getJson(`${API_URL}/api/lanacrowd/donations/${encodeURIComponent(p.id)}`)),
    );
    const donationById = new Map<string, { amountFiat: number; currency: string; nostrCreatedAt: number }>();
    for (const d of receivedRes?.donations || []) donationById.set(d.id, d);
    for (const res of perProject) for (const d of res?.donations || []) donationById.set(d.id, d);
    return summarizeProjects(projects, [...donationById.values()], new Date());
  });

  return (
    <Section icon={Lightbulb} title="100 Million Ideas — projects" loading={state.loading} error={state.error}>
      {state.data && (state.data.projects.length === 0 ? (
        <p className="text-sm text-muted-foreground">No projects submitted.</p>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            {state.data.projects.map((p) => {
              const pct = p.fiatGoal > 0 ? Math.min((p.totalRaised / p.fiatGoal) * 100, 100) : 0;
              return (
                <div key={p.id} className="overflow-hidden rounded-lg border">
                  {p.coverImage && (
                    <img src={p.coverImage} alt={p.title} className="h-28 w-full object-cover" loading="lazy" />
                  )}
                  <div className="space-y-2 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-semibold leading-tight">{p.title}</p>
                      {(p.isCompleted ? true : false) ? (
                        <Badge variant="secondary">completed</Badge>
                      ) : (p.isFunded ? true : false) ? (
                        <Badge className="bg-green-600">funded</Badge>
                      ) : null}
                    </div>
                    <Progress value={pct} />
                    <p className="text-xs text-muted-foreground">
                      {p.totalRaised.toFixed(2)} / {p.fiatGoal.toFixed(2)} {p.currency} · {p.donationCount} donations
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="space-y-1 border-t pt-3">
            <StatRow label="Received across projects"><FiatList pc={state.data.raisedFiat} /></StatRow>
            <StatRow label="Still waiting (goal − received)"><FiatList pc={state.data.remainingFiat} /></StatRow>
            <StatRow label="Received this month"><FiatList pc={state.data.monthly.thisMonth} /></StatRow>
            <StatRow label="Received last month"><FiatList pc={state.data.monthly.lastMonth} /></StatRow>
          </div>
        </div>
      ))}
    </Section>
  );
}

function LanaFundSection({ pubkey, spending }: { pubkey: string; spending: SectionState<SpendingSummary> }) {
  const { parameters } = useSystemParameters();
  // Donations received come from the shared purchase set — without it there is
  // nothing to say, so wait for it rather than render every fundraiser at zero.
  const ready = !!parameters?.relays?.length && !!spending.data;
  const state = useSection<LanaFundSummary>(pubkey, ready, async () => {
    const unitEvents = await relayQuery(parameters!.relays, { kinds: [30901], authors: [pubkey], limit: 200 });
    const units = parseLanaFundUnits(unitEvents as FlowEvent[]);
    return summarizeLanaFund(units, spending.data?.merchantRows || [], new Date());
  }, [spending.data]);

  return (
    <Section
      icon={PiggyBank}
      title="LanaFund.Me"
      loading={(state.loading || spending.loading) && !spending.error}
      error={spending.error ? `purchase records unavailable (${spending.error})` : state.error}
    >
      {state.data && (state.data.units.length === 0 ? (
        <p className="text-sm text-muted-foreground">No LanaFund.Me fundraisers.</p>
      ) : (
        <div className="space-y-3">
          {state.data.units.map((u) => (
            <div key={u.unitId} className="rounded-lg border p-3">
              <div className="flex items-baseline justify-between gap-2">
                <p className="font-semibold">{u.name}</p>
                <Badge variant={u.status === "active" ? "default" : "secondary"}>{u.status || "?"}</Badge>
              </div>
              <StatRow label={`${u.donationCount} donations received`}>
                <FiatList pc={u.receivedFiat} />
              </StatRow>
            </div>
          ))}
          <div className="space-y-1 border-t pt-2">
            <StatRow label="Total received"><FiatList pc={state.data.totalFiat} /></StatRow>
            <StatRow label="This month"><FiatList pc={state.data.monthly.thisMonth} /></StatRow>
            <StatRow label="Last month"><FiatList pc={state.data.monthly.lastMonth} /></StatRow>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Donations arrive as LANA; the principal is settled to the fundraiser's bank off-chain by investors.
          </p>
        </div>
      ))}
    </Section>
  );
}

function SpendingSection({ spending }: { spending: SectionState<SpendingSummary> }) {
  return (
    <Section icon={ShoppingCart} title="Spending (LanaPays purchases)" loading={spending.loading} error={spending.error}>
      {spending.data && (spending.data.count === 0 ? (
        <p className="text-sm text-muted-foreground">No recorded purchases.</p>
      ) : (
        <div className="space-y-1">
          <StatRow label={`Total spent (${spending.data.count} purchases)`}><FiatList pc={spending.data.totalFiat} /></StatRow>
          <StatRow label="…as LANA">{fmtLana(spending.data.totalLana)}</StatRow>
          <StatRow label="Paid with cash"><FiatList pc={spending.data.byCashFiat} muted /></StatRow>
          <StatRow label="Paid with LANA"><FiatList pc={spending.data.byLanaFiat} muted /></StatRow>
          <StatRow label="Obilje cashback earned"><FiatList pc={spending.data.cashbackFiat} /></StatRow>
          <StatRow label="This month"><FiatList pc={spending.data.monthly.thisMonth} /></StatRow>
          <StatRow label="Last month"><FiatList pc={spending.data.monthly.lastMonth} /></StatRow>
          <div className="space-y-1 border-t pt-2">
            {spending.data.purchases.slice(0, 5).map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span className="truncate">
                  {new Date(p.ts * 1000).toLocaleDateString("en-GB")} · {p.merchantName || "merchant"}
                </span>
                <span className="shrink-0">{p.amountFiat.toFixed(2)} {p.currency}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </Section>
  );
}

function DiscountSection({ pubkey }: { pubkey: string }) {
  const { parameters } = useSystemParameters();
  const ready = !!parameters?.relays?.length;
  const state = useSection<DiscountSummary>(pubkey, ready, async () => {
    const [buybacks, payouts] = await Promise.all([
      relayQueryAll(parameters!.relays, { kinds: [30936] }),
      relayQueryAll(parameters!.relays, { kinds: [30937] }),
    ]);
    return summarizeDiscount(buybacks, payouts, pubkey);
  });

  return (
    <Section icon={TrendingDown} title="Lana.Discount — LANA sold for fiat" loading={state.loading} error={state.error}>
      {state.data && (state.data.sales.length === 0 ? (
        <p className="text-sm text-muted-foreground">No buyback sales.</p>
      ) : (
        <div className="space-y-1">
          <StatRow label={`LANA sold (${state.data.sales.length} sales)`}>{fmtLana(state.data.lanaSold)}</StatRow>
          <StatRow label="Gross value"><FiatList pc={state.data.grossFiat} muted /></StatRow>
          <StatRow label="Commission"><FiatList pc={state.data.commissionFiat} muted /></StatRow>
          <StatRow label="Net owed"><FiatList pc={state.data.netFiat} /></StatRow>
          <StatRow label="Paid out"><FiatList pc={state.data.paidOutFiat} /></StatRow>
          <StatRow label="Still to be paid"><FiatList pc={state.data.remainingFiat} /></StatRow>
          {state.data.payouts.length > 0 && (
            <div className="space-y-1 border-t pt-2">
              {state.data.payouts.slice(0, 5).map((p) => (
                <div key={p.id} className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span className="truncate">
                    {new Date(p.ts * 1000).toLocaleDateString("en-GB")} · {p.reference || p.id}
                    {p.paidToAccount ? ` · …${p.paidToAccount.slice(-4)}` : ""}
                  </span>
                  <span className="shrink-0">{p.amount.toFixed(2)} {p.currency}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </Section>
  );
}

function Lana8WonderSection({ pubkey }: { pubkey: string }) {
  const { parameters } = useSystemParameters();
  const ready = !!parameters?.relays?.length;
  const state = useSection<L8WSummary | null>(pubkey, ready, async () => {
    // 88888 is outside the replaceable range, so every version persists and the
    // newest wins — which makes the author pin essential: without it a forged
    // plan tagged #p user would simply outrank the real one.
    const signers = parameters?.trustedSigners?.["Lana8Wonder"]?.length
      ? parameters.trustedSigners["Lana8Wonder"]
      : [LANA8WONDER_PUBKEY];
    const filter: Record<string, unknown> = { kinds: [88888], "#p": [pubkey], authors: signers, limit: 50 };
    const events = (await relayQuery(parameters!.relays, filter)).sort((a, b) => b.created_at - a.created_at);
    if (events.length === 0) return null;
    let plan: AnnuityPlan;
    try { plan = JSON.parse(events[0].content); } catch { return null; }
    const wallets = (plan.accounts || []).map((a) => a.wallet).filter(Boolean);
    const balances = await fetchBalancesMap(wallets, parameters?.electrumServers);
    const currency = (plan.currency || "EUR") as "EUR" | "USD" | "GBP";
    const price = parameters?.exchangeRates?.[currency] || parameters?.exchangeRates?.EUR || 0;
    return analyzeAnnuityPlan(plan, balances, price);
  });

  return (
    <Section icon={Coins} title="Lana8Wonder — cash-outs" loading={state.loading} error={state.error}>
      {state.data === null && !state.loading && !state.error ? (
        <p className="text-sm text-muted-foreground">No Lana8Wonder annuity plan.</p>
      ) : state.data ? (
        <div className="space-y-1">
          <StatRow label="Withdrawn so far">{fmtLana(state.data.totalWithdrawnLana)}</StatRow>
          <StatRow label="…planned value of those levels">
            {state.data.totalPlannedFiatOut.toFixed(2)} {state.data.currency}
          </StatRow>
          <StatRow label="Pending cash-out now">{fmtLana(state.data.totalPendingLana)}</StatRow>
          {state.data.totalPendingLana > 0 && (
            <StatRow label="…at today's rate">
              ≈ {state.data.totalPendingFiat.toFixed(2)} {state.data.currency}
            </StatRow>
          )}
          <StatRow label="Held in plan accounts">{fmtLana(state.data.totalBalance)}</StatRow>
          {state.data.unknownBalanceCount > 0 && (
            <Alert variant="destructive" className="mt-2">
              <AlertDescription className="text-xs">
                {state.data.unknownBalanceCount} account balance(s) could not be read — those
                accounts are excluded from every figure above.
              </AlertDescription>
            </Alert>
          )}
          <p className="pt-1 text-[11px] text-muted-foreground">
            Withdrawals are derived from the plan's levels (trigger reached and wallet at its
            remaining amount) — actual sale prices are not recorded on-chain. A pending amount on
            a frozen wallet cannot be paid out until the freeze lifts.
          </p>
        </div>
      ) : null}
    </Section>
  );
}

function UnconditionalPaymentsSection({ pubkey }: { pubkey: string }) {
  const state = useSection<{ summary: UpSummary; paidStateUnknown: boolean }>(pubkey, true, async () => {
    const { data, error } = await supabase.functions.invoke("fetch-donation-proposals", {
      body: { userPubkey: pubkey },
    });
    if (error) throw new Error(error.message || "fetch failed");
    return {
      summary: summarizeUnconditionalPayments(data?.proposals || [], pubkey),
      paidStateUnknown: !!data?.paidStateUnknown,
    };
  });

  return (
    <Section icon={HandCoins} title="Unconditional payments (subscriptions)" loading={state.loading} error={state.error}>
      {state.data && (
        <div className="space-y-1">
          {state.data.paidStateUnknown && (
            <Alert variant="destructive" className="mb-2">
              <AlertDescription className="text-xs">
                Paid-state could not be verified against the relays — open amounts below may already be settled.
              </AlertDescription>
            </Alert>
          )}
          <StatRow label="Proposed to pay"><FiatList pc={state.data.summary.owedFiat} /></StatRow>
          <StatRow label={`Paid (${state.data.summary.paidCount})`}><FiatList pc={state.data.summary.paidFiat} /></StatRow>
          <StatRow label={`Open (${state.data.summary.openCount})`}><FiatList pc={state.data.summary.openFiat} /></StatRow>
          {perCurrencyEntries(state.data.summary.receivedFiat).length > 0 && (
            <StatRow label="Received as service provider"><FiatList pc={state.data.summary.receivedFiat} /></StatRow>
          )}
        </div>
      )}
    </Section>
  );
}

function Plan15Section({ pubkey }: { pubkey: string }) {
  const { parameters } = useSystemParameters();
  const ready = !!parameters?.relays?.length;
  const state = useSection<Plan15Summary>(pubkey, ready, async () => {
    const relays = parameters!.relays;
    const [memberships, offers, purchases, sales] = await Promise.all([
      relayQuery(relays, { kinds: [31515], "#d": [pubkey], limit: 10 }),
      relayQuery(relays, { kinds: [31516], authors: [pubkey], limit: 200 }),
      relayQuery(relays, { kinds: [91515], authors: [pubkey], limit: 500 }),
      relayQuery(relays, { kinds: [91515], "#p": [pubkey], limit: 500 }),
    ]);
    // Membership is self-published (d = own pubkey) — an event with that d from
    // any other author is not this person's membership.
    const membership = newestPerD(
      (memberships as FlowEvent[]).filter((ev) => ev.pubkey === pubkey),
    )[0] || null;
    const balances = membership
      ? await fetchBalancesMap(
          [tagOf(membership, "plan15_wallet"), tagOf(membership, "staker_wallet")].filter(Boolean),
          parameters?.electrumServers,
        )
      : new Map<string, number>();
    return summarizePlan15(
      membership, offers as FlowEvent[], purchases as FlowEvent[], sales as FlowEvent[], balances, pubkey,
    );
  });

  return (
    <Section icon={Landmark} title="PLAN15" loading={state.loading} error={state.error}>
      {state.data && (!state.data.status ? (
        <p className="text-sm text-muted-foreground">Not a PLAN15 member.</p>
      ) : (
        <div className="space-y-1">
          <StatRow label="Membership">
            <Badge variant={state.data.isMember ? "default" : "secondary"}>
              {state.data.status}{state.data.isStaker ? " · staker" : ""}
            </Badge>
          </StatRow>
          <StatRow label="Holdings (PLAN15 + staker wallet)">{fmtLana(state.data.holdingsLana)}</StatRow>
          <StatRow label={`Bought (${state.data.purchasesCount})`}>
            {fmtLana(state.data.boughtUnregLana)} unregistered
          </StatRow>
          <StatRow label="…paid for it">{fmtLana(state.data.paidRegLana)}</StatRow>
          <StatRow label={`Sold (${state.data.salesCount})`}>
            {fmtLana(state.data.soldUnregLana)} unregistered
          </StatRow>
          <StatRow label="…received for it">{fmtLana(state.data.receivedRegLana)}</StatRow>
          <StatRow label={`Active offers (${state.data.activeOffersCount})`}>{fmtLana(state.data.activeOffersLana)}</StatRow>
        </div>
      ))}
    </Section>
  );
}

interface UfSupportRow {
  request: { title: string; currency: string };
  myFiat: number;
  repaidToMe: number;
  outstandingToMe: number;
}

function DonationsSection({ pubkey }: { pubkey: string }) {
  const { parameters } = useSystemParameters();
  const ready = !!parameters?.relays?.length;
  const state = useSection<{ made: DonationsSummary; uf: { supported: PerCurrency; repaid: PerCurrency; outstanding: PerCurrency; count: number } }>(
    pubkey,
    ready,
    async () => {
      const relays = parameters!.relays;
      const [crowd, events, lashSent, lashReceived, ufRes] = await Promise.all([
        relayQuery(relays, { kinds: [60200], authors: [pubkey], limit: 500 }),
        relayQuery(relays, { kinds: [53334], authors: [pubkey], limit: 500 }),
        relayQuery(relays, { kinds: [39991], authors: [pubkey], limit: 500 }),
        relayQuery(relays, { kinds: [39991], "#p": [pubkey], limit: 500 }),
        getJson(`${API_URL}/api/unconditional-financing/my-supports/${pubkey}`),
      ]);
      const made = summarizeDonationsMade(
        crowd as FlowEvent[], events as FlowEvent[], lashSent as FlowEvent[], lashReceived as FlowEvent[], new Date(),
      );
      const supported: PerCurrency = {};
      const repaid: PerCurrency = {};
      const outstanding: PerCurrency = {};
      const supports: UfSupportRow[] = ufRes?.supports || [];
      for (const s of supports) {
        addCurrency(supported, s.request?.currency || "EUR", s.myFiat || 0);
        addCurrency(repaid, s.request?.currency || "EUR", s.repaidToMe || 0);
        addCurrency(outstanding, s.request?.currency || "EUR", s.outstandingToMe || 0);
      }
      return { made, uf: { supported, repaid, outstanding, count: supports.length } };
    },
  );

  return (
    <Section icon={Gift} title="Donations & support to others" loading={state.loading} error={state.error}>
      {state.data && (
        <div className="space-y-1">
          <StatRow label={`100 Million Ideas donations (${state.data.made.crowdCount})`}>
            <FiatList pc={state.data.made.crowdFiat} />
          </StatRow>
          <StatRow label="…as LANA">{fmtLana(state.data.made.crowdLana)}</StatRow>
          <StatRow label="This month"><FiatList pc={state.data.made.monthly.thisMonth} muted /></StatRow>
          <StatRow label="Last month"><FiatList pc={state.data.made.monthly.lastMonth} muted /></StatRow>
          <div className="border-t pt-2" />
          <StatRow label={`Unconditional financing supported (${state.data.uf.count})`}>
            <FiatList pc={state.data.uf.supported} />
          </StatRow>
          <StatRow label="…repaid back">
            <FiatList pc={state.data.uf.repaid} muted />
          </StatRow>
          <StatRow label="…still outstanding">
            <FiatList pc={state.data.uf.outstanding} muted />
          </StatRow>
          <div className="border-t pt-2" />
          <StatRow label={`Event donations (${state.data.made.eventsCount})`}>{fmtLana(state.data.made.eventsLana)}</StatRow>
          <StatRow label={`LASH given (${state.data.made.lashSentCount})`}>{fmtLana(state.data.made.lashSentLana)}</StatRow>
          <StatRow label={`LASH received (${state.data.made.lashReceivedCount})`}>{fmtLana(state.data.made.lashReceivedLana)}</StatRow>
        </div>
      )}
    </Section>
  );
}

function DirectFundSection({ pubkey }: { pubkey: string }) {
  const { parameters } = useSystemParameters();
  const ready = !!parameters?.relays?.length;
  // Fetched here rather than through useNostrInvestorPayments, whose relay
  // errors collapse into an empty list — indistinguishable from "no payments".
  const state = useSection<{ total: PerCurrency; confirmed: PerCurrency; count: number }>(
    pubkey,
    ready,
    async () => {
      const events = await relayQueryAll(parameters!.relays, { kinds: [30939], authors: [DIRECT_FUND_PUBKEY] });
      const mine = newestPerD(events).filter(
        (ev) => tagOf(ev, "investor_hex").toLowerCase() === pubkey,
      );
      const total: PerCurrency = {};
      const confirmed: PerCurrency = {};
      for (const ev of mine) {
        const amount = Number.parseFloat(tagOf(ev, "amount")) || 0;
        const currency = tagOf(ev, "currency") || "EUR";
        addCurrency(total, currency, amount);
        if (tagOf(ev, "confirmed") === "1") addCurrency(confirmed, currency, amount);
      }
      return { total, confirmed, count: mine.length };
    },
  );

  return (
    <Section icon={Banknote} title="Direct Fund — investor payments" loading={state.loading} error={state.error}>
      {state.data && (state.data.count === 0 ? (
        <p className="text-sm text-muted-foreground">No Direct Fund payments.</p>
      ) : (
        <div className="space-y-1">
          <StatRow label={`Payments (${state.data.count})`}><FiatList pc={state.data.total} /></StatRow>
          <StatRow label="Confirmed"><FiatList pc={state.data.confirmed} /></StatRow>
        </div>
      ))}
    </Section>
  );
}

// ── page ────────────────────────────────────────────────────────────────

export default function FinancialFlow() {
  const [searchParams, setSearchParams] = useSearchParams();
  const pubkey = (searchParams.get("pubkey") || "").toLowerCase();
  const [searchTerm, setSearchTerm] = useState("");
  const { profiles, isLoading: profilesLoading } = useNostrKind0Profiles();
  const { parameters } = useSystemParameters();
  const { profile } = useNostrProfileCache(pubkey || null);

  const filteredProfiles = useMemo(() => {
    if (!searchTerm.trim()) return [];
    const term = searchTerm.toLowerCase();
    return profiles
      .filter(
        (p) =>
          p.name?.toLowerCase().includes(term) ||
          p.display_name?.toLowerCase().includes(term) ||
          p.pubkey?.toLowerCase().includes(term),
      )
      .slice(0, 12);
  }, [profiles, searchTerm]);

  // The 30933 purchase set feeds BOTH the spending and the LanaFund sections —
  // fetched once here. Two queries: #p (new events) + by-processor-author
  // (pre-2026-07 events carry no p tag), exactly the lana-pays-check pattern.
  const ready30933 = !!parameters?.relays?.length;
  const spending = useSection<SpendingSummary>(pubkey, ready30933, async () => {
    const relays = parameters!.relays;
    const ts = parameters?.trustedSigners || {};
    const processorSigners = PROCESSOR_SIGNER_KEYS.flatMap((k) => ts[k] || []);
    // Without the processor list the author check would be disabled and any
    // forged 30933 would count as this person's spending. Refuse instead.
    if (processorSigners.length === 0) {
      throw new Error("purchase processor signers missing from KIND 38888 — cannot verify records");
    }
    const [byP, byAuthor] = await Promise.all([
      relayQuery(relays, { kinds: [30933], "#p": [pubkey], limit: 1000 }),
      // Purchases published before 2026-07 carry no p tag at all — the only
      // way to see them is to sweep the processors' own output.
      relayQueryAll(relays, { kinds: [30933], authors: processorSigners }),
    ]);
    const byId = new Map<string, FlowEvent>();
    for (const ev of [...byP, ...byAuthor] as FlowEvent[]) byId.set(ev.id, ev);
    return summarizeSpending([...byId.values()], pubkey, processorSigners, new Date());
  });

  const selectProfile = (pk: string) => {
    setSearchParams({ pubkey: pk });
    setSearchTerm("");
  };

  // The profile cache keeps the previously viewed user on a miss and has no
  // cancellation, so trust it only when it is demonstrably THIS user's —
  // otherwise the header would name A above B's pubkey and convert B's
  // balances at A's currency.
  const shownProfile = profile?.nostr_hex_id === pubkey ? profile : null;
  const metaCurrency = shownProfile?.raw_metadata?.currency;
  const fiatCurrency = (typeof metaCurrency === "string" && metaCurrency ? metaCurrency.toUpperCase() : "EUR");
  const fiatRate = parameters?.exchangeRates?.[fiatCurrency as "EUR" | "USD" | "GBP"] || 0;

  return (
    <div className="container mx-auto max-w-5xl space-y-6 p-4">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Activity className="h-6 w-6" />
          Financial Flow
        </h1>
        <p className="text-sm text-muted-foreground">
          Balances and money flows for one user across every Lana module.
        </p>
      </div>

      {/* Search */}
      <Card>
        <CardContent className="p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search by name or pubkey…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9"
            />
          </div>
          {searchTerm.trim() && (
            <div className="mt-2 max-h-64 space-y-1 overflow-y-auto">
              {profilesLoading && <Skeleton className="h-10 w-full" />}
              {filteredProfiles.map((p) => (
                <button
                  key={p.pubkey}
                  onClick={() => selectProfile(p.pubkey)}
                  className="flex w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-muted"
                >
                  <UserAvatar pubkey={p.pubkey} picture={p.picture} name={p.display_name || p.name || ""} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{p.display_name || p.name || "Unnamed"}</p>
                    <p className="truncate font-mono text-xs text-muted-foreground">{p.pubkey}</p>
                  </div>
                </button>
              ))}
              {!profilesLoading && filteredProfiles.length === 0 && (
                <p className="p-2 text-sm text-muted-foreground">No matches.</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {pubkey && (
        // Keyed by pubkey so every section remounts on a user switch — without
        // it the grid would paint the previous user's loaded numbers under the
        // new user's name until each effect re-ran.
        <div key={pubkey} className="space-y-6">
          {/* Selected user header */}
          <Card>
            <CardContent className="flex items-center gap-4 p-4">
              <UserAvatar
                pubkey={pubkey}
                picture={shownProfile?.picture || undefined}
                name={shownProfile?.display_name || shownProfile?.full_name || ""}
                className="h-12 w-12"
              />
              <div className="min-w-0">
                <p className="text-lg font-semibold">
                  {shownProfile?.display_name || shownProfile?.full_name || "Unnamed"}
                </p>
                <p className="truncate font-mono text-xs text-muted-foreground">{pubkey}</p>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <BalancesSection pubkey={pubkey} fiatRate={fiatRate} fiatCurrency={fiatCurrency} />
            <Lana8WonderSection pubkey={pubkey} />
            <ProjectsSection pubkey={pubkey} />
            <LanaFundSection pubkey={pubkey} spending={spending} />
            <SpendingSection spending={spending} />
            <DiscountSection pubkey={pubkey} />
            <UnconditionalPaymentsSection pubkey={pubkey} />
            <Plan15Section pubkey={pubkey} />
            <DonationsSection pubkey={pubkey} />
            <DirectFundSection pubkey={pubkey} />
          </div>

          <p className="text-[11px] text-muted-foreground">
            Amounts in different currencies are never merged — the fleet publishes no exchange
            rate between them. Fiat next to LANA balances is approximate, at today's rate.
          </p>
        </div>
      )}
    </div>
  );
}

