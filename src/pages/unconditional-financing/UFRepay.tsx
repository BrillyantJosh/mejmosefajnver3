import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useUfRequest } from "@/hooks/useUFData";
import { splitRepayment } from "@/lib/ufShares";
import { useAuth } from "@/contexts/AuthContext";
import { useSystemParameters } from "@/contexts/SystemParametersContext";
import { useNostrWallets } from "@/hooks/useNostrWallets";
import { useNostrProfilesCacheBulk } from "@/hooks/useNostrProfilesCacheBulk";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft,
  AlertCircle,
  CheckCircle,
  HandCoins,
  Loader2,
  Undo2,
  Wallet,
} from "lucide-react";
import { useLang } from "@/i18n/I18nContext";

const maskWallet = (w: string) =>
  w && w.length > 14 ? `${w.slice(0, 6)}…${w.slice(-6)}` : w;

/**
 * Unconditional Financing — repay page (recipient only).
 * One multi-output LANA transaction distributed proportionally to all financiers.
 */
const UFRepay = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const sl = useLang() === "sl";
  const { session } = useAuth();
  const { parameters } = useSystemParameters();
  const { detail, isLoading, error } = useUfRequest(id);
  const { wallets, isLoading: walletsLoading } = useNostrWallets();

  const [fiatInput, setFiatInput] = useState<string>("");
  const [inputTouched, setInputTouched] = useState(false);
  const [selectedWalletId, setSelectedWalletId] = useState<string>("");
  const [walletBalances, setWalletBalances] = useState<Record<string, number>>({});
  const [loadingBalances, setLoadingBalances] = useState(false);

  const request = detail?.request;
  const financiers = useMemo(() => detail?.financiers || [], [detail?.financiers]);

  const totalFunded = detail?.totalFunded ?? 0;
  const totalRepaid = detail?.totalRepaid ?? 0;
  const outstanding = Math.max(totalFunded - totalRepaid, 0);
  const currency = request?.currency || "EUR";

  // rate semantics: fiat = lana * rate  =>  lana = fiat / rate
  const rate = parameters?.exchangeRates?.[currency as keyof typeof parameters.exchangeRates] || 0;

  // Default the amount to the full outstanding value once the detail loads.
  useEffect(() => {
    if (!inputTouched && detail && outstanding > 0 && fiatInput === "") {
      setFiatInput(outstanding.toFixed(2));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail, outstanding]);

  // Fetch balances for the user's wallets (same edge function as BatchFunding).
  useEffect(() => {
    const fetchBalances = async () => {
      if (!wallets || wallets.length === 0) return;
      const electrumServers = parameters?.electrumServers || [];
      if (electrumServers.length === 0) return;
      setLoadingBalances(true);
      try {
        const { data, error: balErr } = await supabase.functions.invoke("get-wallet-balances", {
          body: {
            wallet_addresses: wallets.map((w) => w.walletId),
            electrum_servers: electrumServers,
          },
        });
        if (balErr) throw balErr;
        if (data?.wallets) {
          const map: Record<string, number> = {};
          data.wallets.forEach((w: { wallet_id: string; balance: number }) => {
            map[w.wallet_id] = w.balance;
          });
          setWalletBalances(map);
        }
      } catch (e) {
        console.error("Error fetching wallet balances:", e);
      } finally {
        setLoadingBalances(false);
      }
    };
    fetchBalances();
  }, [wallets, parameters?.electrumServers]);

  const fiatAmount = parseFloat(fiatInput) || 0;
  const lanaTotal = rate > 0 ? fiatAmount / rate : 0;
  const totalLanoshis = Math.round(lanaTotal * 1e8);

  // Live proportional distribution — recomputed on every amount change.
  const outputs = useMemo(
    () =>
      splitRepayment(
        totalLanoshis,
        fiatAmount,
        financiers.map((f) => ({
          pubkey: f.pubkey,
          wallet: f.wallet,
          contributedFiat: f.amountFiat,
        })),
      ),
    [totalLanoshis, fiatAmount, financiers],
  );

  const financierPubkeys = useMemo(() => financiers.map((f) => f.pubkey), [financiers]);
  const { profiles } = useNostrProfilesCacheBulk(financierPubkeys);

  const selectableWallets = (wallets || []).filter((w) => w.walletType !== "Lana8Wonder");
  const selectedBalance = selectedWalletId ? walletBalances[selectedWalletId] : undefined;
  const hasSufficientBalance =
    selectedBalance !== undefined && lanaTotal > 0 && lanaTotal <= selectedBalance;
  const overOutstanding = fiatAmount > outstanding && outstanding > 0;

  const canContinue =
    fiatAmount > 0 &&
    rate > 0 &&
    outputs.length > 0 &&
    !!selectedWalletId &&
    !loadingBalances &&
    hasSufficientBalance;

  const handleContinue = () => {
    if (!canContinue || !id) return;
    navigate(`/unconditional-financing/repay/${id}/private-key`, {
      state: {
        selectedWalletId,
        fiatAmount,
        lanaTotal,
        totalLanoshis,
        rate,
        outputs,
      },
    });
  };

  // ── Loading ──
  if (isLoading || walletsLoading) {
    return (
      <div className="container mx-auto p-4 sm:p-6 pb-24 max-w-3xl space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  // ── Error / not found ──
  if (error || !detail || !request) {
    return (
      <div className="container mx-auto p-4 sm:p-6 pb-24 max-w-3xl">
        <Card>
          <CardContent className="p-6 text-center space-y-4">
            <AlertCircle className="h-10 w-10 text-destructive mx-auto" />
            <p className="text-muted-foreground">
              {sl ? "Zahtevka ni bilo mogoče naložiti." : "Could not load the request."}
            </p>
            <Button variant="outline" onClick={() => navigate("/unconditional-financing/requests")}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              {sl ? "Nazaj na financiranja" : "Back to financings"}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Guard: only the requester may repay ──
  if (!session?.nostrHexId || request.pubkey !== session.nostrHexId) {
    return (
      <div className="container mx-auto p-4 sm:p-6 pb-24 max-w-3xl">
        <Card>
          <CardContent className="p-6 text-center space-y-4">
            <AlertCircle className="h-10 w-10 text-muted-foreground mx-auto" />
            <p className="font-semibold">
              {sl ? "Vračilo lahko izvede samo prejemnik financiranja." : "Only the recipient of the financing can repay."}
            </p>
            <p className="text-sm text-muted-foreground">
              {sl
                ? "Ta stran je namenjena prejemniku, ki vrača prejeto vrednost financerjem."
                : "This page is for the recipient returning the received value to the financiers."}
            </p>
            <Button variant="outline" onClick={() => navigate(`/unconditional-financing/request/${id}`)}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              {sl ? "Nazaj na zahtevek" : "Back to request"}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Guard: nothing to repay yet ──
  if (financiers.length === 0) {
    return (
      <div className="container mx-auto p-4 sm:p-6 pb-24 max-w-3xl">
        <Card>
          <CardContent className="p-6 text-center space-y-4">
            <HandCoins className="h-10 w-10 text-muted-foreground mx-auto" />
            <p className="font-semibold">
              {sl ? "Ta zahtevek še nima financerjev." : "This request has no financiers yet."}
            </p>
            <p className="text-sm text-muted-foreground">
              {sl
                ? "Vračilo bo mogoče, ko bo zahtevek prejel vsaj en prispevek."
                : "Repayment becomes possible once the request receives at least one contribution."}
            </p>
            <Button variant="outline" onClick={() => navigate(`/unconditional-financing/request/${id}`)}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              {sl ? "Nazaj na zahtevek" : "Back to request"}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Guard: already fully repaid ──
  if (request.isRepaid) {
    return (
      <div className="container mx-auto p-4 sm:p-6 pb-24 max-w-3xl">
        <Card className="border-green-500/20 bg-green-500/5">
          <CardContent className="p-6 text-center space-y-4">
            <CheckCircle className="h-10 w-10 text-green-500 mx-auto" />
            <p className="font-semibold text-green-600">
              {sl ? "Ta zahtevek je v celoti poplačan. 🎉" : "This request is fully repaid. 🎉"}
            </p>
            <p className="text-sm text-muted-foreground">
              {sl
                ? "Celotna financirana vrednost je bila vrnjena financerjem."
                : "The entire financed value has been returned to the financiers."}
            </p>
            <Button variant="outline" onClick={() => navigate(`/unconditional-financing/request/${id}`)}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              {sl ? "Nazaj na zahtevek" : "Back to request"}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 sm:p-6 pb-24 max-w-3xl space-y-6">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate(`/unconditional-financing/request/${id}`)}
          className="gap-2"
        >
          <ArrowLeft className="h-4 w-4" />
          {sl ? "Nazaj" : "Back"}
        </Button>
      </div>

      <div>
        <h1 className="text-2xl sm:text-3xl font-bold flex items-center gap-2">
          <Undo2 className="h-6 w-6 text-primary" />
          {sl ? "Vračilo financiranja" : "Repay financing"}
        </h1>
        <p className="text-muted-foreground mt-1">{request.title}</p>
      </div>

      {/* Summary */}
      <Card className="border-green-500/20 bg-green-500/5">
        <CardContent className="p-4 grid grid-cols-3 gap-2 text-center">
          <div>
            <p className="text-xs text-muted-foreground">{sl ? "Financirano" : "Funded"}</p>
            <p className="font-bold">
              {totalFunded.toFixed(2)} {currency}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{sl ? "Že vrnjeno" : "Repaid"}</p>
            <p className="font-bold">
              {totalRepaid.toFixed(2)} {currency}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{sl ? "Odprto" : "Outstanding"}</p>
            <p className="font-bold text-green-600">
              {outstanding.toFixed(2)} {currency}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Amount */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{sl ? "Znesek vračila" : "Amount to repay"}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label htmlFor="repay-amount">
              {sl ? `Znesek (${currency})` : `Amount (${currency})`}
            </Label>
            <div className="flex gap-2 mt-2">
              <Input
                id="repay-amount"
                type="number"
                min="0"
                step="0.01"
                value={fiatInput}
                onChange={(e) => {
                  setInputTouched(true);
                  setFiatInput(e.target.value);
                }}
                placeholder="0.00"
                className="text-right"
              />
              {outstanding > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="px-3 h-10 text-xs font-bold shrink-0"
                  onClick={() => {
                    setInputTouched(true);
                    setFiatInput(outstanding.toFixed(2));
                  }}
                >
                  MAX
                </Button>
              )}
            </div>
          </div>

          {rate > 0 && fiatAmount > 0 && (
            <div className="bg-muted p-3 rounded-md text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">{sl ? "Menjalno razmerje" : "Exchange rate"}</span>
                <span className="font-mono text-xs">
                  1 LANA = {rate} {currency}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{sl ? "Potrebna LANA" : "LANA required"}</span>
                <span className="font-semibold">{lanaTotal.toFixed(4)} LANA</span>
              </div>
            </div>
          )}

          {rate <= 0 && (
            <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 p-3 rounded-md">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>
                {sl
                  ? `Menjalno razmerje za ${currency} trenutno ni na voljo. Poskusite kasneje.`
                  : `The exchange rate for ${currency} is currently unavailable. Please try again later.`}
              </span>
            </div>
          )}

          {inputTouched && fiatInput !== "" && fiatAmount <= 0 && (
            <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 p-3 rounded-md">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{sl ? "Znesek mora biti večji od 0." : "The amount must be greater than 0."}</span>
            </div>
          )}

          {overOutstanding && (
            <div className="flex items-center gap-2 text-sm text-amber-600 bg-amber-500/10 p-3 rounded-md">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>
                {sl
                  ? `Znesek presega odprto vrednost (${outstanding.toFixed(2)} ${currency}). Prostovoljno preplačilo je dovoljeno.`
                  : `The amount exceeds the outstanding value (${outstanding.toFixed(2)} ${currency}). Voluntary overpayment is allowed.`}
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Live distribution table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            {sl ? "Razdelitev med financerje" : "Distribution among financiers"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {fiatAmount <= 0 || rate <= 0 ? (
            <p className="text-sm text-muted-foreground">
              {sl
                ? "Vnesite znesek, da vidite razdelitev vračila."
                : "Enter an amount to see the repayment distribution."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-2 font-medium">{sl ? "Financer" : "Financier"}</th>
                    <th className="py-2 px-2 font-medium text-right">{sl ? "Delež" : "Share"}</th>
                    <th className="py-2 px-2 font-medium text-right">{currency}</th>
                    <th className="py-2 px-2 font-medium text-right">LANA</th>
                    <th className="py-2 pl-2 font-medium">{sl ? "Denarnica" : "Wallet"}</th>
                  </tr>
                </thead>
                <tbody>
                  {outputs.map((o) => {
                    const profile = profiles.get(o.pubkey);
                    const name =
                      profile?.display_name ||
                      profile?.full_name ||
                      `${o.pubkey.slice(0, 8)}…`;
                    return (
                      <tr key={o.pubkey + o.wallet} className="border-b last:border-0">
                        <td className="py-2 pr-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <UserAvatar
                              pubkey={o.pubkey}
                              picture={profile?.picture}
                              name={name}
                              className="h-7 w-7 shrink-0"
                            />
                            <span className="truncate max-w-[9rem]">{name}</span>
                          </div>
                        </td>
                        <td className="py-2 px-2 text-right whitespace-nowrap">
                          {o.sharePercent.toFixed(1)}%
                        </td>
                        <td className="py-2 px-2 text-right font-semibold whitespace-nowrap">
                          {o.fiat.toFixed(2)}
                        </td>
                        <td className="py-2 px-2 text-right whitespace-nowrap">
                          {(o.lanoshis / 1e8).toFixed(4)}
                        </td>
                        <td className="py-2 pl-2 font-mono text-xs whitespace-nowrap">
                          {maskWallet(o.wallet)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            {sl
              ? "Zelo majhni (prašni) deleži se združijo v delež največjega financerja, da ne nastanejo neuporabni izhodi na verigi."
              : "Very small (dust) shares are folded into the largest financier's share to avoid unspendable on-chain outputs."}
          </p>
        </CardContent>
      </Card>

      {/* Source wallet */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{sl ? "Denarnica za plačilo" : "Source wallet"}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {selectableWallets.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {sl ? "Nimate registriranih denarnic." : "You have no registered wallets."}
            </p>
          ) : (
            <>
              <div>
                <Label htmlFor="wallet-select">{sl ? "Izberite denarnico" : "Select wallet"}</Label>
                <Select value={selectedWalletId} onValueChange={setSelectedWalletId}>
                  <SelectTrigger id="wallet-select" className="mt-2">
                    <SelectValue placeholder={sl ? "Izberite denarnico" : "Select wallet"} />
                  </SelectTrigger>
                  <SelectContent>
                    {selectableWallets.map((wallet) => (
                      <SelectItem
                        key={wallet.walletId}
                        value={wallet.walletId}
                        disabled={!!wallet.freezeStatus}
                      >
                        <div className="flex flex-col items-start">
                          <div className="font-mono text-xs">{maskWallet(wallet.walletId)}</div>
                          <div className="text-xs text-muted-foreground">
                            {wallet.walletType}
                            {wallet.freezeStatus ? (sl ? " — zamrznjena" : " — frozen") : ""}
                            {walletBalances[wallet.walletId] !== undefined
                              ? ` · ${walletBalances[wallet.walletId].toFixed(2)} LANA`
                              : ""}
                          </div>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {selectedWalletId && (
                <div className="bg-muted p-3 rounded-md text-sm space-y-1">
                  <div className="flex items-center gap-2">
                    <Wallet className="h-4 w-4 text-muted-foreground" />
                    <span className="font-mono text-xs break-all">{selectedWalletId}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{sl ? "Stanje" : "Balance"}</span>
                    {loadingBalances ? (
                      <Loader2 className="h-3 w-3 animate-spin inline" />
                    ) : (
                      <span className="font-semibold">
                        {selectedBalance !== undefined
                          ? `${selectedBalance.toFixed(2)} LANA`
                          : sl
                            ? "Ni podatka"
                            : "Unavailable"}
                      </span>
                    )}
                  </div>
                  {lanaTotal > 0 && selectedBalance !== undefined && (
                    hasSufficientBalance ? (
                      <p className="text-sm text-green-600 flex items-center gap-2">
                        <CheckCircle className="h-4 w-4" />
                        {sl ? "Dovolj sredstev" : "Sufficient balance"}
                      </p>
                    ) : (
                      <p className="text-sm text-destructive flex items-center gap-2">
                        <AlertCircle className="h-4 w-4" />
                        {sl
                          ? `Premalo sredstev — potrebujete ${lanaTotal.toFixed(4)} LANA`
                          : `Insufficient balance — you need ${lanaTotal.toFixed(4)} LANA`}
                      </p>
                    )
                  )}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Continue */}
      <Button
        onClick={handleContinue}
        disabled={!canContinue}
        className="w-full bg-green-500 hover:bg-green-600 text-white h-12 disabled:opacity-50"
      >
        {sl
          ? `Nadaljuj — vrni ${fiatAmount > 0 ? fiatAmount.toFixed(2) : "0.00"} ${currency}`
          : `Continue — repay ${fiatAmount > 0 ? fiatAmount.toFixed(2) : "0.00"} ${currency}`}
      </Button>
    </div>
  );
};

export default UFRepay;
