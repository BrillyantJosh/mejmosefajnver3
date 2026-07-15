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
  Info,
  Banknote,
  ArrowLeft,
  ShieldCheck,
  QrCode,
  X,
  ExternalLink,
} from "lucide-react";
import { QRScanner } from "@/components/QRScanner";
import { useAuth } from "@/contexts/AuthContext";
import { useSystemParameters } from "@/contexts/SystemParametersContext";
import { useAdmin } from "@/contexts/AdminContext";
import { useNostrWallets } from "@/hooks/useNostrWallets";
import { useNostrProfile } from "@/hooks/useNostrProfile";
import { useNostrPaymentScore } from "@/hooks/useNostrPaymentScore";
import { useNostrLana8Wonder } from "@/hooks/useNostrLana8Wonder";
import { supabase } from "@/integrations/supabase/client";
import { convertWifToIds } from "@/lib/crypto";
import { useLang, useTranslation } from "@/i18n/I18nContext";
import discountTranslations from "@/i18n/modules/discount";
import { toast } from "sonner";

const MIN_RATING = 10;

// Fallback defaults — overridden by admin settings
const DEFAULT_BUYBACK_WALLET = "Lg7iw2aQp8qazNsZVZFhf4rP7bikSrLRxB";
const DEFAULT_API_URL = "https://www.lana.discount";
const DEFAULT_API_KEY = "ldk_brain_37fe9da0c986846693edcd176620526a8b8d9eca";
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

// Payout-order notice shown (and must be agreed to) before starting a sale. SL for
// Slovenian users, EN for everyone else.
const PAYOUT_NOTICE = {
  sl: {
    orderTitle: "Vrstni red izplačil",
    orderIntro:
      "Izplačila v sistemu potekajo po vnaprej določenem vrstnem redu, ki zagotavlja stabilnost in naravno ravnovesje celotnega ekosistema.",
    seqTitle: "Zaporedje izplačil:",
    seq: [
      "investitorji,",
      "crowdfunding projekti,",
      "projekti brezpogojnih posojil (Unconditional Loan),",
      "Lana8Wonder Spliti in premije iz potrošnje,",
    ],
    seqAfter: "nato sledi naslednji Split (ko je vse poplačano).",
    p1: "Prosimo, da ne pričakujete izplačil mimo tega vrstnega reda — to je naravni ritem sistema, ki omogoča, da deluje predvidljivo, transparentno in dolgoročno stabilno.",
    p2: "Če ste prejeli Lane, jih najprej porabite pri nakupih v trgovinah in pri vključenih ponudnikih — Lana je potrošniški ekosistem in njena največja vrednost je v kroženju med uporabniki. Če jih pred naslednjim Splitom ne uspete porabiti, jih prodajte na trgu, da se izognete morebitni zamrznitvi sredstev ob izvedbi Splita.",
    transTitle: "Transparentnost izplačil",
    trans:
      "Vsa izplačila so popolnoma transparentna. Trenutni vrstni red izplačil in status vašega zahtevka lahko kadarkoli spremljate na portalu lana.discount, kjer je jasno prikazano, na katerem mestu v čakalni vrsti se trenutno nahaja vaše izplačilo.",
    agree: "Prebral/-a sem in se strinjam z vrstnim redom in pogoji izplačil.",
    continue: "Se strinjam in nadaljujem",
  },
  en: {
    orderTitle: "Payment Order",
    orderIntro:
      "Payments within the system follow a predefined order designed to ensure the stability and natural balance of the entire ecosystem.",
    seqTitle: "The payment sequence is as follows:",
    seq: [
      "Investors",
      "Crowdfunding projects",
      "Unconditional Loan projects",
      "Lana8Wonder Splits and retail incentives",
    ],
    seqAfter: "Once all obligations have been fulfilled, the next Split takes place.",
    p1: "Please do not expect payments outside of this sequence. Following this order allows the system to operate predictably, transparently, and sustainably over the long term.",
    p2: "If you have received LANA, we encourage you to spend it first at participating merchants and service providers. LANA is designed as a consumer-driven ecosystem, and its greatest value comes from circulating throughout the economy. If you are unable to spend your LANA before the next Split, you may sell it on the market to avoid the possibility of your funds being temporarily frozen during the Split process.",
    transTitle: "Payment Transparency",
    trans:
      "All payments are fully transparent. You can monitor the current payment queue and the status of your payment at any time on lana.discount, where you can clearly see your current position in the payment queue.",
    agree: "I have read and agree to the payment order and terms.",
    continue: "I agree and continue",
  },
} as const;

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
  const { score: paymentScore, isLoading: scoreLoading } = useNostrPaymentScore(session?.nostrHexId);
  const { status: lana8WonderStatus, isLoading: l8wLoading } = useNostrLana8Wonder();
  const uiLang = useLang();
  const { t } = useTranslation(discountTranslations);
  const notice = PAYOUT_NOTICE[uiLang === "sl" ? "sl" : "en"];
  const isSl = uiLang === "sl";
  // LanaPays.Us wallets are not sold through this module — they are sold directly on lana.discount.
  const lanaPaysSellNotice = isSl
    ? "LanaPays.Us sredstva se prodajo neposredno na lana.discount — prodaja prek te aplikacije ni na voljo."
    : "LanaPays.Us funds are sold directly on lana.discount — selling through this app is not available.";
  const lanaPaysSellCta = isSl ? "Prodaj na lana.discount" : "Sell on lana.discount";

  // Rating check
  const userRating = paymentScore ? parseFloat(paymentScore.score) : null;
  const hasLana8Wonder = lana8WonderStatus.exists;
  // When there is NO payment rating yet — e.g. the user just joined Lana8Wonder,
  // so no subscriptions have run and no rating has accrued — allow selling if a
  // Lana8Wonder (KIND 88888) record exists. An actual rating below the minimum
  // still blocks the sale.
  const ratingBlocked = userRating === null ? !hasLana8Wonder : userRating < MIN_RATING;

  // Admin-configurable settings with defaults
  const BUYBACK_WALLET = appSettings?.discount_buyback_wallet || DEFAULT_BUYBACK_WALLET;
  const DISCOUNT_API_URL = appSettings?.discount_api_url || DEFAULT_API_URL;
  const DISCOUNT_API_KEY = appSettings?.discount_api_key || DEFAULT_API_KEY;
  const COMMISSION_LANAPAYS = appSettings?.discount_commission_lanapays ?? DEFAULT_COMMISSION_LANAPAYS;
  const COMMISSION_OTHER = appSettings?.discount_commission_other ?? DEFAULT_COMMISSION_OTHER;
  const MIN_SELL: Record<string, number> = {
    EUR: appSettings?.discount_min_sell_eur ?? 2,
    USD: appSettings?.discount_min_sell_usd ?? 2,
    GBP: appSettings?.discount_min_sell_gbp ?? 2,
  };

  // 5-step flow
  const [step, setStep] = useState(1);

  // Payout-order consent gate — the user must read the notice and agree before step 1.
  const [consented, setConsented] = useState(false);
  const [agreeChecked, setAgreeChecked] = useState(false);

  // Step 1: Select Wallet
  const [selectedWallet, setSelectedWallet] = useState("");
  const [balances, setBalances] = useState<Record<string, number>>({});
  const [balancesLoading, setBalancesLoading] = useState(false);
  const [utxoCount, setUtxoCount] = useState<number | null>(null);
  const [utxoLoading, setUtxoLoading] = useState(false);
  const MAX_UTXOS = 20;

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

  // QR Scanner — uses shared <QRScanner> dialog (same as mobile.lanapays.us)
  const [isScannerOpen, setIsScannerOpen] = useState(false);

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

  // Filter wallets — exclude Lana8Wonder, Knights, Retail
  const availableWallets = useMemo(
    () =>
      wallets.filter(
        (w) => w.walletType !== "Lana8Wonder" && w.walletType !== "Knights" && w.walletType !== "Retail"
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

  // Check UTXO count when wallet is selected
  useEffect(() => {
    if (!selectedWallet) {
      setUtxoCount(null);
      return;
    }
    const checkUtxos = async () => {
      setUtxoLoading(true);
      try {
        const { data } = await supabase.functions.invoke('get-utxo-info', {
          body: { address: selectedWallet, electrumServers: parameters?.electrumServers || [] }
        });
        if (data?.success) {
          setUtxoCount(data.utxoCount || 0);
        }
      } catch (e) {
        console.error('UTXO check failed:', e);
      } finally {
        setUtxoLoading(false);
      }
    };
    checkUtxos();
  }, [selectedWallet, parameters?.electrumServers]);

  const tooManyUtxos = utxoCount !== null && utxoCount > MAX_UTXOS;

  // Available currencies from system params
  const activeCurrencies = useMemo(() => {
    if (!parameters?.exchangeRates) return [];
    return Object.keys(parameters.exchangeRates);
  }, [parameters?.exchangeRates]);

  // Auto-set currency from user's profile (KIND 0) — not changeable
  // Profile currency takes priority even if fallback was set first
  useEffect(() => {
    if (profile?.currency && activeCurrencies.includes(profile.currency)) {
      setSelectedCurrency(profile.currency);
    } else if (!selectedCurrency && activeCurrencies.length > 0) {
      setSelectedCurrency(activeCurrencies[0]);
    }
  }, [activeCurrencies, profile?.currency]);

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

  // (QR scanner lifecycle managed by useJsQRScanner above)

  const executeSell = async () => {
    if (!session?.lanaPrivateKey || !session?.nostrHexId) {
      toast.error(t("sell.toast.authRequired"));
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
        throw new Error(txError.message || t("sell.error.sendFailed"));
      }

      if (!txData?.success) {
        throw new Error(txData?.error || t("sell.error.txFailed"));
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
          error: t("sell.error.saleRegFailed"),
        });
        toast.warning(t("sell.toast.saleRegIssue"));
      } else {
        setTxResult({
          success: true,
          txHash,
          transactionId: saleData?.transactionId || saleData?.transaction_id,
          lanaAmount: parsedLana,
          netFiat,
          currency: selectedCurrency,
        });
        toast.success(t("sell.toast.soldSuccess"));
      }
    } catch (error) {
      console.error("Sell error:", error);
      setTxResult({
        success: false,
        error: error instanceof Error ? error.message : t("sell.error.saleFailed"),
      });
      toast.error(t("sell.error.saleFailed"));
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
          {t("sell.pageTitle")}
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          {t("sell.pageSubtitle")}
        </p>
        <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30 px-4 py-3 text-xs text-blue-700 dark:text-blue-400 mt-2">
          <strong>{t("sell.payoutTiming.label")}</strong> {t("sell.payoutTiming.text")}
        </div>
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

      {walletsLoading || scoreLoading || l8wLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      ) : (
        <>
          {/* Rating status — always shown at top */}
          {!ratingBlocked ? (
            <div className="flex items-center gap-3 rounded-xl border border-green-300 dark:border-green-800 bg-green-50 dark:bg-green-950/30 px-4 py-3 mb-4">
              <CheckCircle className="h-5 w-5 text-green-600 shrink-0" />
              <span className="text-sm text-green-700 dark:text-green-400">
                {userRating !== null ? (
                  <>{t("sell.rating.label")} <strong>{userRating}/10</strong> {t("sell.rating.enabledSuffix")}</>
                ) : (
                  <><strong>{t("sell.rating.l8wMember")}</strong> {t("sell.rating.enabledNoRating")}</>
                )}
              </span>
            </div>
          ) : (
            <div className="space-y-4 mb-4">
              <div className="rounded-2xl border-2 border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/30 p-6 text-center space-y-4">
                <div className="mx-auto w-16 h-16 rounded-full bg-red-100 dark:bg-red-900/50 flex items-center justify-center">
                  <XCircle className="h-8 w-8 text-red-500" />
                </div>
                <h2 className="text-xl font-bold text-red-700 dark:text-red-400">{t("sell.rating.blockedTitle")}</h2>
                <p className="text-sm text-red-600 dark:text-red-400 max-w-md mx-auto leading-relaxed">
                  {t("sell.rating.blockedText")}
                </p>
                {userRating !== null ? (
                  <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-red-100 dark:bg-red-900/40">
                    <span className="text-sm font-medium text-red-700 dark:text-red-400">
                      {t("sell.rating.current", { rating: userRating })}
                    </span>
                  </div>
                ) : (
                  <p className="text-xs text-red-500/70">{t("sell.rating.noneFound")}</p>
                )}
              </div>
            </div>
          )}

          {/* Steps only shown when rating is OK */}
          {!ratingBlocked && (
          <>
          {/* ============ PAYOUT-ORDER NOTICE + CONSENT (before starting) ============ */}
          {!consented && (
            <div className="space-y-4">
              <div className="rounded-2xl border-2 border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 p-5 sm:p-6 space-y-4">
                <div className="flex items-center gap-2">
                  <Info className="h-5 w-5 text-amber-600 shrink-0" />
                  <h2 className="text-lg font-bold text-amber-800 dark:text-amber-300">{notice.orderTitle}</h2>
                </div>
                <p className="text-sm text-foreground/90 leading-relaxed">{notice.orderIntro}</p>
                <div>
                  <p className="text-sm font-medium mb-1">{notice.seqTitle}</p>
                  <ol className="list-decimal list-inside space-y-0.5 text-sm text-foreground/90">
                    {notice.seq.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ol>
                  <p className="text-sm text-foreground/90 mt-1">{notice.seqAfter}</p>
                </div>
                <p className="text-sm text-foreground/90 leading-relaxed">{notice.p1}</p>
                <p className="text-sm text-foreground/90 leading-relaxed">{notice.p2}</p>
                <div className="pt-3 border-t border-amber-200 dark:border-amber-800/60 space-y-1">
                  <h3 className="text-base font-bold text-amber-800 dark:text-amber-300">{notice.transTitle}</h3>
                  <p className="text-sm text-foreground/90 leading-relaxed">
                    {(() => {
                      const parts = notice.trans.split("lana.discount");
                      return parts.length > 1 ? (
                        <>
                          {parts[0]}
                          <a
                            href="https://lana.discount"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary font-medium underline"
                          >
                            lana.discount
                          </a>
                          {parts.slice(1).join("lana.discount")}
                        </>
                      ) : (
                        notice.trans
                      );
                    })()}
                  </p>
                </div>
              </div>

              <label className="flex items-start gap-3 rounded-xl border p-4 cursor-pointer hover:bg-muted/40">
                <input
                  type="checkbox"
                  checked={agreeChecked}
                  onChange={(e) => setAgreeChecked(e.target.checked)}
                  className="mt-0.5 h-5 w-5 shrink-0 accent-primary"
                />
                <span className="text-sm font-medium">{notice.agree}</span>
              </label>

              <Button className="w-full h-12 text-base" disabled={!agreeChecked} onClick={() => setConsented(true)}>
                {notice.continue}
              </Button>
            </div>
          )}

          {/* ============ STEP 1: Select Wallet ============ */}
          {consented && step === 1 && (
            <div className="space-y-6">
              <div className="rounded-2xl border-2 border-border bg-card p-4 sm:p-6">
                <h2 className="text-lg font-semibold text-foreground mb-4">
                  {t("sell.step1.title")}
                </h2>

                {availableWallets.length > 0 ? (
                  <div className="space-y-3 mb-6">
                    {availableWallets.map((w) => {
                      const shortAddr =
                        w.walletId.slice(0, 10) + "..." + w.walletId.slice(-6);
                      const isFrozen = !!w.freezeStatus;
                      const isLanaPays = w.walletType === "LanaPays.Us";

                      const cardBody = (
                        <div className="space-y-2">
                          {/* Top row: wallet address + frozen badge */}
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="font-mono text-xs sm:text-sm font-medium text-foreground truncate">
                              {shortAddr}
                            </span>
                            {isFrozen && (
                              <span className="text-[10px] font-bold uppercase tracking-wider bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300 px-1.5 py-0.5 rounded flex-shrink-0">
                                {t("sell.wallet.frozen")}
                              </span>
                            )}
                          </div>

                          {/* Middle row: type + note */}
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                            <span>{w.walletType}</span>
                            {w.note && (
                              <span className="truncate max-w-[200px]">{w.note}</span>
                            )}
                          </div>

                          {/* Bottom row: balance */}
                          <div>
                            {balancesLoading &&
                            balances[w.walletId] === undefined ? (
                              <div className="h-4 w-24 animate-pulse bg-muted rounded" />
                            ) : balances[w.walletId] !== undefined ? (
                              <span className="font-mono text-sm font-bold text-foreground">
                                {balances[w.walletId].toLocaleString(
                                  undefined,
                                  {
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 2,
                                  }
                                )}
                                <span className="text-xs text-muted-foreground font-normal ml-1">
                                  LANA
                                </span>
                              </span>
                            ) : (
                              <span className="text-xs text-muted-foreground">
                                ---
                              </span>
                            )}
                          </div>
                        </div>
                      );

                      // LanaPays.Us: sold directly on lana.discount — NOT sellable through this module.
                      if (isLanaPays) {
                        return (
                          <div
                            key={w.walletId}
                            className={`w-full rounded-xl border-2 border-border bg-muted/20 px-3 sm:px-5 py-3 sm:py-4 space-y-3 ${isFrozen ? "opacity-60" : ""}`}
                          >
                            {cardBody}
                            <div className="rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 p-3 space-y-2">
                              <p className="text-xs text-amber-700 dark:text-amber-400 leading-relaxed">
                                {lanaPaysSellNotice}
                              </p>
                              <Button size="sm" variant="outline" asChild className="gap-1.5 w-full sm:w-auto">
                                <a href="https://lana.discount" target="_blank" rel="noopener noreferrer">
                                  <ExternalLink className="h-4 w-4" />
                                  {lanaPaysSellCta}
                                </a>
                              </Button>
                            </div>
                          </div>
                        );
                      }

                      return (
                        <button
                          key={w.walletId}
                          onClick={() => setSelectedWallet(w.walletId)}
                          className={`w-full rounded-xl border-2 px-3 sm:px-5 py-3 sm:py-4 text-left transition-all ${
                            selectedWallet === w.walletId
                              ? "border-primary bg-primary/5"
                              : "border-border hover:border-muted-foreground/30"
                          } ${isFrozen ? "opacity-60" : ""}`}
                        >
                          {cardBody}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded-lg border border-amber-200 bg-amber-50/50 dark:bg-amber-950/30 dark:border-amber-800 p-4 text-center">
                    <p className="text-sm text-amber-700 dark:text-amber-400 font-medium mb-1">
                      {t("sell.wallet.noneTitle")}
                    </p>
                    <p className="text-xs text-amber-600 dark:text-amber-500">
                      {t("sell.wallet.noneText")}
                    </p>
                  </div>
                )}
              </div>

              {/* Payout currency from profile */}
              {selectedCurrency && (
                <div className="rounded-lg border border-border bg-muted/30 p-3 flex items-center justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground">{t("sell.payoutCurrency")}</p>
                    <p className="text-sm font-semibold">{selectedCurrency}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-muted-foreground">{t("sell.exchangeRate")}</p>
                    <p className="text-sm font-mono">1 LANA = {parameters?.exchangeRates?.[selectedCurrency] || '...'} {selectedCurrency}</p>
                  </div>
                </div>
              )}

              {/* UTXO consolidation warning */}
              {selectedWallet && tooManyUtxos && (
                <div className="rounded-xl border-2 border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/30 p-4 space-y-3">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
                    <div className="space-y-2">
                      <p className="text-sm font-semibold text-red-700 dark:text-red-400">
                        {t("sell.utxo.title")}
                      </p>
                      <p className="text-xs text-red-600 dark:text-red-500">
                        {t("sell.utxo.has")} <strong>{t("sell.utxo.count", { count: utxoCount })}</strong> {t("sell.utxo.exceeds", { max: MAX_UTXOS })}
                      </p>
                      <a
                        href="https://youtu.be/dWniYXwdWqk"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-red-600 dark:text-red-400 hover:underline"
                      >
                        <ExternalLink className="h-3 w-3" />
                        {t("sell.utxo.watch")}
                      </a>
                    </div>
                  </div>
                </div>
              )}

              {selectedWallet && utxoLoading && (
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" /> {t("sell.utxo.checking")}
                </p>
              )}

              {/* Currency-payment method mismatch warning */}
              {selectedCurrency && !getPayoutInfo() && (() => {
                const availableMethods = (profile?.payment_methods || []).filter((pm: any) => pm.scope === 'payout' || pm.scope === 'both');
                return (
                  <div className="rounded-xl border-2 border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/30 p-4 space-y-3">
                    <div className="flex items-start gap-3">
                      <Banknote className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
                      <div className="space-y-2">
                        <p className="text-sm font-bold text-red-700 dark:text-red-400">
                          {t("sell.mismatch.title")}
                        </p>
                        <p className="text-xs text-red-600 dark:text-red-500">
                          {t("sell.mismatch.youSelected")} <strong>{selectedCurrency}</strong> {t("sell.mismatch.noPmConfigured", { currency: selectedCurrency })}
                        </p>
                        {availableMethods.length > 0 && (
                          <div className="text-xs text-red-600 dark:text-red-500">
                            <p className="font-medium">{t("sell.mismatch.availableMethods")}</p>
                            <ul className="list-disc pl-4 mt-1 space-y-0.5">
                              {availableMethods.map((pm: any, i: number) => (
                                <li key={i}>
                                  <strong>{pm.currency}</strong> — {pm.label || pm.scheme}
                                  {pm.fields?.iban && <span className="font-mono ml-1">(...{pm.fields.iban.slice(-4)})</span>}
                                  {pm.fields?.account_number && <span className="font-mono ml-1">(...{pm.fields.account_number.slice(-4)})</span>}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        <p className="text-xs text-red-600 dark:text-red-500">
                          {t("sell.mismatch.pleaseSelect")}{' '}
                          <a href="/profile" className="font-medium underline hover:text-red-800 dark:hover:text-red-300">
                            {t("sell.mismatch.updateProfile")}
                          </a>{' '}
                          {t("sell.mismatch.toAddPm", { currency: selectedCurrency })}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })()}

              <div className="flex justify-end">
                <button
                  onClick={() => setStep(3)}
                  disabled={!selectedWallet || tooManyUtxos || utxoLoading || !selectedCurrency || !getPayoutInfo()}
                  className={`rounded-xl px-6 py-3 font-semibold text-white transition-all ${
                    selectedWallet && !tooManyUtxos && !utxoLoading && selectedCurrency && getPayoutInfo()
                      ? "bg-primary hover:bg-primary/90 shadow-lg"
                      : "bg-muted-foreground/30 cursor-not-allowed"
                  }`}
                >
                  {t("sell.next")}
                </button>
              </div>
            </div>
          )}

          {/* ============ STEP 2: Select Currency ============ */}
          {step === 2 && (
            <div className="space-y-6">
              <div className="rounded-2xl border-2 border-border bg-card p-4 sm:p-6">
                <h2 className="text-lg font-semibold text-foreground mb-4">
                  {t("sell.step2.title")}
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
                      {t("sell.step2.payoutAccount")}
                    </h3>
                    {(() => {
                      const info = getPayoutInfo();
                      if (!info) {
                        const availableMethods = (profile?.payment_methods || []).filter((pm: any) => pm.scope === 'payout' || pm.scope === 'both');
                        return (
                          <div className="rounded-lg border-2 border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/30 p-4 space-y-2">
                            <p className="text-sm text-red-700 dark:text-red-400 font-bold">
                              {t("sell.mismatch.title")}
                            </p>
                            <p className="text-xs text-red-600 dark:text-red-500">
                              {t("sell.mismatch.youSelected")} <strong>{selectedCurrency}</strong> {t("sell.mismatch2.noPmForCurrency")}
                            </p>
                            {availableMethods.length > 0 && (
                              <div className="text-xs text-red-600 dark:text-red-500">
                                <p className="font-medium">{t("sell.mismatch2.support")}</p>
                                <div className="flex flex-wrap gap-1 mt-1">
                                  {availableMethods.map((pm: any, i: number) => (
                                    <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-red-100 dark:bg-red-900/30 font-medium">
                                      {pm.currency} — {pm.label || pm.scheme}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                            <p className="text-xs text-red-600 dark:text-red-500">
                              {t("sell.mismatch2.selectAbove")}{' '}
                              <a href="/profile" className="font-medium underline">{t("sell.mismatch.updateProfile")}</a>{' '}
                              {t("sell.mismatch2.toAddPm", { currency: selectedCurrency })}
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
                                  {t("sell.pm.verified")}
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
                                {t("sell.pm.account")}
                              </span>{" "}
                              <span className="font-mono">
                                {bank.bankAccount}
                              </span>
                            </div>
                          )}
                          {bank.bankSWIFT && (
                            <div className="text-xs">
                              <span className="text-muted-foreground">
                                {t("sell.pm.swift")}
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
                  className="rounded-xl border border-border px-4 sm:px-6 py-2.5 sm:py-3 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                >
                  {t("sell.back")}
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
                  {t("sell.next")}
                </button>
              </div>
            </div>
          )}

          {/* ============ STEP 3: Enter Amount & Preview ============ */}
          {step === 3 && (
            <div className="space-y-6">
              <div className="rounded-2xl border-2 border-border bg-card p-4 sm:p-6">
                <h2 className="text-lg font-semibold text-foreground mb-4">
                  {t("sell.step3.title")}
                </h2>

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1.5">
                      {t("sell.step3.amountLabel")}
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        translate="no"
                        value={lanaAmount}
                        onChange={(e) => {
                          setLanaAmount(e.target.value);
                          setIsEmptyWallet(false);
                        }}
                        placeholder={t("sell.step3.amountPlaceholder")}
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
                          {t("sell.step3.max")}
                        </button>
                      )}
                    </div>
                    {walletBalance > 0 && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {t("sell.available")}: {walletBalance.toLocaleString()} LANA
                      </p>
                    )}
                  </div>

                  {/* Payout Breakdown */}
                  {parsedLana > 0 && exchangeRate > 0 && (
                    <div translate="no" className="rounded-xl border-2 border-primary/20 bg-primary/5 p-3 sm:p-5 space-y-3">
                      <h3 className="text-sm font-bold text-foreground uppercase tracking-wider">
                        {t("sell.breakdown.title")}
                      </h3>

                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">
                            {t("sell.breakdown.lanaAmount")}
                          </span>
                          <span className="font-mono font-bold text-foreground">
                            {parsedLana.toLocaleString()} LANA
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">
                            {t("sell.exchangeRate")}
                          </span>
                          <span className="font-mono text-foreground">
                            1 LANA = {exchangeRate} {selectedCurrency}
                          </span>
                        </div>
                        <div className="border-t border-border/50 pt-2 flex justify-between">
                          <span className="text-muted-foreground">
                            {t("sell.breakdown.grossValue")}
                          </span>
                          <span className="font-mono text-foreground">
                            {formatFiat(grossFiat, selectedCurrency)}
                          </span>
                        </div>
                        <div className="flex justify-between text-red-600">
                          <span>{t("sell.breakdown.commission")} ({COMMISSION_PERCENT}%)</span>
                          <span className="font-mono">
                            -{formatFiat(commissionFiat, selectedCurrency)}
                          </span>
                        </div>
                        <div className="border-t-2 border-primary/30 pt-2 flex justify-between">
                          <span className="font-bold text-foreground">
                            {t("sell.breakdown.yourPayout")}
                          </span>
                          <span className="font-mono font-bold text-base sm:text-lg text-primary whitespace-nowrap">
                            {formatFiat(netFiat, selectedCurrency)}{" "}
                            {selectedCurrency}
                          </span>
                        </div>
                      </div>

                      <div className="text-xs text-muted-foreground pt-1 space-y-0.5">
                        <div>
                          {t("sell.breakdown.from")}:{" "}
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
                          {t("sell.breakdown.toBuyback")}:{" "}
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
                    {t("sell.minimum.text")} <strong>{CURRENCY_SYMBOLS[selectedCurrency] || ''}{minSellFiat} {selectedCurrency}</strong>
                  </p>
                </div>
              )}

              <div className="flex justify-between">
                <button
                  onClick={() => setStep(1)}
                  className="rounded-xl border border-border px-4 sm:px-6 py-2.5 sm:py-3 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                >
                  {t("sell.back")}
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
                  {t("sell.step3.proceed")}
                </button>
              </div>
            </div>
          )}

          {/* ============ STEP 4: Confirm Transaction ============ */}
          {step === 4 && (
            <div className="space-y-6">
              <div className="rounded-2xl border-2 border-border bg-card p-4 sm:p-6">
                <h2 className="text-lg font-semibold text-foreground mb-4">
                  {t("sell.step4.title")}
                </h2>

                {/* Summary */}
                <div translate="no" className="rounded-xl bg-muted/30 p-3 sm:p-4 space-y-2 text-sm mb-6">
                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground flex-shrink-0">{t("sell.summary.fromWallet")}</span>
                    <span className="font-mono text-foreground text-xs sm:text-sm truncate">
                      {selectedWallet.slice(0, 8)}...{selectedWallet.slice(-6)}
                    </span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground flex-shrink-0">
                      {t("sell.summary.toBuyback")}
                    </span>
                    <span className="font-mono text-foreground text-xs sm:text-sm truncate">
                      {BUYBACK_WALLET.slice(0, 8)}...{BUYBACK_WALLET.slice(-6)}
                    </span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground">{t("sell.summary.amount")}</span>
                    <span className="font-mono font-bold text-foreground whitespace-nowrap">
                      {parsedLana.toLocaleString()} LANA
                    </span>
                  </div>
                  <div className="border-t border-border pt-2 flex justify-between gap-2">
                    <span className="font-bold text-foreground">
                      {t("sell.breakdown.yourPayout")}
                    </span>
                    <span className="font-mono font-bold text-primary whitespace-nowrap">
                      {formatFiat(netFiat, selectedCurrency)} {selectedCurrency}
                    </span>
                  </div>
                </div>

                {/* WIF Private Key Input */}
                <div className="space-y-3">
                  <label className="text-sm font-medium text-foreground">{t("sell.wif.label")}</label>
                  <div className="flex gap-2">
                    <input
                      type="password"
                      value={privateKey}
                      onChange={(e) => setPrivateKey(e.target.value.trim())}
                      placeholder={t("sell.wif.placeholder")}
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
                      title={t("sell.wif.scanTitle")}
                    >
                      <QrCode className="h-5 w-5" />
                    </button>
                  </div>
                  {validatingKey && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <Loader2 className="h-3 w-3 animate-spin" /> {t("sell.wif.validating")}
                    </p>
                  )}
                  {privateKeyValid === true && (
                    <p className="text-xs text-green-600 flex items-center gap-1">
                      <CheckCircle className="h-3 w-3" /> {t("sell.wif.matches")}
                    </p>
                  )}
                  {privateKeyValid === false && (
                    <p className="text-xs text-red-500 flex items-center gap-1">
                      <XCircle className="h-3 w-3" /> {t("sell.wif.noMatch")}
                    </p>
                  )}
                  {privateKeyValid === null && privateKey === '' && (
                    <p className="text-xs text-muted-foreground">
                      {t("sell.wif.notStored")}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex justify-between">
                <button
                  onClick={() => setStep(3)}
                  className="rounded-xl border border-border px-4 sm:px-6 py-2.5 sm:py-3 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                >
                  {t("sell.back")}
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
                      {t("sell.step4.sending")}
                    </span>
                  ) : (
                    t("sell.step4.confirmSend")
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
                      {t("sell.result.broadcastTitle")}
                    </h2>
                    <p className="text-muted-foreground mb-6">
                      {t("sell.result.broadcastText")}
                    </p>

                    <div translate="no" className="rounded-xl bg-white/50 dark:bg-background/50 border border-green-200 dark:border-green-800 p-4 space-y-2 text-sm text-left max-w-md mx-auto">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">
                          {t("sell.result.amountSold")}
                        </span>
                        <span className="font-mono font-bold">
                          {txResult.lanaAmount?.toLocaleString()} LANA
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">
                          {t("sell.breakdown.yourPayout")}
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
                            {t("sell.result.txHash")}
                          </span>
                          <div
                            className="font-mono text-xs text-foreground break-all mt-0.5 select-all cursor-pointer"
                            title={t("sell.result.copyTitle")}
                          >
                            {txResult.txHash}
                          </div>
                        </div>
                      )}
                      {txResult.transactionId && (
                        <div className="border-t border-green-200 dark:border-green-800 pt-2">
                          <span className="text-muted-foreground text-xs">
                            {t("sell.result.transactionId")}
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
                      {t("sell.result.failedTitle")}
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
                    {t("sell.result.sellMore")}
                  </button>
                ) : (
                  <>
                    <button
                      onClick={handleReset}
                      className="rounded-xl border border-border px-4 sm:px-6 py-2.5 sm:py-3 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {t("sell.back")}
                    </button>
                    <button
                      onClick={() => {
                        setTxResult(null);
                        setStep(4);
                      }}
                      className="rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-white hover:bg-primary/90 transition-colors"
                    >
                      {t("sell.result.tryAgain")}
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
        </>
        )}
        </>
      )}
      {/* QR Scanner — shared dialog (same component used on mobile.lanapays.us) */}
      <QRScanner
        isOpen={isScannerOpen}
        onClose={() => setIsScannerOpen(false)}
        onScan={(decoded) => {
          setPrivateKey(decoded.trim());
          toast.success(t("sell.scanner.success"));
        }}
        title={t("sell.scanner.title")}
        description={t("sell.scanner.description")}
      />
    </div>
  );
}
