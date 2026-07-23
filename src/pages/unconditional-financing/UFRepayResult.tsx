import { useEffect, useMemo } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import type { UfRepaymentOutput } from "@/lib/ufShares";
import { useNostrProfilesCacheBulk } from "@/hooks/useNostrProfilesCacheBulk";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle, ExternalLink, Heart, PartyPopper } from "lucide-react";
import { useLang } from "@/i18n/I18nContext";

interface RepayResultState {
  txHash: string;
  fiatAmount: number;
  lanaTotal: number;
  currency: string;
  outputs: UfRepaymentOutput[];
  requestId: string;
  isRepaid: boolean;
}

const maskWallet = (w: string) =>
  w && w.length > 14 ? `${w.slice(0, 6)}…${w.slice(-6)}` : w;

/**
 * Unconditional Financing — repayment success page.
 * Shows the tx link, the proportional distribution recap, and (when the
 * request is now fully repaid) a small celebration.
 */
const UFRepayResult = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const sl = useLang() === "sl";

  const state = (location.state || {}) as Partial<RepayResultState>;
  const { txHash, fiatAmount, lanaTotal, currency, outputs, requestId, isRepaid } = state;
  const hasState = !!txHash && typeof fiatAmount === "number" && Array.isArray(outputs);

  // Reached directly without a repayment — send back to the request.
  useEffect(() => {
    if (!hasState) {
      navigate(`/unconditional-financing/request/${requestId || id}`, { replace: true });
    }
  }, [hasState, requestId, id, navigate]);

  const pubkeys = useMemo(() => (outputs || []).map((o) => o.pubkey), [outputs]);
  const { profiles } = useNostrProfilesCacheBulk(pubkeys);

  if (!hasState) return null;

  const detailPath = `/unconditional-financing/request/${requestId || id}`;

  return (
    <div className="container mx-auto p-4 sm:p-6 pb-24 max-w-2xl space-y-6">
      {/* Success header */}
      <div className="text-center pt-6">
        <CheckCircle className="h-16 w-16 text-green-500 mx-auto mb-4" />
        <h1 className="text-3xl font-bold text-green-600">
          {sl ? "Vračilo poslano" : "Repayment sent"}
        </h1>
        <p className="text-muted-foreground mt-2">
          {sl
            ? `${fiatAmount!.toFixed(2)} ${currency} je bilo razdeljeno med ${outputs!.length} ${outputs!.length === 1 ? "financerja" : "financerjev"} v eni transakciji.`
            : `${fiatAmount!.toFixed(2)} ${currency} was distributed among ${outputs!.length} financier${outputs!.length === 1 ? "" : "s"} in a single transaction.`}
        </p>
      </div>

      {/* Fully repaid celebration */}
      {isRepaid && (
        <Card className="border-green-500/30 bg-green-500/10">
          <CardContent className="p-6 text-center space-y-2">
            <PartyPopper className="h-10 w-10 text-green-600 mx-auto" />
            <p className="text-xl font-bold text-green-600">
              {sl ? "Zahtevek v celoti poplačan 🎉" : "Request fully repaid 🎉"}
            </p>
            <p className="text-sm text-muted-foreground">
              {sl
                ? "Celotna prejeta vrednost se je vrnila v skupni tok. Hvala za zaupanje skupnosti."
                : "The entire received value has returned to the shared flow. Thank you for the community's trust."}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Transaction details */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            {sl ? "Podrobnosti transakcije" : "Transaction details"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex justify-between items-center gap-4">
            <span className="text-muted-foreground">{sl ? "Transakcija" : "Transaction"}</span>
            <a
              href={`https://chainz.cryptoid.info/lana/tx.dws?${txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-xs text-blue-500 hover:underline flex items-center gap-1"
            >
              {txHash!.substring(0, 16)}...
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">{sl ? "Skupni znesek" : "Total amount"}</span>
            <span className="font-semibold">
              {fiatAmount!.toFixed(2)} {currency}
            </span>
          </div>
          {typeof lanaTotal === "number" && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">{sl ? "Poslana LANA" : "LANA sent"}</span>
              <span className="font-semibold">{lanaTotal.toFixed(4)} LANA</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-muted-foreground">{sl ? "Število izplačil" : "Outputs"}</span>
            <span className="font-semibold">{outputs!.length}</span>
          </div>
        </CardContent>
      </Card>

      {/* Distribution recap */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            {sl ? "Razdelitev med financerje" : "Distribution among financiers"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          {outputs!.map((o) => {
            const profile = profiles.get(o.pubkey);
            const name =
              profile?.display_name || profile?.full_name || `${o.pubkey.slice(0, 8)}…`;
            return (
              <div
                key={o.pubkey + o.wallet}
                className="flex items-center justify-between gap-3 py-2 border-b last:border-0"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <UserAvatar
                    pubkey={o.pubkey}
                    picture={profile?.picture}
                    name={name}
                    className="h-8 w-8 shrink-0"
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{name}</p>
                    <p className="font-mono text-xs text-muted-foreground">
                      {maskWallet(o.wallet)}
                    </p>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-semibold">
                    {o.fiat.toFixed(2)} {currency}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {(o.lanoshis / 1e8).toFixed(4)} LANA
                  </p>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex flex-col sm:flex-row gap-3">
        <Button
          variant="outline"
          onClick={() => navigate(detailPath)}
          className="flex-1 h-12"
        >
          {sl ? "Nazaj na zahtevek" : "Back to request"}
        </Button>
        <Button
          onClick={() => navigate("/unconditional-financing/my")}
          className="flex-1 bg-green-500 hover:bg-green-600 text-white h-12 gap-2"
        >
          <Heart className="h-4 w-4" />
          {sl ? "Moja financiranja" : "My financings"}
        </Button>
      </div>
    </div>
  );
};

export default UFRepayResult;
