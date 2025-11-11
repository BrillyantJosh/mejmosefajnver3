import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Wallet as WalletIcon, CreditCard, FileText, ExternalLink, TrendingUp, Copy, QrCode } from "lucide-react";
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

interface WalletWithBalance {
  walletId: string;
  walletType: string;
  note?: string;
  amountUnregistered?: string;
  eventId?: string;
  createdAt?: number;
  registrarPubkey?: string;
  status?: string;
  balance?: number;
  balanceLoading?: boolean;
}

export default function Wallet() {
  const { wallets, isLoading } = useNostrWallets();
  const { parameters, refetch: refetchParameters } = useSystemParameters();
  const { profile } = useNostrProfile();
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
          {walletsWithBalances.map((wallet) => (
            <Card 
              key={wallet.eventId || wallet.walletId} 
              className="hover:shadow-lg transition-shadow"
            >
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <WalletIcon className="h-5 w-5 text-primary" />
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
              <CardContent className="space-y-3">
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
                          <span className="text-2xl font-bold text-green-600">
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

                <Button
                  size="sm"
                  className="w-full"
                  onClick={() => window.location.href = `/send-lana?walletId=${wallet.walletId}&balance=${wallet.balance || 0}`}
                >
                  Send
                </Button>
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
