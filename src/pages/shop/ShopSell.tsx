import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  QrCode,
  FileText,
  Wallet,
  Loader2,
  CheckCircle,
  XCircle,
  ArrowRight,
  ScanLine,
  Send,
  AlertCircle,
} from "lucide-react";
import { useSystemParameters } from "@/contexts/SystemParametersContext";
import { useAuth } from "@/contexts/AuthContext";
import { useNostrWallets } from "@/hooks/useNostrWallets";
import { QRScanner } from "@/components/QRScanner";
import { convertWifToIds } from "@/lib/crypto";
import { signNostrEvent } from "@/lib/nostrSigning";
import { supabase } from "@/integrations/supabase/client";
import { SimplePool } from "nostr-tools";
import { toast } from "sonner";

type Step = "amount" | "scanning" | "processing" | "result" | "invoice";

export default function ShopSell() {
  const { parameters } = useSystemParameters();
  const { session } = useAuth();
  const { wallets: userWallets } = useNostrWallets();

  // Step tracking
  const [step, setStep] = useState<Step>("amount");

  // Amount state
  const [selectedCurrency, setSelectedCurrency] = useState<"EUR" | "USD" | "GBP" | "LANA" | "">("");
  const [inputAmount, setInputAmount] = useState("");
  const [selectedWalletId, setSelectedWalletId] = useState("");
  const [error, setError] = useState("");

  // QR Scanner state
  const [showScanner, setShowScanner] = useState(false);

  // Processing state
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStatus, setProcessingStatus] = useState("");
  const [txResult, setTxResult] = useState<{
    success: boolean;
    txHash?: string;
    amount?: number;
    fee?: number;
    buyerWallet?: string;
    error?: string;
  } | null>(null);

  // Invoice state
  const [invoiceDescription, setInvoiceDescription] = useState("");
  const [invoiceDeadline, setInvoiceDeadline] = useState("");
  const [isPublishingInvoice, setIsPublishingInvoice] = useState(false);
  const [invoiceResult, setInvoiceResult] = useState<{
    success: boolean;
    eventId?: string;
    error?: string;
  } | null>(null);

  const exchangeRates = parameters?.exchangeRates;

  // Filter wallets — exclude Lana8Wonder and Knights
  const availableWallets = useMemo(() => {
    return userWallets.filter(
      (w) => w.walletType !== "Lana8Wonder" && w.walletType !== "Knights" && !w.freezeStatus
    );
  }, [userWallets]);

  // Calculate LANA amount from input
  const calculatedLana = useMemo(() => {
    if (!inputAmount || !exchangeRates || !selectedCurrency) return 0;
    const amount = parseFloat(inputAmount);
    if (isNaN(amount) || amount <= 0) return 0;
    if (selectedCurrency === "LANA") return amount;
    const rate = exchangeRates[selectedCurrency as "EUR" | "USD" | "GBP"];
    return rate && rate > 0 ? amount / rate : 0;
  }, [inputAmount, selectedCurrency, exchangeRates]);

  // Validate form
  useEffect(() => {
    if (!inputAmount) { setError(""); return; }
    const amount = parseFloat(inputAmount);
    if (isNaN(amount) || amount <= 0) {
      setError("Please enter a valid amount");
    } else {
      setError("");
    }
  }, [inputAmount, selectedCurrency]);

  const isValidAmount = selectedCurrency && inputAmount && parseFloat(inputAmount) > 0 && calculatedLana > 0 && selectedWalletId;

  const formatNumber = (num: number) => num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // === CHARGE CUSTOMER (QR scan) ===
  const handleChargeCustomer = () => {
    setShowScanner(true);
  };

  const handleQrScan = async (scannedKey: string) => {
    setShowScanner(false);
    setStep("processing");
    setIsProcessing(true);
    setProcessingStatus("Deriving wallet from private key...");
    setTxResult(null);

    try {
      // Step 1: Derive wallet from private key
      const ids = await convertWifToIds(scannedKey);
      const buyerWallet = ids.walletId;
      setProcessingStatus(`Wallet: ${buyerWallet.slice(0, 8)}...${buyerWallet.slice(-6)} — Checking registration...`);

      // Step 2: Check wallet registration
      const API_URL = import.meta.env.VITE_API_URL ?? '';
      const regRes = await fetch(`${API_URL}/api/functions/check-wallet-registration`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet_id: buyerWallet }),
      });
      const regData = await regRes.json();

      if (!regData.registered) {
        setTxResult({
          success: false,
          buyerWallet,
          error: "Buyer's wallet is not registered. Transaction cannot proceed."
        });
        setIsProcessing(false);
        return;
      }

      if (regData.wallet?.frozen) {
        setTxResult({
          success: false,
          buyerWallet,
          error: "Buyer's wallet is frozen. Transaction cannot proceed."
        });
        setIsProcessing(false);
        return;
      }

      setProcessingStatus("Wallet registered. Building transaction...");

      // Step 3: Build and broadcast transaction
      const lanaAmount = calculatedLana;
      const { data, error: txError } = await supabase.functions.invoke('send-lana-transaction', {
        body: {
          senderAddress: buyerWallet,
          recipientAddress: selectedWalletId,
          amount: lanaAmount,
          privateKey: scannedKey,
          emptyWallet: false,
          electrumServers: parameters?.electrumServers || []
        }
      });

      if (txError) throw txError;

      if (data?.success) {
        setTxResult({
          success: true,
          txHash: data.txHash,
          amount: data.amount,
          fee: data.fee,
          buyerWallet,
        });
        toast.success("Payment received successfully!");
      } else {
        setTxResult({
          success: false,
          buyerWallet,
          error: data?.error || "Transaction failed"
        });
      }
    } catch (err) {
      console.error("Charge customer error:", err);
      setTxResult({
        success: false,
        error: err instanceof Error ? err.message : "Failed to process payment"
      });
    } finally {
      setIsProcessing(false);
    }
  };

  // === SEND INVOICE ===
  const handleSendInvoice = () => {
    setStep("invoice");
    setInvoiceResult(null);
  };

  const handlePublishInvoice = async () => {
    if (!session?.nostrPrivateKey || !session?.nostrHexId || !parameters?.relays) {
      toast.error("Missing authentication or relay configuration");
      return;
    }

    setIsPublishingInvoice(true);
    setInvoiceResult(null);

    try {
      // Generate unique invoice ID
      const invoiceId = crypto.randomUUID().replace(/-/g, '');

      // Build tags
      const tags: string[][] = [
        ["d", invoiceId],
        ["amount_fiat", parseFloat(inputAmount).toFixed(2)],
        ["currency", selectedCurrency],
        ["amount_lana", calculatedLana.toFixed(2)],
        ["wallet_id", selectedWalletId],
        ["status", "open"],
      ];

      if (invoiceDescription.trim()) {
        tags.push(["description", invoiceDescription.trim()]);
      }

      if (invoiceDeadline) {
        const deadlineTs = Math.floor(new Date(invoiceDeadline).getTime() / 1000);
        tags.push(["deadline", deadlineTs.toString()]);
      }

      // Sign the event
      const signedEvent = signNostrEvent(
        session.nostrPrivateKey,
        70100,
        invoiceDescription.trim() || `Invoice for ${parseFloat(inputAmount).toFixed(2)} ${selectedCurrency}`,
        tags
      );

      // Queue to server DB as fallback
      supabase.functions.invoke('queue-relay-event', {
        body: { signedEvent, userPubkey: session.nostrHexId }
      }).catch(() => {}); // silent — best-effort

      // Publish to relays
      const pool = new SimplePool();
      let successCount = 0;

      try {
        const publishPromises = pool.publish(parameters.relays, signedEvent);
        const publishArray = Array.from(publishPromises);

        await Promise.race([
          Promise.allSettled(publishArray).then((results) => {
            successCount = results.filter(r => r.status === 'fulfilled').length;
          }),
          new Promise((resolve) => setTimeout(resolve, 10000))
        ]);
      } finally {
        pool.close(parameters.relays);
      }

      setInvoiceResult({
        success: true,
        eventId: signedEvent.id,
      });

      toast.success(`Invoice published to ${successCount} relay${successCount !== 1 ? 's' : ''}`);
    } catch (err) {
      console.error("Invoice publish error:", err);
      setInvoiceResult({
        success: false,
        error: err instanceof Error ? err.message : "Failed to publish invoice"
      });
      toast.error("Failed to publish invoice");
    } finally {
      setIsPublishingInvoice(false);
    }
  };

  // === RESET ===
  const handleNewSale = () => {
    setStep("amount");
    setInputAmount("");
    setSelectedCurrency("");
    setSelectedWalletId("");
    setError("");
    setTxResult(null);
    setInvoiceResult(null);
    setInvoiceDescription("");
    setInvoiceDeadline("");
  };

  // === RENDER ===

  // Amount & Wallet Selection (Step 1)
  if (step === "amount") {
    return (
      <div className="space-y-4">
        <div className="mb-4">
          <h2 className="text-2xl font-bold">Sell</h2>
          <p className="text-sm text-muted-foreground">Charge a customer or send an invoice</p>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Wallet className="h-5 w-5" />
              Sale Details
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Currency Selection */}
            <div className="space-y-2">
              <Label>Currency</Label>
              <Select
                value={selectedCurrency}
                onValueChange={(value: "EUR" | "USD" | "GBP" | "LANA") => setSelectedCurrency(value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select currency" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="EUR">EUR</SelectItem>
                  <SelectItem value="USD">USD</SelectItem>
                  <SelectItem value="GBP">GBP</SelectItem>
                  <SelectItem value="LANA">LANA</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Amount Input */}
            <div className="space-y-2">
              <Label>Amount</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                placeholder={selectedCurrency ? `Enter amount in ${selectedCurrency}` : "Select currency first"}
                value={inputAmount}
                onChange={(e) => setInputAmount(e.target.value)}
                disabled={!selectedCurrency}
              />
            </div>

            {/* LANA conversion display */}
            {inputAmount && calculatedLana > 0 && selectedCurrency !== "LANA" && (
              <div className="p-3 rounded-lg bg-primary/5 border border-primary/20">
                <p className="text-sm text-muted-foreground">Customer will pay:</p>
                <p className="text-xl font-bold text-primary">{formatNumber(calculatedLana)} LANA</p>
              </div>
            )}

            {/* Wallet Selection */}
            <div className="space-y-2">
              <Label>Receive to wallet</Label>
              {availableWallets.length === 0 ? (
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>No eligible wallets found. Lana8Wonder and Knights wallets are excluded.</AlertDescription>
                </Alert>
              ) : (
                <Select value={selectedWalletId} onValueChange={setSelectedWalletId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select your wallet" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableWallets.map((w) => (
                      <SelectItem key={w.walletId} value={w.walletId}>
                        <span className="font-mono text-xs">{w.walletId.slice(0, 10)}...{w.walletId.slice(-6)}</span>
                        {w.walletType && (
                          <Badge variant="secondary" className="ml-2 text-[10px]">{w.walletType}</Badge>
                        )}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>

        {/* Action buttons */}
        <div className="grid grid-cols-2 gap-3">
          <Button
            size="lg"
            onClick={handleChargeCustomer}
            disabled={!isValidAmount}
            className="flex flex-col items-center gap-1 h-auto py-4"
          >
            <ScanLine className="h-6 w-6" />
            <span className="text-sm font-semibold">Charge Customer</span>
            <span className="text-xs opacity-75">Scan QR</span>
          </Button>
          <Button
            size="lg"
            variant="outline"
            onClick={handleSendInvoice}
            disabled={!isValidAmount}
            className="flex flex-col items-center gap-1 h-auto py-4"
          >
            <Send className="h-6 w-6" />
            <span className="text-sm font-semibold">Send Invoice</span>
            <span className="text-xs opacity-75">Remote payment</span>
          </Button>
        </div>

        {/* QR Scanner Dialog */}
        <Dialog open={showScanner} onOpenChange={setShowScanner}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <QrCode className="w-5 h-5" />
                Scan Customer's Private Key
              </DialogTitle>
              <DialogDescription>
                <span className="block text-center my-2">
                  <span className="text-2xl font-bold text-primary">{formatNumber(calculatedLana)} LANA</span>
                  {selectedCurrency !== "LANA" && (
                    <span className="block text-sm text-muted-foreground">
                      ({parseFloat(inputAmount).toFixed(2)} {selectedCurrency})
                    </span>
                  )}
                </span>
                Position the customer's QR code within the frame
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div id="qr-reader-login" className="w-full rounded-lg overflow-hidden" />
              <Button onClick={() => setShowScanner(false)} variant="outline" className="w-full">
                Cancel
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Actual QR Scanner (rendered behind dialog) */}
        <QRScanner
          isOpen={showScanner}
          onClose={() => setShowScanner(false)}
          onScan={handleQrScan}
        />
      </div>
    );
  }

  // Processing (Step 2a)
  if (step === "processing") {
    return (
      <div className="space-y-4">
        <div className="mb-4">
          <h2 className="text-2xl font-bold">Processing Payment</h2>
        </div>

        {isProcessing ? (
          <Card>
            <CardContent className="p-8 flex flex-col items-center justify-center space-y-4">
              <Loader2 className="h-12 w-12 animate-spin text-primary" />
              <p className="text-lg font-semibold">{processingStatus}</p>
              <div className="p-3 rounded-lg bg-primary/5 border border-primary/20 text-center">
                <p className="text-sm text-muted-foreground">Amount</p>
                <p className="text-2xl font-bold text-primary">{formatNumber(calculatedLana)} LANA</p>
              </div>
            </CardContent>
          </Card>
        ) : txResult ? (
          <Card className={txResult.success ? "border-green-300" : "border-red-300"}>
            <CardContent className="p-6 space-y-4">
              <div className="flex items-center gap-3">
                {txResult.success ? (
                  <CheckCircle className="h-10 w-10 text-green-500" />
                ) : (
                  <XCircle className="h-10 w-10 text-red-500" />
                )}
                <div>
                  <h3 className="text-xl font-bold">
                    {txResult.success ? "Payment Received!" : "Payment Failed"}
                  </h3>
                  {txResult.success && (
                    <p className="text-sm text-muted-foreground">Transaction confirmed on the blockchain</p>
                  )}
                </div>
              </div>

              {txResult.success && txResult.txHash && (
                <div className="space-y-2 p-3 bg-muted/50 rounded-lg text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Amount</span>
                    <span className="font-semibold">{formatNumber(txResult.amount || calculatedLana)} LANA</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Fee</span>
                    <span className="text-xs">{txResult.fee ? (txResult.fee / 100_000_000).toFixed(8) : "—"} LANA</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">From</span>
                    <span className="font-mono text-xs">{txResult.buyerWallet?.slice(0, 10)}...{txResult.buyerWallet?.slice(-6)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">To</span>
                    <span className="font-mono text-xs">{selectedWalletId.slice(0, 10)}...{selectedWalletId.slice(-6)}</span>
                  </div>
                  <div className="border-t pt-2">
                    <span className="text-muted-foreground text-xs">TX: </span>
                    <span className="font-mono text-xs break-all">{txResult.txHash}</span>
                  </div>
                </div>
              )}

              {!txResult.success && txResult.error && (
                <Alert variant="destructive">
                  <AlertDescription>{txResult.error}</AlertDescription>
                </Alert>
              )}

              <Button onClick={handleNewSale} className="w-full" size="lg">
                <ArrowRight className="h-4 w-4 mr-2" />
                New Sale
              </Button>
            </CardContent>
          </Card>
        ) : null}
      </div>
    );
  }

  // Send Invoice (Step 2b)
  if (step === "invoice") {
    return (
      <div className="space-y-4">
        <div className="mb-4">
          <h2 className="text-2xl font-bold">Send Invoice</h2>
          <p className="text-sm text-muted-foreground">Publish a payment request to Nostr</p>
        </div>

        {!invoiceResult ? (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Invoice Details
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="p-3 rounded-lg bg-primary/5 border border-primary/20 text-center">
                <p className="text-sm text-muted-foreground">Amount</p>
                <p className="text-2xl font-bold text-primary">{formatNumber(calculatedLana)} LANA</p>
                {selectedCurrency !== "LANA" && (
                  <p className="text-sm text-muted-foreground">
                    ({parseFloat(inputAmount).toFixed(2)} {selectedCurrency})
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea
                  placeholder="What is this payment for? (optional)"
                  value={invoiceDescription}
                  onChange={(e) => setInvoiceDescription(e.target.value)}
                  rows={3}
                />
              </div>

              <div className="space-y-2">
                <Label>Payment deadline (optional)</Label>
                <Input
                  type="datetime-local"
                  value={invoiceDeadline}
                  onChange={(e) => setInvoiceDeadline(e.target.value)}
                />
              </div>

              <div className="p-3 bg-muted/50 rounded-lg text-sm space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Receive to</span>
                  <span className="font-mono text-xs">{selectedWalletId.slice(0, 10)}...{selectedWalletId.slice(-6)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Published as</span>
                  <Badge variant="secondary" className="text-xs">KIND 70100</Badge>
                </div>
              </div>

              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setStep("amount")} className="flex-1">
                  Back
                </Button>
                <Button
                  onClick={handlePublishInvoice}
                  disabled={isPublishingInvoice}
                  className="flex-1"
                >
                  {isPublishingInvoice ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Publishing...
                    </>
                  ) : (
                    <>
                      <Send className="h-4 w-4 mr-2" />
                      Publish Invoice
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className={invoiceResult.success ? "border-green-300" : "border-red-300"}>
            <CardContent className="p-6 space-y-4">
              <div className="flex items-center gap-3">
                {invoiceResult.success ? (
                  <CheckCircle className="h-10 w-10 text-green-500" />
                ) : (
                  <XCircle className="h-10 w-10 text-red-500" />
                )}
                <div>
                  <h3 className="text-xl font-bold">
                    {invoiceResult.success ? "Invoice Published!" : "Invoice Failed"}
                  </h3>
                  {invoiceResult.success && (
                    <p className="text-sm text-muted-foreground">
                      The buyer can now find and pay this invoice
                    </p>
                  )}
                </div>
              </div>

              {invoiceResult.success && invoiceResult.eventId && (
                <div className="p-3 bg-muted/50 rounded-lg text-sm space-y-2">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Amount</span>
                    <span className="font-semibold">{formatNumber(calculatedLana)} LANA</span>
                  </div>
                  <div className="border-t pt-2">
                    <span className="text-muted-foreground text-xs">Event ID: </span>
                    <span className="font-mono text-xs break-all">{invoiceResult.eventId}</span>
                  </div>
                </div>
              )}

              {!invoiceResult.success && invoiceResult.error && (
                <Alert variant="destructive">
                  <AlertDescription>{invoiceResult.error}</AlertDescription>
                </Alert>
              )}

              <Button onClick={handleNewSale} className="w-full" size="lg">
                <ArrowRight className="h-4 w-4 mr-2" />
                New Sale
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  return null;
}
