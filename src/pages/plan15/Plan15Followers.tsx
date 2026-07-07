import { useEffect, useMemo, useState } from "react";
import { useNostrPlan15, Plan15Offer, LANOSHIS_PER_LANA } from "@/hooks/useNostrPlan15";
import { useNostrProfilesCacheBulk } from "@/hooks/useNostrProfilesCacheBulk";
import { useNostrUserWallets } from "@/hooks/useNostrUserWallets";
import { useAuth } from "@/contexts/AuthContext";
import { useSystemParameters } from "@/contexts/SystemParametersContext";
import { useTranslation } from "@/i18n/I18nContext";
import plan15Translations from "@/i18n/modules/plan15";
import { checkWalletRegistration, WalletRegistrationStatus } from "@/lib/walletRegistration";
import { convertWifToIds } from "@/lib/crypto";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { QRScanner } from "@/components/QRScanner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScanLine, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";

// Registered wallet types allowed as the PLAN15 paying wallet (from KIND 30889).
const PAYMENT_WALLET_TYPES = ["Main Wallet", "Wallet", "Retail"];

const fmtLana = (lanoshis: number) =>
  (lanoshis / LANOSHIS_PER_LANA).toLocaleString("en-US", { maximumFractionDigits: 8 });

export default function Plan15Followers() {
  const { session } = useAuth();
  const { parameters } = useSystemParameters();
  const { t } = useTranslation(plan15Translations);
  const { members, offers, isLoading, myMembership, getOfferRemaining, getMemberHoldings, priceFor, fxFor, getRegisteredPayLanoshis, publishAcceptance } = useNostrPlan15();
  const pubkeys = useMemo(() => members.map(m => m.pubkey), [members]);
  const { profiles } = useNostrProfilesCacheBulk(pubkeys);
  const { wallets: registeredWallets } = useNostrUserWallets(session?.nostrHexId || null);
  const eligibleWallets = registeredWallets.filter(w => PAYMENT_WALLET_TYPES.includes(w.walletType));

  const [dialogOffer, setDialogOffer] = useState<Plan15Offer | null>(null);
  const [buyLana, setBuyLana] = useState("");
  const [buyerWallet, setBuyerWallet] = useState("");   // UNREGISTERED receiving wallet
  const [payingWallet, setPayingWallet] = useState(""); // REGISTERED paying wallet
  const [wif, setWif] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [buyerWalletStatus, setBuyerWalletStatus] = useState<WalletRegistrationStatus | "idle" | "checking">("idle");
  const [scannerTarget, setScannerTarget] = useState<null | "receiving" | "wif">(null);
  const [payingBalance, setPayingBalance] = useState(0);

  const nameFor = (pk: string) => {
    const p = profiles.get(pk);
    return p?.display_name || p?.full_name || pk.slice(0, 8) + "…";
  };

  const sellerMembership = dialogOffer ? members.find(m => m.pubkey === dialogOffer.seller) : null;
  const sellerPaymentWallet = sellerMembership?.paymentWallet || "";

  const openBuy = (offer: Plan15Offer) => {
    setDialogOffer(offer);
    setBuyLana("");
    setBuyerWallet(myMembership?.wallet || ""); // receive into MY PLAN15 profile wallet (NOT the staker wallet)
    setPayingWallet("");
    setWif("");
    setBuyerWalletStatus("idle");
  };

  // Receiving wallet must be UNREGISTERED (it receives unregistered LANA).
  useEffect(() => {
    const w = buyerWallet.trim();
    if (!dialogOffer || !w) { setBuyerWalletStatus("idle"); return; }
    setBuyerWalletStatus("checking");
    const timer = setTimeout(async () => setBuyerWalletStatus(await checkWalletRegistration(w)), 600);
    return () => clearTimeout(timer);
  }, [buyerWallet, dialogOffer]);

  // The paying wallet is PICKED from the registered KIND 30889 list, so it is
  // registered by construction — no async check needed.
  const payingWalletOk = !!payingWallet && eligibleWallets.some(w => w.walletId === payingWallet);

  // Fetch the paying wallet's on-chain balance (used for the frozen-wallet limit).
  useEffect(() => {
    const w = payingWallet.trim();
    if (!w || !parameters?.electrumServers?.length) { setPayingBalance(0); return; }
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase.functions.invoke("get-wallet-balances", {
          body: { wallet_addresses: [w], electrum_servers: parameters.electrumServers },
        });
        if (cancelled) return;
        const b = (data?.wallets || []).find((x: any) => x.wallet_id === w);
        setPayingBalance(b?.confirmed_balance ?? b?.balance ?? 0);
      } catch { if (!cancelled) setPayingBalance(0); }
    })();
    return () => { cancelled = true; };
  }, [payingWallet, parameters?.electrumServers]);

  const amountLanoshis = Math.round((parseFloat(buyLana || "0") || 0) * LANOSHIS_PER_LANA);
  const remainingLana = dialogOffer ? getOfferRemaining(dialogOffer) / LANOSHIS_PER_LANA : 0;
  const price = dialogOffer ? priceFor(dialogOffer.currency) : 0;
  const fiat = (parseFloat(buyLana || "0") * price).toFixed(2);
  const payLanoshis = dialogOffer ? getRegisteredPayLanoshis(amountLanoshis, dialogOffer.currency) : 0;
  const payLana = payLanoshis / LANOSHIS_PER_LANA;

  // A FROZEN paying wallet may still transact, but capped: max 50% of funds AND max €100.
  const payingWalletObj = eligibleWallets.find(w => w.walletId === payingWallet);
  const payingFrozen = !!payingWalletObj?.freezeStatus;
  const fxCur = dialogOffer ? fxFor(dialogOffer.currency) : 0;
  const frozenCapLana = payingFrozen
    ? Math.min(0.5 * payingBalance, fxCur > 0 ? 100 / fxCur : 0)
    : Infinity;
  const overFrozenLimit = payingFrozen && payLana > frozenCapLana;

  const submitBuy = async () => {
    if (!dialogOffer) return;
    const lana = parseFloat(buyLana);
    if (!lana || lana <= 0) { toast.error(t("followers.errAmount")); return; }
    if (lana > remainingLana) { toast.error(t("followers.errTooMuch")); return; }
    if (!sellerPaymentWallet) { toast.error(t("followers.sellerNoPayment")); return; }
    if (!buyerWallet) { toast.error(t("followers.errAddr")); return; }
    if (buyerWalletStatus === "registered") { toast.error(t("followers.errBuyerRegistered")); return; }
    if (buyerWalletStatus !== "unregistered") { toast.error(t("me.errWaitCheck")); return; }
    if (!payingWallet || !payingWalletOk) { toast.error(t("followers.errPayWalletReg")); return; }
    if (!wif.trim()) { toast.error(t("followers.errWif")); return; }
    if (payLanoshis <= 0) { toast.error(t("followers.errAmount")); return; }
    if (overFrozenLimit) { toast.error(t("followers.errFrozenLimit")); return; }

    setSubmitting(true);
    try {
      // Validate the WIF matches the paying (registered) wallet
      const ids = await convertWifToIds(wif.trim());
      const match =
        ids.walletIdCompressed === payingWallet ||
        ids.walletIdUncompressed === payingWallet ||
        ids.walletId === payingWallet;
      if (!match) { toast.error(t("followers.errWifMismatch")); setSubmitting(false); return; }

      // Leg 1: send REGISTERED LANA on-chain to the seller's payment_wallet
      const { data, error } = await supabase.functions.invoke("send-lana-transaction", {
        body: {
          senderAddress: payingWallet,
          recipientAddress: sellerPaymentWallet,
          amount: payLana,
          privateKey: wif.trim(),
          electrumServers: parameters?.electrumServers || [],
          // Omit userPubkey for a FROZEN wallet so the server skips its freeze block;
          // the 50% / €100 limit is enforced client-side (overFrozenLimit) above.
          userPubkey: payingFrozen ? undefined : session?.nostrHexId,
        },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || t("followers.errPayFailed"));

      await publishAcceptance({
        offer: dialogOffer,
        buyerWallet,
        amountLanoshis,
        paymentFrom: payingWallet,
        paymentTo: sellerPaymentWallet,
        paymentAmountLanoshis: payLanoshis,
        paymentTxid: data.txHash,
      });
      toast.success(t("followers.accepted"));
      setDialogOffer(null);
    } catch (e: any) {
      toast.error(e?.message || t("followers.errPayFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  if (isLoading) {
    return <div className="space-y-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-24 w-full" />)}</div>;
  }

  if (members.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-muted-foreground">
          {t("followers.empty")}
        </CardContent>
      </Card>
    );
  }

  const canSubmit =
    !!sellerPaymentWallet &&
    buyerWalletStatus === "unregistered" &&
    payingWalletOk &&
    !!wif.trim() &&
    payLanoshis > 0 &&
    !overFrozenLimit;

  return (
    <div className="space-y-4">
      <QRScanner
        isOpen={scannerTarget !== null}
        onClose={() => setScannerTarget(null)}
        onScan={(decoded) => {
          if (scannerTarget === "wif") {
            setWif(decoded.trim());
          } else {
            setBuyerWallet(decoded.replace(/^[a-zA-Z]+:/, "").split("?")[0].trim());
          }
          setScannerTarget(null);
        }}
        title={scannerTarget === "wif" ? t("followers.scanWif") : t("me.scanWallet")}
        description={scannerTarget === "wif" ? t("followers.scanWifDesc") : t("me.scanWalletDesc")}
      />

      {members.map(member => {
        const memberOffers = offers.filter(o => o.seller === member.pubkey && o.status === "active");
        const sellingLanoshis = memberOffers.reduce((s, o) => s + getOfferRemaining(o), 0);
        return (
          <Card key={member.pubkey}>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                {nameFor(member.pubkey)}
                {member.isStaker && <Badge variant="secondary">{t("followers.staker")}</Badge>}
                {member.pubkey === session?.nostrHexId && <Badge variant="outline">{t("followers.me")}</Badge>}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
                <div>
                  <span className="text-muted-foreground">{t("followers.holds")} </span>
                  <span className="font-semibold">{getMemberHoldings(member).toLocaleString("en-US", { maximumFractionDigits: 2 })} LANA</span>
                </div>
                <div>
                  <span className="text-muted-foreground">{t("followers.selling")} </span>
                  <span className="font-semibold">{fmtLana(sellingLanoshis)} LANA</span>
                </div>
              </div>
              {memberOffers.length > 0 && (
                <div className="space-y-2">
                  {memberOffers.map(offer => {
                    const rem = getOfferRemaining(offer);
                    const offerFiat = ((rem / LANOSHIS_PER_LANA) * priceFor(offer.currency))
                      .toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                    const canBuy = member.pubkey !== session?.nostrHexId && rem > 0;
                    return (
                      <div key={offer.address} className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm">
                        <div>
                          <span className="font-medium">{fmtLana(rem)} LANA</span>
                          <span className="text-muted-foreground"> @ {priceFor(offer.currency)} {offer.currency}/LANA</span>
                          <span className="font-semibold"> = {offerFiat} {offer.currency}</span>
                        </div>
                        <Button size="sm" disabled={!canBuy} onClick={() => openBuy(offer)}>{t("followers.buy")}</Button>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}

      <Dialog open={!!dialogOffer} onOpenChange={(o) => !o && setDialogOffer(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{t("followers.dialogTitle")}</DialogTitle></DialogHeader>
          {dialogOffer && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {t("followers.remaining", {
                  amount: remainingLana.toLocaleString("en-US", { maximumFractionDigits: 8 }),
                  price,
                  currency: dialogOffer.currency,
                })}
              </p>

              {!sellerPaymentWallet && (
                <p className="text-sm text-red-600 dark:text-red-400">{t("followers.sellerNoPayment")}</p>
              )}

              <div>
                <Label>{t("followers.amountLabel")}</Label>
                <Input value={buyLana} onChange={e => setBuyLana(e.target.value)} inputMode="decimal" placeholder="100" />
              </div>

              <div className="rounded-md bg-muted/50 p-2 text-sm">
                <div>{t("followers.youPayRegistered")} <span className="font-semibold">{payLana.toLocaleString("en-US", { maximumFractionDigits: 8 })} LANA</span></div>
                <div className="text-xs text-muted-foreground">≈ {fiat} {dialogOffer.currency}</div>
              </div>

              <div>
                <Label>{t("followers.receivingAddr")}</Label>
                {myMembership?.wallet ? (
                  <>
                    <div className="mt-1 rounded-md border bg-muted/50 px-3 py-2 font-mono text-sm break-all">{buyerWallet}</div>
                    <p className="mt-1 text-xs text-muted-foreground">{t("followers.receivingFromProfile")}</p>
                  </>
                ) : (
                  <div className="flex gap-2">
                    <Input value={buyerWallet} onChange={e => setBuyerWallet(e.target.value)} placeholder="L..." />
                    <Button type="button" variant="outline" size="icon" onClick={() => setScannerTarget("receiving")} title={t("me.scanQR")}>
                      <ScanLine className="h-4 w-4" />
                    </Button>
                  </div>
                )}
                {buyerWalletStatus === "checking" && (
                  <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> {t("me.checking")}</p>
                )}
                {buyerWalletStatus === "unregistered" && (
                  <p className="mt-1 flex items-center gap-1 text-xs text-green-600 dark:text-green-400"><CheckCircle2 className="h-3 w-3" /> {t("me.unregisteredOk")}</p>
                )}
                {buyerWalletStatus === "registered" && (
                  <p className="mt-1 flex items-center gap-1 text-xs text-red-600 dark:text-red-400"><XCircle className="h-3 w-3" /> {t("me.registeredBad")}</p>
                )}
                {buyerWalletStatus === "error" && (
                  <p className="mt-1 flex items-center gap-1 text-xs text-yellow-600 dark:text-yellow-400"><XCircle className="h-3 w-3" /> {t("me.checkError")}</p>
                )}
              </div>

              <div>
                <Label>{t("followers.payingWallet")}</Label>
                {eligibleWallets.length > 0 ? (
                  <Select value={payingWallet} onValueChange={setPayingWallet}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder={t("followers.selectWallet")} /></SelectTrigger>
                    <SelectContent>
                      {eligibleWallets.map(w => (
                        <SelectItem key={w.walletId} value={w.walletId}>
                          {w.walletType} · {w.walletId.slice(0, 10)}…
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <p className="text-xs text-muted-foreground mt-1">{t("me.noRegisteredWallets")}</p>
                )}
                {payingFrozen && (
                  <p className="mt-1 text-xs text-yellow-600 dark:text-yellow-400">
                    {t("followers.frozenLimit", { amount: (isFinite(frozenCapLana) ? frozenCapLana : 0).toLocaleString("en-US", { maximumFractionDigits: 8 }) })}
                  </p>
                )}
              </div>

              <div>
                <Label>{t("followers.wifLabel")}</Label>
                <div className="flex gap-2">
                  <Input type="password" value={wif} onChange={e => setWif(e.target.value)} placeholder="WIF" />
                  <Button type="button" variant="outline" size="icon" onClick={() => setScannerTarget("wif")} title={t("followers.scanWif")}>
                    <ScanLine className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOffer(null)}>{t("followers.cancel")}</Button>
            <Button onClick={submitBuy} disabled={submitting || !canSubmit}>
              {submitting ? t("followers.paying") : t("followers.acceptOffer")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
