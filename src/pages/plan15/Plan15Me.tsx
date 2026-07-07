import { useEffect, useState } from "react";
import { useNostrPlan15, LANOSHIS_PER_LANA } from "@/hooks/useNostrPlan15";
import { useSystemParameters } from "@/contexts/SystemParametersContext";
import { useTranslation } from "@/i18n/I18nContext";
import plan15Translations from "@/i18n/modules/plan15";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { QRScanner } from "@/components/QRScanner";
import { checkWalletRegistration, WalletRegistrationStatus } from "@/lib/walletRegistration";
import { ScanLine, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";

export default function Plan15Me() {
  const { parameters } = useSystemParameters();
  const { t } = useTranslation(plan15Translations);
  const {
    isLoading, myMembership, myOffers, myPurchases, getPayoutForAcceptance,
    publishMembership, publishOffer, getMemberHoldings, getMemberSellable, priceFor,
  } = useNostrPlan15();

  // membership form
  const [wallet, setWallet] = useState("");
  const [isStaker, setIsStaker] = useState(false);
  const [stakerWallet, setStakerWallet] = useState("");
  const [savingMember, setSavingMember] = useState(false);

  // offer form
  const [offerLana, setOfferLana] = useState("");
  const [savingOffer, setSavingOffer] = useState(false);

  // wallet registration guard (PLAN15 requires an UNREGISTERED wallet) + QR scan
  const [walletStatus, setWalletStatus] = useState<WalletRegistrationStatus | "idle" | "checking">("idle");
  const [scannerTarget, setScannerTarget] = useState<null | "wallet" | "staker">(null);

  useEffect(() => {
    // Pre-fill ONLY for an existing member (their own previously-saved wallet).
    // For a new user leave the field EMPTY — never auto-fill the main wallet.
    if (myMembership) {
      setWallet(myMembership.wallet);
      setIsStaker(myMembership.isStaker);
      setStakerWallet(myMembership.stakerWallet);
    }
  }, [myMembership]);

  // Debounced check: the PLAN15 wallet must NOT be a registered wallet.
  useEffect(() => {
    const w = wallet.trim();
    if (!w) { setWalletStatus("idle"); return; }
    setWalletStatus("checking");
    const timer = setTimeout(async () => {
      const status = await checkWalletRegistration(w);
      setWalletStatus(status);
    }, 600);
    return () => clearTimeout(timer);
  }, [wallet]);

  const holdings = myMembership ? getMemberHoldings(myMembership) : 0;
  const sellable = myMembership ? getMemberSellable(myMembership) : 0;

  const saveMembership = async () => {
    if (!wallet) { toast.error(t("me.errEnterWallet")); return; }
    if (walletStatus === "registered") { toast.error(t("me.errRegistered")); return; }
    if (walletStatus !== "unregistered") { toast.error(t("me.errWaitCheck")); return; }
    if (isStaker && !stakerWallet) { toast.error(t("me.errStakerWallet")); return; }
    setSavingMember(true);
    try {
      await publishMembership({ plan15Wallet: wallet, isStaker, stakerWallet });
      toast.success(myMembership ? t("me.membershipUpdated") : t("me.joined"));
    } catch (e: any) {
      toast.error(e?.message || t("me.error"));
    } finally {
      setSavingMember(false);
    }
  };

  const saveOffer = async () => {
    const lana = parseFloat(offerLana);
    if (!myMembership) { toast.error(t("me.errJoinFirst")); return; }
    if (walletStatus === "registered") { toast.error(t("me.errWalletRegisteredOffer")); return; }
    if (!lana || lana <= 0) { toast.error(t("followers.errAmount")); return; }
    if (lana > sellable) { toast.error(t("me.errTooMuchFloor", { amount: sellable })); return; }
    setSavingOffer(true);
    try {
      await publishOffer({ wallet: myMembership.wallet, amountLanoshis: Math.round(lana * LANOSHIS_PER_LANA) });
      toast.success(t("me.offerPublished"));
      setOfferLana("");
    } catch (e: any) {
      toast.error(e?.message || t("me.error"));
    } finally {
      setSavingOffer(false);
    }
  };

  if (isLoading) {
    return <div className="space-y-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-28 w-full" />)}</div>;
  }

  return (
    <div className="space-y-6">
      <QRScanner
        isOpen={scannerTarget !== null}
        onClose={() => setScannerTarget(null)}
        onScan={(decoded) => {
          const addr = decoded.replace(/^[a-zA-Z]+:/, "").split("?")[0].trim();
          if (scannerTarget === "wallet") setWallet(addr);
          else if (scannerTarget === "staker") setStakerWallet(addr);
          setScannerTarget(null);
        }}
        title={t("me.scanWallet")}
        description={t("me.scanWalletDesc")}
      />

      {/* Membership */}
      <Card>
        <CardHeader><CardTitle className="text-base">{myMembership ? t("me.myMembership") : t("me.join")}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label>{t("me.walletLabel")}</Label>
            <div className="flex gap-2">
              <Input value={wallet} onChange={e => setWallet(e.target.value)} placeholder="L..." />
              <Button type="button" variant="outline" size="icon" onClick={() => setScannerTarget("wallet")} title={t("me.scanQR")}>
                <ScanLine className="h-4 w-4" />
              </Button>
            </div>
            {walletStatus === "checking" && (
              <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> {t("me.checking")}</p>
            )}
            {walletStatus === "unregistered" && (
              <p className="mt-1 flex items-center gap-1 text-xs text-green-600 dark:text-green-400"><CheckCircle2 className="h-3 w-3" /> {t("me.unregisteredOk")}</p>
            )}
            {walletStatus === "registered" && (
              <p className="mt-1 flex items-center gap-1 text-xs text-red-600 dark:text-red-400"><XCircle className="h-3 w-3" /> {t("me.registeredBad")}</p>
            )}
            {walletStatus === "error" && (
              <p className="mt-1 flex items-center gap-1 text-xs text-yellow-600 dark:text-yellow-400"><XCircle className="h-3 w-3" /> {t("me.checkError")}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={isStaker} onCheckedChange={setIsStaker} />
            <Label>{t("me.isStaker")}</Label>
          </div>
          {isStaker && (
            <div>
              <Label>{t("me.stakerWallet")}</Label>
              <div className="flex gap-2">
                <Input value={stakerWallet} onChange={e => setStakerWallet(e.target.value)} placeholder="L... / T..." />
                <Button type="button" variant="outline" size="icon" onClick={() => setScannerTarget("staker")} title={t("me.scanQR")}>
                  <ScanLine className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
          <Button onClick={saveMembership} disabled={savingMember || walletStatus !== "unregistered"}>
            {savingMember ? t("me.saving") : (myMembership ? t("me.update") : t("me.joinBtn"))}
          </Button>
        </CardContent>
      </Card>

      {myMembership && (
        <>
          {/* Holdings */}
          <Card>
            <CardHeader><CardTitle className="text-base">{t("me.myHoldings")}</CardTitle></CardHeader>
            <CardContent className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
              <div>
                <span className="text-muted-foreground">{t("me.iHave")} </span>
                <span className="font-semibold">{holdings.toLocaleString("en-US", { maximumFractionDigits: 2 })} LANA</span>
                {myMembership.isStaker && myMembership.stakerWallet && (
                  <span className="text-muted-foreground text-xs ml-1">{t("me.includesStaker")}</span>
                )}
              </div>
              <div>
                <span className="text-muted-foreground">{t("me.floor")} </span>
                <span className="font-semibold">{(parameters?.plan15Floor || 0).toLocaleString("en-US")} LANA</span>
              </div>
              <div>
                <span className="text-muted-foreground">{t("me.forSale")} </span>
                <span className="font-semibold">{sellable.toLocaleString("en-US", { maximumFractionDigits: 2 })} LANA</span>
              </div>
            </CardContent>
          </Card>

          {/* Publish offer */}
          <Card>
            <CardHeader><CardTitle className="text-base">{t("me.publishOffer")}</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label>{t("me.amountToSell")}</Label>
                <Input value={offerLana} onChange={e => setOfferLana(e.target.value)} inputMode="decimal" placeholder={t("me.max", { amount: sellable })} />
              </div>
              <p className="text-xs text-muted-foreground">{t("me.communityPrice", { price: priceFor("EUR") })}</p>
              <Button onClick={saveOffer} disabled={savingOffer || sellable <= 0}>
                {savingOffer ? t("followers.publishing") : t("me.publishOfferBtn")}
              </Button>
            </CardContent>
          </Card>

          {/* My active offers */}
          {myOffers.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">{t("me.myOffers")}</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                {myOffers.map(o => (
                  <div key={o.address} className="flex items-center justify-between rounded-md border p-2">
                    <span>{(o.amount / LANOSHIS_PER_LANA).toLocaleString("en-US", { maximumFractionDigits: 8 })} LANA</span>
                    <Badge variant={o.status === "active" ? "default" : "secondary"}>{o.status}</Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* My purchases */}
      <Card>
        <CardHeader><CardTitle className="text-base">{t("me.myPurchases")}</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          {myPurchases.length === 0 && <p className="text-muted-foreground">{t("me.nothingBought")}</p>}
          {myPurchases.map(p => {
            const payout = getPayoutForAcceptance(p.id);
            return (
              <div key={p.id} className="flex items-center justify-between gap-2 rounded-md border p-2">
                <div>
                  <div>{(p.amount / LANOSHIS_PER_LANA).toLocaleString("en-US", { maximumFractionDigits: 8 })} LANA · {p.amountFiat} {p.currency}</div>
                  {payout?.txid && <div className="text-xs text-muted-foreground font-mono break-all">TX: {payout.txid}</div>}
                </div>
                {payout ? <Badge className="bg-green-600 hover:bg-green-600">{t("me.paidOut")}</Badge> : <Badge variant="secondary">{t("me.pending")}</Badge>}
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
