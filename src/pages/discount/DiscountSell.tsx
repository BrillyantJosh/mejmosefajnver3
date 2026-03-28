import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Loader2,
  CheckCircle,
  XCircle,
  ArrowLeft,
  Wallet,
  AlertCircle,
  ArrowDown,
  Banknote,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useSystemParameters } from "@/contexts/SystemParametersContext";
import { useNostrWallets } from "@/hooks/useNostrWallets";
import { formatLana } from "@/lib/currencyConversion";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type Step = "amount" | "confirm" | "processing" | "result";
type Currency = "EUR" | "USD" | "GBP";

const CURRENCIES: Currency[] = ["EUR", "USD", "GBP"];

const BUYBACK_WALLET = "Lg7iw2aQp8qazNsZVZFhf4rP7bikSrLRxB";
const DISCOUNT_API_URL = "https://www.lana.discount";
const DISCOUNT_API_KEY = "ldk_brain_37fe9da0c986846693edcd176620526a8b8d9eca";
const COMMISSION_PERCENT = 21;

function formatFiat(amount: number, currency: string) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export default function DiscountSell() {
  const { session } = useAuth();
  const { parameters } = useSystemParameters();
  const { wallets, isLoading: walletsLoading } = useNostrWallets();

  // Step management
  const [step, setStep] = useState<Step>("amount");

  // Amount step
  const [selectedCurrency, setSelectedCurrency] = useState<Currency>("EUR");
  const [lanaInput, setLanaInput] = useState("");
  const [selectedWalletId, setSelectedWalletId] = useState("");

  // Result
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<{
    success: boolean;
    txHash?: string;
    transactionId?: string;
    error?: string;
  } | null>(null);

  // Filter wallets — exclude Lana8Wonder, Knights, frozen
  const availableWallets = useMemo(
    () =>
      wallets.filter(
        (w) =>
          w.walletType !== "Lana8Wonder" &&
          w.walletType !== "Knights" &&
          !w.freezeStatus
      ),
    [wallets]
  );

  // Auto-select first wallet
  useEffect(() => {
    if (!selectedWalletId && availableWallets.length > 0) {
      setSelectedWalletId(availableWallets[0].walletId);
    }
  }, [availableWallets, selectedWalletId]);

  // Parsed LANA amount
  const lanaAmount = useMemo(() => {
    const val = parseFloat(lanaInput);
    return isNaN(val) || val <= 0 ? 0 : val;
  }, [lanaInput]);

  // Exchange rate from system parameters
  const exchangeRate = useMemo(() => {
    if (!parameters?.exchangeRates) return 0;
    return parameters.exchangeRates[selectedCurrency] || 0;
  }, [parameters?.exchangeRates, selectedCurrency]);

  // FIAT calculations
  const grossFiat = lanaAmount * exchangeRate;
  const commissionFiat = grossFiat * (COMMISSION_PERCENT / 100);
  const netFiat = grossFiat - commissionFiat;

  // LANA amount in lanoshis (1 LANA = 100,000,000 lanoshis)
  const lanaAmountLanoshis = Math.round(lanaAmount * 100000000);

  // Handle continue from amount step
  const handleContinue = () => {
    if (lanaAmount <= 0) {
      toast.error("Please enter a valid LANA amount");
      return;
    }
    if (!selectedWalletId) {
      toast.error("Please select a wallet");
      return;
    }
    if (exchangeRate <= 0) {
      toast.error("Exchange rate not available. Please try again later.");
      return;
    }
    setStep("confirm");
  };

  // Handle sell — build TX and call external API
  const handleSell = async () => {
    if (!session?.lanaPrivateKey || !session?.nostrHexId) {
      toast.error("Authentication required");
      return;
    }

    setStep("processing");
    setIsProcessing(true);
    setResult(null);

    try {
      // Step 1: Build and broadcast LANA transaction via Supabase Edge Function
      const { data: txData, error: txError } = await supabase.functions.invoke(
        "send-lana-transaction",
        {
          body: {
            senderPrivateKeyWIF: session.lanaPrivateKey,
            recipientAddress: BUYBACK_WALLET,
            amountLanoshis: lanaAmountLanoshis,
          },
        }
      );

      if (txError) {
        throw new Error(txError.message || "Failed to send LANA transaction");
      }

      if (!txData?.success && !txData?.txHash && !txData?.txid) {
        throw new Error(txData?.error || "Transaction failed");
      }

      const txHash = txData.txHash || txData.txid;

      // Step 2: Register sale with Lana.Discount external API
      const saleRes = await fetch(
        `${DISCOUNT_API_URL}/api/external/sale`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${DISCOUNT_API_KEY}`,
          },
          body: JSON.stringify({
            tx_hash: txHash,
            sender_wallet_id: selectedWalletId,
            buyback_wallet_id: BUYBACK_WALLET,
            lana_amount: lanaAmount,
            currency: selectedCurrency,
            exchange_rate: exchangeRate,
            user_hex_id: session.nostrHexId,
          }),
        }
      );

      if (!saleRes.ok) {
        const errBody = await saleRes.text();
        console.error("Discount API error:", errBody);
        // TX was sent successfully but API registration failed
        // Still show success but with a warning
        setResult({
          success: true,
          txHash,
          error: "Transaction sent but sale registration failed. Contact support.",
        });
        toast.warning(
          "LANA sent successfully, but sale registration had an issue. Your TX hash has been recorded."
        );
      } else {
        const saleData = await saleRes.json();
        setResult({
          success: true,
          txHash,
          transactionId: saleData.transaction_id || saleData.id,
        });
        toast.success("LANA sold successfully!");
      }
    } catch (error) {
      console.error("Sell error:", error);
      setResult({
        success: false,
        error: error instanceof Error ? error.message : "Sale failed",
      });
      toast.error("Sale failed");
    } finally {
      setIsProcessing(false);
      setStep("result");
    }
  };

  // Reset to start
  const handleReset = () => {
    setStep("amount");
    setLanaInput("");
    setResult(null);
  };

  return (
    <div className="px-4 space-y-4 sm:space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
          <Banknote className="h-5 w-5 sm:h-6 sm:w-6" />
          Sell LANA
        </h1>
        <p className="text-xs sm:text-sm text-muted-foreground mt-1">
          Sell LANA through Lana.Discount for instant FIAT payout
        </p>
      </div>

      {/* ========== AMOUNT STEP ========== */}
      {step === "amount" && (
        <>
          {/* LANA Amount */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Sell Amount</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* LANA input */}
              <div className="space-y-2">
                <Label>LANA Amount</Label>
                <Input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={lanaInput}
                  onChange={(e) => setLanaInput(e.target.value)}
                  placeholder="Enter amount in LANA"
                  className="text-lg"
                />
              </div>

              {/* Currency selector */}
              <div className="space-y-2">
                <Label>Payout Currency</Label>
                <Select
                  value={selectedCurrency}
                  onValueChange={(v) => setSelectedCurrency(v as Currency)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CURRENCIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Live calculation */}
              {lanaAmount > 0 && exchangeRate > 0 && (
                <div className="p-3 bg-muted rounded-lg space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Exchange Rate</span>
                    <span>1 LANA = {formatFiat(exchangeRate, selectedCurrency)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Gross</span>
                    <span>{formatFiat(grossFiat, selectedCurrency)}</span>
                  </div>
                  <div className="flex justify-between text-sm text-destructive">
                    <span>Commission ({COMMISSION_PERCENT}%)</span>
                    <span>-{formatFiat(commissionFiat, selectedCurrency)}</span>
                  </div>
                  <div className="flex justify-between font-bold border-t pt-2">
                    <span>Net Payout</span>
                    <span className="text-green-600">
                      {formatFiat(netFiat, selectedCurrency)}
                    </span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Wallet Selector */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Wallet className="h-5 w-5" />
                Send From
              </CardTitle>
            </CardHeader>
            <CardContent>
              {walletsLoading ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading wallets...
                </div>
              ) : availableWallets.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  No wallets available. Register a wallet first.
                </p>
              ) : (
                <Select
                  value={selectedWalletId}
                  onValueChange={setSelectedWalletId}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select wallet" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableWallets.map((w) => (
                      <SelectItem key={w.walletId} value={w.walletId}>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs">
                            {w.walletId.slice(0, 8)}...{w.walletId.slice(-4)}
                          </span>
                          {w.walletType && (
                            <Badge variant="outline" className="text-xs">
                              {w.walletType}
                            </Badge>
                          )}
                          {w.note && (
                            <span className="text-xs text-muted-foreground">
                              {w.note}
                            </span>
                          )}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </CardContent>
          </Card>

          {/* Continue button */}
          <Button
            onClick={handleContinue}
            disabled={lanaAmount <= 0 || !selectedWalletId || exchangeRate <= 0}
            className="w-full h-12 sm:h-14 bg-green-600 hover:bg-green-700 text-white text-sm sm:text-base"
          >
            Continue
          </Button>
        </>
      )}

      {/* ========== CONFIRM STEP ========== */}
      {step === "confirm" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Confirm Sale</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* From wallet */}
            <div className="flex justify-between items-start">
              <span className="text-sm text-muted-foreground">From Wallet</span>
              <span className="font-mono text-xs text-right break-all max-w-[60%]">
                {selectedWalletId}
              </span>
            </div>

            {/* Arrow */}
            <div className="flex justify-center">
              <ArrowDown className="h-6 w-6 text-muted-foreground" />
            </div>

            {/* To buyback wallet */}
            <div className="flex justify-between items-start">
              <span className="text-sm text-muted-foreground">
                Buyback Wallet
              </span>
              <span className="font-mono text-xs text-right break-all max-w-[60%]">
                {BUYBACK_WALLET}
              </span>
            </div>

            {/* Amount details */}
            <div className="p-4 bg-muted rounded-lg space-y-2">
              <div className="flex justify-between">
                <span className="text-muted-foreground">LANA Amount</span>
                <span className="font-bold text-lg">
                  {formatLana(lanaAmount)}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Exchange Rate</span>
                <span>
                  1 LANA = {formatFiat(exchangeRate, selectedCurrency)}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Gross</span>
                <span>{formatFiat(grossFiat, selectedCurrency)}</span>
              </div>
              <div className="flex justify-between text-sm text-destructive">
                <span>Commission ({COMMISSION_PERCENT}%)</span>
                <span>-{formatFiat(commissionFiat, selectedCurrency)}</span>
              </div>
              <div className="flex justify-between font-bold border-t pt-2 text-green-600">
                <span>Net Payout</span>
                <span>{formatFiat(netFiat, selectedCurrency)}</span>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={() => setStep("amount")}
                className="flex-1"
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back
              </Button>
              <Button
                onClick={handleSell}
                className="flex-1 bg-green-600 hover:bg-green-700 text-white"
              >
                <Banknote className="h-4 w-4 mr-2" />
                Sell LANA
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ========== PROCESSING STEP ========== */}
      {step === "processing" && (
        <Card>
          <CardContent className="py-12">
            <div className="flex flex-col items-center justify-center gap-4">
              <Loader2 className="h-12 w-12 animate-spin text-green-600" />
              <p className="text-lg font-medium">Processing sale...</p>
              <p className="text-sm text-muted-foreground text-center">
                Sending {formatLana(lanaAmount)} to Lana.Discount buyback wallet
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ========== RESULT STEP ========== */}
      {step === "result" && result && (
        <Card>
          <CardContent className="py-8">
            <div className="flex flex-col items-center gap-4">
              {result.success ? (
                <>
                  <CheckCircle className="h-16 w-16 text-green-600" />
                  <h2 className="text-2xl font-bold text-green-600">
                    Sale Successful!
                  </h2>
                  <div className="w-full space-y-3">
                    <div className="p-3 bg-muted rounded-lg">
                      <p className="text-sm text-muted-foreground">
                        LANA Sold
                      </p>
                      <p className="font-bold text-lg">
                        {formatLana(lanaAmount)}
                      </p>
                    </div>
                    <div className="p-3 bg-green-50 dark:bg-green-950/30 rounded-lg">
                      <p className="text-sm text-muted-foreground">
                        Net Payout
                      </p>
                      <p className="font-bold text-lg text-green-600">
                        {formatFiat(netFiat, selectedCurrency)}
                      </p>
                    </div>
                    {result.txHash && (
                      <div className="p-3 bg-muted rounded-lg">
                        <p className="text-sm text-muted-foreground">
                          TX Hash
                        </p>
                        <p className="font-mono text-xs break-all">
                          {result.txHash}
                        </p>
                      </div>
                    )}
                    {result.transactionId && (
                      <div className="p-3 bg-muted rounded-lg">
                        <p className="text-sm text-muted-foreground">
                          Transaction ID
                        </p>
                        <p className="font-mono text-xs break-all">
                          {result.transactionId}
                        </p>
                      </div>
                    )}
                    {result.error && (
                      <Alert>
                        <AlertCircle className="h-4 w-4" />
                        <AlertDescription>{result.error}</AlertDescription>
                      </Alert>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <XCircle className="h-16 w-16 text-destructive" />
                  <h2 className="text-2xl font-bold text-destructive">
                    Sale Failed
                  </h2>
                  {result.error && (
                    <Alert variant="destructive">
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription>{result.error}</AlertDescription>
                    </Alert>
                  )}
                  <Button
                    variant="outline"
                    onClick={() => setStep("confirm")}
                    className="w-full"
                  >
                    Retry
                  </Button>
                </>
              )}

              <Button
                onClick={handleReset}
                className="w-full mt-2 bg-green-600 hover:bg-green-700 text-white"
              >
                New Sale
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
