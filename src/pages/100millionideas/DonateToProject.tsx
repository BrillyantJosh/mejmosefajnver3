import { useParams, useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import { useNostrProjects } from "@/hooks/useNostrProjects";
import { useNostrUserWallets } from "@/hooks/useNostrUserWallets";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Wallet, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface WalletBalance {
  wallet_id: string;
  balance: number;
}

const DonateToProject = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { session } = useAuth();
  const { toast } = useToast();
  const { projects, isLoading: projectsLoading } = useNostrProjects();
  const { wallets, isLoading: walletsLoading } = useNostrUserWallets(session?.nostrHexId || null);
  
  const [selectedWalletId, setSelectedWalletId] = useState<string>("");
  const [amount, setAmount] = useState<string>("100.00");
  const [message, setMessage] = useState<string>("");
  const [walletBalances, setWalletBalances] = useState<Record<string, number>>({});
  const [loadingBalances, setLoadingBalances] = useState(false);

  const project = projects.find(p => p.id === projectId);

  useEffect(() => {
    if (wallets && wallets.length > 0) {
      const walletIds = wallets.map(w => w.walletId);
      fetchWalletBalances(walletIds);
    }
  }, [wallets]);

  const fetchWalletBalances = async (walletIds: string[]) => {
    setLoadingBalances(true);
    try {
      const { data, error } = await supabase.functions.invoke('get-wallet-balances', {
        body: { walletIds }
      });

      if (error) throw error;

      if (data?.balances) {
        const balancesMap: Record<string, number> = {};
        data.balances.forEach((b: WalletBalance) => {
          balancesMap[b.wallet_id] = b.balance;
        });
        setWalletBalances(balancesMap);
      }
    } catch (error) {
      console.error('Error fetching wallet balances:', error);
      toast({
        title: "Error",
        description: "Failed to fetch wallet balances",
        variant: "destructive"
      });
    } finally {
      setLoadingBalances(false);
    }
  };

  const formatBalance = (lanoshis: number): string => {
    return (lanoshis / 100000000).toFixed(8);
  };

  const handleDonate = async () => {
    if (!selectedWalletId || !amount || !project) {
      toast({
        title: "Missing information",
        description: "Please select a wallet and enter an amount",
        variant: "destructive"
      });
      return;
    }

    // TODO: Implement actual donation logic
    // This will involve creating a KIND 60200 event and broadcasting it
    toast({
      title: "Coming soon",
      description: "Donation functionality will be implemented soon",
    });
  };

  if (projectsLoading || walletsLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="container mx-auto p-6">
        <p className="text-center text-muted-foreground">Project not found</p>
      </div>
    );
  }

  const selectedWallet = wallets.find(w => w.walletId === selectedWalletId);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b bg-background sticky top-0 z-10">
        <div className="container mx-auto p-4">
          <Button
            variant="ghost"
            onClick={() => navigate(`/100millionideas/project/${projectId}`)}
            className="gap-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="container mx-auto p-6 max-w-2xl">
        <div className="space-y-6">
          <div>
            <h1 className="text-3xl font-bold">Donate with LANA</h1>
            <p className="text-muted-foreground mt-2">
              Support: {project.title}
            </p>
          </div>

          {/* Project Wallet (TO) */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Project Wallet (TO)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="bg-muted p-3 rounded-md">
                <p className="font-mono text-sm break-all">{project.wallet}</p>
              </div>
              <p className="text-sm text-muted-foreground mt-2">
                Funds will be sent to this wallet
              </p>
            </CardContent>
          </Card>

          {/* Your Wallet (FROM) */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Your Wallet (FROM) *</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {!wallets || wallets.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No wallets found. Please register a wallet first.
                </p>
              ) : (
                <>
                  <div>
                    <Label htmlFor="wallet-select">Select wallet</Label>
                    <Select value={selectedWalletId} onValueChange={setSelectedWalletId}>
                      <SelectTrigger id="wallet-select">
                        <SelectValue placeholder="Select wallet" />
                      </SelectTrigger>
                      <SelectContent>
                        {wallets.map((wallet) => (
                          <SelectItem key={wallet.walletId} value={wallet.walletId}>
                            <div className="flex flex-col items-start">
                              <div className="font-mono text-xs">
                                {wallet.walletId.substring(0, 10)}...{wallet.walletId.substring(wallet.walletId.length - 8)}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {wallet.walletType} {wallet.note && `- ${wallet.note.substring(0, 20)}`}
                              </div>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-sm text-muted-foreground mt-2">
                      Select the wallet to send funds from
                    </p>
                  </div>

                  {selectedWallet && (
                    <div className="bg-muted p-4 rounded-md space-y-2">
                      <div className="flex items-center gap-2">
                        <Wallet className="h-4 w-4 text-muted-foreground" />
                        <span className="font-semibold">Wallet Details</span>
                      </div>
                      <div className="space-y-1 text-sm">
                        <p>
                          <span className="text-muted-foreground">ID:</span>{' '}
                          <span className="font-mono">
                            {selectedWallet.walletId.substring(0, 10)}...{selectedWallet.walletId.substring(selectedWallet.walletId.length - 8)}
                          </span>
                        </p>
                        <p>
                          <span className="text-muted-foreground">Type:</span> {selectedWallet.walletType}
                        </p>
                        {selectedWallet.note && (
                          <p>
                            <span className="text-muted-foreground">Note:</span> {selectedWallet.note}
                          </p>
                        )}
                        <p>
                          <span className="text-muted-foreground">Balance:</span>{' '}
                          {loadingBalances ? (
                            <Loader2 className="h-3 w-3 animate-spin inline" />
                          ) : (
                            <span className="font-semibold">
                              {walletBalances[selectedWallet.walletId] !== undefined
                                ? `${formatBalance(walletBalances[selectedWallet.walletId])} LANA`
                                : 'Loading...'}
                            </span>
                          )}
                        </p>
                      </div>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          {/* Donation Amount */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Donation Amount ({project.currency}) *</CardTitle>
            </CardHeader>
            <CardContent>
              <Input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="100.00"
                step="0.01"
                min="0"
              />
            </CardContent>
          </Card>

          {/* Message */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Message (Optional)</CardTitle>
            </CardHeader>
            <CardContent>
              <Textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Leave a message for the project creator"
                rows={4}
              />
            </CardContent>
          </Card>

          {/* Donate Button */}
          <Button
            onClick={handleDonate}
            disabled={!selectedWalletId || !amount || loadingBalances}
            className="w-full bg-green-500 hover:bg-green-600 text-white h-12"
          >
            Donate {amount} {project.currency}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default DonateToProject;
