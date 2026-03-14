import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  CreditCard,
  Loader2,
  CheckCircle,
  XCircle,
  ArrowLeft,
  Send,
  Camera,
  Wallet,
  FileText,
  Search,
  AlertCircle,
} from "lucide-react";
import { QRScanner } from "@/components/QRScanner";
import { useAuth } from "@/contexts/AuthContext";
import { useSystemParameters } from "@/contexts/SystemParametersContext";
import { useNostrWallets } from "@/hooks/useNostrWallets";
import { useNostrProfileCache } from "@/hooks/useNostrProfileCache";
import { convertWifToIds } from "@/lib/crypto";
import { fiatToLana, formatCurrency, formatLana } from "@/lib/currencyConversion";
import { signNostrEvent } from "@/lib/nostrSigning";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type Step = "amount" | "scanning" | "processing" | "result" | "invoice";
type Currency = "EUR" | "USD" | "GBP" | "LANA";

const CURRENCIES: Currency[] = ["EUR", "USD", "GBP", "LANA"];

// Generate a UUID for invoice d-tag
function generateUUID(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export default function ShopSell() {
  const { session } = useAuth();
  const { parameters } = useSystemParameters();
  const { wallets, isLoading: walletsLoading } = useNostrWallets();

  // Step management
  const [step, setStep] = useState<Step>("amount");

  // Amount step
  const [selectedCurrency, setSelectedCurrency] = useState<Currency>("EUR");
  const [inputAmount, setInputAmount] = useState("");
  const [selectedWalletId, setSelectedWalletId] = useState("");

  // Scanning step
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [scannedKey, setScannedKey] = useState("");
  const [buyerWallet, setBuyerWallet] = useState("");
  const [scanError, setScanError] = useState<string | null>(null);

  // Processing / result
  const [isProcessing, setIsProcessing] = useState(false);
  const [txResult, setTxResult] = useState<{
    success: boolean;
    txHash?: string;
    error?: string;
    fee?: number;
  } | null>(null);

  // Invoice step
  const [invoiceDescription, setInvoiceDescription] = useState("");
  const [invoiceDeadline, setInvoiceDeadline] = useState("");
  const [buyerSearch, setBuyerSearch] = useState("");
  const [searchResults, setSearchResults] = useState<
    Array<{ pubkey: string; display_name?: string; picture?: string }>
  >([]);
  const [selectedBuyerPubkey, setSelectedBuyerPubkey] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [isPublishingInvoice, setIsPublishingInvoice] = useState(false);

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

  // Calculate LANA equivalent
  const calculatedLana = useMemo(() => {
    const amount = parseFloat(inputAmount);
    if (isNaN(amount) || amount <= 0) return 0;
    if (selectedCurrency === "LANA") return amount;
    return fiatToLana(amount, selectedCurrency);
  }, [inputAmount, selectedCurrency]);

  // Buyer profile for selected buyer
  const { profile: selectedBuyerProfile } = useNostrProfileCache(selectedBuyerPubkey || "");

  // ==========================================
  // CHARGE CUSTOMER (QR Scan) Flow
  // ==========================================

  const handleChargeCustomer = () => {
    if (!inputAmount || calculatedLana <= 0) {
      toast.error("Please enter a valid amount");
      return;
    }
    if (!selectedWalletId) {
      toast.error("Please select a wallet to receive payment");
      return;
    }
    setStep("scanning");
    setScanError(null);
    setScannedKey("");
    setBuyerWallet("");
    // Open scanner immediately
    setTimeout(() => setIsScannerOpen(true), 100);
  };

  const handleQRScan = async (data: string) => {
    const trimmed = data.trim();
    setIsScannerOpen(false);
    setScannedKey(trimmed);

    try {
      // Derive wallet from WIF key
      const ids = await convertWifToIds(trimmed);
      const buyerAddr = ids.walletIdCompressed || ids.walletIdUncompressed;

      if (!buyerAddr) {
        setScanError("Could not derive wallet address from scanned key");
        return;
      }

      // Check if buyer wallet is the same as seller wallet
      if (buyerAddr === selectedWalletId) {
        setScanError("Buyer wallet cannot be the same as seller wallet");
        return;
      }

      setBuyerWallet(buyerAddr);

      // Check wallet registration
      const { data: regData, error: regError } = await supabase.functions.invoke(
        "check-wallet-registration",
        { body: { walletId: buyerAddr } }
      );

      if (regError) {
        console.warn("Wallet registration check failed:", regError);
        // Continue anyway — don't block the sale
      } else if (regData && !regData.registered) {
        setScanError(
          `Wallet ${buyerAddr.slice(0, 8)}... is not registered. Transaction may fail.`
        );
        // Still allow proceeding
      }

      // Auto-proceed to processing
      await processTransaction(buyerAddr, trimmed);
    } catch (error) {
      console.error("QR scan processing error:", error);
      setScanError(
        error instanceof Error
          ? error.message
          : "Invalid private key scanned"
      );
    }
  };

  const processTransaction = async (senderAddress: string, privateKey: string) => {
    setStep("processing");
    setIsProcessing(true);
    setTxResult(null);

    try {
      const electrumServers = (parameters?.electrumServers || []).map((s) => ({
        host: s.host,
        port: parseInt(s.port, 10) || 5097,
      }));

      if (electrumServers.length === 0) {
        electrumServers.push(
          { host: "electrum1.lanacoin.com", port: 5097 },
          { host: "electrum2.lanacoin.com", port: 5097 }
        );
      }

      const { data, error } = await supabase.functions.invoke(
        "send-lana-transaction",
        {
          body: {
            senderAddress,
            recipientAddress: selectedWalletId,
            amount: calculatedLana,
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

      setTxResult({
        success: true,
        txHash: data.txid || data.txHash,
        fee: data.fee,
      });
      toast.success("Payment received successfully!");
    } catch (error) {
      console.error("Transaction error:", error);
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

  // ==========================================
  // SEND INVOICE Flow
  // ==========================================

  const handleSendInvoice = () => {
    if (!inputAmount || calculatedLana <= 0) {
      toast.error("Please enter a valid amount");
      return;
    }
    if (!selectedWalletId) {
      toast.error("Please select a wallet to receive payment");
      return;
    }
    setStep("invoice");
    setInvoiceDescription("");
    setInvoiceDeadline("");
    setSelectedBuyerPubkey(null);
    setBuyerSearch("");
    setSearchResults([]);
  };

  // Search for Lana users (profiles)
  const handleSearchBuyer = async () => {
    if (!buyerSearch.trim()) return;
    setIsSearching(true);

    try {
      // Query KIND 0 profiles via nostr
      const { data, error } = await supabase.functions.invoke(
        "query-nostr-events",
        {
          body: {
            filter: { kinds: [0], limit: 200 },
            timeout: 10000,
          },
        }
      );

      if (error) {
        throw error;
      }

      const events = data?.events || [];
      const query = buyerSearch.toLowerCase();

      const matches = events
        .map((event: any) => {
          try {
            const content = JSON.parse(event.content);
            return {
              pubkey: event.pubkey,
              display_name:
                content.display_name || content.name || content.full_name,
              picture: content.picture,
              about: content.about || "",
            };
          } catch {
            return null;
          }
        })
        .filter(
          (p: any) =>
            p &&
            p.pubkey !== session?.nostrHexId &&
            ((p.display_name &&
              p.display_name.toLowerCase().includes(query)) ||
              p.pubkey.startsWith(query))
        )
        .slice(0, 10);

      setSearchResults(matches);
    } catch (error) {
      console.error("Search error:", error);
      toast.error("Failed to search profiles");
    } finally {
      setIsSearching(false);
    }
  };

  const handlePublishInvoice = async () => {
    if (!session?.nostrPrivateKey || !session?.nostrHexId) {
      toast.error("Nostr authentication required");
      return;
    }

    setIsPublishingInvoice(true);

    try {
      const invoiceId = generateUUID();
      const tags: string[][] = [
        ["d", invoiceId],
        ["amount_fiat", parseFloat(inputAmount).toFixed(2)],
        ["currency", selectedCurrency],
        ["amount_lana", calculatedLana.toFixed(2)],
        ["wallet_id", selectedWalletId],
        ["status", "open"],
        ["service", "lanashop"],
      ];

      if (invoiceDescription.trim()) {
        tags.push(["description", invoiceDescription.trim()]);
      }

      if (invoiceDeadline) {
        const deadlineUnix = Math.floor(
          new Date(invoiceDeadline).getTime() / 1000
        );
        tags.push(["deadline", String(deadlineUnix)]);
      }

      if (selectedBuyerPubkey) {
        tags.push(["p", selectedBuyerPubkey]);
      }

      const signedEvent = signNostrEvent(
        session.nostrPrivateKey,
        70100,
        invoiceDescription.trim() || "",
        tags
      );

      // Publish via publish-dm-event endpoint
      const { error } = await supabase.functions.invoke("publish-dm-event", {
        body: { event: signedEvent },
      });

      if (error) {
        console.error("Failed to publish invoice:", error);
      }

      // Queue as fallback
      supabase.functions
        .invoke("queue-relay-event", {
          body: { signedEvent, userPubkey: session.nostrHexId },
        })
        .catch(() => {}); // silent fallback

      toast.success("Invoice published successfully!");

      // Show result
      setTxResult({
        success: true,
        txHash: invoiceId,
      });
      setStep("result");
    } catch (error) {
      console.error("Invoice publish error:", error);
      toast.error("Failed to publish invoice");
    } finally {
      setIsPublishingInvoice(false);
    }
  };

  // Reset to start
  const handleReset = () => {
    setStep("amount");
    setInputAmount("");
    setScannedKey("");
    setBuyerWallet("");
    setScanError(null);
    setTxResult(null);
    setInvoiceDescription("");
    setInvoiceDeadline("");
    setSelectedBuyerPubkey(null);
    setBuyerSearch("");
    setSearchResults([]);
  };

  // ==========================================
  // RENDER
  // ==========================================

  return (
    <div className="px-4 space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <CreditCard className="h-6 w-6" />
          Sell
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Charge a customer or send an invoice
        </p>
      </div>

      {/* ========== AMOUNT STEP ========== */}
      {step === "amount" && (
        <>
          {/* Amount Input */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Payment Amount</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Currency Selector */}
              <div className="space-y-2">
                <Label>Currency</Label>
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

              {/* Amount */}
              <div className="space-y-2">
                <Label>Amount</Label>
                <Input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={inputAmount}
                  onChange={(e) => setInputAmount(e.target.value)}
                  placeholder={`Enter amount in ${selectedCurrency}`}
                  className="text-lg"
                />
              </div>

              {/* LANA equivalent */}
              {calculatedLana > 0 && selectedCurrency !== "LANA" && (
                <div className="p-3 bg-muted rounded-lg">
                  <p className="text-sm text-muted-foreground">LANA equivalent</p>
                  <p className="text-2xl font-bold text-green-600">
                    {formatLana(calculatedLana)}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Wallet Selector */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Wallet className="h-5 w-5" />
                Receive To
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

          {/* Action Buttons */}
          <div className="grid grid-cols-2 gap-3">
            <Button
              onClick={handleChargeCustomer}
              disabled={!inputAmount || calculatedLana <= 0 || !selectedWalletId}
              className="h-14 bg-green-600 hover:bg-green-700 text-white"
            >
              <Camera className="h-5 w-5 mr-2" />
              Charge Customer
            </Button>
            <Button
              onClick={handleSendInvoice}
              disabled={!inputAmount || calculatedLana <= 0 || !selectedWalletId}
              variant="outline"
              className="h-14"
            >
              <FileText className="h-5 w-5 mr-2" />
              Send Invoice
            </Button>
          </div>
        </>
      )}

      {/* ========== SCANNING STEP ========== */}
      {step === "scanning" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Scan Customer's QR Code</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="p-4 bg-muted rounded-lg text-center">
              <p className="text-sm text-muted-foreground mb-2">
                Amount to charge
              </p>
              <p className="text-2xl font-bold text-green-600">
                {formatLana(calculatedLana)}
              </p>
              {selectedCurrency !== "LANA" && (
                <p className="text-sm text-muted-foreground">
                  ({formatCurrency(parseFloat(inputAmount), selectedCurrency)})
                </p>
              )}
            </div>

            {scanError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{scanError}</AlertDescription>
              </Alert>
            )}

            {buyerWallet && (
              <div className="p-3 bg-green-50 dark:bg-green-950/30 rounded-lg">
                <p className="text-sm text-muted-foreground">Buyer wallet</p>
                <p className="font-mono text-sm break-all">{buyerWallet}</p>
              </div>
            )}

            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setStep("amount");
                  setScanError(null);
                }}
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back
              </Button>
              <Button
                onClick={() => setIsScannerOpen(true)}
                className="flex-1 bg-green-600 hover:bg-green-700 text-white"
              >
                <Camera className="h-4 w-4 mr-2" />
                {scannedKey ? "Scan Again" : "Open Scanner"}
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
              <p className="text-lg font-medium">Processing payment...</p>
              <p className="text-sm text-muted-foreground">
                Sending {formatLana(calculatedLana)} to your wallet
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
                    {txResult.txHash?.includes("-")
                      ? "Invoice Sent!"
                      : "Payment Received!"}
                  </h2>
                  <div className="w-full space-y-3">
                    <div className="p-3 bg-muted rounded-lg">
                      <p className="text-sm text-muted-foreground">Amount</p>
                      <p className="font-bold text-lg">
                        {formatLana(calculatedLana)}
                      </p>
                      {selectedCurrency !== "LANA" && (
                        <p className="text-sm text-muted-foreground">
                          {formatCurrency(
                            parseFloat(inputAmount),
                            selectedCurrency
                          )}
                        </p>
                      )}
                    </div>
                    {txResult.txHash && (
                      <div className="p-3 bg-muted rounded-lg">
                        <p className="text-sm text-muted-foreground">
                          {txResult.txHash.includes("-")
                            ? "Invoice ID"
                            : "Transaction Hash"}
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
                New Sale
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ========== INVOICE STEP ========== */}
      {step === "invoice" && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Create Invoice
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Invoice summary */}
              <div className="p-3 bg-muted rounded-lg">
                <p className="text-sm text-muted-foreground">Invoice amount</p>
                <p className="text-xl font-bold text-green-600">
                  {formatLana(calculatedLana)}
                </p>
                {selectedCurrency !== "LANA" && (
                  <p className="text-sm text-muted-foreground">
                    {formatCurrency(parseFloat(inputAmount), selectedCurrency)}
                  </p>
                )}
              </div>

              {/* Description */}
              <div className="space-y-2">
                <Label>Description (optional)</Label>
                <Textarea
                  value={invoiceDescription}
                  onChange={(e) => setInvoiceDescription(e.target.value)}
                  placeholder="What is this payment for?"
                  rows={3}
                />
              </div>

              {/* Deadline */}
              <div className="space-y-2">
                <Label>Payment Deadline (optional)</Label>
                <Input
                  type="datetime-local"
                  value={invoiceDeadline}
                  onChange={(e) => setInvoiceDeadline(e.target.value)}
                />
              </div>

              {/* Buyer Search */}
              <div className="space-y-2">
                <Label>Send To (optional — leave empty for public invoice)</Label>
                <div className="flex gap-2">
                  <Input
                    value={buyerSearch}
                    onChange={(e) => setBuyerSearch(e.target.value)}
                    placeholder="Search by name or pubkey..."
                    onKeyDown={(e) => e.key === "Enter" && handleSearchBuyer()}
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={handleSearchBuyer}
                    disabled={isSearching}
                  >
                    {isSearching ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Search className="h-4 w-4" />
                    )}
                  </Button>
                </div>

                {/* Search results */}
                {searchResults.length > 0 && (
                  <div className="border rounded-lg max-h-40 overflow-y-auto">
                    {searchResults.map((profile) => (
                      <button
                        key={profile.pubkey}
                        onClick={() => {
                          setSelectedBuyerPubkey(profile.pubkey);
                          setSearchResults([]);
                          setBuyerSearch(
                            profile.display_name || profile.pubkey.slice(0, 12)
                          );
                        }}
                        className={`w-full text-left px-3 py-2 hover:bg-muted flex items-center gap-2 border-b last:border-b-0 ${
                          selectedBuyerPubkey === profile.pubkey
                            ? "bg-green-50 dark:bg-green-950/30"
                            : ""
                        }`}
                      >
                        {profile.picture ? (
                          <img
                            src={profile.picture}
                            alt=""
                            className="w-8 h-8 rounded-full object-cover"
                          />
                        ) : (
                          <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-xs font-bold">
                            {(
                              profile.display_name ||
                              profile.pubkey.slice(0, 2)
                            )
                              .charAt(0)
                              .toUpperCase()}
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">
                            {profile.display_name || "Unknown"}
                          </p>
                          <p className="text-xs text-muted-foreground font-mono truncate">
                            {profile.pubkey.slice(0, 16)}...
                          </p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                {/* Selected buyer */}
                {selectedBuyerPubkey && (
                  <div className="flex items-center gap-2 p-2 bg-green-50 dark:bg-green-950/30 rounded-lg">
                    <CheckCircle className="h-4 w-4 text-green-600 shrink-0" />
                    <span className="text-sm font-medium truncate">
                      {selectedBuyerProfile?.display_name ||
                        selectedBuyerProfile?.full_name ||
                        selectedBuyerPubkey.slice(0, 16) + "..."}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="ml-auto h-6 px-2 text-xs"
                      onClick={() => {
                        setSelectedBuyerPubkey(null);
                        setBuyerSearch("");
                      }}
                    >
                      Clear
                    </Button>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Invoice Actions */}
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
              onClick={handlePublishInvoice}
              disabled={isPublishingInvoice}
              className="flex-1 bg-green-600 hover:bg-green-700 text-white"
            >
              {isPublishingInvoice ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Send className="h-4 w-4 mr-2" />
              )}
              Publish Invoice
            </Button>
          </div>
        </>
      )}

      {/* QR Scanner */}
      <QRScanner
        isOpen={isScannerOpen}
        onClose={() => setIsScannerOpen(false)}
        onScan={handleQRScan}
      />
    </div>
  );
}
