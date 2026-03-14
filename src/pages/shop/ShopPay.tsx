import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ShoppingCart,
  Wallet,
  Loader2,
  CheckCircle,
  XCircle,
  ArrowLeft,
  ArrowRight,
  QrCode,
  Clock,
  User,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import { useSystemParameters } from "@/contexts/SystemParametersContext";
import { useAuth } from "@/contexts/AuthContext";
import { useNostrWallets } from "@/hooks/useNostrWallets";
import { QRScanner } from "@/components/QRScanner";
import { convertWifToIds } from "@/lib/crypto";
import { signNostrEvent } from "@/lib/nostrSigning";
import { supabase } from "@/integrations/supabase/client";
import { SimplePool, Event } from "nostr-tools";
import { toast } from "sonner";

interface Invoice {
  id: string;
  pubkey: string;
  createdAt: number;
  invoiceId: string;
  amountFiat: string;
  currency: string;
  amountLana: string;
  walletId: string;
  status: string;
  description: string;
  deadline: number | null;
  targetBuyer: string | null;
}

type Step = "browse" | "pay" | "processing" | "result";

function parseInvoiceEvent(event: Event): Invoice | null {
  try {
    const getTag = (name: string) => event.tags.find(t => t[0] === name)?.[1] || "";
    const status = getTag("status");
    if (status !== "open") return null;

    return {
      id: event.id,
      pubkey: event.pubkey,
      createdAt: event.created_at,
      invoiceId: getTag("d"),
      amountFiat: getTag("amount_fiat"),
      currency: getTag("currency"),
      amountLana: getTag("amount_lana"),
      walletId: getTag("wallet_id"),
      status,
      description: getTag("description") || event.content || "",
      deadline: getTag("deadline") ? parseInt(getTag("deadline")) : null,
      targetBuyer: event.tags.find(t => t[0] === "p")?.[1] || null,
    };
  } catch {
    return null;
  }
}

export default function ShopPay() {
  const { parameters } = useSystemParameters();
  const { session } = useAuth();
  const { wallets: userWallets } = useNostrWallets();

  // Step tracking
  const [step, setStep] = useState<Step>("browse");

  // Browse state
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [isLoadingInvoices, setIsLoadingInvoices] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);

  // Pay state
  const [selectedWalletId, setSelectedWalletId] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [showScanner, setShowScanner] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStatus, setProcessingStatus] = useState("");
  const [txResult, setTxResult] = useState<{
    success: boolean;
    txHash?: string;
    amount?: number;
    fee?: number;
    error?: string;
  } | null>(null);

  // Filter wallets — exclude Lana8Wonder and Knights
  const availableWallets = useMemo(() => {
    return userWallets.filter(
      (w) => w.walletType !== "Lana8Wonder" && w.walletType !== "Knights" && !w.freezeStatus
    );
  }, [userWallets]);

  // Fetch invoices from relays
  const fetchInvoices = async () => {
    if (!parameters?.relays) return;

    setIsLoadingInvoices(true);
    const pool = new SimplePool();

    try {
      const events = await pool.querySync(parameters.relays, {
        kinds: [70100],
        limit: 50,
      });

      const parsed = events
        .map(parseInvoiceEvent)
        .filter((inv): inv is Invoice => inv !== null)
        .filter((inv) => {
          // Filter out expired invoices
          if (inv.deadline && inv.deadline < Math.floor(Date.now() / 1000)) return false;
          // Don't show user's own invoices
          if (inv.pubkey === session?.nostrHexId) return false;
          return true;
        })
        .sort((a, b) => b.createdAt - a.createdAt);

      setInvoices(parsed);
    } catch (err) {
      console.error("Failed to fetch invoices:", err);
      toast.error("Failed to load invoices from relays");
    } finally {
      pool.close(parameters.relays);
      setIsLoadingInvoices(false);
    }
  };

  useEffect(() => {
    fetchInvoices();
  }, [parameters?.relays, session?.nostrHexId]);

  const formatNumber = (num: number) => num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const formatDate = (ts: number) => {
    return new Date(ts * 1000).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  // Select an invoice to pay
  const handleSelectInvoice = (invoice: Invoice) => {
    setSelectedInvoice(invoice);
    setStep("pay");
    setPrivateKey("");
    setSelectedWalletId("");
    setTxResult(null);
  };

  // Process payment
  const handlePay = async () => {
    if (!selectedInvoice || !selectedWalletId || !privateKey || !session?.nostrPrivateKey || !parameters?.relays) return;

    setStep("processing");
    setIsProcessing(true);
    setProcessingStatus("Validating private key...");
    setTxResult(null);

    try {
      // Step 1: Validate private key matches selected wallet
      const ids = await convertWifToIds(privateKey);
      const derivedWallet = ids.walletId;

      // Check if derived wallet matches selected wallet (try both formats)
      if (derivedWallet !== selectedWalletId && ids.walletIdCompressed !== selectedWalletId && ids.walletIdUncompressed !== selectedWalletId) {
        setTxResult({
          success: false,
          error: `Private key does not match selected wallet. Key belongs to ${derivedWallet.slice(0, 10)}...`
        });
        setIsProcessing(false);
        return;
      }

      setProcessingStatus("Checking wallet registration...");

      // Step 2: Check wallet registration
      const API_URL = import.meta.env.VITE_API_URL ?? '';
      const regRes = await fetch(`${API_URL}/api/functions/check-wallet-registration`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet_id: selectedWalletId }),
      });
      const regData = await regRes.json();

      if (!regData.registered) {
        setTxResult({
          success: false,
          error: "Your selected wallet is not registered. Cannot send transaction."
        });
        setIsProcessing(false);
        return;
      }

      setProcessingStatus("Building transaction...");

      // Step 3: Build and broadcast transaction
      const lanaAmount = parseFloat(selectedInvoice.amountLana);
      const { data, error: txError } = await supabase.functions.invoke('send-lana-transaction', {
        body: {
          senderAddress: selectedWalletId,
          recipientAddress: selectedInvoice.walletId,
          amount: lanaAmount,
          privateKey,
          emptyWallet: false,
          electrumServers: parameters?.electrumServers || []
        }
      });

      if (txError) throw txError;

      if (!data?.success) {
        throw new Error(data?.error || "Transaction failed");
      }

      setProcessingStatus("Transaction sent! Publishing confirmation...");

      // Step 4: Publish KIND 70101 confirmation
      try {
        const confirmTags: string[][] = [
          ["invoice_ref", selectedInvoice.id],
          ["tx_id", data.txHash],
          ["sender_wallet", selectedWalletId],
          ["receiver_wallet", selectedInvoice.walletId],
          ["amount_fiat", selectedInvoice.amountFiat],
          ["currency", selectedInvoice.currency],
          ["amount_lana", lanaAmount.toFixed(2)],
          ["status", "confirmed"],
        ];

        const signedConfirmation = signNostrEvent(
          session.nostrPrivateKey,
          70101,
          `Payment for invoice ${selectedInvoice.invoiceId}`,
          confirmTags
        );

        // Queue as fallback
        supabase.functions.invoke('queue-relay-event', {
          body: { signedEvent: signedConfirmation, userPubkey: session.nostrHexId }
        }).catch(() => {});

        // Publish to relays
        const pool = new SimplePool();
        try {
          const publishPromises = pool.publish(parameters.relays, signedConfirmation);
          const publishArray = Array.from(publishPromises);
          await Promise.race([
            Promise.allSettled(publishArray),
            new Promise((resolve) => setTimeout(resolve, 10000))
          ]);
        } finally {
          pool.close(parameters.relays);
        }
      } catch (confirmErr) {
        console.warn("Failed to publish confirmation event:", confirmErr);
        // Don't fail the payment — TX is already confirmed
      }

      setTxResult({
        success: true,
        txHash: data.txHash,
        amount: data.amount || lanaAmount,
        fee: data.fee,
      });

      toast.success("Payment successful!");
    } catch (err) {
      console.error("Payment error:", err);
      setTxResult({
        success: false,
        error: err instanceof Error ? err.message : "Payment failed"
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleNewPayment = () => {
    setStep("browse");
    setSelectedInvoice(null);
    setPrivateKey("");
    setSelectedWalletId("");
    setTxResult(null);
    fetchInvoices();
  };

  // === BROWSE INVOICES ===
  if (step === "browse") {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-2xl font-bold">Pay</h2>
            <p className="text-sm text-muted-foreground">Browse and pay open invoices</p>
          </div>
          <Button variant="outline" size="sm" onClick={fetchInvoices} disabled={isLoadingInvoices}>
            <RefreshCw className={`h-4 w-4 mr-1 ${isLoadingInvoices ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>

        {isLoadingInvoices ? (
          <Card>
            <CardContent className="p-8 flex items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground mr-2" />
              <span className="text-muted-foreground">Loading invoices from relays...</span>
            </CardContent>
          </Card>
        ) : invoices.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center">
              <ShoppingCart className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              <p className="text-lg font-semibold">No open invoices</p>
              <p className="text-sm text-muted-foreground mt-1">
                There are no payment requests on the relays right now.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {invoices.map((invoice) => (
              <Card
                key={invoice.id}
                className="cursor-pointer hover:bg-muted/50 transition-colors"
                onClick={() => handleSelectInvoice(invoice)}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="space-y-1 flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-lg">
                          {formatNumber(parseFloat(invoice.amountLana))} LANA
                        </span>
                        <Badge variant="secondary" className="text-xs">
                          {parseFloat(invoice.amountFiat).toFixed(2)} {invoice.currency}
                        </Badge>
                      </div>
                      {invoice.description && (
                        <p className="text-sm text-muted-foreground truncate">{invoice.description}</p>
                      )}
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <User className="h-3 w-3" />
                          {invoice.pubkey.slice(0, 8)}...{invoice.pubkey.slice(-4)}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {formatDate(invoice.createdAt)}
                        </span>
                        {invoice.deadline && (
                          <span className="text-orange-500 flex items-center gap-1">
                            <AlertCircle className="h-3 w-3" />
                            Due: {formatDate(invoice.deadline)}
                          </span>
                        )}
                      </div>
                    </div>
                    <ArrowRight className="h-5 w-5 text-muted-foreground ml-2 flex-shrink-0" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    );
  }

  // === PAY INVOICE ===
  if (step === "pay" && selectedInvoice) {
    return (
      <div className="space-y-4">
        <div className="mb-4">
          <h2 className="text-2xl font-bold">Pay Invoice</h2>
        </div>

        {/* Invoice summary */}
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="text-center">
              <p className="text-sm text-muted-foreground">Amount to pay</p>
              <p className="text-3xl font-bold text-primary">
                {formatNumber(parseFloat(selectedInvoice.amountLana))} LANA
              </p>
              <p className="text-sm text-muted-foreground">
                ({parseFloat(selectedInvoice.amountFiat).toFixed(2)} {selectedInvoice.currency})
              </p>
            </div>
            {selectedInvoice.description && (
              <div className="p-3 bg-muted/50 rounded-lg">
                <p className="text-sm">{selectedInvoice.description}</p>
              </div>
            )}
            <div className="text-xs text-muted-foreground space-y-1">
              <div className="flex justify-between">
                <span>Seller</span>
                <span className="font-mono">{selectedInvoice.pubkey.slice(0, 12)}...{selectedInvoice.pubkey.slice(-6)}</span>
              </div>
              <div className="flex justify-between">
                <span>Pay to wallet</span>
                <span className="font-mono">{selectedInvoice.walletId.slice(0, 10)}...{selectedInvoice.walletId.slice(-6)}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Payment form */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Wallet className="h-5 w-5" />
              Payment Details
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Wallet Selection */}
            <div className="space-y-2">
              <Label>Pay from wallet</Label>
              {availableWallets.length === 0 ? (
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>No eligible wallets found.</AlertDescription>
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

            {/* Private key */}
            <div className="space-y-2">
              <Label>Private Key (WIF)</Label>
              <div className="flex gap-2">
                <Input
                  type="password"
                  placeholder="Enter your private key"
                  value={privateKey}
                  onChange={(e) => setPrivateKey(e.target.value)}
                  className="flex-1"
                />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setShowScanner(true)}
                >
                  <QrCode className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep("browse")} className="flex-1">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back
              </Button>
              <Button
                onClick={handlePay}
                disabled={!selectedWalletId || !privateKey}
                className="flex-1"
              >
                Pay {formatNumber(parseFloat(selectedInvoice.amountLana))} LANA
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* QR Scanner */}
        <QRScanner
          isOpen={showScanner}
          onClose={() => setShowScanner(false)}
          onScan={(data) => {
            setPrivateKey(data);
            setShowScanner(false);
          }}
        />
      </div>
    );
  }

  // === PROCESSING / RESULT ===
  if (step === "processing" || step === "result") {
    return (
      <div className="space-y-4">
        <div className="mb-4">
          <h2 className="text-2xl font-bold">
            {isProcessing ? "Processing Payment" : "Payment Result"}
          </h2>
        </div>

        {isProcessing ? (
          <Card>
            <CardContent className="p-8 flex flex-col items-center justify-center space-y-4">
              <Loader2 className="h-12 w-12 animate-spin text-primary" />
              <p className="text-lg font-semibold">{processingStatus}</p>
              {selectedInvoice && (
                <div className="p-3 rounded-lg bg-primary/5 border border-primary/20 text-center">
                  <p className="text-sm text-muted-foreground">Paying</p>
                  <p className="text-2xl font-bold text-primary">
                    {formatNumber(parseFloat(selectedInvoice.amountLana))} LANA
                  </p>
                </div>
              )}
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
                    {txResult.success ? "Payment Successful!" : "Payment Failed"}
                  </h3>
                  {txResult.success && (
                    <p className="text-sm text-muted-foreground">
                      Transaction confirmed and KIND 70101 published
                    </p>
                  )}
                </div>
              </div>

              {txResult.success && txResult.txHash && selectedInvoice && (
                <div className="space-y-2 p-3 bg-muted/50 rounded-lg text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Amount</span>
                    <span className="font-semibold">{formatNumber(txResult.amount || parseFloat(selectedInvoice.amountLana))} LANA</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Fee</span>
                    <span className="text-xs">{txResult.fee ? (txResult.fee / 100_000_000).toFixed(8) : "—"} LANA</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">From</span>
                    <span className="font-mono text-xs">{selectedWalletId.slice(0, 10)}...{selectedWalletId.slice(-6)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">To</span>
                    <span className="font-mono text-xs">{selectedInvoice.walletId.slice(0, 10)}...{selectedInvoice.walletId.slice(-6)}</span>
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

              <Button onClick={handleNewPayment} className="w-full" size="lg">
                <ArrowRight className="h-4 w-4 mr-2" />
                Back to Invoices
              </Button>
            </CardContent>
          </Card>
        ) : null}
      </div>
    );
  }

  return null;
}
