import { useEffect, useState } from "react";
import { useNostrPlan15, LANOSHIS_PER_LANA } from "@/hooks/useNostrPlan15";
import { useAuth } from "@/contexts/AuthContext";
import { useSystemParameters } from "@/contexts/SystemParametersContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";

export default function Plan15Me() {
  const { session } = useAuth();
  const { parameters } = useSystemParameters();
  const {
    isLoading, myMembership, myOffers, myPurchases, getPayoutForAcceptance,
    publishMembership, publishOffer, getHoldingsLana, getSellableLana, priceFor,
  } = useNostrPlan15();

  // membership form
  const [wallet, setWallet] = useState("");
  const [isStaker, setIsStaker] = useState(false);
  const [stakerWallet, setStakerWallet] = useState("");
  const [savingMember, setSavingMember] = useState(false);

  // offer form
  const [offerLana, setOfferLana] = useState("");
  const [savingOffer, setSavingOffer] = useState(false);

  useEffect(() => {
    if (myMembership) {
      setWallet(myMembership.wallet);
      setIsStaker(myMembership.isStaker);
      setStakerWallet(myMembership.stakerWallet);
    } else if (session?.walletId) {
      setWallet(session.walletId);
    }
  }, [myMembership, session?.walletId]);

  const holdings = myMembership ? getHoldingsLana(myMembership.wallet) : 0;
  const sellable = myMembership ? getSellableLana(myMembership.wallet) : 0;

  const saveMembership = async () => {
    if (!wallet) { toast.error("Vnesi PLAN15 denarnico"); return; }
    if (isStaker && !stakerWallet) { toast.error("Vnesi stejkersko denarnico"); return; }
    setSavingMember(true);
    try {
      await publishMembership({ plan15Wallet: wallet, isStaker, stakerWallet });
      toast.success(myMembership ? "Članstvo posodobljeno" : "Vključen v PLAN15!");
    } catch (e: any) {
      toast.error(e?.message || "Napaka");
    } finally {
      setSavingMember(false);
    }
  };

  const saveOffer = async () => {
    const lana = parseFloat(offerLana);
    if (!myMembership) { toast.error("Najprej se vključi v PLAN15"); return; }
    if (!lana || lana <= 0) { toast.error("Vnesi veljavno količino"); return; }
    if (lana > sellable) { toast.error(`Preveč — največ ${sellable} LANA (nad pragom)`); return; }
    setSavingOffer(true);
    try {
      await publishOffer({ wallet: myMembership.wallet, amountLanoshis: Math.round(lana * LANOSHIS_PER_LANA) });
      toast.success("Ponudba objavljena");
      setOfferLana("");
    } catch (e: any) {
      toast.error(e?.message || "Napaka");
    } finally {
      setSavingOffer(false);
    }
  };

  if (isLoading) {
    return <div className="space-y-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-28 w-full" />)}</div>;
  }

  return (
    <div className="space-y-6">
      {/* Membership */}
      <Card>
        <CardHeader><CardTitle className="text-base">{myMembership ? "Moje članstvo" : "Vključi se v PLAN15"}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label>PLAN15 denarnica (šteje kot imetje)</Label>
            <Input value={wallet} onChange={e => setWallet(e.target.value)} placeholder="L..." />
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={isStaker} onCheckedChange={setIsStaker} />
            <Label>Sem stejker</Label>
          </div>
          {isStaker && (
            <div>
              <Label>Stejkerska denarnica</Label>
              <Input value={stakerWallet} onChange={e => setStakerWallet(e.target.value)} placeholder="L... / T..." />
            </div>
          )}
          <Button onClick={saveMembership} disabled={savingMember}>
            {savingMember ? "Shranjujem…" : (myMembership ? "Posodobi" : "Vključi se")}
          </Button>
        </CardContent>
      </Card>

      {myMembership && (
        <>
          {/* Holdings */}
          <Card>
            <CardHeader><CardTitle className="text-base">Moje imetje</CardTitle></CardHeader>
            <CardContent className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
              <div>
                <span className="text-muted-foreground">Imam: </span>
                <span className="font-semibold">{holdings.toLocaleString("en-US", { maximumFractionDigits: 2 })} LANA</span>
              </div>
              <div>
                <span className="text-muted-foreground">Prag: </span>
                <span className="font-semibold">{(parameters?.plan15Floor || 0).toLocaleString("en-US")} LANA</span>
              </div>
              <div>
                <span className="text-muted-foreground">Za prodajo (presežek): </span>
                <span className="font-semibold">{sellable.toLocaleString("en-US", { maximumFractionDigits: 2 })} LANA</span>
              </div>
            </CardContent>
          </Card>

          {/* Publish offer */}
          <Card>
            <CardHeader><CardTitle className="text-base">Objavi prodajno ponudbo</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label>Količina za prodajo (LANA, ≤ presežek)</Label>
                <Input value={offerLana} onChange={e => setOfferLana(e.target.value)} inputMode="decimal" placeholder={`največ ${sellable}`} />
              </div>
              <p className="text-xs text-muted-foreground">Cena je skupnostna: {priceFor("EUR")} EUR/LANA (iz KIND 38888).</p>
              <Button onClick={saveOffer} disabled={savingOffer || sellable <= 0}>
                {savingOffer ? "Objavljam…" : "Objavi ponudbo"}
              </Button>
            </CardContent>
          </Card>

          {/* My active offers */}
          {myOffers.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">Moje ponudbe</CardTitle></CardHeader>
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
        <CardHeader><CardTitle className="text-base">Ponudbe, ki sem jih kupil</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          {myPurchases.length === 0 && <p className="text-muted-foreground">Še nič kupljenega.</p>}
          {myPurchases.map(p => {
            const payout = getPayoutForAcceptance(p.id);
            return (
              <div key={p.id} className="flex items-center justify-between gap-2 rounded-md border p-2">
                <div>
                  <div>{(p.amount / LANOSHIS_PER_LANA).toLocaleString("en-US", { maximumFractionDigits: 8 })} LANA · {p.amountFiat} {p.currency}</div>
                  {payout?.txid && <div className="text-xs text-muted-foreground font-mono break-all">TX: {payout.txid}</div>}
                </div>
                {payout ? <Badge className="bg-green-600 hover:bg-green-600">Poplačano</Badge> : <Badge variant="secondary">Čaka</Badge>}
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
