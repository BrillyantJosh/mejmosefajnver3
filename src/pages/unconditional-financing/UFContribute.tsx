import { useParams, useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import { useUfRequest, ufMaturingDaysLeft } from "@/hooks/useUFData";
import { useNostrWallets } from "@/hooks/useNostrWallets";
import { useAuth } from "@/contexts/AuthContext";
import { useSystemParameters } from "@/contexts/SystemParametersContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Wallet, Loader2, Clock, AlertCircle, Snowflake, Info } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useLang } from "@/i18n/I18nContext";

interface WalletBalance {
  wallet_id: string;
  balance: number;
}

const maskWalletId = (id: string): string =>
  id.length > 20 ? `${id.substring(0, 10)}...${id.substring(id.length - 8)}` : id;

const UFContribute = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { session } = useAuth();
  const { toast } = useToast();
  const sl = useLang() === "sl";
  const { parameters } = useSystemParameters();
  const { detail, isLoading: requestLoading, error: requestError } = useUfRequest(id);
  const { wallets, isLoading: walletsLoading } = useNostrWallets();

  const [selectedWalletId, setSelectedWalletId] = useState<string>("");
  const [fiatInput, setFiatInput] = useState<string>("");
  const [message, setMessage] = useState<string>("");
  const [walletBalances, setWalletBalances] = useState<Record<string, number>>({});
  const [loadingBalances, setLoadingBalances] = useState(false);

  const request = detail?.request ?? null;

  useEffect(() => {
    if (!wallets || wallets.length === 0 || !parameters) return;
    const electrumServers = parameters.electrumServers || [];
    if (electrumServers.length === 0) return;

    let alive = true;
    const walletIds = wallets.map((w) => w.walletId);
    setLoadingBalances(true);
    supabase.functions
      .invoke("get-wallet-balances", {
        body: {
          wallet_addresses: walletIds,
          electrum_servers: electrumServers,
        },
      })
      .then(({ data, error }) => {
        if (!alive) return;
        if (error) throw error;
        if (data?.wallets) {
          const balancesMap: Record<string, number> = {};
          data.wallets.forEach((w: WalletBalance) => {
            balancesMap[w.wallet_id] = w.balance;
          });
          setWalletBalances(balancesMap);
        }
      })
      .catch((err: unknown) => {
        console.error("Error fetching wallet balances:", err);
        if (alive) {
          toast({
            title: sl ? "Napaka" : "Error",
            description: sl
              ? "Stanj denarnic ni bilo mogoče naložiti."
              : "Failed to load wallet balances.",
            variant: "destructive",
          });
        }
      })
      .finally(() => alive && setLoadingBalances(false));

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallets, parameters?.electrumServers]);

  if (requestLoading || walletsLoading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (requestError || !request) {
    return (
      <div className="container mx-auto p-4 sm:p-6 pb-24">
        <Button variant="ghost" onClick={() => navigate("/unconditional-financing")} className="gap-2 mb-4">
          <ArrowLeft className="h-4 w-4" />
          {sl ? "Nazaj" : "Back"}
        </Button>
        <p className="text-center text-muted-foreground py-12">
          {sl ? "Zahtevek ni bil najden." : "Request not found."}
        </p>
      </div>
    );
  }

  const currency = request.currency || "EUR";
  const rates = (parameters?.exchangeRates ?? {}) as unknown as Record<string, number>;
  const rate = rates[currency] ?? 0;

  const parsedFiat = parseFloat(fiatInput) || 0;
  const lanaAmount = rate > 0 ? parsedFiat / rate : 0;
  const selectedWalletBalance =
    selectedWalletId && walletBalances[selectedWalletId] !== undefined
      ? walletBalances[selectedWalletId]
      : 0;
  const hasSufficientBalance = lanaAmount > 0 && selectedWalletBalance >= lanaAmount;

  // Canonical Main Wallet lookup — repayments go here
  const mainWallet =
    wallets.find((w) => w.walletType === "Main Wallet") ||
    wallets.find((w) => w.walletType === "Wallet");

  const isOwnRequest = !!session?.nostrHexId && session.nostrHexId === request.pubkey;
  const isMaturing = request.phase === "maturing";
  const daysLeft = ufMaturingDaysLeft(request.fundingOpensAt);
  const fundingOpensDate = new Date(request.fundingOpensAt * 1000).toLocaleDateString(
    sl ? "sl-SI" : "en-GB",
    { day: "numeric", month: "long", year: "numeric" }
  );

  const selectedWallet = wallets.find((w) => w.walletId === selectedWalletId);

  const canContinue =
    !!session?.nostrHexId &&
    !!selectedWalletId &&
    parsedFiat > 0 &&
    rate > 0 &&
    hasSufficientBalance &&
    !!mainWallet &&
    !loadingBalances;

  const handleContinue = () => {
    if (!canContinue || !mainWallet) {
      toast({
        title: sl ? "Manjkajoči podatki" : "Missing information",
        description: sl
          ? "Izberi denarnico in vnesi veljaven znesek."
          : "Select a wallet and enter a valid amount.",
        variant: "destructive",
      });
      return;
    }

    navigate(`/unconditional-financing/contribute/${id}/private-key`, {
      state: {
        selectedWalletId,
        fiatAmount: parsedFiat,
        lanaAmount,
        rate,
        message,
        repaymentWalletId: mainWallet.walletId,
      },
    });
  };

  return (
    <div className="container mx-auto p-4 sm:p-6 pb-24 max-w-2xl">
      <Button
        variant="ghost"
        onClick={() => navigate(`/unconditional-financing/request/${id}`)}
        className="gap-2 mb-4"
      >
        <ArrowLeft className="h-4 w-4" />
        {sl ? "Nazaj na zahtevek" : "Back to request"}
      </Button>

      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">{sl ? "Prispevaj" : "Contribute"}</h1>
          <p className="text-muted-foreground mt-2">
            {sl ? `Podpri: ${request.title}` : `Support: ${request.title}`}
          </p>
        </div>

        {/* Maturing guard — funding not yet open */}
        {isMaturing ? (
          <Card className="border-amber-500/30 bg-amber-500/10">
            <CardContent className="p-6">
              <div className="flex items-start gap-3">
                <Clock className="h-6 w-6 text-amber-600 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-semibold text-amber-700 dark:text-amber-500">
                    {sl ? "Zahtevek še zori" : "This request is still maturing"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {sl
                      ? `Financiranje se odpre ${fundingOpensDate}${daysLeft > 0 ? ` (še ${daysLeft} ${daysLeft === 1 ? "dan" : daysLeft === 2 ? "dneva" : "dni"})` : ""}. Do takrat lahko zahtevek komentiraš na strani zahtevka.`
                      : `Funding opens on ${fundingOpensDate}${daysLeft > 0 ? ` (${daysLeft} day${daysLeft === 1 ? "" : "s"} left)` : ""}. Until then you can comment on the request page.`}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : isOwnRequest ? (
          /* Requester cannot fund their own request */
          <Card>
            <CardContent className="p-6">
              <div className="flex items-start gap-3">
                <Info className="h-6 w-6 text-muted-foreground shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-semibold">
                    {sl ? "To je tvoj zahtevek" : "This is your own request"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {sl
                      ? "Svojega zahtevka ne moreš financirati. Ko se financiranje odpre, ga lahko podprejo drugi člani skupnosti."
                      : "You cannot contribute to your own request. Once funding opens, other community members can support it."}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : !session?.nostrHexId ? (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              {sl
                ? "Za prispevek se moraš prijaviti."
                : "You must be logged in to contribute."}
            </AlertDescription>
          </Alert>
        ) : (
          <>
            {/* Recipient wallet (TO) */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">
                  {sl ? "Denarnica prejemnika (PREJME)" : "Recipient wallet (TO)"}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="bg-muted p-3 rounded-md">
                  <p className="font-mono text-sm break-all">{request.wallet}</p>
                </div>
                <p className="text-sm text-muted-foreground mt-2">
                  {sl
                    ? "Sredstva bodo poslana neposredno na glavno denarnico prejemnika."
                    : "Funds will be sent directly to the recipient's Main Wallet."}
                </p>
              </CardContent>
            </Card>

            {/* Source wallet (FROM) */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">
                  {sl ? "Tvoja denarnica (POŠLJE)" : "Your wallet (FROM)"}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {!wallets || wallets.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {sl
                      ? "Nimaš registriranih denarnic."
                      : "You have no registered wallets."}
                  </p>
                ) : (
                  <>
                    <div>
                      <Label htmlFor="wallet-select">
                        {sl ? "Izberi denarnico" : "Select wallet"}
                      </Label>
                      <Select value={selectedWalletId} onValueChange={setSelectedWalletId}>
                        <SelectTrigger id="wallet-select">
                          <SelectValue placeholder={sl ? "Izberi denarnico" : "Select wallet"} />
                        </SelectTrigger>
                        <SelectContent>
                          {wallets
                            .filter((wallet) => wallet.walletType !== "Lana8Wonder")
                            .map((wallet) => {
                              const frozen = !!wallet.freezeStatus;
                              return (
                                <SelectItem
                                  key={wallet.walletId}
                                  value={wallet.walletId}
                                  disabled={frozen}
                                >
                                  <div className="flex flex-col items-start">
                                    <div className="font-mono text-xs flex items-center gap-1">
                                      {maskWalletId(wallet.walletId)}
                                      {frozen && <Snowflake className="h-3 w-3 text-blue-400" />}
                                    </div>
                                    <div className="text-xs text-muted-foreground">
                                      {wallet.walletType}
                                      {frozen && (sl ? " — zamrznjena" : " — frozen")}
                                      {wallet.note && ` - ${wallet.note.substring(0, 20)}`}
                                    </div>
                                  </div>
                                </SelectItem>
                              );
                            })}
                        </SelectContent>
                      </Select>
                      <p className="text-sm text-muted-foreground mt-2">
                        {sl
                          ? "Zamrznjenih denarnic ni mogoče uporabiti za prispevek."
                          : "Frozen wallets cannot be used for contributing."}
                      </p>
                    </div>

                    {selectedWallet && (
                      <div className="bg-muted p-4 rounded-md space-y-2">
                        <div className="flex items-center gap-2">
                          <Wallet className="h-4 w-4 text-muted-foreground" />
                          <span className="font-semibold">
                            {sl ? "Podatki denarnice" : "Wallet details"}
                          </span>
                        </div>
                        <div className="space-y-1 text-sm">
                          <p>
                            <span className="text-muted-foreground">ID:</span>{" "}
                            <span className="font-mono">{maskWalletId(selectedWallet.walletId)}</span>
                          </p>
                          <p>
                            <span className="text-muted-foreground">{sl ? "Tip:" : "Type:"}</span>{" "}
                            {selectedWallet.walletType}
                          </p>
                          <p>
                            <span className="text-muted-foreground">{sl ? "Stanje:" : "Balance:"}</span>{" "}
                            {loadingBalances ? (
                              <Loader2 className="h-3 w-3 animate-spin inline" />
                            ) : (
                              <span className="font-semibold">
                                {walletBalances[selectedWallet.walletId] !== undefined
                                  ? `${walletBalances[selectedWallet.walletId].toFixed(2)} LANA`
                                  : sl ? "Nalaganje..." : "Loading..."}
                              </span>
                            )}
                          </p>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>

            {/* Amount */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">
                  {sl ? `Znesek v ${currency}` : `Amount in ${currency}`}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Input
                    type="number"
                    value={fiatInput}
                    onChange={(e) => setFiatInput(e.target.value)}
                    placeholder="0.00"
                    step="0.01"
                    min="0"
                  />
                </div>

                {rate <= 0 && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                      {sl
                        ? `Menjalno razmerje za ${currency} trenutno ni na voljo. Poskusi kasneje.`
                        : `The exchange rate for ${currency} is currently unavailable. Please try again later.`}
                    </AlertDescription>
                  </Alert>
                )}

                {parsedFiat > 0 && rate > 0 && (
                  <div className="bg-muted p-4 rounded-md space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">
                        {sl ? "Plačilo v LANI" : "Payment in LANA"}
                      </span>
                      <span className="text-lg font-bold">≈ {lanaAmount.toFixed(2)} LANA</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {sl
                        ? `Menjalno razmerje: 1 LANA = ${rate.toFixed(6)} ${currency}`
                        : `Exchange rate: 1 LANA = ${rate.toFixed(6)} ${currency}`}
                    </p>

                    {selectedWalletId && (
                      <div className="pt-2 border-t">
                        {hasSufficientBalance ? (
                          <p className="text-sm text-green-500">
                            {sl ? "Dovolj sredstev v denarnici." : "Sufficient balance in wallet."}
                          </p>
                        ) : (
                          <p className="text-sm text-destructive">
                            {sl
                              ? `Premalo sredstev — na voljo ${selectedWalletBalance.toFixed(2)} LANA.`
                              : `Insufficient balance — available ${selectedWalletBalance.toFixed(2)} LANA.`}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Repayment wallet info */}
            {mainWallet ? (
              <Card className="border-blue-500/20 bg-blue-500/5">
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <Info className="h-5 w-5 text-blue-500 shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <p className="text-sm font-medium">
                        {sl
                          ? `Vračila boš prejemal na svojo glavno denarnico ${maskWalletId(mainWallet.walletId)}`
                          : `Repayments will be sent to your Main Wallet ${maskWalletId(mainWallet.walletId)}`}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {sl
                          ? "Ko bo prejemnik vračal sredstva, bo tvoj sorazmerni delež samodejno nakazan sem."
                          : "When the recipient repays, your proportional share will be sent here automatically."}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  {sl
                    ? "Nimaš glavne denarnice (Main Wallet). Denarnica za prejemanje vračil je obvezna — prispevek ni mogoč."
                    : "You have no Main Wallet. A repayment wallet is required — contributing is not possible."}
                </AlertDescription>
              </Alert>
            )}

            {/* Optional message */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">
                  {sl ? "Sporočilo (neobvezno)" : "Message (optional)"}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder={
                    sl
                      ? "Dodaj spodbudno sporočilo prejemniku..."
                      : "Add an encouraging message for the recipient..."
                  }
                  rows={4}
                />
              </CardContent>
            </Card>

            {/* Continue */}
            <Button
              onClick={handleContinue}
              disabled={!canContinue}
              className="w-full bg-green-500 hover:bg-green-600 text-white h-12 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {parsedFiat > 0 && rate > 0
                ? sl
                  ? `Prispevaj ${parsedFiat.toFixed(2)} ${currency} (≈ ${lanaAmount.toFixed(2)} LANA)`
                  : `Contribute ${parsedFiat.toFixed(2)} ${currency} (≈ ${lanaAmount.toFixed(2)} LANA)`
                : sl
                  ? "Nadaljuj"
                  : "Continue"}
            </Button>

            {!selectedWalletId && (
              <p className="text-sm text-center text-muted-foreground">
                {sl ? "Najprej izberi denarnico." : "Please select a wallet first."}
              </p>
            )}
            {selectedWalletId && parsedFiat === 0 && (
              <p className="text-sm text-center text-muted-foreground">
                {sl ? "Vnesi znesek prispevka." : "Please enter a contribution amount."}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default UFContribute;
