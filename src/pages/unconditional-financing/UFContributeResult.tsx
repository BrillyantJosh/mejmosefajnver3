import { useParams, useNavigate, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CheckCircle2, ExternalLink, ArrowLeft, Heart, Wallet } from "lucide-react";
import { useLang } from "@/i18n/I18nContext";

interface ContributeResultState {
  txHash: string;
  fiatAmount: number;
  lanaAmount: number;
  currency: string;
  requestTitle: string;
  requestId: string;
  eventId: string;
}

const UFContributeResult = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const sl = useLang() === "sl";

  const state = (location.state || {}) as Partial<ContributeResultState>;
  const { txHash, fiatAmount, lanaAmount, currency, requestTitle, requestId, eventId } = state;
  const stateMissing = !txHash;

  // Redirect to the request detail if opened without result state (e.g. refresh)
  useEffect(() => {
    if (stateMissing) {
      navigate(`/unconditional-financing/request/${id}`, { replace: true });
    }
  }, [stateMissing, id, navigate]);

  if (stateMissing) return null;

  const explorerUrl = `https://chainz.cryptoid.info/lana/tx.dws?${txHash}`;
  const detailPath = `/unconditional-financing/request/${requestId || id}`;

  return (
    <div className="container mx-auto p-4 sm:p-6 pb-24 max-w-2xl">
      <Button variant="ghost" onClick={() => navigate(detailPath)} className="gap-2 mb-4">
        <ArrowLeft className="h-4 w-4" />
        {sl ? "Nazaj na zahtevek" : "Back to request"}
      </Button>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-6 w-6 text-green-500" />
            {sl ? "Prispevek poslan" : "Contribution sent"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <Alert className="border-green-500/20 bg-green-500/5">
            <AlertDescription>
              <p className="font-semibold text-green-600">
                {sl
                  ? `Hvala za podporo${requestTitle ? ` zahtevku »${requestTitle}«` : ""}!`
                  : `Thank you for supporting${requestTitle ? ` "${requestTitle}"` : " this request"}!`}
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                {sl
                  ? "Tvoj prispevek je bil izveden na LANA verigi."
                  : "Your contribution was processed on the LANA chain."}
              </p>
            </AlertDescription>
          </Alert>

          {/* Amounts */}
          <div className="grid gap-3">
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">
                {sl ? "Prispevek" : "Contribution"}
              </span>
              <span className="font-semibold">
                {(fiatAmount ?? 0).toFixed(2)} {currency || "EUR"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">
                {sl ? "Plačano v LANI" : "Paid in LANA"}
              </span>
              <span className="font-semibold">{(lanaAmount ?? 0).toFixed(2)} LANA</span>
            </div>
          </div>

          {/* Transaction */}
          <div className="p-4 bg-muted/50 rounded-lg space-y-3">
            <h3 className="font-semibold">
              {sl ? "Podrobnosti transakcije" : "Transaction details"}
            </h3>
            <div>
              <p className="text-sm text-muted-foreground">
                {sl ? "ID transakcije" : "Transaction ID"}
              </p>
              <p className="font-mono text-sm break-all">{txHash}</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => window.open(explorerUrl, "_blank")}
            >
              <ExternalLink className="h-4 w-4 mr-2" />
              {sl ? "Poglej v raziskovalcu verige" : "View on block explorer"}
            </Button>
            {eventId && (
              <div>
                <p className="text-xs text-muted-foreground">
                  {sl ? "Nostr dogodek" : "Nostr event"}
                </p>
                <p className="font-mono text-xs break-all">{eventId}</p>
              </div>
            )}
          </div>

          {/* Repayment note */}
          <div className="p-4 bg-blue-500/5 border border-blue-500/20 rounded-lg">
            <div className="flex items-start gap-3">
              <Wallet className="h-5 w-5 text-blue-500 shrink-0 mt-0.5" />
              <p className="text-sm text-muted-foreground">
                {sl
                  ? "Ko bo prejemnik vračal sredstva, bo tvoj sorazmerni delež vračil sčasoma samodejno prispel na tvojo glavno denarnico."
                  : "As the recipient repays, your proportional share of the repayments will arrive to your Main Wallet over time."}
              </p>
            </div>
          </div>

          {/* Actions */}
          <div className="space-y-3">
            <Button className="w-full" onClick={() => navigate(detailPath)}>
              {sl ? "Nazaj na zahtevek" : "Back to request"}
            </Button>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => navigate("/unconditional-financing/my")}
            >
              <Heart className="h-4 w-4 mr-2" />
              {sl ? "Moja financiranja" : "My financings"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default UFContributeResult;
