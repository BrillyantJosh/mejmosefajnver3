import { useState, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, ArrowRight, Wallet, Trash2, AlertTriangle, Loader2, Snowflake, ShieldAlert } from "lucide-react";
import { useSystemParameters } from "@/contexts/SystemParametersContext";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { supabase } from "@/integrations/supabase/client";
import { useNostrWallets } from "@/hooks/useNostrWallets";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** Get human-readable freeze reason */
function getFreezeReasonLabel(freezeStatus: string): string {
  switch (freezeStatus) {
    case 'frozen_l8w': return 'Late wallet registration';
    case 'frozen_max_cap': return 'Maximum balance cap exceeded';
    case 'frozen_too_wild': return 'Irregular or suspicious activity';
    case 'frozen_unreg_Lanas': return 'Received unregistered LANA exceeding threshold';
    case 'frozen': return 'All accounts frozen by registrar';
    default: return 'Account frozen';
  }
}

export default function SendLana() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { parameters } = useSystemParameters();
  const { wallets: userWallets } = useNostrWallets();

  const walletId = searchParams.get("walletId") || "";
  const walletBalance = parseFloat(searchParams.get("balance") || "0");
  const manualOnly = searchParams.get("manualOnly") === "true";

  // Check if this wallet is frozen
  const walletData = userWallets.find(w => w.walletId === walletId);
  const isFrozen = !!(walletData?.freezeStatus);

  // Send Amount state
  const [selectedCurrency, setSelectedCurrency] = useState<"EUR" | "USD" | "GBP" | "LANA" | "">("");
  const [inputAmount, setInputAmount] = useState("");
  const [error, setError] = useState("");
  const [calculatedLana, setCalculatedLana] = useState(0);

  // UTXO info state
  const [utxoLoading, setUtxoLoading] = useState(true);
  const [utxoCount, setUtxoCount] = useState(0);
  const [estimatedFee, setEstimatedFee] = useState(0);
  const [totalBalanceSat, setTotalBalanceSat] = useState(0);
  const maxInputs = 20;
  const [utxoWarningDismissed, setUtxoWarningDismissed] = useState(false);

  const exchangeRates = parameters?.exchangeRates;

  // Fetch UTXO info on mount
  useEffect(() => {
    const fetchUtxoInfo = async () => {
      if (!walletId) return;
      try {
        const { data, error: fetchError } = await supabase.functions.invoke('get-utxo-info', {
          body: { address: walletId, electrumServers: parameters?.electrumServers || [] }
        });
        if (fetchError) {
          console.error('UTXO info error:', fetchError);
          setUtxoLoading(false);
          return;
        }
        if (data?.success) {
          setUtxoCount(data.utxoCount);
          setEstimatedFee(data.estimatedFee);
          setTotalBalanceSat(data.totalBalance);
        }
      } catch (err) {
        console.error('UTXO info error:', err);
      } finally {
        setUtxoLoading(false);
      }
    };
    fetchUtxoInfo();
  }, [walletId, parameters?.electrumServers]);

  const tooManyUtxos = utxoCount > maxInputs;
  const netAmountSat = totalBalanceSat - estimatedFee;
  const netAmountLana = netAmountSat / 100_000_000;
  const feeLana = estimatedFee / 100_000_000;

  // Calculate immediately without debouncing
  const calculateAmount = () => {
    if (!inputAmount || !exchangeRates || !selectedCurrency) return 0;
    const amount = parseFloat(inputAmount);
    if (isNaN(amount) || amount <= 0) return 0;
    if (selectedCurrency === "LANA") return amount;
    const rate = exchangeRates[selectedCurrency as "EUR" | "USD" | "GBP"];
    return rate && rate > 0 ? amount / rate : 0;
  };

  useEffect(() => {
    const lanaAmount = calculateAmount();
    setCalculatedLana(lanaAmount);

    if (!inputAmount) { setError(""); return; }
    const amount = parseFloat(inputAmount);
    if (isNaN(amount) || amount <= 0) { setError("Please enter a valid amount"); return; }
    if (lanaAmount > walletBalance) {
      setError(`Insufficient balance. You have ${walletBalance.toFixed(2)} LANA available.`);
    } else {
      setError("");
    }
  }, [inputAmount, selectedCurrency, exchangeRates, walletBalance]);

  const isValidAmount = selectedCurrency && inputAmount && parseFloat(inputAmount) > 0 && calculateAmount() > 0 && calculateAmount() <= walletBalance;

  const handleContinueSend = () => {
    if (!inputAmount || calculatedLana <= 0) { setError("Please enter an amount"); return; }
    if (calculatedLana > walletBalance) { setError(`Insufficient balance. You have ${walletBalance.toFixed(2)} LANA available.`); return; }
    navigate(`/send-lana/recipient?walletId=${walletId}&amount=${calculatedLana}&currency=${selectedCurrency}&inputAmount=${inputAmount}${manualOnly ? '&manualOnly=true' : ''}`);
  };

  const handleContinueEmpty = () => {
    navigate(`/send-lana/recipient?walletId=${walletId}&amount=${netAmountLana}&currency=LANA&inputAmount=${netAmountLana}&emptyWallet=true${manualOnly ? '&manualOnly=true' : ''}`);
  };

  const formatNumber = (num: number) => num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const formatLana = (num: number) => num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 8 });

  return (
    <div className="max-w-2xl mx-auto">
      <Button variant="ghost" onClick={() => navigate("/wallet")} className="mb-4">
        <ArrowLeft className="h-4 w-4 mr-2" />
        Back to Wallets
      </Button>

      {/* Wallet Info */}
      <Card className={`mb-6 ${isFrozen ? 'border-blue-500/50 bg-blue-500/5' : ''}`}>
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-2">
            {isFrozen ? <Snowflake className="h-4 w-4 text-blue-500" /> : <Wallet className="h-4 w-4 text-muted-foreground" />}
            <p className="text-sm text-muted-foreground">Sending from</p>
          </div>
          <p className="font-mono text-sm break-all">{walletId}</p>
          <p className="text-sm text-muted-foreground mt-2">
            Available balance:{" "}
            <span className="font-semibold text-foreground">{formatNumber(walletBalance)} LANA</span>
          </p>
          {!utxoLoading && (
            <p className="text-xs text-muted-foreground mt-1">
              {utxoCount} UTXO{utxoCount !== 1 ? 's' : ''}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Frozen Wallet Block */}
      {isFrozen && (
        <Alert variant="destructive" className="mb-6 border-blue-500/50 bg-blue-500/10">
          <ShieldAlert className="h-4 w-4 text-blue-500" />
          <AlertTitle className="text-blue-700 dark:text-blue-400">Wallet Frozen — Sending Disabled</AlertTitle>
          <AlertDescription className="text-blue-700/80 dark:text-blue-300/80">
            This wallet has been frozen by the registrar.
            <strong className="block mt-1">Reason: {getFreezeReasonLabel(walletData?.freezeStatus || 'frozen')}</strong>
            <span className="block mt-1">
              All outgoing transactions are disabled. You can still receive funds to this wallet.
              Contact your registrar to resolve this issue.
            </span>
          </AlertDescription>
        </Alert>
      )}

      {/* UTXO Consolidation Warning */}
      {!utxoLoading && tooManyUtxos && !utxoWarningDismissed && (
        <Alert variant="destructive" className="mb-6">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription className="space-y-3">
            <p>
              This wallet has <strong>{utxoCount} UTXOs</strong> which exceeds the maximum of {maxInputs} inputs per transaction.
              You cannot empty the wallet until you consolidate. However, you can still send smaller amounts.
            </p>
            <a
              href="https://youtu.be/kBi4MKcc4qM"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm font-medium underline hover:no-underline"
            >
              📺 Watch: How to consolidate UTXOs
            </a>
            <Button
              variant="outline"
              size="sm"
              className="w-full mt-2 border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground"
              onClick={() => setUtxoWarningDismissed(true)}
            >
              Proceed Anyway — Send a Smaller Amount
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {!utxoLoading && tooManyUtxos && utxoWarningDismissed && (
        <Alert className="mb-6">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription className="text-sm">
            <strong>{utxoCount} UTXOs</strong> — emptying wallet is disabled. You can send specific amounts below.
          </AlertDescription>
        </Alert>
      )}

      {isFrozen ? (
        <Card className="opacity-50">
          <CardContent className="p-8 text-center">
            <Snowflake className="h-12 w-12 mx-auto mb-4 text-blue-500" />
            <p className="text-lg font-semibold text-blue-700 dark:text-blue-400">Sending is not available</p>
            <p className="text-sm text-muted-foreground mt-2">
              This wallet is frozen. All outgoing transactions are disabled.
            </p>
            <Button variant="outline" className="mt-4" onClick={() => navigate("/wallet")}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Wallets
            </Button>
          </CardContent>
        </Card>
      ) : utxoLoading ? (
        <Card>
          <CardContent className="p-8 flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            <span className="ml-2 text-muted-foreground">Loading wallet info...</span>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {/* Option 1: Send Amount */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <Wallet className="h-5 w-5" />
                Send Amount
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Currency Selection */}
              <div className="space-y-2">
                <Label htmlFor="currency">Currency</Label>
                <Select
                  value={selectedCurrency}
                  onValueChange={(value: "EUR" | "USD" | "GBP" | "LANA") => setSelectedCurrency(value)}
                >
                  <SelectTrigger id="currency">
                    <SelectValue placeholder="Select currency" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="LANA">LANA</SelectItem>
                    <SelectItem value="EUR">EUR</SelectItem>
                    <SelectItem value="USD">USD</SelectItem>
                    <SelectItem value="GBP">GBP</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Amount Input */}
              <div className="space-y-2">
                <Label htmlFor="amount">
                  Amount {selectedCurrency && selectedCurrency !== "LANA" && `(${selectedCurrency})`}
                </Label>
                <Input
                  id="amount"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder={selectedCurrency ? `Enter amount in ${selectedCurrency}` : "Select currency first"}
                  value={inputAmount}
                  onChange={(e) => setInputAmount(e.target.value)}
                  disabled={!selectedCurrency}
                />
              </div>

              {/* Conversion Display */}
              {inputAmount && calculatedLana > 0 && selectedCurrency !== "LANA" && (
                <div className="p-3 rounded-lg bg-primary/5 border border-primary/20">
                  <p className="text-sm text-muted-foreground">You will send:</p>
                  <p className="text-xl font-bold text-primary">{formatNumber(calculatedLana)} LANA</p>
                </div>
              )}

              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <Button className="w-full" size="lg" onClick={handleContinueSend} disabled={!isValidAmount}>
                Continue
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </CardContent>
          </Card>

          {/* Option 2: Empty Wallet */}
          <Card className={tooManyUtxos ? 'opacity-50' : ''}>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <Trash2 className="h-5 w-5" />
                Empty Wallet
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Send the entire balance minus the transaction fee. Wallet will be left with 0 LANA.
              </p>

              <div className="space-y-2 p-3 bg-muted/50 rounded-lg text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Balance</span>
                  <span className="font-medium">{formatLana(totalBalanceSat / 100_000_000)} LANA</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Estimated fee ({utxoCount} input{utxoCount !== 1 ? 's' : ''})</span>
                  <span className="font-medium text-destructive">-{formatLana(feeLana)} LANA</span>
                </div>
                <div className="flex justify-between border-t pt-2">
                  <span className="font-semibold">You will send</span>
                  <span className="font-bold text-primary">{formatLana(netAmountLana > 0 ? netAmountLana : 0)} LANA</span>
                </div>
              </div>

              {tooManyUtxos && (
                <p className="text-xs text-destructive">
                  Cannot empty wallet with {utxoCount} UTXOs. Maximum is {maxInputs}. Consolidate first.
                </p>
              )}

              <Button
                className="w-full"
                size="lg"
                onClick={handleContinueEmpty}
                disabled={tooManyUtxos || netAmountSat <= 0}
              >
                Empty Wallet
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
