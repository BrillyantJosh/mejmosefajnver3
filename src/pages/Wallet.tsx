import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Wallet as WalletIcon, CreditCard, FileText, ExternalLink, TrendingUp, Copy, QrCode, Snowflake, ShieldAlert } from "lucide-react";
import { useNostrWallets } from "@/hooks/useNostrWallets";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useSystemParameters } from "@/contexts/SystemParametersContext";
import { useNostrProfile } from "@/hooks/useNostrProfile";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import QRCode from "react-qr-code";
import lana8wonderBg from "@/assets/lana8wonder-bg.png";
import knightsBg from "@/assets/knights-bg.png";
import { UnregisteredLanaAlert } from "@/components/wallet/UnregisteredLanaAlert";
import { useUnregisteredLana } from "@/hooks/useUnregisteredLana";
import { useWarningBeforeSplit } from "@/hooks/useWarningBeforeSplit";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle } from "lucide-react";

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

interface WalletWithBalance {
  walletId: string;
  walletType: string;
  note?: string;
  amountUnregistered?: string;
  eventId?: string;
  createdAt?: number;
  registrarPubkey?: string;
  status?: string;
  freezeStatus?: string;
  balance?: number;
  balanceLoading?: boolean;
}

export default function Wallet() {
  const { wallets, isLoading } = useNostrWallets();
  const { parameters, refetch: refetchParameters } = useSystemParameters();
  const { profile } = useNostrProfile();
  const { records: unregRecords, count: unregCount } = useUnregisteredLana();
  const splitWarning = useWarningBeforeSplit();
  const [walletsWithBalances, setWalletsWithBalances] = useState<WalletWithBalance[]>([]);
  const [qrDialogOpen, setQrDialogOpen] = useState(false);
  const [selectedWalletForQr, setSelectedWalletForQr] = useState<string>("");

  // Refresh system parameters when wallet page loads
  useEffect(() => {
    refetchParameters();
  }, []);

  useEffect(() => {
    if (wallets.length > 0 && parameters?.electrumServers) {
      fetchBalances();
    }
  }, [wallets, parameters?.electrumServers]);

  const fetchBalances = async () => {
    if (!parameters?.electrumServers || wallets.length === 0) return;

    // Set loading state
    setWalletsWithBalances(wallets.map(w => ({ ...w, balanceLoading: true })));

    try {
      const walletAddresses = wallets.map(w => w.walletId);
      
      const { data, error } = await supabase.functions.invoke('get-wallet-balances', {
        body: {
          wallet_addresses: walletAddresses,
          electrum_servers: parameters.electrumServers,
        },
      });

      if (error) {
        console.error('Error fetching balances:', error);
        setWalletsWithBalances(wallets.map(w => ({ ...w, balance: 0, balanceLoading: false })));
        return;
      }

      // Map balances to wallets
      const updatedWallets = wallets.map(wallet => {
        const balanceData = data.wallets?.find((b: any) => b.wallet_id === wallet.walletId);
        return {
          ...wallet,
          balance: balanceData?.balance || 0,
          balanceLoading: false,
        };
      });

      setWalletsWithBalances(updatedWallets);
    } catch (error) {
      console.error('Error fetching balances:', error);
      setWalletsWithBalances(wallets.map(w => ({ ...w, balance: 0, balanceLoading: false })));
    }
  };

  const formatNumber = (num: number) => {
    return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const getFiatValue = (lanaBalance: number) => {
    const currency = profile?.currency || 'USD';
    const rate = parameters?.exchangeRates?.[currency as 'EUR' | 'USD' | 'GBP'] || 0;
    const fiatValue = lanaBalance * rate;
    return { value: fiatValue, currency };
  };

  // Sort wallets by type priority
  const walletTypeOrder: Record<string, number> = {
    "Main Wallet": 1,
    "Wallet": 2,
    "LanaPays.Us": 3,
    "Knights": 4,
    "Lana8Wonder": 5,
    "Lana.Discount": 6,
  };

  const sortedWallets = [...walletsWithBalances].sort((a, b) => {
    const orderA = walletTypeOrder[a.walletType] || 99;
    const orderB = walletTypeOrder[b.walletType] || 99;
    if (orderA !== orderB) return orderA - orderB;
    // Sub-sort Lana8Wonder by numeric note (1, 2, 3...)
    if (a.walletType === 'Lana8Wonder' && b.walletType === 'Lana8Wonder') {
      const numA = parseInt(a.note || '') || Infinity;
      const numB = parseInt(b.note || '') || Infinity;
      return numA - numB;
    }
    return 0;
  });

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">My Wallets</h1>
          <p className="text-muted-foreground">Manage your registered wallets</p>
        </div>
        <Button onClick={() => window.location.href = '/wallet/register'}>
          Register New Wallet
        </Button>
      </div>

      {/* Unregistered LANA Warning */}
      {unregCount > 0 && (
        <UnregisteredLanaAlert records={unregRecords} count={unregCount} />
      )}

      {/* Frozen Account Warning */}
      {(() => {
        const frozenWallets = wallets.filter(w => w.freezeStatus);
        const allFrozen = wallets.length > 0 && frozenWallets.length === wallets.length;
        const someFrozen = frozenWallets.length > 0 && !allFrozen;

        if (allFrozen) {
          const reason = frozenWallets[0]?.freezeStatus || 'frozen';
          return (
            <Alert variant="destructive" className="mb-6 border-blue-500/50 bg-blue-500/10">
              <Snowflake className="h-4 w-4 text-blue-500" />
              <AlertTitle className="text-blue-700 dark:text-blue-400">All Accounts Frozen</AlertTitle>
              <AlertDescription className="text-blue-700/80 dark:text-blue-300/80">
                All your wallets have been frozen by the registrar.
                <strong className="block mt-1">Reason: {getFreezeReasonLabel(reason)}</strong>
                <span className="block mt-1">
                  You can still receive funds, but all outgoing transactions are disabled.
                  Contact your registrar to resolve this issue.
                </span>
              </AlertDescription>
            </Alert>
          );
        }
        if (someFrozen) {
          return (
            <Alert variant="destructive" className="mb-6 border-blue-500/50 bg-blue-500/10">
              <Snowflake className="h-4 w-4 text-blue-500" />
              <AlertTitle className="text-blue-700 dark:text-blue-400">Some Wallets Frozen</AlertTitle>
              <AlertDescription className="text-blue-700/80 dark:text-blue-300/80">
                {frozenWallets.length} of your {wallets.length} wallets {frozenWallets.length === 1 ? 'has' : 'have'} been frozen.
                Frozen wallets can still receive funds, but outgoing transactions are disabled.
                See each wallet card below for details.
              </AlertDescription>
            </Alert>
          );
        }
        return null;
      })()}

      {/* Warning Before SPLIT */}
      {splitWarning.exceeded && (
        <Alert variant="destructive" className="mb-6">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Maximum Wallet Balance Exceeded</AlertTitle>
          <AlertDescription>
            Your combined balance across Wallet, Main Wallet, and Lana.Discount wallets is{' '}
            <strong>{splitWarning.totalBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} LANA</strong>,
            which exceeds the maximum allowed balance of{' '}
            <strong>{splitWarning.limit.toLocaleString()} LANA</strong>.
            You must reduce your balance before the next SPLIT to avoid your account being frozen.
            Transfer or spend your LANA to bring your balance below the limit.
          </AlertDescription>
        </Alert>
      )}

      {/* Total Balance Summary */}
      {!isLoading && walletsWithBalances.length > 0 && (
        <Card className="mb-6 bg-gradient-to-br from-primary/10 to-accent/10 border-primary/20">
          <CardContent className="pt-6">
            <div className="flex flex-col items-center gap-2">
              <div className="flex items-center gap-2 mb-2">
                <WalletIcon className="h-6 w-6 text-primary" />
                <p className="text-sm text-muted-foreground font-medium">Total Balance</p>
              </div>
              {walletsWithBalances.some(w => w.balanceLoading) ? (
                <Skeleton className="h-12 w-48" />
              ) : (
                <>
                  <p className="text-4xl font-bold text-green-600">
                    {formatNumber(
                      walletsWithBalances.reduce((sum, w) => {
                        const fiat = getFiatValue(w.balance || 0);
                        return sum + fiat.value;
                      }, 0)
                    )}{' '}
                    {getFiatValue(0).currency}
                  </p>
                  <p className="text-lg text-muted-foreground">
                    ≈ {formatNumber(
                      walletsWithBalances.reduce((sum, w) => sum + (w.balance || 0), 0)
                    )}{' '}
                    LANA
                  </p>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-6 w-3/4 mb-2" />
                <Skeleton className="h-4 w-1/2" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-4 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : walletsWithBalances.length === 0 ? (
        <Card className="p-12 text-center">
          <div className="flex flex-col items-center gap-4">
            <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center">
              <WalletIcon className="h-8 w-8 text-muted-foreground" />
            </div>
            <div>
              <h3 className="text-lg font-semibold mb-2">No Wallets Found</h3>
              <p className="text-muted-foreground">
                You don't have any registered wallets yet.
              </p>
            </div>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {sortedWallets.map((wallet) => (
            <Card
              key={wallet.eventId || wallet.walletId}
              className={`hover:shadow-lg transition-shadow relative overflow-hidden ${
                wallet.freezeStatus
                  ? "border-blue-500/50 bg-blue-500/5"
                  : wallet.walletType === "Main Wallet" ? "bg-green-500/10 border-green-500/30" : ""
              }`}
              style={!wallet.freezeStatus && wallet.walletType === "Lana8Wonder" ? {
                backgroundImage: `url(${lana8wonderBg})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
              } : !wallet.freezeStatus && wallet.walletType === "Knights" ? {
                backgroundImage: `url(${knightsBg})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
              } : undefined}
            >
              {!wallet.freezeStatus && (wallet.walletType === "Lana8Wonder" || wallet.walletType === "Knights") && (
                <div className="absolute inset-0 bg-background/85" />
              )}

              {/* Frozen overlay badge */}
              {wallet.freezeStatus && (
                <div className="absolute top-0 right-0 z-20 bg-blue-500 text-white text-xs font-bold px-3 py-1 rounded-bl-lg flex items-center gap-1">
                  <Snowflake className="h-3 w-3" />
                  FROZEN
                </div>
              )}

              {/* CLEAR overlay badge — wallet needs to be reduced before SPLIT */}
              {splitWarning.exceeded && !wallet.freezeStatus && ['Wallet', 'Main Wallet', 'Lana.Discount'].includes(wallet.walletType) && (wallet.balance || 0) > 0 && (
                <div className="absolute top-0 right-0 z-20 bg-red-500 text-white text-xs font-bold px-3 py-1 rounded-bl-lg flex items-center gap-1 animate-pulse">
                  <AlertTriangle className="h-3 w-3" />
                  CLEAR
                </div>
              )}

              <CardHeader className="relative z-10">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <div className={`h-10 w-10 rounded-full flex items-center justify-center flex-shrink-0 ${
                      wallet.freezeStatus ? "bg-blue-500/20" : "bg-primary/10"
                    }`}>
                      {wallet.freezeStatus
                        ? <Snowflake className="h-5 w-5 text-blue-500" />
                        : <WalletIcon className="h-5 w-5 text-primary" />
                      }
                    </div>
                    <div className="flex-1 min-w-0">
                      <CardTitle className="text-base font-semibold truncate" title={wallet.walletId}>
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
                        setSelectedWalletForQr(wallet.walletId);
                        setQrDialogOpen(true);
                      }}
                    >
                      <QrCode className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0"
                      onClick={() => {
                        navigator.clipboard.writeText(wallet.walletId);
                        toast.success("Wallet ID copied to clipboard");
                      }}
                    >
                      <Copy className="h-4 w-4" />
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
                        Outgoing transactions disabled. Receiving is still allowed.
                      </p>
                    </div>
                  </div>
                )}

                <div className="flex flex-col gap-2 p-3 rounded-lg bg-muted/50">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <TrendingUp className="h-4 w-4 text-primary" />
                      <span className="text-sm text-muted-foreground">Balance:</span>
                    </div>
                    {wallet.balanceLoading ? (
                      <Skeleton className="h-8 w-32" />
                    ) : (
                      <div className="flex flex-col items-end">
                        {wallet.balance && wallet.balance > 0 && (
                          <span className={`text-2xl font-bold ${wallet.freezeStatus ? 'text-blue-600' : 'text-green-600'}`}>
                            {formatNumber(getFiatValue(wallet.balance).value)} {getFiatValue(wallet.balance).currency}
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
                      <p className="text-foreground mt-1">{wallet.note}</p>
                    </div>
                  </div>
                )}

                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  asChild
                >
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

                {wallet.walletType !== "Lana8Wonder" && wallet.walletType !== "Knights" && !wallet.freezeStatus && (
                  <Button
                    size="sm"
                    className="w-full"
                    onClick={() => window.location.href = `/send-lana?walletId=${wallet.walletId}&balance=${wallet.balance || 0}`}
                  >
                    Send
                  </Button>
                )}

                {wallet.freezeStatus && wallet.walletType !== "Lana8Wonder" && wallet.walletType !== "Knights" && (
                  <Button
                    size="sm"
                    className="w-full"
                    variant="outline"
                    disabled
                  >
                    <Snowflake className="h-4 w-4 mr-2" />
                    Sending Disabled — Wallet Frozen
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* QR Code Dialog */}
      <Dialog open={qrDialogOpen} onOpenChange={setQrDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Wallet QR Code</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col items-center gap-4 py-4">
            <div className="bg-white p-4 rounded-lg">
              <QRCode
                value={selectedWalletForQr}
                size={256}
                level="H"
              />
            </div>
            <div className="text-center space-y-2 w-full">
              <p className="text-sm text-muted-foreground">Wallet Address</p>
              <p className="font-mono text-xs break-all px-4">{selectedWalletForQr}</p>
            </div>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                navigator.clipboard.writeText(selectedWalletForQr);
                toast.success("Wallet address copied to clipboard");
              }}
            >
              <Copy className="h-4 w-4 mr-2" />
              Copy Address
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
