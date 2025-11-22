import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { QRScanner } from "@/components/QRScanner";
import { Camera, Wallet, ArrowRight, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { convertWifToIds } from "@/lib/crypto";
import { formatLana } from "@/lib/currencyConversion";

interface PaymentRecipient {
  proposalId: string;
  proposalDTag: string;
  recipientWallet: string;
  recipientPubkey: string;
  lanaAmount: number;
  lanoshiAmount: number;
  service: string;
}

interface PaymentData {
  selectedProposals: PaymentRecipient[];
  senderWallet: string;
  totalLana: number;
}

export default function ConfirmPayment() {
  const navigate = useNavigate();
  const [privateKey, setPrivateKey] = useState("");
  const [isValidating, setIsValidating] = useState(false);
  const [isPrivateKeyValid, setIsPrivateKeyValid] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [paymentData, setPaymentData] = useState<PaymentData | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    // Load payment data from session storage
    const storedData = sessionStorage.getItem('pendingUnconditionalPayment');
    if (!storedData) {
      toast.error("No payment data found");
      navigate('/unconditional-payment');
      return;
    }

    try {
      const data = JSON.parse(storedData);
      setPaymentData(data);
    } catch (error) {
      toast.error("Invalid payment data");
      navigate('/unconditional-payment');
    }
  }, [navigate]);

  useEffect(() => {
    if (!privateKey || !paymentData) {
      setIsPrivateKeyValid(false);
      setValidationError(null);
      return;
    }

    const validatePrivateKey = async () => {
      try {
        setIsValidating(true);
        const derivedIds = await convertWifToIds(privateKey);
        
        if (derivedIds.walletId === paymentData.senderWallet) {
          setIsPrivateKeyValid(true);
          setValidationError(null);
        } else {
          setIsPrivateKeyValid(false);
          setValidationError("Private key does not match the selected wallet");
        }
      } catch (error) {
        setIsPrivateKeyValid(false);
        setValidationError("Invalid private key format");
      } finally {
        setIsValidating(false);
      }
    };

    const debounce = setTimeout(validatePrivateKey, 500);
    return () => clearTimeout(debounce);
  }, [privateKey, paymentData]);

  const handleScanComplete = (scannedData: string) => {
    setPrivateKey(scannedData.trim());
    setIsScannerOpen(false);
  };

  // Group recipients by wallet address and calculate totals
  const recipientSummary = paymentData?.selectedProposals.reduce((acc, proposal) => {
    const existing = acc.find(r => r.wallet === proposal.recipientWallet);
    if (existing) {
      existing.amount += proposal.lanaAmount;
      existing.services.push(proposal.service);
    } else {
      acc.push({
        wallet: proposal.recipientWallet,
        amount: proposal.lanaAmount,
        services: [proposal.service]
      });
    }
    return acc;
  }, [] as Array<{ wallet: string; amount: number; services: string[] }>) || [];

  const handleConfirmPayment = async () => {
    if (!privateKey || !isPrivateKeyValid || !paymentData) {
      toast.error("Please enter a valid private key");
      return;
    }

    setIsProcessing(true);

    try {
      // Here we would call the edge function to process the unconditional payment
      // This would be similar to send-lana-transaction but for multiple outputs
      
      // For now, show a placeholder
      toast.success("Payment processing not yet fully implemented");
      
      // TODO: Implement the actual payment transaction
      // This should:
      // 1. Create a transaction with multiple outputs (one for each unique recipient wallet)
      // 2. Sign the transaction with the private key
      // 3. Broadcast it to the network
      // 4. Create KIND 90901 events for each unconditional payment
      // 5. Navigate to a success page
      
      console.log('Payment data:', {
        senderWallet: paymentData.senderWallet,
        recipients: recipientSummary,
        totalLana: paymentData.totalLana,
        privateKey: '***hidden***'
      });

      // Placeholder navigation
      // navigate('/unconditional-payment/payment-result');
      
    } catch (error) {
      console.error('Payment error:', error);
      toast.error(error instanceof Error ? error.message : 'Payment failed');
    } finally {
      setIsProcessing(false);
    }
  };

  if (!paymentData) {
    return null;
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6 pb-20">
      <div className="mb-6">
        <Button
          variant="ghost"
          onClick={() => navigate('/unconditional-payment')}
          className="mb-4"
        >
          ← Back to Payments
        </Button>
        <h1 className="text-3xl font-bold">Confirm Payment</h1>
        <p className="text-muted-foreground">Review and authorize your unconditional payment</p>
      </div>

      {/* Payment Summary */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5" />
            Payment Summary
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label className="text-muted-foreground">From Wallet</Label>
            <div className="p-3 bg-muted rounded-lg">
              <p className="font-mono text-sm break-all">{paymentData.senderWallet}</p>
            </div>
          </div>

          <div className="space-y-3">
            <Label className="text-muted-foreground">To Recipients</Label>
            {recipientSummary.map((recipient, index) => (
              <div key={index} className="p-3 bg-muted rounded-lg space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <p className="font-mono text-sm break-all mb-1">{recipient.wallet}</p>
                    <p className="text-xs text-muted-foreground">
                      {recipient.services.join(', ')}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold">{formatLana(recipient.amount)}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="pt-4 border-t">
            <div className="flex items-center justify-between">
              <span className="text-lg font-semibold">Total Amount</span>
              <span className="text-2xl font-bold text-primary">{formatLana(paymentData.totalLana)}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Private Key Input */}
      <Card>
        <CardHeader>
          <CardTitle>Authorize Payment</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="privateKey">Enter Private Key (WIF Format)</Label>
            <div className="flex gap-2">
              <Input
                id="privateKey"
                type="password"
                value={privateKey}
                onChange={(e) => setPrivateKey(e.target.value)}
                placeholder="Enter your private key..."
                className={isPrivateKeyValid ? "border-green-500" : validationError ? "border-destructive" : ""}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => setIsScannerOpen(true)}
              >
                <Camera className="h-4 w-4" />
              </Button>
            </div>

            {isValidating && (
              <p className="text-sm text-muted-foreground">Validating...</p>
            )}

            {isPrivateKeyValid && (
              <div className="flex items-center gap-2 text-sm text-green-600">
                <AlertCircle className="h-4 w-4" />
                <span>Private key verified for selected wallet</span>
              </div>
            )}

            {validationError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{validationError}</AlertDescription>
              </Alert>
            )}
          </div>

          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Your private key is required to authorize this transaction. It will be used securely to sign the payment and will not be stored.
            </AlertDescription>
          </Alert>

          <Button
            onClick={handleConfirmPayment}
            disabled={!isPrivateKeyValid || isProcessing}
            className="w-full"
            size="lg"
          >
            {isProcessing ? (
              "Processing..."
            ) : (
              <>
                Confirm & Send Payment
                <ArrowRight className="ml-2 h-4 w-4" />
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      <QRScanner
        isOpen={isScannerOpen}
        onClose={() => setIsScannerOpen(false)}
        onScan={handleScanComplete}
      />
    </div>
  );
}
