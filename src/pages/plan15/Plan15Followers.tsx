import { useMemo, useState } from "react";
import { useNostrPlan15, Plan15Offer, LANOSHIS_PER_LANA } from "@/hooks/useNostrPlan15";
import { useNostrProfilesCacheBulk } from "@/hooks/useNostrProfilesCacheBulk";
import { useAuth } from "@/contexts/AuthContext";
import { useTranslation } from "@/i18n/I18nContext";
import plan15Translations from "@/i18n/modules/plan15";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";

const fmtLana = (lanoshis: number) =>
  (lanoshis / LANOSHIS_PER_LANA).toLocaleString("en-US", { maximumFractionDigits: 8 });

export default function Plan15Followers() {
  const { session } = useAuth();
  const { t } = useTranslation(plan15Translations);
  const { members, offers, isLoading, getOfferRemaining, getHoldingsLana, priceFor, publishAcceptance } = useNostrPlan15();
  const pubkeys = useMemo(() => members.map(m => m.pubkey), [members]);
  const { profiles } = useNostrProfilesCacheBulk(pubkeys);

  const [dialogOffer, setDialogOffer] = useState<Plan15Offer | null>(null);
  const [buyLana, setBuyLana] = useState("");
  const [buyerWallet, setBuyerWallet] = useState("");
  const [paymentRef, setPaymentRef] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const nameFor = (pk: string) => {
    const p = profiles.get(pk);
    return p?.display_name || p?.full_name || pk.slice(0, 8) + "…";
  };

  const openBuy = (offer: Plan15Offer) => {
    setDialogOffer(offer);
    setBuyLana("");
    setBuyerWallet(session?.walletId || "");
    setPaymentRef("");
  };

  const remainingLana = dialogOffer ? getOfferRemaining(dialogOffer) / LANOSHIS_PER_LANA : 0;
  const price = dialogOffer ? priceFor(dialogOffer.currency) : 0;
  const fiat = (parseFloat(buyLana || "0") * price).toFixed(2);

  const submitBuy = async () => {
    if (!dialogOffer) return;
    const lana = parseFloat(buyLana);
    if (!lana || lana <= 0) { toast.error(t("followers.errAmount")); return; }
    if (lana > remainingLana) { toast.error(t("followers.errTooMuch")); return; }
    if (!buyerWallet) { toast.error(t("followers.errAddr")); return; }
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
                  <span className="font-semibold">{getHoldingsLana(member.wallet).toLocaleString("en-US", { maximumFractionDigits: 2 })} LANA</span>
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
                    const canBuy = member.pubkey !== session?.nostrHexId && rem > 0;
                    return (
                      <div key={offer.address} className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm">
                        <div>
                          <span className="font-medium">{fmtLana(rem)} LANA</span>
                          <span className="text-muted-foreground"> @ {priceFor(offer.currency)} {offer.currency}/LANA</span>
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
                <Input value={buyerWallet} onChange={e => setBuyerWallet(e.target.value)} placeholder="L..." />
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
            <Button onClick={submitBuy} disabled={submitting}>{submitting ? t("followers.publishing") : t("followers.acceptOffer")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
