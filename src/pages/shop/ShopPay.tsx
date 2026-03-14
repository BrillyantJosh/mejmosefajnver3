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
  ShoppingCart,
  Loader2,
  CheckCircle,
  XCircle,
  ArrowLeft,
  Camera,
  Wallet,
  Clock,
  AlertCircle,
  User,
  RefreshCw,
} from "lucide-react";
import { QRScanner } from "@/components/QRScanner";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { useAuth } from "@/contexts/AuthContext";
import { useSystemParameters } from "@/contexts/SystemParametersContext";
import { useNostrWallets } from "@/hooks/useNostrWallets";
import { useNostrProfileCache } from "@/hooks/useNostrProfileCache";
import { convertWifToIds } from "@/lib/crypto";
import { formatCurrency, formatLana } from "@/lib/currencyConversion";
import { signNostrEvent } from "@/lib/nostrSigning";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type Step = "browse" | "pay" | "processing" | "result";

interface Invoice {
  id: string;
  pubkey: string;
  createdAt: number;
  invoiceId: string;
  amountFiat: number;
  currency: string;
  amountLana: number;
  walletId: string;
  status: string;
  description: string;
  deadline: number | null;
  targetBuyer: string | null;
}

// Helper to parse an invoice from a Nostr event
function parseInvoice(event: any): Invoice | null {
  try {
    const tags = event.tags || [];
    const getTag = (name: string): string | undefined =>
      tags.find((t: string[]) => t[0] === name)?.[1];

    const invoiceId = getTag("d");
    const amountFiat = parseFloat(getTag("amount_fiat") || "0");
    const currency = getTag("currency") || "EUR";
    const amountLana = parseFloat(getTag("amount_lana") || "0");
    const walletId = getTag("wallet_id");
    const status = getTag("status") || "open";
    const description = getTag("description") || event.content || "";
    const deadlineStr = getTag("deadline");
    const deadline = deadlineStr ? parseInt(deadlineStr, 10) : null;
    const targetBuyer =
      tags.find((t: string[]) => t[0] === "p")?.[1] || null;

    if (!invoiceId || !walletId || amountLana <= 0) return null;

    return {
      id: event.id,
      pubkey: event.pubkey,
      createdAt: event.created_at,
      invoiceId,
      amountFiat,
      currency,
      amountLana,
      walletId,
      status,
      description,
      deadline,
      targetBuyer,
    };
  } catch {
    return null;
  }
}

// Sub-component: Invoice card with seller profile
function InvoiceCard({
  invoice,
  onClick,
}: {
  invoice: Invoice;
  onClick: () => void;
}) {
  const { profile } = useNostrProfileCache(invoice.pubkey);
  const now = Math.floor(Date.now() / 1000);
  const isExpired = invoice.deadline && invoice.deadline < now;
  const timeLeft = invoice.deadline
    ? invoice.deadline - now
    : null;

  const formatTimeLeft = (seconds: number) => {
    if (seconds <= 0) return "Expired";
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    if (hours > 24) return `${Math.floor(hours / 24)}d ${hours % 24}h`;
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
  };

  if (isExpired) return null;

  return (
    <Card
      className="cursor-pointer hover:shadow-md transition-shadow"
      onClick={onClick}
    >
      <CardContent className="p-3 sm:p-4 space-y-3">
        {/* Seller info */}
        <div className="flex items-center gap-3">
          <UserAvatar
            pubkey={invoice.pubkey}
            picture={profile?.picture}
            name={profile?.display_name || profile?.full_name}
            className="h-8 w-8 sm:h-10 sm:w-10"
          />
          <div className="flex-1 min-w-0">
            <p className="font-medium truncate">
              {profile?.display_name ||
                profile?.full_name ||
                `${invoice.pubkey.slice(0, 8)}...`}
            </p>
            <p className="text-xs text-muted-foreground">Seller</p>
          </div>
          {timeLeft !== null && (
            <Badge
              variant="outline"
              className="text-xs gap-1 shrink-0"
            >
              <Clock className="h-3 w-3" />
              {formatTimeLeft(timeLeft)}
            </Badge>
          )}
        </div>

        {/* Amount */}
        <div className="flex items-baseline justify-between">
          <div>
            <span className="text-xl sm:text-2xl font-bold">
              {invoice.amountLana.toFixed(2)}
            </span>
            <span className="text-xs sm:text-sm text-muted-foreground ml-1">LANA</span>
          </div>
          {invoice.amountFiat > 0 && invoice.currency !== "LANA" && (
            <span className="text-sm text-muted-foreground">
              {formatCurrency(invoice.amountFiat, invoice.currency)}
            </span>
          )}
        </div>

        {/* Description */}
        {invoice.description && (
          <p className="text-sm text-muted-foreground line-clamp-2">
            {invoice.description}
          </p>
        )}

        {/* Wallet */}
        <div className="text-[0.65rem] sm:text-xs text-muted-foreground font-mono truncate">
          Pay to: {invoice.walletId.slice(0, 12)}...{invoice.walletId.slice(-4)}
        </div>
      </CardContent>
    </Card>
  );
}

export default function ShopPay() {
  const { session } = useAuth();
  const { parameters } = useSystemParameters();
  const { wallets, isLoading: walletsLoading } = useNostrWallets();

  // Step management
  const [step, setStep] = useState<Step>("browse");

  // Browse step
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [isLoadingInvoices, setIsLoadingInvoices] = useState(true);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);

  // Pay step
  const [selectedWalletId, setSelectedWalletId] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [isPrivateKeyValid, setIsPrivateKeyValid] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [isScannerOpen, setIsScannerOpen] = useState(false);

  // Balance check
  const [walletBalance, setWalletBalance] = useState<number | null>(null);
  const [isLoadingBalance, setIsLoadingBalance] = useState(false);
  const [balanceError, setBalanceError] = useState<string | null>(null);

  // Processing / result
  const [isProcessing, setIsProcessing] = useState(false);
  const [txResult, setTxResult] = useState<{
    success: boolean;
    txHash?: string;
    error?: string;
    fee?: number;
  } | null>(null);

  // Filter wallets
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

  // ==========================================
  // Fetch wallet balance when wallet is selected in pay step
  // ==========================================

  useEffect(() => {
    if (!selectedWalletId || !selectedInvoice || step !== "pay") {
      setWalletBalance(null);
      setBalanceError(null);
      return;
    }

    const fetchBalance = async () => {
      setIsLoadingBalance(true);
      setBalanceError(null);
      try {
        const electrumServers = (parameters?.electrumServers || []).map(
          (s) => ({
            host: s.host,
            port: parseInt(s.port, 10) || 5097,
          })
        );

        const { data, error } = await supabase.functions.invoke(
          "get-wallet-balances",
          {
            body: {
              wallet_addresses: [selectedWalletId],
              electrum_servers:
                electrumServers.length > 0 ? electrumServers : undefined,
            },
          }
        );

        if (error) {
          setBalanceError("Could not check balance");
          return;
        }

        const walletData = data?.wallets?.[0];
        if (walletData && !walletData.error) {
          setWalletBalance(walletData.balance);
        } else {
          setBalanceError("Could not check balance");
        }
      } catch {
        setBalanceError("Could not check balance");
      } finally {
        setIsLoadingBalance(false);
      }
    };

    fetchBalance();
  }, [selectedWalletId, selectedInvoice, step, parameters?.electrumServers]);

  // Derived: is balance sufficient?
  const hasSufficientBalance =
    walletBalance !== null &&
    selectedInvoice !== null &&
    walletBalance >= selectedInvoice.amountLana;

  // ==========================================
  // Fetch invoices
  // ==========================================

  const fetchInvoices = async () => {
    setIsLoadingInvoices(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        "query-nostr-events",
        {
          body: {
            filter: { kinds: [70100], limit: 100 },
            timeout: 15000,
          },
        }
      );

      if (error) {
        console.error("Failed to fetch invoices:", error);
        toast.error("Failed to load invoices");
        return;
      }

      const events = data?.events || [];
      const now = Math.floor(Date.now() / 1000);

      const parsed = events
        .map(parseInvoice)
        .filter((inv: Invoice | null): inv is Invoice => {
          if (!inv) return false;
          // Only show open invoices
          if (inv.status !== "open") return false;
          // Exclude own invoices
          if (inv.pubkey === session?.nostrHexId) return false;
          // Exclude expired
          if (inv.deadline && inv.deadline < now) return false;
          // If targeted to specific buyer, only show if it's for us
          if (
            inv.targetBuyer &&
            inv.targetBuyer !== session?.nostrHexId
          )
            return false;
          return true;
        })
        .sort((a: Invoice, b: Invoice) => b.createdAt - a.createdAt);

      setInvoices(parsed);
    } catch (error) {
      console.error("Error fetching invoices:", error);
    } finally {
      setIsLoadingInvoices(false);
    }
  };

  useEffect(() => {
    if (session?.nostrHexId) {
      fetchInvoices();
    }
  }, [session?.nostrHexId]);

  // ==========================================
  // Validate private key
  // ==========================================

  useEffect(() => {
    if (!privateKey || !selectedWalletId) {
      setIsPrivateKeyValid(false);
      setValidationError(null);
      return;
    }

    const validate = async () => {
      try {
        setIsValidating(true);
        const ids = await convertWifToIds(privateKey);

        const matchesCompressed =
          ids.walletIdCompressed === selectedWalletId;
        const matchesUncompressed =
          ids.walletIdUncompressed === selectedWalletId;

        if (matchesCompressed || matchesUncompressed) {
          setIsPrivateKeyValid(true);
          setValidationError(null);
        } else {
          setIsPrivateKeyValid(false);
          setValidationError(
            "Private key does not match the selected wallet"
          );
        }
      } catch {
        setIsPrivateKeyValid(false);
        setValidationError("Invalid private key format");
      } finally {
        setIsValidating(false);
      }
    };

    const debounce = setTimeout(validate, 500);
    return () => clearTimeout(debounce);
  }, [privateKey, selectedWalletId]);

  // ==========================================
  // Handle Pay
  // ==========================================

  const handleSelectInvoice = (invoice: Invoice) => {
    setSelectedInvoice(invoice);
    setPrivateKey("");
    setIsPrivateKeyValid(false);
    setValidationError(null);
    setStep("pay");
  };

  const handleScanComplete = (data: string) => {
    setPrivateKey(data.trim());
    setIsScannerOpen(false);
  };

  const handlePay = async () => {
    if (
      !selectedInvoice ||
      !privateKey ||
      !isPrivateKeyValid ||
      !selectedWalletId
    ) {
      return;
    }

    if (!session?.nostrPrivateKey || !session?.nostrHexId) {
      toast.error("Nostr authentication required");
      return;
    }

    setStep("processing");
    setIsProcessing(true);
    setTxResult(null);

    try {
      const electrumServers = (parameters?.electrumServers || []).map(
        (s) => ({
          host: s.host,
          port: parseInt(s.port, 10) || 5097,
        })
      );

      if (electrumServers.length === 0) {
        electrumServers.push(
          { host: "electrum1.lanacoin.com", port: 5097 },
          { host: "electrum2.lanacoin.com", port: 5097 }
        );
      }

      // Send transaction
      const { data, error } = await supabase.functions.invoke(
        "send-lana-transaction",
        {
          body: {
            senderAddress: selectedWalletId,
            recipientAddress: selectedInvoice.walletId,
            amount: selectedInvoice.amountLana,
            privateKey,
            emptyWallet: false,
            electrumServers,
          },
        }
      );

      if (error) {
        throw new Error(error.message || "Transaction failed");
      }

      if (!data?.success) {
        throw new Error(data?.error || "Transaction failed");
      }

      const txHash = data.txid || data.txHash;

      // Publish KIND 70101 confirmation
      try {
        const confirmTags: string[][] = [
          ["invoice_ref", selectedInvoice.id],
          ["tx_id", txHash],
          ["sender_wallet", selectedWalletId],
          ["receiver_wallet", selectedInvoice.walletId],
          ["amount_fiat", selectedInvoice.amountFiat.toFixed(2)],
          ["currency", selectedInvoice.currency],
          ["amount_lana", selectedInvoice.amountLana.toFixed(2)],
          ["status", "confirmed"],
          ["service", "lanashop"],
          ["p", selectedInvoice.pubkey],
        ];

        const signedEvent = signNostrEvent(
          session.nostrPrivateKey,
          70101,
          `Payment confirmed for invoice ${selectedInvoice.invoiceId}`,
          confirmTags
        );

        // Publish via publish-dm-event
        const { error: pubError } = await supabase.functions.invoke(
          "publish-dm-event",
          { body: { event: signedEvent } }
        );

        if (pubError) {
          console.error("Failed to publish confirmation:", pubError);
        }

        // Queue as fallback
        supabase.functions
          .invoke("queue-relay-event", {
            body: { signedEvent, userPubkey: session.nostrHexId },
          })
          .catch(() => {});

        console.log(
          "✅ KIND 70101 confirmation published for invoice",
          selectedInvoice.invoiceId
        );
      } catch (pubError) {
        console.error("Error publishing confirmation event:", pubError);
        // Don't fail the payment — tx already succeeded
      }

      setTxResult({
        success: true,
        txHash,
        fee: data.fee,
      });
      toast.success("Payment sent successfully!");
    } catch (error) {
      console.error("Payment error:", error);
      setTxResult({
        success: false,
        error:
          error instanceof Error ? error.message : "Transaction failed",
      });
      toast.error("Payment failed");
    } finally {
      setIsProcessing(false);
      setStep("result");
    }
  };

  // Reset
  const handleReset = () => {
    setStep("browse");
    setSelectedInvoice(null);
    setPrivateKey("");
    setIsPrivateKeyValid(false);
    setValidationError(null);
    setTxResult(null);
    setWalletBalance(null);
    setBalanceError(null);
    fetchInvoices();
  };

  // ==========================================
  // RENDER
  // ==========================================

  return (
    <div className="px-4 space-y-4 sm:space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
            <ShoppingCart className="h-5 w-5 sm:h-6 sm:w-6" />
            Pay
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1">
            Browse and pay open invoices
          </p>
        </div>
        {step === "browse" && (
          <Button
            variant="outline"
            size="sm"
            onClick={fetchInvoices}
            disabled={isLoadingInvoices}
          >
            <RefreshCw
              className={`h-4 w-4 mr-1 ${
                isLoadingInvoices ? "animate-spin" : ""
              }`}
            />
            Refresh
          </Button>
        )}
      </div>

      {/* ========== BROWSE STEP ========== */}
      {step === "browse" && (
        <>
          {isLoadingInvoices ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              <span className="ml-2 text-muted-foreground">
                Loading invoices...
              </span>
            </div>
          ) : invoices.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <ShoppingCart className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground">
                  No open invoices found
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  Invoices sent to you will appear here
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {invoices.map((invoice) => (
                <InvoiceCard
                  key={invoice.id}
                  invoice={invoice}
                  onClick={() => handleSelectInvoice(invoice)}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* ========== PAY STEP ========== */}
      {step === "pay" && selectedInvoice && (
        <>
          {/* Invoice Details */}
          <InvoiceDetailCard invoice={selectedInvoice} />

          {/* Wallet Selector */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Wallet className="h-5 w-5" />
                Pay From
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {walletsLoading ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading wallets...
                </div>
              ) : availableWallets.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  No wallets available.
                </p>
              ) : (
                <Select
                  value={selectedWalletId}
                  onValueChange={(v) => {
                    setSelectedWalletId(v);
                    setPrivateKey("");
                    setIsPrivateKeyValid(false);
                    setValidationError(null);
                    setWalletBalance(null);
                    setBalanceError(null);
                  }}
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

              {/* Wallet Balance */}
              {selectedWalletId && (
                <div className={`p-3 rounded-lg flex items-center gap-2 ${
                  isLoadingBalance
                    ? "bg-muted"
                    : balanceError
                    ? "bg-muted"
                    : hasSufficientBalance
                    ? "bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800"
                    : "bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800"
                }`}>
                  {isLoadingBalance ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" />
                      <span className="text-sm text-muted-foreground">Checking balance...</span>
                    </>
                  ) : balanceError ? (
                    <>
                      <AlertCircle className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span className="text-sm text-muted-foreground">{balanceError}</span>
                    </>
                  ) : walletBalance !== null ? (
                    <>
                      {hasSufficientBalance ? (
                        <CheckCircle className="h-4 w-4 text-green-600 shrink-0" />
                      ) : (
                        <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-1.5 flex-wrap">
                          <span className="text-sm font-medium">
                            Balance: {formatLana(walletBalance)}
                          </span>
                          {!hasSufficientBalance && (
                            <span className="text-xs text-red-500">
                              (need {formatLana(selectedInvoice!.amountLana)})
                            </span>
                          )}
                        </div>
                        {hasSufficientBalance && (
                          <span className="text-xs text-green-600">Sufficient funds</span>
                        )}
                        {!hasSufficientBalance && walletBalance !== null && (
                          <span className="text-xs text-red-500">Insufficient funds</span>
                        )}
                      </div>
                    </>
                  ) : null}
                </div>
              )}

              {/* Private Key Input */}
              <div className="space-y-2">
                <Label>Private Key (WIF Format)</Label>
                <div className="flex gap-2">
                  <Input
                    type="password"
                    value={privateKey}
                    onChange={(e) => setPrivateKey(e.target.value)}
                    placeholder="Enter your private key..."
                    className={
                      isPrivateKeyValid
                        ? "border-green-500"
                        : validationError
                        ? "border-destructive"
                        : ""
                    }
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
                  <p className="text-sm text-muted-foreground">
                    Validating...
                  </p>
                )}

                {isPrivateKeyValid && (
                  <div className="flex items-center gap-2 text-sm text-green-600">
                    <CheckCircle className="h-4 w-4" />
                    <span>Private key verified</span>
                  </div>
                )}

                {validationError && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>{validationError}</AlertDescription>
                  </Alert>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Pay Actions */}
          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={() => {
                setStep("browse");
                setPrivateKey("");
                setIsPrivateKeyValid(false);
              }}
              className="flex-1"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
            <Button
              onClick={handlePay}
              disabled={!isPrivateKeyValid || isProcessing || (walletBalance !== null && !hasSufficientBalance)}
              className="flex-1 bg-green-600 hover:bg-green-700 text-white"
            >
              Pay {formatLana(selectedInvoice.amountLana)}
            </Button>
          </div>
        </>
      )}

      {/* ========== PROCESSING STEP ========== */}
      {step === "processing" && selectedInvoice && (
        <Card>
          <CardContent className="py-12">
            <div className="flex flex-col items-center justify-center gap-4">
              <Loader2 className="h-12 w-12 animate-spin text-green-600" />
              <p className="text-lg font-medium">Processing payment...</p>
              <p className="text-sm text-muted-foreground">
                Sending {formatLana(selectedInvoice.amountLana)}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ========== RESULT STEP ========== */}
      {step === "result" && txResult && (
        <Card>
          <CardContent className="py-8">
            <div className="flex flex-col items-center gap-4">
              {txResult.success ? (
                <>
                  <CheckCircle className="h-16 w-16 text-green-600" />
                  <h2 className="text-2xl font-bold text-green-600">
                    Payment Sent!
                  </h2>
                  <div className="w-full space-y-3">
                    {selectedInvoice && (
                      <div className="p-3 bg-muted rounded-lg">
                        <p className="text-sm text-muted-foreground">Amount</p>
                        <p className="font-bold text-lg">
                          {formatLana(selectedInvoice.amountLana)}
                        </p>
                        {selectedInvoice.amountFiat > 0 &&
                          selectedInvoice.currency !== "LANA" && (
                            <p className="text-sm text-muted-foreground">
                              {formatCurrency(
                                selectedInvoice.amountFiat,
                                selectedInvoice.currency
                              )}
                            </p>
                          )}
                      </div>
                    )}
                    {txResult.txHash && (
                      <div className="p-3 bg-muted rounded-lg">
                        <p className="text-sm text-muted-foreground">
                          Transaction Hash
                        </p>
                        <p className="font-mono text-xs break-all">
                          {txResult.txHash}
                        </p>
                      </div>
                    )}
                    {txResult.fee !== undefined && (
                      <div className="p-3 bg-muted rounded-lg">
                        <p className="text-sm text-muted-foreground">
                          Network Fee
                        </p>
                        <p className="font-mono text-sm">
                          {(txResult.fee / 100000000).toFixed(8)} LANA
                        </p>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <XCircle className="h-16 w-16 text-destructive" />
                  <h2 className="text-2xl font-bold text-destructive">
                    Payment Failed
                  </h2>
                  {txResult.error && (
                    <Alert variant="destructive">
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription>{txResult.error}</AlertDescription>
                    </Alert>
                  )}
                </>
              )}

              <Button
                onClick={handleReset}
                className="w-full mt-4 bg-green-600 hover:bg-green-700 text-white"
              >
                Browse More Invoices
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* QR Scanner */}
      <QRScanner
        isOpen={isScannerOpen}
        onClose={() => setIsScannerOpen(false)}
        onScan={handleScanComplete}
      />
    </div>
  );
}

// Invoice detail card shown during pay step
function InvoiceDetailCard({ invoice }: { invoice: Invoice }) {
  const { profile } = useNostrProfileCache(invoice.pubkey);
  const now = Math.floor(Date.now() / 1000);
  const timeLeft = invoice.deadline ? invoice.deadline - now : null;

  const formatTimeLeft = (seconds: number) => {
    if (seconds <= 0) return "Expired";
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    if (hours > 24) return `${Math.floor(hours / 24)}d ${hours % 24}h left`;
    if (hours > 0) return `${hours}h ${mins}m left`;
    return `${mins}m left`;
  };

  return (
    <Card className="border-green-200 dark:border-green-800">
      <CardHeader>
        <CardTitle className="text-lg">Invoice Details</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Seller */}
        <div className="flex items-center gap-3">
          <UserAvatar
            pubkey={invoice.pubkey}
            picture={profile?.picture}
            name={profile?.display_name || profile?.full_name}
            className="h-10 w-10"
          />
          <div>
            <p className="text-xs text-muted-foreground">Pay to</p>
            <p className="font-medium">
              {profile?.display_name ||
                profile?.full_name ||
                `${invoice.pubkey.slice(0, 12)}...`}
            </p>
          </div>
        </div>

        {/* Amount */}
        <div className="p-3 bg-muted rounded-lg">
          <p className="text-sm text-muted-foreground">Amount</p>
          <p className="text-2xl font-bold text-green-600">
            {formatLana(invoice.amountLana)}
          </p>
          {invoice.amountFiat > 0 && invoice.currency !== "LANA" && (
            <p className="text-sm text-muted-foreground">
              {formatCurrency(invoice.amountFiat, invoice.currency)}
            </p>
          )}
        </div>

        {/* Description */}
        {invoice.description && (
          <div>
            <p className="text-sm text-muted-foreground">Description</p>
            <p className="text-sm mt-1">{invoice.description}</p>
          </div>
        )}

        {/* Wallet */}
        <div>
          <p className="text-sm text-muted-foreground">Seller Wallet</p>
          <p className="font-mono text-xs break-all mt-1">
            {invoice.walletId}
          </p>
        </div>

        {/* Deadline */}
        {timeLeft !== null && (
          <div className="flex items-center gap-2 text-sm">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <span
              className={
                timeLeft < 3600
                  ? "text-orange-600"
                  : "text-muted-foreground"
              }
            >
              {formatTimeLeft(timeLeft)}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
