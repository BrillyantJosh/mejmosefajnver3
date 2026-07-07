import { useState } from "react";
import { useNostrPlan15, Plan15Acceptance, LANOSHIS_PER_LANA } from "@/hooks/useNostrPlan15";
import { useAuth } from "@/contexts/AuthContext";
import { useSystemParameters } from "@/contexts/SystemParametersContext";
import { useTranslation } from "@/i18n/I18nContext";
import plan15Translations from "@/i18n/modules/plan15";
import { supabase } from "@/integrations/supabase/client";
import { convertWifToIds } from "@/lib/crypto";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { QRScanner } from "@/components/QRScanner";
import { ScanLine } from "lucide-react";
import { toast } from "sonner";

export default function Plan15Payouts() {
  const { session } = useAuth();
  const { parameters } = useSystemParameters();
  const { t } = useTranslation(plan15Translations);
  const { isLoading, incomingAcceptances, offers, publishPayout } = useNostrPlan15();
  const [wifByAcceptance, setWifByAcceptance] = useState<Record<string, string>>({});
  const [paying, setPaying] = useState<string | null>(null);
  const [scanForId, setScanForId] = useState<string | null>(null);

  const offerFor = (a: Plan15Acceptance) => offers.find(o => o.address === a.offerAddress);

  const doPayout = async (a: Plan15Acceptance) => {
    const wif = (wifByAcceptance[a.id] || "").trim();
    if (!wif) { toast.error(t("payouts.errWif")); return; }
    const offer = offerFor(a);
    const fromWallet = offer?.wallet || "";
    if (!fromWallet) { toast.error(t("payouts.errNoSource")); return; }
    setPaying(a.id);
    try {
      // Validate WIF matches the source wallet
      const ids = await convertWifToIds(wif);
      const match =
        ids.walletIdCompressed === fromWallet ||
        ids.walletIdUncompressed === fromWallet ||
        ids.walletId === fromWallet;
      if (!match) { toast.error(t("payouts.errWifMismatch")); setPaying(null); return; }

      const amountLana = a.amount / LANOSHIS_PER_LANA;
      const { data, error } = await supabase.functions.invoke("send-lana-transaction", {
        body: {
          senderAddress: fromWallet,
          recipientAddress: a.buyerWallet,
          amount: amountLana,
          privateKey: wif,
          electrumServers: parameters?.electrumServers || [],
          userPubkey: session?.nostrHexId,
        },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || t("payouts.errTxFailed"));

      await publishPayout({ acceptance: a, fromWallet, txid: data.txHash });
      toast.success(t("payouts.paidOut", { tx: String(data.txHash).slice(0, 16) }));
      setWifByAcceptance(prev => { const n = { ...prev }; delete n[a.id]; return n; });
    } catch (e: any) {
      toast.error(e?.message || t("payouts.errPayout"));
    } finally {
      setPaying(null);
    }
  };

  if (isLoading) {
    return <div className="space-y-3">{[1, 2].map(i => <Skeleton key={i} className="h-32 w-full" />)}</div>;
  }

  if (incomingAcceptances.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-muted-foreground">
          {t("payouts.empty")}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <QRScanner
        isOpen={scanForId !== null}
        onClose={() => setScanForId(null)}
        onScan={(decoded) => {
          if (scanForId) setWifByAcceptance(prev => ({ ...prev, [scanForId]: decoded.trim() }));
          setScanForId(null);
        }}
        title={t("followers.scanWif")}
        description={t("followers.scanWifDesc")}
      />
      <Card className="border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/30">
        <CardContent className="p-3 text-sm text-blue-900 dark:text-blue-200">
          {t("payouts.instruction")}
        </CardContent>
      </Card>
      {incomingAcceptances.map(a => {
        const offer = offerFor(a);
        return (
          <Card key={a.id}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                {(a.amount / LANOSHIS_PER_LANA).toLocaleString("en-US", { maximumFractionDigits: 8 })} LANA
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div><span className="text-muted-foreground">{t("payouts.buyerAddr")} </span><span className="font-mono break-all">{a.buyerWallet}</span></div>
              <div><span className="text-muted-foreground">{t("payouts.paymentReceived")} </span><span className="font-semibold">{(a.paymentAmount / LANOSHIS_PER_LANA).toLocaleString("en-US", { maximumFractionDigits: 8 })} LANA</span></div>
              {a.paymentTxid && <div className="text-xs break-all"><span className="text-muted-foreground">{t("payouts.paymentTxidLabel")} </span><span className="font-mono">{a.paymentTxid}</span></div>}
              <div><span className="text-muted-foreground">{t("payouts.sourceWallet")} </span><span className="font-mono break-all">{offer?.wallet || "?"}</span></div>
              <div>
                <Label>{t("payouts.wifLabel")}</Label>
                <div className="flex gap-2">
                  <Input
                    type="password"
                    value={wifByAcceptance[a.id] || ""}
                    onChange={e => setWifByAcceptance(prev => ({ ...prev, [a.id]: e.target.value }))}
                    placeholder="WIF"
                  />
                  <Button type="button" variant="outline" size="icon" onClick={() => setScanForId(a.id)} title={t("followers.scanWif")}>
                    <ScanLine className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <Button onClick={() => doPayout(a)} disabled={paying === a.id}>
                {paying === a.id ? t("payouts.paying") : t("payouts.confirmPay")}
              </Button>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
