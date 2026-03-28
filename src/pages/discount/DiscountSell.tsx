import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Loader2,
  CheckCircle,
  XCircle,
  Wallet,
  AlertCircle,
  Banknote,
  ArrowLeft,
  ShieldCheck,
  QrCode,
  X,
} from "lucide-react";
import { Html5Qrcode } from "html5-qrcode";
import { useAuth } from "@/contexts/AuthContext";
import { useSystemParameters } from "@/contexts/SystemParametersContext";
import { useAdmin } from "@/contexts/AdminContext";
import { useNostrWallets } from "@/hooks/useNostrWallets";
import { useNostrProfile } from "@/hooks/useNostrProfile";
import { supabase } from "@/integrations/supabase/client";
import { convertWifToIds } from "@/lib/crypto";
import { toast } from "sonner";

// Fallback defaults — overridden by admin settings
const DEFAULT_BUYBACK_WALLET = "Lg7iw2aQp8qazNsZVZFhf4rP7bikSrLRxB";
const DEFAULT_API_URL = "https://www.lana.discount";
const DEFAULT_COMMISSION_LANAPAYS = 30;
const DEFAULT_COMMISSION_OTHER = 21;

const CURRENCY_SYMBOLS: Record<string, string> = {
  EUR: "\u20ac",
  USD: "$",
  GBP: "\u00a3",
  CHF: "CHF",
  CZK: "CZK",
  PLN: "PLN",
  HRK: "HRK",
  RSD: "RSD",
  HUF: "HUF",
  BAM: "BAM",
};

const SCHEME_LABELS: Record<string, string> = {
  "EU.IBAN": "SEPA / IBAN",
  "UK.ACCT_SORT": "UK Account",
  "US.ACH": "US ACH",
};

function formatFiat(amount: number, currency: string): string {
  const sym = CURRENCY_SYMBOLS[currency] || "";
  return `${sym}${amount.toFixed(2)}`;
}

export default function DiscountSell() {
  const { session } = useAuth();
  const { parameters } = useSystemParameters();
  const { appSettings } = useAdmin();
  const { wallets, isLoading: walletsLoading } = useNostrWallets();
  const { profile } = useNostrProfile();

  // Admin-configurable settings with defaults
  const BUYBACK_WALLET = appSettings?.discount_buyback_wallet || DEFAULT_BUYBACK_WALLET;
  const DISCOUNT_API_URL = appSettings?.discount_api_url || DEFAULT_API_URL;
  const DISCOUNT_API_KEY = appSettings?.discount_api_key || '';
  const COMMISSION_LANAPAYS = appSettings?.discount_commission_lanapays ?? DEFAULT_COMMISSION_LANAPAYS;
  const COMMISSION_OTHER = appSettings?.discount_commission_other ?? DEFAULT_COMMISSION_OTHER;
  const MIN_SELL: Record<string, number> = {
    EUR: appSettings?.discount_min_sell_eur ?? 2,
    USD: appSettings?.discount_min_sell_usd ?? 2,
    GBP: appSettings?.discount_min_sell_gbp ?? 2,
  };

  // 5-step flow
  const [step, setStep] = useState(1);

  // Step 1: Select Wallet
  const [selectedWallet, setSelectedWallet] = useState("");
  const [balances, setBalances] = useState<Record<string, number>>({});
  const [balancesLoading, setBalancesLoading] = useState(false);

  // Step 2: Select Currency
  const [selectedCurrency, setSelectedCurrency] = useState("");

  // Step 3: Amount & Preview
  const [lanaAmount, setLanaAmount] = useState("");
  const [isEmptyWallet, setIsEmptyWallet] = useState(false);

  // Step 4: Confirm + Private Key
  const [privateKey, setPrivateKey] = useState("");
  const [privateKeyValid, setPrivateKeyValid] = useState<boolean | null>(null);
  const [validatingKey, setValidatingKey] = useState(false);
  const [executing, setExecuting] = useState(false);

  // QR Scanner
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [isCameraReady, setIsCameraReady] = useState(false);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const hasScannedRef = useRef(false);

  // Step 5: Result
  const [txResult, setTxResult] = useState<{
    success: boolean;
    txHash?: string;
    transactionId?: string;
    error?: string;
    lanaAmount?: number;
    netFiat?: number;
    currency?: string;
  } | null>(null);

  // Filter wallets — exclude Lana8Wonder, Knights
  const availableWallets = useMemo(
    () =>
      wallets.filter(
        (w) => w.walletType !== "Lana8Wonder" && w.walletType !== "Knights"
      ),
    [wallets]
  );

  // Fetch balances when wallets load
  useEffect(() => {
    if (availableWallets.length === 0) return;
    const fetchBalances = async () => {
      setBalancesLoading(true);
      try {
        const addresses = availableWallets.map((w) => w.walletId);
        const { data, error } = await supabase.functions.invoke(
          "get-wallet-balances",
          {
            body: {
              wallet_addresses: addresses,
              electrum_servers: parameters?.electrumServers || [],
            },
          }
        );
        if (error) throw error;
        const balMap: Record<string, number> = {};
        (data?.wallets || []).forEach(
          (b: { wallet_id: string; balance: number }) => {
            balMap[b.wallet_id] = b.balance;
          }
        );
        setBalances(balMap);
      } catch (e) {
        console.error("Balance fetch failed:", e);
      } finally {
        setBalancesLoading(false);
      }
    };
    fetchBalances();
  }, [availableWallets, parameters?.electrumServers]);

  // Available currencies from system params
  const activeCurrencies = useMemo(() => {
    if (!parameters?.exchangeRates) return [];
    return Object.keys(parameters.exchangeRates);
  }, [parameters?.exchangeRates]);

  // Pre-select first currency
  useEffect(() => {
    if (!selectedCurrency && activeCurrencies.length > 0) {
      setSelectedCurrency(activeCurrencies[0]);
    }
  }, [activeCurrencies, selectedCurrency]);

  // Validate private key against selected wallet (debounced)
  useEffect(() => {
    if (!privateKey || !selectedWallet) {
      setPrivateKeyValid(null);
      return;
    }
    setValidatingKey(true);
    const timer = setTimeout(async () => {
      try {
        const ids = await convertWifToIds(privateKey);
        const matches = ids.walletId === selectedWallet ||
          ids.walletIdCompressed === selectedWallet ||
          ids.walletIdUncompressed === selectedWallet;
        setPrivateKeyValid(matches);
      } catch {
        setPrivateKeyValid(false);
      }
      setValidatingKey(false);
    }, 500);
    return () => clearTimeout(timer);
  }, [privateKey, selectedWallet]);

  // Exchange rate
  const exchangeRate = useMemo(() => {
    if (!parameters?.exchangeRates || !selectedCurrency) return 0;
    return parameters.exchangeRates[selectedCurrency] || 0;
  }, [parameters?.exchangeRates, selectedCurrency]);

  // Parsed LANA amount
  const parsedLana = useMemo(() => {
    const val = parseFloat(lanaAmount);
    return isNaN(val) || val <= 0 ? 0 : val;
  }, [lanaAmount]);

  // Wallet balance for selected wallet
  const walletBalance = selectedWallet ? balances[selectedWallet] || 0 : 0;

  // Determine commission based on wallet type
  const selectedWalletObj = wallets.find(w => w.walletId === selectedWallet);
  const isLanaPayWallet = selectedWalletObj?.walletType === 'Lana.Discount' || selectedWalletObj?.walletType === 'LanaPays';
  const COMMISSION_PERCENT = isLanaPayWallet ? COMMISSION_LANAPAYS : COMMISSION_OTHER;

  // Minimum sell check
  const minSellFiat = MIN_SELL[selectedCurrency] || 0;

  // FIAT calculations
  const grossFiat = parsedLana * exchangeRate;
  const commissionFiat = grossFiat * (COMMISSION_PERCENT / 100);
  const netFiat = grossFiat - commissionFiat;
  const belowMinimum = minSellFiat > 0 && grossFiat > 0 && grossFiat < minSellFiat;

  // Lanoshis
  const lanaAmountLanoshis = Math.round(parsedLana * 100000000);

  // Payment method lookup
  const getPayoutInfo = () => {
    if (!selectedCurrency || !profile) return null;

    const paymentMethods = profile.payment_methods || [];

    // Try modern payment_methods first
    const payoutMethod = paymentMethods.find(
      (pm) =>
        (pm.scope === "payout" || pm.scope === "both") &&
        pm.currency === selectedCurrency
    );
    if (payoutMethod) return { type: "modern" as const, method: payoutMethod };

    // Fallback to any payment method with matching currency
    const anyMatch = paymentMethods.find(
      (pm) => pm.currency === selectedCurrency
    );
    if (anyMatch) return { type: "modern" as const, method: anyMatch };

    // Legacy fallback
    if (profile.bankName || profile.bankAccount) {
      return {
        type: "legacy" as const,
        bank: {
          bankName: profile.bankName,
          bankAddress: profile.bankAddress,
          bankSWIFT: profile.bankSWIFT,
          bankAccount: profile.bankAccount,
        },
      };
    }

    return null;
  };

  // Execute sell
  // QR Scanner
  const startScanner = useCallback(async () => {
    setScanError(null);
    try {
      const cameras = await Html5Qrcode.getCameras();
      if (!cameras || cameras.length === 0) {
        setScanError("No camera found on this device.");
        return;
      }
      let selectedCamera = cameras[0];
      if (cameras.length > 1) {
        const backCamera = cameras.find(c =>
          c.label.toLowerCase().includes("back") || c.label.toLowerCase().includes("rear")
        );
        if (backCamera) selectedCamera = backCamera;
      }
      const scanner = new Html5Qrcode("qr-reader-discount");
      scannerRef.current = scanner;
      await scanner.start(
        selectedCamera.id,
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => {
          if (hasScannedRef.current) return;
          hasScannedRef.current = true;
          setPrivateKey(decodedText.trim());
          stopScanner();
          setIsScannerOpen(false);
          toast.success("QR code scanned successfully");
        },
        () => {}
      );
      setIsCameraReady(true);
    } catch (err) {
      console.error("Failed to start scanner:", err);
      setScanError("Failed to access camera. Please check permissions.");
    }
  }, []);

  const stopScanner = useCallback(async () => {
    if (scannerRef.current) {
      try { await scannerRef.current.stop(); } catch {}
      scannerRef.current = null;
      setIsCameraReady(false);
    }
  }, []);

  useEffect(() => {
    if (isScannerOpen) {
      hasScannedRef.current = false;
      const timer = setTimeout(startScanner, 300);
      return () => clearTimeout(timer);
    } else {
      stopScanner();
    }
  }, [isScannerOpen, startScanner, stopScanner]);

  const executeSell = async () => {
    if (!session?.lanaPrivateKey || !session?.nostrHexId) {
      toast.error("Authentication required");
      return;
    }

    setExecuting(true);
    setTxResult(null);

    try {
      // Build electrum servers list from system parameters
      let electrumServers = (parameters?.electrumServers || []).map((s: any) =>
        typeof s === 'string' ? { host: s.split(':')[0], port: parseInt(s.split(':')[1]) || 5097 } : s
      );
      if (electrumServers.length === 0) {
        electrumServers.push(
          { host: "electrum1.lanacoin.com", port: 5097 },
          { host: "electrum2.lanacoin.com", port: 5097 }
        );
      }

      // Step 1: Build and broadcast LANA transaction via Supabase
      const { data: txData, error: txError } =
        await supabase.functions.invoke("send-lana-transaction", {
          body: {
            senderAddress: selectedWallet,
            recipientAddress: BUYBACK_WALLET,
            amount: parsedLana,
            privateKey: privateKey,
            emptyWallet: isEmptyWallet,
            electrumServers,
          },
        });

      if (txError) {
        throw new Error(txError.message || "Failed to send LANA transaction");
      }

      if (!txData?.success) {
        throw new Error(txData?.error || "Transaction failed");
      }

      const txHash = txData.txid || txData.txHash;

      // Step 2: Register sale with Lana.Discount via server proxy (avoids CORS)
      const { data: saleData, error: saleError } =
        await supabase.functions.invoke("discount-external-sale", {
          body: {
            apiUrl: DISCOUNT_API_URL,
            apiKey: DISCOUNT_API_KEY,
            tx_hash: txHash,
            sender_wallet_id: selectedWallet,
            buyback_wallet_id: BUYBACK_WALLET,
            lana_amount: parsedLana,
            currency: selectedCurrency,
            exchange_rate: exchangeRate,
            user_hex_id: session.nostrHexId,
          },
        });

      if (saleError) {
        console.error("Discount API error:", saleError);
        setTxResult({
          success: true,
          txHash,
          lanaAmount: parsedLana,
          netFiat,
          currency: selectedCurrency,
          error:
            "Transaction sent but sale registration failed. Contact support.",
        });
        toast.warning(
          "LANA sent successfully, but sale registration had an issue."
        );
      } else {
        setTxResult({
          success: true,
          txHash,
          transactionId: saleData?.transactionId || saleData?.transaction_id,
          lanaAmount: parsedLana,
          netFiat,
          currency: selectedCurrency,
        });
        toast.success("LANA sold successfully!");
      }
    } catch (error) {
      console.error("Sell error:", error);
      setTxResult({
        success: false,
        error: error instanceof Error ? error.message : "Sale failed",
      });
      toast.error("Sale failed");
    } finally {
      setExecuting(false);
      setStep(5);
    }
  };

  // Reset
  const handleReset = () => {
    setStep(1);
    setSelectedWallet("");
    setSelectedCurrency(activeCurrencies[0] || "");
    setLanaAmount("");
    setIsEmptyWallet(false);
    setPrivateKey("");
    setPrivateKeyValid(null);
    setTxResult(null);
  };

  // ==========================================
  // RENDER
  // ==========================================

  return (
    <div className="px-4 space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="mb-2">
        <h1 className="text-2xl sm:text-3xl font-bold text-foreground">
          Sell LanaCoin
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Sell your registered LanaCoins and receive an instant cash payout.
        </p>
      </div>

      {/* Step Indicator */}
      <div className="flex items-center gap-2 mb-2">
        {[1, 2, 3, 4, 5].map((s) => (
          <div key={s} className="flex items-center gap-2">
            <div
              className={`h-8 w-8 rounded-full flex items-center justify-center text-sm font-bold transition-colors ${
                s === step
                  ? "bg-primary text-white"
                  : s < step
                    ? "bg-primary/20 text-primary"
                    : "bg-muted text-muted-foreground"
              }`}
            >
              {s < step ? (
                <svg
                  className="h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={3}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              ) : (
                s
              )}
            </div>
            {s < 5 && (
              <div
                className={`w-8 h-0.5 ${s < step ? "bg-primary/40" : "bg-border"}`}
              />
            )}
          </div>
        ))}
      </div>

      {walletsLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      ) : (
        <>
          {/* ============ STEP 1: Select Wallet ============ */}
          {step === 1 && (
            <div className="space-y-6">
              <div className="rounded-2xl border-2 border-border bg-card p-6">
                <h2 className="text-lg font-semibold text-foreground mb-4">
                  Select Wallet to Sell From
                </h2>

                {availableWallets.length > 0 ? (
                  <div className="space-y-3 mb-6">
                    {availableWallets.map((w) => {
                      const shortAddr =
                        w.walletId.slice(0, 10) + "..." + w.walletId.slice(-6);
                      const isFrozen = !!w.freezeStatus;
                      return (
                        <button
                          key={w.walletId}
                          onClick={() => setSelectedWallet(w.walletId)}
                          className={`w-full rounded-xl border-2 px-5 py-4 text-left transition-all ${
                            selectedWallet === w.walletId
                              ? "border-primary bg-primary/5"
                              : "border-border hover:border-muted-foreground/30"
                          } ${isFrozen ? "opacity-60" : ""}`}
                        >
                          <div className="flex items-start gap-4">
                            {/* Wallet info */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="font-mono text-sm font-medium text-foreground">
                                  {shortAddr}
                                </span>
                                {isFrozen && (
                                  <span className="text-[10px] font-bold uppercase tracking-wider bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300 px-1.5 py-0.5 rounded">
                                    Frozen
                                  </span>
                                )}
                              </div>
                              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                                <span className="inline-flex items-center gap-1">
                                  <span className="font-medium text-foreground/70">
                                    Type:
                                  </span>
                                  {w.walletType}
                                </span>
                                {w.note && (
                                  <span className="inline-flex items-center gap-1">
                                    <span className="font-medium text-foreground/70">
                                      Note:
                                    </span>
                                    {w.note}
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* Balance */}
                            <div className="text-right flex-shrink-0">
                              {balancesLoading &&
                              balances[w.walletId] === undefined ? (
                                <div className="h-4 w-20 animate-pulse bg-muted rounded" />
                              ) : balances[w.walletId] !== undefined ? (
                                <div>
                                  <span className="font-mono text-sm font-bold text-foreground">
                                    {balances[w.walletId].toLocaleString(
                                      undefined,
                                      {
                                        minimumFractionDigits: 2,
                                        maximumFractionDigits: 2,
                                      }
                                    )}
                                  </span>
                                  <span className="text-xs text-muted-foreground ml-1">
                                    LANA
                                  </span>
                                </div>
                              ) : (
                                <span className="text-xs text-muted-foreground">
                                  ---
                                </span>
                              )}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded-lg border border-amber-200 bg-amber-50/50 dark:bg-amber-950/30 dark:border-amber-800 p-4 text-center">
                    <p className="text-sm text-amber-700 dark:text-amber-400 font-medium mb-1">
                      No registered wallets found
                    </p>
                    <p className="text-xs text-amber-600 dark:text-amber-500">
                      No wallets are registered for your account. Please contact
                      support.
                    </p>
                  </div>
                )}
              </div>

              <div className="flex justify-end">
                <button
                  onClick={() => setStep(2)}
                  disabled={!selectedWallet}
                  className={`rounded-xl px-6 py-3 font-semibold text-white transition-all ${
                    selectedWallet
                      ? "bg-primary hover:bg-primary/90 shadow-lg"
                      : "bg-muted-foreground/30 cursor-not-allowed"
                  }`}
                >
                  Next
                </button>
              </div>
            </div>
          )}

          {/* ============ STEP 2: Select Currency ============ */}
          {step === 2 && (
            <div className="space-y-6">
              <div className="rounded-2xl border-2 border-border bg-card p-6">
                <h2 className="text-lg font-semibold text-foreground mb-4">
                  Select Payout Currency
                </h2>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
                  {activeCurrencies.map((code) => {
                    const rate = parameters?.exchangeRates?.[code];
                    return (
                      <button
                        key={code}
                        onClick={() => setSelectedCurrency(code)}
                        className={`rounded-xl border-2 px-4 py-3 text-left transition-all ${
                          selectedCurrency === code
                            ? "border-primary bg-primary/5"
                            : "border-border hover:border-muted-foreground/30"
                        }`}
                      >
                        <div className="text-lg font-bold text-foreground">
                          {code}
                        </div>
                        {rate && (
                          <div className="text-xs text-muted-foreground">
                            1 LANA = {rate} {code}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* Payout Account Info */}
                {selectedCurrency && (
                  <div className="border-t border-border pt-4">
                    <h3 className="text-sm font-semibold text-foreground mb-2">
                      Your Payout Account
                    </h3>
                    {(() => {
                      const info = getPayoutInfo();
                      if (!info) {
                        return (
                          <div className="rounded-lg border border-red-200 bg-red-50/50 dark:bg-red-950/30 dark:border-red-800 p-4">
                            <p className="text-sm text-red-700 dark:text-red-400 font-medium mb-1">
                              No payout account found for {selectedCurrency}
                            </p>
                            <p className="text-xs text-red-600 dark:text-red-500">
                              Your Nostr profile does not contain payment
                              information for this currency. Please update your
                              profile with payout details (e.g. IBAN) before
                              proceeding.
                            </p>
                          </div>
                        );
                      }
                      if (info.type === "modern") {
                        const pm = info.method!;
                        return (
                          <div className="rounded-lg border border-green-200 bg-green-50/50 dark:bg-green-950/30 dark:border-green-800 p-3 space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-foreground">
                                {pm.label || pm.scheme}
                              </span>
                              {pm.verified && (
                                <span className="text-[10px] bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300 px-1.5 py-0.5 rounded font-bold">
                                  VERIFIED
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {SCHEME_LABELS[pm.scheme] || pm.scheme}
                            </div>
                            {Object.entries(pm.fields).map(([key, val]) => (
                              <div key={key} className="text-xs">
                                <span className="text-muted-foreground">
                                  {key}:
                                </span>{" "}
                                <span className="font-mono text-foreground">
                                  {String(val)}
                                </span>
                              </div>
                            ))}
                          </div>
                        );
                      }
                      // Legacy
                      const bank = info.bank!;
                      return (
                        <div className="rounded-lg border border-green-200 bg-green-50/50 dark:bg-green-950/30 dark:border-green-800 p-3 space-y-1">
                          {bank.bankName && (
                            <div className="text-sm font-medium text-foreground">
                              {bank.bankName}
                            </div>
                          )}
                          {bank.bankAccount && (
                            <div className="text-xs">
                              <span className="text-muted-foreground">
                                Account:
                              </span>{" "}
                              <span className="font-mono">
                                {bank.bankAccount}
                              </span>
                            </div>
                          )}
                          {bank.bankSWIFT && (
                            <div className="text-xs">
                              <span className="text-muted-foreground">
                                SWIFT:
                              </span>{" "}
                              <span className="font-mono">
                                {bank.bankSWIFT}
                              </span>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>

              <div className="flex justify-between">
                <button
                  onClick={() => setStep(1)}
                  className="rounded-xl border border-border px-6 py-3 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={() => setStep(3)}
                  disabled={!selectedCurrency || !getPayoutInfo()}
                  className={`rounded-xl px-6 py-3 font-semibold text-white transition-all ${
                    selectedCurrency && getPayoutInfo()
                      ? "bg-primary hover:bg-primary/90 shadow-lg"
                      : "bg-muted-foreground/30 cursor-not-allowed"
                  }`}
                >
                  Next
                </button>
              </div>
            </div>
          )}

          {/* ============ STEP 3: Enter Amount & Preview ============ */}
          {step === 3 && (
            <div className="space-y-6">
              <div className="rounded-2xl border-2 border-border bg-card p-6">
                <h2 className="text-lg font-semibold text-foreground mb-4">
                  Enter LANA Amount
                </h2>

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1.5">
                      Amount (LANA)
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        value={lanaAmount}
                        onChange={(e) => {
                          setLanaAmount(e.target.value);
                          setIsEmptyWallet(false);
                        }}
                        placeholder="e.g. 100000"
                        min="1"
                        className="flex-1 rounded-lg border border-border bg-background px-4 py-3 text-sm font-mono text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
                      />
                      {walletBalance > 0 && (
                        <button
                          onClick={() => {
                            const estimatedFeeLanoshis = Math.floor(
                              (1 * 180 + 1 * 34 + 10) * 100 * 1.5
                            );
                            const feeLana = estimatedFeeLanoshis / 100000000;
                            const maxSendable = Math.max(
                              0,
                              walletBalance - feeLana
                            );
                            setLanaAmount(String(maxSendable));
                            setIsEmptyWallet(true);
                          }}
                          className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm font-semibold text-primary hover:bg-primary/10 transition-colors"
                        >
                          Max
                        </button>
                      )}
                    </div>
                    {walletBalance > 0 && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Available: {walletBalance.toLocaleString()} LANA
                      </p>
                    )}
                  </div>

                  {/* Payout Breakdown */}
                  {parsedLana > 0 && exchangeRate > 0 && (
                    <div className="rounded-xl border-2 border-primary/20 bg-primary/5 p-5 space-y-3">
                      <h3 className="text-sm font-bold text-foreground uppercase tracking-wider">
                        Payout Breakdown
                      </h3>

                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">
                            LANA Amount
                          </span>
                          <span className="font-mono font-bold text-foreground">
                            {parsedLana.toLocaleString()} LANA
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">
                            Exchange Rate
                          </span>
                          <span className="font-mono text-foreground">
                            1 LANA = {exchangeRate} {selectedCurrency}
                          </span>
                        </div>
                        <div className="border-t border-border/50 pt-2 flex justify-between">
                          <span className="text-muted-foreground">
                            Gross Value
                          </span>
                          <span className="font-mono text-foreground">
                            {formatFiat(grossFiat, selectedCurrency)}
                          </span>
                        </div>
                        <div className="flex justify-between text-red-600">
                          <span>Commission ({COMMISSION_PERCENT}%)</span>
                          <span className="font-mono">
                            -{formatFiat(commissionFiat, selectedCurrency)}
                          </span>
                        </div>
                        <div className="border-t-2 border-primary/30 pt-2 flex justify-between">
                          <span className="font-bold text-foreground">
                            Your Payout
                          </span>
                          <span className="font-mono font-bold text-lg text-primary">
                            {formatFiat(netFiat, selectedCurrency)}{" "}
                            {selectedCurrency}
                          </span>
                        </div>
                      </div>

                      <div className="text-xs text-muted-foreground pt-1 space-y-0.5">
                        <div>
                          From:{" "}
                          <span className="font-mono font-medium text-foreground">
                            {selectedWallet.slice(0, 12)}...
                            {selectedWallet.slice(-8)}
                          </span>
                          {(() => {
                            const wt = wallets.find(
                              (w) => w.walletId === selectedWallet
                            )?.walletType;
                            return wt ? (
                              <span className="ml-1 text-muted-foreground">
                                ({wt})
                              </span>
                            ) : null;
                          })()}
                        </div>
                        <div>
                          To buyback:{" "}
                          <span className="font-mono">
                            {BUYBACK_WALLET.slice(0, 12)}...
                            {BUYBACK_WALLET.slice(-8)}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Minimum amount warning */}
              {belowMinimum && (
                <div className="rounded-xl border-2 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 p-4 flex items-start gap-3">
                  <AlertCircle className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
                  <p className="text-sm text-red-700 dark:text-red-400">
                    Minimum sell value is <strong>{CURRENCY_SYMBOLS[selectedCurrency] || ''}{minSellFiat} {selectedCurrency}</strong>
                  </p>
                </div>
              )}

              <div className="flex justify-between">
                <button
                  onClick={() => setStep(2)}
                  className="rounded-xl border border-border px-6 py-3 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={() => setStep(4)}
                  disabled={parsedLana <= 0 || exchangeRate <= 0 || belowMinimum}
                  className={`rounded-xl px-6 py-3 font-semibold text-white transition-all ${
                    parsedLana > 0 && exchangeRate > 0 && !belowMinimum
                      ? "bg-primary hover:bg-primary/90 shadow-lg"
                      : "bg-muted-foreground/30 cursor-not-allowed"
                  }`}
                >
                  Proceed to Confirm
                </button>
              </div>
            </div>
          )}

          {/* ============ STEP 4: Confirm Transaction ============ */}
          {step === 4 && (
            <div className="space-y-6">
              <div className="rounded-2xl border-2 border-border bg-card p-6">
                <h2 className="text-lg font-semibold text-foreground mb-4">
                  Confirm Transaction
                </h2>

                {/* Summary */}
                <div className="rounded-xl bg-muted/30 p-4 space-y-2 text-sm mb-6">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">From Wallet</span>
                    <span className="font-mono text-foreground">
                      {selectedWallet.slice(0, 12)}...
                      {selectedWallet.slice(-8)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">
                      To Buyback Wallet
                    </span>
                    <span className="font-mono text-foreground">
                      {BUYBACK_WALLET.slice(0, 12)}...
                      {BUYBACK_WALLET.slice(-8)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Amount</span>
                    <span className="font-mono font-bold text-foreground">
                      {parsedLana.toLocaleString()} LANA
                    </span>
                  </div>
                  <div className="border-t border-border pt-2 flex justify-between">
                    <span className="font-bold text-foreground">
                      Your Payout
                    </span>
                    <span className="font-mono font-bold text-primary">
                      {formatFiat(netFiat, selectedCurrency)} {selectedCurrency}
                    </span>
                  </div>
                </div>

                {/* WIF Private Key Input */}
                <div className="space-y-3">
                  <label className="text-sm font-medium text-foreground">WIF Private Key</label>
                  <div className="flex gap-2">
                    <input
                      type="password"
                      value={privateKey}
                      onChange={(e) => setPrivateKey(e.target.value.trim())}
                      placeholder="Enter or scan your WIF private key"
                      className={`flex-1 rounded-xl border-2 px-4 py-3 font-mono text-sm bg-background transition-colors focus:outline-none focus:ring-2 ${
                        privateKeyValid === true
                          ? 'border-green-500 focus:ring-green-500/30'
                          : privateKeyValid === false
                            ? 'border-red-500 focus:ring-red-500/30'
                            : 'border-border focus:ring-primary/30'
                      }`}
                    />
                    <button
                      type="button"
                      onClick={() => setIsScannerOpen(true)}
                      className="shrink-0 rounded-xl border-2 border-border px-4 py-3 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                      title="Scan QR Code"
                    >
                      <QrCode className="h-5 w-5" />
                    </button>
                  </div>
                  {validatingKey && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <Loader2 className="h-3 w-3 animate-spin" /> Validating key...
                    </p>
                  )}
                  {privateKeyValid === true && (
                    <p className="text-xs text-green-600 flex items-center gap-1">
                      <CheckCircle className="h-3 w-3" /> Private key matches the selected wallet
                    </p>
                  )}
                  {privateKeyValid === false && (
                    <p className="text-xs text-red-500 flex items-center gap-1">
                      <XCircle className="h-3 w-3" /> Private key does not match the selected wallet
                    </p>
                  )}
                  {privateKeyValid === null && privateKey === '' && (
                    <p className="text-xs text-muted-foreground">
                      Your private key is used only to sign this transaction. It is never stored.
                    </p>
                  )}
                </div>
              </div>

              <div className="flex justify-between">
                <button
                  onClick={() => setStep(3)}
                  className="rounded-xl border border-border px-6 py-3 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={executeSell}
                  disabled={executing || !privateKey || privateKeyValid !== true}
                  className={`rounded-xl px-8 py-3 font-semibold text-white transition-all ${
                    !executing && privateKey && privateKeyValid === true
                      ? "bg-red-600 hover:bg-red-700 shadow-lg"
                      : "bg-muted-foreground/30 cursor-not-allowed"
                  }`}
                >
                  {executing ? (
                    <span className="flex items-center gap-2">
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                      Sending Transaction...
                    </span>
                  ) : (
                    "Confirm & Send"
                  )}
                </button>
              </div>
            </div>
          )}

          {/* ============ STEP 5: Result ============ */}
          {step === 5 && txResult && (
            <div className="space-y-6">
              <div
                className={`rounded-2xl border-2 p-8 text-center ${
                  txResult.success
                    ? "border-green-200 bg-green-50/30 dark:border-green-800 dark:bg-green-950/20"
                    : "border-red-200 bg-red-50/30 dark:border-red-800 dark:bg-red-950/20"
                }`}
              >
                {txResult.success ? (
                  <>
                    <div className="h-16 w-16 rounded-full bg-green-100 dark:bg-green-900 flex items-center justify-center mx-auto mb-4">
                      <svg
                        className="h-8 w-8 text-green-600"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2.5}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                    </div>
                    <h2 className="text-2xl font-bold text-foreground mb-2">
                      Transaction Broadcast!
                    </h2>
                    <p className="text-muted-foreground mb-6">
                      Your LanaCoins have been sent to the network. Payout will
                      be processed after blockchain confirmation.
                    </p>

                    <div className="rounded-xl bg-white/50 dark:bg-background/50 border border-green-200 dark:border-green-800 p-4 space-y-2 text-sm text-left max-w-md mx-auto">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">
                          Amount Sold
                        </span>
                        <span className="font-mono font-bold">
                          {txResult.lanaAmount?.toLocaleString()} LANA
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">
                          Your Payout
                        </span>
                        <span className="font-mono font-bold text-primary">
                          {txResult.currency &&
                            formatFiat(
                              txResult.netFiat || 0,
                              txResult.currency
                            )}{" "}
                          {txResult.currency}
                        </span>
                      </div>
                      {txResult.txHash && (
                        <div className="border-t border-green-200 dark:border-green-800 pt-2">
                          <span className="text-muted-foreground text-xs">
                            TX Hash
                          </span>
                          <div
                            className="font-mono text-xs text-foreground break-all mt-0.5 select-all cursor-pointer"
                            title="Click to copy"
                          >
                            {txResult.txHash}
                          </div>
                        </div>
                      )}
                      {txResult.transactionId && (
                        <div className="border-t border-green-200 dark:border-green-800 pt-2">
                          <span className="text-muted-foreground text-xs">
                            Transaction ID
                          </span>
                          <div className="font-mono text-xs text-foreground break-all mt-0.5">
                            {txResult.transactionId}
                          </div>
                        </div>
                      )}
                    </div>

                    {txResult.error && (
                      <Alert className="mt-4 text-left">
                        <AlertCircle className="h-4 w-4" />
                        <AlertDescription>{txResult.error}</AlertDescription>
                      </Alert>
                    )}
                  </>
                ) : (
                  <>
                    <div className="h-16 w-16 rounded-full bg-red-100 dark:bg-red-900 flex items-center justify-center mx-auto mb-4">
                      <svg
                        className="h-8 w-8 text-red-600"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2.5}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M6 18L18 6M6 6l12 12"
                        />
                      </svg>
                    </div>
                    <h2 className="text-2xl font-bold text-foreground mb-2">
                      Transaction Failed
                    </h2>
                    <p className="text-red-600 mb-4">{txResult.error}</p>
                  </>
                )}
              </div>

              <div className="flex justify-center gap-4">
                {txResult.success ? (
                  <button
                    onClick={handleReset}
                    className="rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-white hover:bg-primary/90 transition-colors"
                  >
                    Sell More
                  </button>
                ) : (
                  <>
                    <button
                      onClick={handleReset}
                      className="rounded-xl border border-border px-6 py-3 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                    >
                      Back
                    </button>
                    <button
                      onClick={() => {
                        setTxResult(null);
                        setStep(4);
                      }}
                      className="rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-white hover:bg-primary/90 transition-colors"
                    >
                      Try Again
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
        </>
      )}
      {/* QR Scanner Modal */}
      {isScannerOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="bg-card border-2 border-border rounded-2xl p-6 max-w-md w-full mx-4 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-foreground">Scan WIF Private Key</h3>
              <button
                onClick={() => setIsScannerOpen(false)}
                className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-muted transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div
              id="qr-reader-discount"
              className="rounded-xl overflow-hidden bg-black min-h-[280px]"
            />
            {!isCameraReady && !scanError && (
              <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Starting camera...
              </div>
            )}
            {scanError && (
              <div className="rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 p-3 text-sm text-red-600">
                {scanError}
              </div>
            )}
            <p className="text-xs text-muted-foreground text-center">
              Point your camera at the QR code containing your WIF private key.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
