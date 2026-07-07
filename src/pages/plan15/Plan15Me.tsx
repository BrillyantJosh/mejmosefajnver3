import { useEffect, useState } from "react";
import { useNostrPlan15, LANOSHIS_PER_LANA } from "@/hooks/useNostrPlan15";
import { useSystemParameters } from "@/contexts/SystemParametersContext";
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
    const t = setTimeout(async () => {
      const status = await checkWalletRegistration(w);
      setWalletStatus(status);
    }, 600);
    return () => clearTimeout(t);
  }, [wallet]);

  const holdings = myMembership ? getHoldingsLana(myMembership.wallet) : 0;
  const sellable = myMembership ? getSellableLana(myMembership.wallet) : 0;

  const saveMembership = async () => {
    if (!wallet) { toast.error("Vnesi PLAN15 denarnico"); return; }
    if (walletStatus === "registered") { toast.error("Ta denarnica je REGISTRIRANA — PLAN15 zahteva neregistrirano denarnico"); return; }
    if (walletStatus !== "unregistered") { toast.error("Počakaj na preverbo registracije denarnice"); return; }
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
    if (walletStatus === "registered") { toast.error("Tvoja PLAN15 denarnica je registrirana — vnesi neregistrirano in posodobi članstvo"); return; }
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
      <QRScanner
        isOpen={scannerTarget !== null}
        onClose={() => setScannerTarget(null)}
        onScan={(decoded) => {
          const addr = decoded.replace(/^[a-zA-Z]+:/, "").split("?")[0].trim();
          if (scannerTarget === "wallet") setWallet(addr);
          else if (scannerTarget === "staker") setStakerWallet(addr);
          setScannerTarget(null);
        }}
        title="Skeniraj denarnico"
        description="Postavi QR kodo naslova denarnice v okvir."
      />

      {/* Membership */}
      <Card>
        <CardHeader><CardTitle className="text-base">{myMembership ? "Moje članstvo" : "Vključi se v PLAN15"}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label>PLAN15 denarnica (šteje kot imetje) — mora biti NEREGISTRIRANA</Label>
            <div className="flex gap-2">
              <Input value={wallet} onChange={e => setWallet(e.target.value)} placeholder="L..." />
              <Button type="button" variant="outline" size="icon" onClick={() => setScannerTarget("wallet")} title="Skeniraj QR">
                <ScanLine className="h-4 w-4" />
              </Button>
            </div>
            {walletStatus === "checking" && (
              <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Preverjam registracijo…</p>
            )}
            {walletStatus === "unregistered" && (
              <p className="mt-1 flex items-center gap-1 text-xs text-green-600 dark:text-green-400"><CheckCircle2 className="h-3 w-3" /> Neregistrirana denarnica ✓</p>
            )}
            {walletStatus === "registered" && (
              <p className="mt-1 flex items-center gap-1 text-xs text-red-600 dark:text-red-400"><XCircle className="h-3 w-3" /> REGISTRIRANA denarnica — ni dovoljeno. PLAN15 uporablja samo neregistrirane LANE.</p>
            )}
            {walletStatus === "error" && (
              <p className="mt-1 flex items-center gap-1 text-xs text-yellow-600 dark:text-yellow-400"><XCircle className="h-3 w-3" /> Registracije ni bilo mogoče preveriti — poskusi znova.</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={isStaker} onCheckedChange={setIsStaker} />
            <Label>Sem stejker</Label>
          </div>
          {isStaker && (
            <div>
              <Label>Stejkerska denarnica</Label>
              <div className="flex gap-2">
                <Input value={stakerWallet} onChange={e => setStakerWallet(e.target.value)} placeholder="L... / T..." />
                <Button type="button" variant="outline" size="icon" onClick={() => setScannerTarget("staker")} title="Skeniraj QR">
                  <ScanLine className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
          <Button onClick={saveMembership} disabled={savingMember || walletStatus !== "unregistered"}>
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
