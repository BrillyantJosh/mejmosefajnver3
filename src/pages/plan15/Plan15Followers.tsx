import { useEffect, useMemo, useState } from "react";
import { useNostrPlan15, Plan15Offer, LANOSHIS_PER_LANA } from "@/hooks/useNostrPlan15";
import { useNostrProfilesCacheBulk } from "@/hooks/useNostrProfilesCacheBulk";
import { useAuth } from "@/contexts/AuthContext";
import { useTranslation } from "@/i18n/I18nContext";
import plan15Translations from "@/i18n/modules/plan15";
import { checkWalletRegistration, WalletRegistrationStatus } from "@/lib/walletRegistration";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { QRScanner } from "@/components/QRScanner";
import { ScanLine, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";

const fmtLana = (lanoshis: number) =>
  (lanoshis / LANOSHIS_PER_LANA).toLocaleString("en-US", { maximumFractionDigits: 8 });

export default function Plan15Followers() {
  const { session } = useAuth();
  const { t } = useTranslation(plan15Translations);
  const { members, offers, isLoading, getOfferRemaining, getMemberHoldings, priceFor, publishAcceptance } = useNostrPlan15();
  const pubkeys = useMemo(() => members.map(m => m.pubkey), [members]);
  const { profiles } = useNostrProfilesCacheBulk(pubkeys);

  const [dialogOffer, setDialogOffer] = useState<Plan15Offer | null>(null);
  const [buyLana, setBuyLana] = useState("");
  const [buyerWallet, setBuyerWallet] = useState("");
  const [paymentRef, setPaymentRef] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [buyerWalletStatus, setBuyerWalletStatus] = useState<WalletRegistrationStatus | "idle" | "checking">("idle");
  const [scannerOpen, setScannerOpen] = useState(false);

  const nameFor = (pk: string) => {
    const p = profiles.get(pk);
    return p?.display_name || p?.full_name || pk.slice(0, 8) + "…";
  };

  const openBuy = (offer: Plan15Offer) => {
    setDialogOffer(offer);
    setBuyLana("");
    setBuyerWallet(""); // leave empty — the buyer enters their own UNREGISTERED receiving wallet
    setPaymentRef("");
    setBuyerWalletStatus("idle");
  };

  // The buyer's receiving wallet must also be UNREGISTERED (it receives unregistered LANA).
  useEffect(() => {
    const w = buyerWallet.trim();
    if (!dialogOffer || !w) { setBuyerWalletStatus("idle"); return; }
    setBuyerWalletStatus("checking");
    const timer = setTimeout(async () => {
      setBuyerWalletStatus(await checkWalletRegistration(w));
    }, 600);
    return () => clearTimeout(timer);
  }, [buyerWallet, dialogOffer]);

  const remainingLana = dialogOffer ? getOfferRemaining(dialogOffer) / LANOSHIS_PER_LANA : 0;
  const price = dialogOffer ? priceFor(dialogOffer.currency) : 0;
  const fiat = (parseFloat(buyLana || "0") * price).toFixed(2);

  const submitBuy = async () => {
    if (!dialogOffer) return;
    const lana = parseFloat(buyLana);
    if (!lana || lana <= 0) { toast.error(t("followers.errAmount")); return; }
    if (lana > remainingLana) { toast.error(t("followers.errTooMuch")); return; }
    if (!buyerWallet) { toast.error(t("followers.errAddr")); return; }
    if (buyerWalletStatus === "registered") { toast.error(t("followers.errBuyerRegistered")); return; }
    if (buyerWalletStatus !== "unregistered") { toast.error(t("me.errWaitCheck")); return; }
    setSubmitting(true);
    try {
      await publishAcceptance({
        offer: dialogOffer,
        buyerWallet,
        amountLanoshis: Math.round(lana * LANOSHIS_PER_LANA),
        paymentReference: paymentRef,
      });
      toast.success(t("followers.accepted"));
      setDialogOffer(null);
    } catch (e: any) {
      toast.error(e?.message || t("followers.errPublish"));
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

  return (
    <div className="space-y-4">
      <QRScanner
        isOpen={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onScan={(decoded) => {
          setBuyerWallet(decoded.replace(/^[a-zA-Z]+:/, "").split("?")[0].trim());
          setScannerOpen(false);
        }}
        title={t("me.scanWallet")}
        description={t("me.scanWalletDesc")}
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
        <DialogContent>
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
              <div>
                <Label>{t("followers.amountLabel")}</Label>
                <Input value={buyLana} onChange={e => setBuyLana(e.target.value)} inputMode="decimal" placeholder="100" />
              </div>
              <div>
                <Label>{t("followers.receivingAddr")}</Label>
                <div className="flex gap-2">
                  <Input value={buyerWallet} onChange={e => setBuyerWallet(e.target.value)} placeholder="L..." />
                  <Button type="button" variant="outline" size="icon" onClick={() => setScannerOpen(true)} title={t("me.scanQR")}>
                    <ScanLine className="h-4 w-4" />
                  </Button>
                </div>
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
                <Label>{t("followers.paymentRef")}</Label>
                <Input value={paymentRef} onChange={e => setPaymentRef(e.target.value)} />
              </div>
              <p className="text-sm">{t("followers.toPay")} <span className="font-semibold">{fiat} {dialogOffer.currency}</span></p>
              <p className="text-xs text-muted-foreground">{t("followers.fiatNote")}</p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOffer(null)}>{t("followers.cancel")}</Button>
            <Button onClick={submitBuy} disabled={submitting || buyerWalletStatus !== "unregistered"}>
              {submitting ? t("followers.publishing") : t("followers.acceptOffer")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
