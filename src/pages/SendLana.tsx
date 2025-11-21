import { useState, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, ArrowRight, Wallet } from "lucide-react";
import { useSystemParameters } from "@/contexts/SystemParametersContext";
import { useNostrProfile } from "@/hooks/useNostrProfile";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function SendLana() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { parameters } = useSystemParameters();
  const { profile } = useNostrProfile();

  const walletId = searchParams.get("walletId") || "";
  const walletBalance = parseFloat(searchParams.get("balance") || "0");

  const [selectedCurrency, setSelectedCurrency] = useState<"EUR" | "USD" | "GBP" | "LANA" | "">("");
  const [inputAmount, setInputAmount] = useState("");
  const [error, setError] = useState("");
  const [calculatedLana, setCalculatedLana] = useState(0);

  const exchangeRates = parameters?.exchangeRates;

  // Calculate immediately without debouncing
  const calculateAmount = () => {
    if (!inputAmount || !exchangeRates || !selectedCurrency) {
      return 0;
    }

    const amount = parseFloat(inputAmount);
    if (isNaN(amount) || amount <= 0) {
      return 0;
    }

    let lanaAmount = 0;
    if (selectedCurrency === "LANA") {
      lanaAmount = amount;
    } else {
      const rate = exchangeRates[selectedCurrency as "EUR" | "USD" | "GBP"];
      if (rate && rate > 0) {
        lanaAmount = amount / rate;
      }
    }

    return lanaAmount;
  };

  useEffect(() => {
    const lanaAmount = calculateAmount();
    setCalculatedLana(lanaAmount);

    if (!inputAmount) {
      setError("");
      return;
    }

    const amount = parseFloat(inputAmount);
    if (isNaN(amount) || amount <= 0) {
      setError("Please enter a valid amount");
      return;
    }

    // Check if sufficient balance
    if (lanaAmount > walletBalance) {
      setError(`Insufficient balance. You have ${walletBalance.toFixed(2)} LANA available.`);
    } else {
      setError("");
    }
  }, [inputAmount, selectedCurrency, exchangeRates, walletBalance]);

  // Real-time validation
  const isValidAmount = selectedCurrency && inputAmount && parseFloat(inputAmount) > 0 && calculateAmount() > 0 && calculateAmount() <= walletBalance;

  const handleContinue = () => {
    if (!inputAmount || calculatedLana <= 0) {
      setError("Please enter an amount");
      return;
    }

    if (calculatedLana > walletBalance) {
      setError(`Insufficient balance. You have ${walletBalance.toFixed(2)} LANA available.`);
      return;
    }

    console.log('🚀 SendLana navigate:', { 
      walletId, 
      calculatedLana, 
      selectedCurrency, 
      inputAmount 
    });

    navigate(`/send-lana/recipient?walletId=${walletId}&amount=${calculatedLana}&currency=${selectedCurrency}&inputAmount=${inputAmount}`);
  };

  const formatNumber = (num: number) => {
    return num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  return (
    <div className="max-w-2xl mx-auto">
      <Button
        variant="ghost"
        onClick={() => navigate("/wallet")}
        className="mb-4"
      >
        <ArrowLeft className="h-4 w-4 mr-2" />
        Back to Wallets
      </Button>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5" />
            Send LANA
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Wallet Info */}
          <div className="p-4 rounded-lg bg-muted/50">
            <p className="text-sm text-muted-foreground mb-1">Sending from:</p>
            <p className="font-mono text-sm break-all">{walletId}</p>
            <p className="text-sm text-muted-foreground mt-2">
              Available balance:{" "}
              <span className="font-semibold text-foreground">
                {formatNumber(walletBalance)} LANA
              </span>
            </p>
          </div>

          {/* Currency Selection */}
          <div className="space-y-2">
            <Label htmlFor="currency">Select Currency</Label>
            <Select
              value={selectedCurrency}
              onValueChange={(value: "EUR" | "USD" | "GBP" | "LANA") =>
                setSelectedCurrency(value)
              }
            >
              <SelectTrigger id="currency">
                <SelectValue placeholder="Select currency" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="LANA">LANA</SelectItem>
                <SelectItem value="EUR">EUR (€)</SelectItem>
                <SelectItem value="USD">USD ($)</SelectItem>
                <SelectItem value="GBP">GBP (£)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Amount Input */}
          <div className="space-y-2">
            <Label htmlFor="amount">
              Amount {selectedCurrency !== "LANA" && `(${selectedCurrency})`}
            </Label>
            <Input
              id="amount"
              type="number"
              step="0.01"
              min="0"
              placeholder={`Enter amount in ${selectedCurrency}`}
              value={inputAmount}
              onChange={(e) => setInputAmount(e.target.value)}
            />
          </div>

          {/* Conversion Display */}
          {inputAmount && calculatedLana > 0 && selectedCurrency !== "LANA" && (
            <div className="p-4 rounded-lg bg-primary/5 border border-primary/20">
              <p className="text-sm text-muted-foreground">You will send:</p>
              <p className="text-2xl font-bold text-primary">
                {formatNumber(calculatedLana)} LANA
              </p>
            </div>
          )}

          {/* Error Message */}
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* Continue Button */}
          <Button
            className="w-full"
            size="lg"
            onClick={handleContinue}
            disabled={!isValidAmount}
          >
            Continue
            <ArrowRight className="h-4 w-4 ml-2" />
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
