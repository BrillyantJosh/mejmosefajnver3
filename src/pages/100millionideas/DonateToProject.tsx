import { useParams, useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import { useNostrProjects } from "@/hooks/useNostrProjects";
import { useNostrUserWallets } from "@/hooks/useNostrUserWallets";
import { useAuth } from "@/contexts/AuthContext";
import { useSystemParameters } from "@/contexts/SystemParametersContext";
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
  const { parameters } = useSystemParameters();
  const { projects, isLoading: projectsLoading } = useNostrProjects();
  const { wallets, isLoading: walletsLoading } = useNostrUserWallets(session?.nostrHexId || null);
  
  const [selectedWalletId, setSelectedWalletId] = useState<string>("");
  const [amount, setAmount] = useState<string>("0");
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
      const electrumServers = parameters?.electrumServers || [];
      
      if (electrumServers.length === 0) {
        console.error('No Electrum servers available');
        toast({
          title: "Error",
          description: "No Electrum servers configured",
          variant: "destructive"
        });
        return;
      }

      const { data, error } = await supabase.functions.invoke('get-wallet-balances', {
        body: { 
          wallet_addresses: walletIds,
          electrum_servers: electrumServers
        }
      });

      if (error) throw error;

      if (data?.wallets) {
        const balancesMap: Record<string, number> = {};
        data.wallets.forEach((w: WalletBalance) => {
          balancesMap[w.wallet_id] = w.balance;
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

  const formatBalance = (balance: number): string => {
    return balance.toFixed(2);
  };

  // Calculate LANA amount from EUR using exchange rate
  const calculateLanaAmount = (): number => {
    const eurAmount = parseFloat(amount) || 0;
    if (eurAmount === 0 || !project) return 0;
    
    // Get exchange rate from system parameters
    const exchangeRate = parameters?.exchangeRates?.EUR || 0;
    if (exchangeRate === 0) return 0;
    
    // Formula: EUR / exchangeRate = LANA
    return eurAmount / exchangeRate;
  };

  const lanaAmount = calculateLanaAmount();
  const selectedWalletBalance = selectedWalletId && walletBalances[selectedWalletId] 
    ? walletBalances[selectedWalletId] 
    : 0;
  
  const hasSufficientBalance = lanaAmount > 0 && selectedWalletBalance >= lanaAmount;
  const canDonate = selectedWalletId && amount && parseFloat(amount) > 0 && hasSufficientBalance && !loadingBalances;

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
            <CardContent className="space-y-4">
              <div>
                <Input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0"
                  step="0.01"
                  min="0"
                />
              </div>
              
              {/* LANA Amount Display */}
              {parseFloat(amount) > 0 && (
                <div className="bg-muted p-4 rounded-md space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Amount in LANA:</span>
                    <span className="text-lg font-bold">
                      {lanaAmount.toFixed(2)} LANA
                    </span>
                  </div>
                  {parameters?.exchangeRates?.EUR && (
                    <p className="text-xs text-muted-foreground">
                      Exchange rate: 1 LANA = {parameters.exchangeRates.EUR.toFixed(6)} {project.currency}
                    </p>
                  )}
                  
                  {/* Balance Check */}
                  {selectedWalletId && (
                    <div className="pt-2 border-t">
                      {hasSufficientBalance ? (
                        <p className="text-sm text-green-500 flex items-center gap-2">
                          ✓ Sufficient balance available
                        </p>
                      ) : (
                        <p className="text-sm text-destructive flex items-center gap-2">
                          ✗ Insufficient balance (Available: {selectedWalletBalance.toFixed(2)} LANA)
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
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
            disabled={!canDonate}
            className="w-full bg-green-500 hover:bg-green-600 text-white h-12 disabled:opacity-50 disabled:cursor-not-allowed"
            title={!hasSufficientBalance && selectedWalletId && parseFloat(amount) > 0 ? "Insufficient balance" : ""}
          >
            {parseFloat(amount) > 0 
              ? `Donate ${amount} ${project.currency} (${lanaAmount.toFixed(2)} LANA)`
              : `Donate`
            }
          </Button>
          
          {!selectedWalletId && (
            <p className="text-sm text-center text-muted-foreground">
              Please select a wallet to continue
            </p>
          )}
          {selectedWalletId && parseFloat(amount) === 0 && (
            <p className="text-sm text-center text-muted-foreground">
              Please enter an amount to donate
            </p>
          )}
          {!hasSufficientBalance && selectedWalletId && parseFloat(amount) > 0 && (
            <p className="text-sm text-center text-destructive">
              Insufficient balance in selected wallet
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default DonateToProject;
