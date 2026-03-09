import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Search,
  Wallet as WalletIcon,
  TrendingUp,
  Copy,
  ExternalLink,
  CreditCard,
  FileText,
  Snowflake,
  ShieldAlert,
  CheckCircle,
  XCircle,
  Loader2,
  User,
} from "lucide-react";
import { toast } from "sonner";
import { useNostrProfileCache } from "@/hooks/useNostrProfileCache";
import { useNostrUserWallets } from "@/hooks/useNostrUserWallets";
import { supabase } from "@/integrations/supabase/client";
import { useSystemParameters } from "@/contexts/SystemParametersContext";
import { useNostrProfile } from "@/hooks/useNostrProfile";
import lana8wonderBg from "@/assets/lana8wonder-bg.png";
import knightsBg from "@/assets/knights-bg.png";

/** Get human-readable freeze reason */
function getFreezeReasonLabel(freezeStatus: string): string {
  switch (freezeStatus) {
    case "frozen_l8w":
      return "Late wallet registration";
    case "frozen_max_cap":
      return "Maximum balance cap exceeded";
    case "frozen_too_wild":
      return "Irregular or suspicious activity";
    case "frozen_unreg_Lanas":
      return "Received unregistered LANA exceeding threshold";
    case "frozen":
      return "All accounts frozen by registrar";
    default:
      return "Account frozen";
  }
}

interface WalletWithBalance {
  walletId: string;
  walletType: string;
  note?: string;
  freezeStatus?: string;
  balance?: number;
  balanceLoading?: boolean;
}

export default function SearchByWallet() {
  const navigate = useNavigate();
  const { parameters } = useSystemParameters();
  const { profile: currentUserProfile } = useNostrProfile();

  // Search input
  const [walletInput, setWalletInput] = useState("");
  const checkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Wallet check state
  const [checkStatus, setCheckStatus] = useState<
    "idle" | "checking" | "registered" | "unregistered" | "error"
  >("idle");
  const [checkData, setCheckData] = useState<{
    wallet_type?: string;
    frozen?: boolean;
    nostr_hex_id?: string;
  } | null>(null);

  // Profile from nostr_hex_id
  const { profile: ownerProfile, isLoading: profileLoading } =
    useNostrProfileCache(checkData?.nostr_hex_id || null);

  // Wallets from nostr_hex_id
  const { wallets, isLoading: walletsLoading } = useNostrUserWallets(
    checkData?.nostr_hex_id || null
  );

  // Wallet balances
  const [walletsWithBalances, setWalletsWithBalances] = useState<
    WalletWithBalance[]
  >([]);

  // API call to check wallet registration
  const checkWalletRegistration = useCallback(async (walletAddress: string) => {
    setCheckStatus("checking");
    setCheckData(null);
    try {
      const API_URL = import.meta.env.VITE_API_URL ?? "";
      const res = await fetch(
        `${API_URL}/api/functions/check-wallet-registration`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ wallet_id: walletAddress }),
        }
      );
      const data = await res.json();

      if (data.registered === true) {
        setCheckStatus("registered");
        setCheckData({
          wallet_type: data.wallet?.wallet_type,
          frozen: data.wallet?.frozen,
          nostr_hex_id: data.wallet?.nostr_hex_id,
        });
      } else if (data.registered === false) {
        setCheckStatus("unregistered");
        setCheckData(null);
      } else {
        setCheckStatus("error");
        setCheckData(null);
      }
    } catch {
      setCheckStatus("error");
      setCheckData(null);
    }
  }, []);

  // Debounced auto-check when wallet input changes (600ms)
  useEffect(() => {
    if (checkTimerRef.current) clearTimeout(checkTimerRef.current);

    const trimmed = walletInput.trim();
    if (!trimmed || trimmed.length < 26 || !trimmed.startsWith("L")) {
      setCheckStatus("idle");
      setCheckData(null);
      return;
    }

    checkTimerRef.current = setTimeout(() => {
      checkWalletRegistration(trimmed);
    }, 600);

    return () => {
      if (checkTimerRef.current) clearTimeout(checkTimerRef.current);
    };
  }, [walletInput, checkWalletRegistration]);

  // Fetch balances when wallets load
  useEffect(() => {
    if (wallets.length > 0 && parameters?.electrumServers) {
      fetchBalances();
    } else {
      setWalletsWithBalances([]);
    }
  }, [wallets, parameters?.electrumServers]);

  const fetchBalances = async () => {
    if (!parameters?.electrumServers || wallets.length === 0) return;

    setWalletsWithBalances(
      wallets.map((w) => ({
        walletId: w.walletId,
        walletType: w.walletType,
        note: w.note,
        freezeStatus: w.freezeStatus,
        balanceLoading: true,
      }))
    );

    try {
      const walletAddresses = wallets.map((w) => w.walletId);

      const { data, error } = await supabase.functions.invoke(
        "get-wallet-balances",
        {
          body: {
            wallet_addresses: walletAddresses,
            electrum_servers: parameters.electrumServers,
          },
        }
      );

      if (error) {
        console.error("Error fetching balances:", error);
        setWalletsWithBalances(
          wallets.map((w) => ({
            walletId: w.walletId,
            walletType: w.walletType,
            note: w.note,
            freezeStatus: w.freezeStatus,
            balance: 0,
            balanceLoading: false,
          }))
        );
        return;
      }

      const updatedWallets = wallets.map((wallet) => {
        const balanceData = data.wallets?.find(
          (b: any) => b.wallet_id === wallet.walletId
        );
        return {
          walletId: wallet.walletId,
          walletType: wallet.walletType,
          note: wallet.note,
          freezeStatus: wallet.freezeStatus,
          balance: balanceData?.balance || 0,
          balanceLoading: false,
        };
      });

      setWalletsWithBalances(updatedWallets);
    } catch (error) {
      console.error("Error fetching balances:", error);
      setWalletsWithBalances(
        wallets.map((w) => ({
          walletId: w.walletId,
          walletType: w.walletType,
          note: w.note,
          freezeStatus: w.freezeStatus,
          balance: 0,
          balanceLoading: false,
        }))
      );
    }
  };

  const formatNumber = (num: number) => {
    return num.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  const getFiatValue = (lanaBalance: number) => {
    const currency = currentUserProfile?.currency || "USD";
    const rate =
      parameters?.exchangeRates?.[currency as "EUR" | "USD" | "GBP"] || 0;
    const fiatValue = lanaBalance * rate;
    return { value: fiatValue, currency };
  };

  const totalLana = walletsWithBalances.reduce(
    (sum, w) => sum + (w.balance || 0),
    0
  );
  const totalFiat = walletsWithBalances.reduce((sum, w) => {
    const fiat = getFiatValue(w.balance || 0);
    return sum + fiat.value;
  }, 0);

  // Sort wallets by type priority
  const walletTypeOrder: Record<string, number> = {
    "Main Wallet": 1,
    Wallet: 2,
    "LanaPays.Us": 3,
    Knights: 4,
    Lana8Wonder: 5,
  };

  const sortedWallets = [...walletsWithBalances].sort((a, b) => {
    const orderA = walletTypeOrder[a.walletType] || 99;
    const orderB = walletTypeOrder[b.walletType] || 99;
    if (orderA !== orderB) return orderA - orderB;
    if (a.walletType === "Lana8Wonder" && b.walletType === "Lana8Wonder") {
      const numA = parseInt(a.note || "") || Infinity;
      const numB = parseInt(b.note || "") || Infinity;
      return numA - numB;
    }
    return 0;
  });

  return (
    <div className="container mx-auto p-6 max-w-6xl">
      <h1 className="text-3xl font-bold mb-6">Search by Wallet</h1>

      {/* Wallet Search Input */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Search className="h-5 w-5" />
            Enter Wallet Address
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="relative">
            <WalletIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Paste a LANA wallet address (starts with L)..."
              value={walletInput}
              onChange={(e) => setWalletInput(e.target.value)}
              className="pl-10 font-mono"
            />
          </div>

          {/* Check Status Indicator */}
          {checkStatus === "checking" && (
            <div className="flex items-center gap-2 mt-3 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">Checking wallet registration...</span>
            </div>
          )}

          {checkStatus === "registered" && (
            <div className="flex items-center gap-2 mt-3 p-3 rounded-lg bg-green-500/10 border border-green-500/30">
              <CheckCircle className="h-5 w-5 text-green-500 flex-shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium text-green-700 dark:text-green-400">
                  Registered wallet
                  {checkData?.wallet_type && (
                    <span className="ml-2 text-xs bg-green-500/20 px-2 py-0.5 rounded">
                      {checkData.wallet_type}
                    </span>
                  )}
                  {checkData?.frozen && (
                    <span className="ml-2 text-xs bg-blue-500/20 text-blue-600 px-2 py-0.5 rounded inline-flex items-center gap-1">
                      <Snowflake className="h-3 w-3" />
                      Frozen
                    </span>
                  )}
                </p>
              </div>
            </div>
          )}

          {checkStatus === "unregistered" && (
            <div className="flex items-center gap-2 mt-3 p-3 rounded-lg bg-red-500/10 border border-red-500/30">
              <XCircle className="h-5 w-5 text-red-500 flex-shrink-0" />
              <p className="text-sm font-medium text-red-700 dark:text-red-400">
                This wallet is not registered
              </p>
            </div>
          )}

          {checkStatus === "error" && (
            <div className="flex items-center gap-2 mt-3 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/30">
              <ShieldAlert className="h-5 w-5 text-yellow-500 flex-shrink-0" />
              <p className="text-sm font-medium text-yellow-700 dark:text-yellow-400">
                Could not verify wallet. Please try again.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Owner Profile Card */}
      {checkStatus === "registered" && checkData?.nostr_hex_id && (
        <Card className="mb-6">
          <CardContent className="pt-6">
            {profileLoading ? (
              <div className="flex items-center gap-4">
                <Skeleton className="h-16 w-16 rounded-full" />
                <div className="flex-1">
                  <Skeleton className="h-6 w-48 mb-2" />
                  <Skeleton className="h-4 w-32" />
                </div>
              </div>
            ) : ownerProfile ? (
              <div className="space-y-4">
                <div className="flex items-center gap-4">
                  <UserAvatar
                    pubkey={checkData.nostr_hex_id}
                    picture={ownerProfile.picture}
                    name={
                      ownerProfile.display_name ||
                      ownerProfile.full_name ||
                      "Anonymous"
                    }
                    className="h-16 w-16 flex-shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <h2 className="text-2xl font-bold break-words">
                      {ownerProfile.display_name ||
                        ownerProfile.full_name ||
                        "Anonymous"}
                    </h2>
                    {ownerProfile.full_name &&
                      ownerProfile.display_name &&
                      ownerProfile.full_name !== ownerProfile.display_name && (
                        <p className="text-muted-foreground break-all">
                          @{ownerProfile.full_name}
                        </p>
                      )}
                    {ownerProfile.about && (
                      <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                        {ownerProfile.about}
                      </p>
                    )}
                  </div>
                </div>

                {/* Nostr HEX ID */}
                <div className="bg-muted/50 rounded-lg p-3">
                  <p className="text-xs text-muted-foreground mb-1">
                    Nostr HEX ID
                  </p>
                  <div className="flex items-center gap-2">
                    <p className="font-mono text-xs break-all select-all flex-1">
                      {checkData.nostr_hex_id}
                    </p>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 flex-shrink-0"
                      onClick={() => {
                        navigator.clipboard.writeText(
                          checkData.nostr_hex_id || ""
                        );
                        toast.success("Nostr HEX ID copied!");
                      }}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {/* Link to full profile */}
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() =>
                    navigate(
                      `/transparency/profiles/${checkData.nostr_hex_id}`
                    )
                  }
                >
                  <User className="h-4 w-4 mr-2" />
                  View Full Profile
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-3 text-muted-foreground">
                <User className="h-8 w-8" />
                <p>Owner profile not found on Nostr relays</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Frozen Account Warning */}
      {checkStatus === "registered" &&
        checkData?.nostr_hex_id &&
        (() => {
          const frozenWallets = walletsWithBalances.filter(
            (w) => w.freezeStatus
          );
          const allFrozen =
            walletsWithBalances.length > 0 &&
            frozenWallets.length === walletsWithBalances.length;
          const someFrozen = frozenWallets.length > 0 && !allFrozen;

          if (allFrozen) {
            const reason = frozenWallets[0]?.freezeStatus || "frozen";
            return (
              <Alert
                variant="destructive"
                className="mb-6 border-blue-500/50 bg-blue-500/10"
              >
                <Snowflake className="h-4 w-4 text-blue-500" />
                <AlertTitle className="text-blue-700 dark:text-blue-400">
                  All Accounts Frozen
                </AlertTitle>
                <AlertDescription className="text-blue-700/80 dark:text-blue-300/80">
                  All wallets for this user have been frozen.
                  <strong className="block mt-1">
                    Reason: {getFreezeReasonLabel(reason)}
                  </strong>
                  <span className="block mt-1">
                    Outgoing transactions are disabled. Receiving is still
                    allowed.
                  </span>
                </AlertDescription>
              </Alert>
            );
          }
          if (someFrozen) {
            return (
              <Alert
                variant="destructive"
                className="mb-6 border-blue-500/50 bg-blue-500/10"
              >
                <Snowflake className="h-4 w-4 text-blue-500" />
                <AlertTitle className="text-blue-700 dark:text-blue-400">
                  Some Wallets Frozen
                </AlertTitle>
                <AlertDescription className="text-blue-700/80 dark:text-blue-300/80">
                  {frozenWallets.length} of {walletsWithBalances.length} wallets{" "}
                  {frozenWallets.length === 1 ? "is" : "are"} frozen. See
                  individual wallet cards below for details.
                </AlertDescription>
              </Alert>
            );
          }
          return null;
        })()}

      {/* Wallets Section */}
      {checkStatus === "registered" && checkData?.nostr_hex_id && (
        <>
          {walletsLoading ? (
            <div className="space-y-4">
              {[1, 2].map((i) => (
                <Card key={i}>
                  <CardContent className="pt-6">
                    <Skeleton className="h-20 w-full" />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : walletsWithBalances.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <WalletIcon className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                <p className="text-muted-foreground">
                  No wallets found for this user
                </p>
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Total Summary */}
              <Card className="mb-6 bg-gradient-to-br from-primary/10 to-accent/10 border-primary/20">
                <CardContent className="pt-6">
                  <div className="flex flex-col items-center gap-2">
                    <div className="flex items-center gap-2 mb-2">
                      <WalletIcon className="h-6 w-6 text-primary" />
                      <p className="text-sm text-muted-foreground font-medium">
                        Total Balance
                      </p>
                    </div>
                    {walletsWithBalances.some((w) => w.balanceLoading) ? (
                      <Skeleton className="h-12 w-48" />
                    ) : (
                      <>
                        <p className="text-4xl font-bold text-green-600">
                          {formatNumber(totalFiat)}{" "}
                          {getFiatValue(0).currency}
                        </p>
                        <p className="text-lg text-muted-foreground">
                          ≈ {formatNumber(totalLana)} LANA
                        </p>
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Wallet Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {sortedWallets.map((wallet, index) => (
                  <Card
                    key={wallet.walletId || index}
                    className={`hover:shadow-lg transition-shadow relative overflow-hidden ${
                      wallet.freezeStatus
                        ? "border-blue-500/50 bg-blue-500/5"
                        : wallet.walletType === "Main Wallet"
                          ? "bg-green-500/10 border-green-500/30"
                          : ""
                    }`}
                    style={
                      !wallet.freezeStatus &&
                      wallet.walletType === "Lana8Wonder"
                        ? {
                            backgroundImage: `url(${lana8wonderBg})`,
                            backgroundSize: "cover",
                            backgroundPosition: "center",
                          }
                        : !wallet.freezeStatus &&
                            wallet.walletType === "Knights"
                          ? {
                              backgroundImage: `url(${knightsBg})`,
                              backgroundSize: "cover",
                              backgroundPosition: "center",
                            }
                          : undefined
                    }
                  >
                    {!wallet.freezeStatus &&
                      (wallet.walletType === "Lana8Wonder" ||
                        wallet.walletType === "Knights") && (
                        <div className="absolute inset-0 bg-background/85" />
                      )}

                    {/* Frozen overlay badge */}
                    {wallet.freezeStatus && (
                      <div className="absolute top-0 right-0 z-20 bg-blue-500 text-white text-xs font-bold px-3 py-1 rounded-bl-lg flex items-center gap-1">
                        <Snowflake className="h-3 w-3" />
                        FROZEN
                      </div>
                    )}

                    {/* Highlight searched wallet */}
                    {wallet.walletId === walletInput.trim() && (
                      <div className="absolute top-0 left-0 z-20 bg-orange-500 text-white text-xs font-bold px-3 py-1 rounded-br-lg">
                        SEARCHED
                      </div>
                    )}

                    <CardHeader className="relative z-10">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <div
                            className={`h-10 w-10 rounded-full flex items-center justify-center flex-shrink-0 ${
                              wallet.freezeStatus
                                ? "bg-blue-500/20"
                                : "bg-primary/10"
                            }`}
                          >
                            {wallet.freezeStatus ? (
                              <Snowflake className="h-5 w-5 text-blue-500" />
                            ) : (
                              <WalletIcon className="h-5 w-5 text-primary" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <CardTitle
                              className="text-base font-semibold truncate"
                              title={wallet.walletId}
                            >
                              {wallet.walletId}
                            </CardTitle>
                          </div>
                        </div>
                        <div className="flex gap-1 flex-shrink-0">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0"
                            onClick={() => {
                              navigator.clipboard.writeText(wallet.walletId);
                              toast.success("Wallet address copied!");
                            }}
                          >
                            <Copy className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0"
                            onClick={() => {
                              window.open(
                                `https://chainz.cryptoid.info/lana/address.dws?${wallet.walletId}.htm`,
                                "_blank"
                              );
                            }}
                          >
                            <ExternalLink className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3 relative z-10">
                      {/* Freeze reason banner on card */}
                      {wallet.freezeStatus && (
                        <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-500/10 border border-blue-500/30 text-sm">
                          <ShieldAlert className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" />
                          <div>
                            <p className="font-medium text-blue-700 dark:text-blue-400">
                              {getFreezeReasonLabel(wallet.freezeStatus)}
                            </p>
                            <p className="text-blue-600/70 dark:text-blue-300/70 text-xs mt-0.5">
                              Outgoing transactions disabled
                            </p>
                          </div>
                        </div>
                      )}

                      <div className="flex flex-col gap-2 p-3 rounded-lg bg-muted/50">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <TrendingUp className="h-4 w-4 text-primary" />
                            <span className="text-sm text-muted-foreground">
                              Balance:
                            </span>
                          </div>
                          {wallet.balanceLoading ? (
                            <Skeleton className="h-8 w-32" />
                          ) : (
                            <div className="flex flex-col items-end">
                              {wallet.balance && wallet.balance > 0 && (
                                <span
                                  className={`text-2xl font-bold ${wallet.freezeStatus ? "text-blue-600" : "text-green-600"}`}
                                >
                                  {formatNumber(
                                    getFiatValue(wallet.balance).value
                                  )}{" "}
                                  {getFiatValue(wallet.balance).currency}
                                </span>
                              )}
                              <span className="text-sm text-muted-foreground">
                                ≈ {formatNumber(wallet.balance || 0)} LANA
                              </span>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 text-sm">
                        <CreditCard className="h-4 w-4 text-muted-foreground" />
                        <span className="text-muted-foreground">Type:</span>
                        <span className="font-medium">{wallet.walletType}</span>
                      </div>

                      {wallet.note && (
                        <div className="flex items-start gap-2 text-sm">
                          <FileText className="h-4 w-4 text-muted-foreground mt-0.5" />
                          <div className="flex-1">
                            <span className="text-muted-foreground">Note:</span>
                            <p className="text-foreground mt-1">
                              {wallet.note}
                            </p>
                          </div>
                        </div>
                      )}

                      <Button variant="outline" size="sm" className="w-full" asChild>
                        <a
                          href={`https://chainz.cryptoid.info/lana/address.dws?${wallet.walletId}.htm`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center justify-center gap-2"
                        >
                          <ExternalLink className="h-4 w-4" />
                          Transaction History
                        </a>
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
