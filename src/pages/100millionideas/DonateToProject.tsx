import { useParams, useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import { useLanacrowdProject } from "@/hooks/useLanacrowdProject";
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
import millionideasTranslations from "@/i18n/modules/millionideas";
import { useTranslation } from "@/i18n/I18nContext";

interface WalletBalance {
  wallet_id: string;
  balance: number;
}

const DonateToProject = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { session } = useAuth();
  const { toast } = useToast();
  const { t } = useTranslation(millionideasTranslations);
  const { parameters } = useSystemParameters();
  const { project, isLoading: projectsLoading } = useLanacrowdProject(projectId);
  const { wallets, isLoading: walletsLoading } = useNostrUserWallets(session?.nostrHexId || null);
  
  const [selectedWalletId, setSelectedWalletId] = useState<string>("");
  const [lanaAmount, setLanaAmount] = useState<string>("0");
  const [message, setMessage] = useState<string>("");
  const [walletBalances, setWalletBalances] = useState<Record<string, number>>({});
  const [loadingBalances, setLoadingBalances] = useState(false);

  // project comes directly from useLanacrowdProject above

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
          title: t("donate.errorTitle"),
          description: t("donate.noElectrum"),
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
        title: t("donate.errorTitle"),
        description: t("donate.fetchBalancesFailed"),
        variant: "destructive"
      });
    } finally {
      setLoadingBalances(false);
    }
  };

  const formatBalance = (balance: number): string => {
    return balance.toFixed(2);
  };

  // Calculate fiat amount from LANA using exchange rate
  const calculateFiatAmount = (): number => {
    const lana = parseFloat(lanaAmount) || 0;
    if (lana === 0 || !project) return 0;
    
    // Get exchange rate from system parameters based on project currency
    const currency = project.currency || 'EUR';
    const exchangeRate = parameters?.exchangeRates?.[currency] || parameters?.exchangeRates?.EUR || 0;
    if (exchangeRate === 0) return 0;
    
    // Formula: LANA * exchangeRate = fiat
    return lana * exchangeRate;
  };

  const fiatAmount = calculateFiatAmount();
  const parsedLanaAmount = parseFloat(lanaAmount) || 0;
  const selectedWalletBalance = selectedWalletId && walletBalances[selectedWalletId] 
    ? walletBalances[selectedWalletId] 
    : 0;
  
  const hasSufficientBalance = parsedLanaAmount > 0 && selectedWalletBalance >= parsedLanaAmount;
  const canDonate = selectedWalletId && lanaAmount && parsedLanaAmount > 0 && hasSufficientBalance && !loadingBalances;

  const handleDonate = async () => {
    if (!selectedWalletId || !lanaAmount || !project) {
      toast({
        title: t("donate.missingInfoTitle"),
        description: t("donate.missingInfoDesc"),
        variant: "destructive"
      });
      return;
    }

    // Navigate to private key entry page
    navigate(`/100millionideas/donate-private-key/${projectId}`, {
      state: {
        selectedWalletId,
        amount: fiatAmount.toFixed(2),
        lanaAmount: parsedLanaAmount,
        message
      }
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
        <p className="text-center text-muted-foreground">{t("donate.projectNotFound")}</p>
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
            {t("donate.back")}
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="container mx-auto p-6 max-w-2xl">
        <div className="space-y-6">
          <div>
            <h1 className="text-3xl font-bold">{t("donate.title")}</h1>
            <p className="text-muted-foreground mt-2">
              {t("donate.support", { title: project.title })}
            </p>
          </div>

          {/* Project Wallet (TO) */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">{t("donate.projectWalletTo")}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="bg-muted p-3 rounded-md">
                <p className="font-mono text-sm break-all">{project.wallet}</p>
              </div>
              <p className="text-sm text-muted-foreground mt-2">
                {t("donate.fundsSentHere")}
              </p>
            </CardContent>
          </Card>

          {/* Your Wallet (FROM) */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">{t("donate.yourWalletFrom")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {!wallets || wallets.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t("donate.noWallets")}
                </p>
              ) : (
                <>
                  <div>
                    <Label htmlFor="wallet-select">{t("donate.selectWallet")}</Label>
                    <Select value={selectedWalletId} onValueChange={setSelectedWalletId}>
                      <SelectTrigger id="wallet-select">
                        <SelectValue placeholder={t("donate.selectWallet")} />
                      </SelectTrigger>
                      <SelectContent>
                        {wallets
                          .filter(wallet => wallet.walletType !== 'Lana8Wonder')
                          .map((wallet) => (
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
                      {t("donate.selectWalletHint")}
                    </p>
                  </div>

                  {selectedWallet && (
                    <div className="bg-muted p-4 rounded-md space-y-2">
                      <div className="flex items-center gap-2">
                        <Wallet className="h-4 w-4 text-muted-foreground" />
                        <span className="font-semibold">{t("donate.walletDetails")}</span>
                      </div>
                      <div className="space-y-1 text-sm">
                        <p>
                          <span className="text-muted-foreground">{t("donate.idLabel")}</span>{' '}
                          <span className="font-mono">
                            {selectedWallet.walletId.substring(0, 10)}...{selectedWallet.walletId.substring(selectedWallet.walletId.length - 8)}
                          </span>
                        </p>
                        <p>
                          <span className="text-muted-foreground">{t("donate.typeLabel")}</span> {selectedWallet.walletType}
                        </p>
                        {selectedWallet.note && (
                          <p>
                            <span className="text-muted-foreground">{t("donate.noteLabel")}</span> {selectedWallet.note}
                          </p>
                        )}
                        <p>
                          <span className="text-muted-foreground">{t("donate.balanceLabel")}</span>{' '}
                          {loadingBalances ? (
                            <Loader2 className="h-3 w-3 animate-spin inline" />
                          ) : (
                            <span className="font-semibold">
                              {walletBalances[selectedWallet.walletId] !== undefined
                                ? `${formatBalance(walletBalances[selectedWallet.walletId])} LANA`
                                : t("donate.loading")}
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
              <CardTitle className="text-lg">{t("donate.donationAmount")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Input
                  type="number"
                  value={lanaAmount}
                  onChange={(e) => setLanaAmount(e.target.value)}
                  placeholder="0"
                  step="0.01"
                  min="0"
                />
              </div>
              
              {/* Fiat Amount Display */}
              {parsedLanaAmount > 0 && (
                <div className="bg-muted p-4 rounded-md space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">{t("donate.amountIn", { currency: project.currency || 'EUR' })}</span>
                    <span className="text-lg font-bold">
                      {fiatAmount.toFixed(2)} {project.currency}
                    </span>
                  </div>
                  {parameters?.exchangeRates?.[project.currency || 'EUR'] && (
                    <p className="text-xs text-muted-foreground">
                      {t("donate.exchangeRate", { rate: (parameters.exchangeRates[project.currency || 'EUR'] || parameters.exchangeRates.EUR || 0).toFixed(6), currency: project.currency || 'EUR' })}
                    </p>
                  )}
                  
                  {/* Balance Check */}
                  {selectedWalletId && (
                    <div className="pt-2 border-t">
                      {hasSufficientBalance ? (
                        <p className="text-sm text-green-500 flex items-center gap-2">
                          {t("donate.sufficientBalance")}
                        </p>
                      ) : (
                        <p className="text-sm text-destructive flex items-center gap-2">
                          {t("donate.insufficientAvailable", { amount: selectedWalletBalance.toFixed(2) })}
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
              <CardTitle className="text-lg">{t("donate.messageOptional")}</CardTitle>
            </CardHeader>
            <CardContent>
              <Textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={t("donate.messagePlaceholder")}
                rows={4}
              />
            </CardContent>
          </Card>

          {/* Donate Button */}
          <Button
            onClick={handleDonate}
            disabled={!canDonate}
            className="w-full bg-green-500 hover:bg-green-600 text-white h-12 disabled:opacity-50 disabled:cursor-not-allowed"
            title={!hasSufficientBalance && selectedWalletId && parsedLanaAmount > 0 ? t("donate.insufficientTitle") : ""}
          >
            {parsedLanaAmount > 0
              ? t("donate.donateAmount", { lana: parsedLanaAmount.toFixed(2), fiat: fiatAmount.toFixed(2), currency: project.currency || 'EUR' })
              : t("donate.donateBtn")
            }
          </Button>
          
          {!selectedWalletId && (
            <p className="text-sm text-center text-muted-foreground">
              {t("donate.pleaseSelectWallet")}
            </p>
          )}
          {selectedWalletId && parsedLanaAmount === 0 && (
            <p className="text-sm text-center text-muted-foreground">
              {t("donate.pleaseEnterAmount")}
            </p>
          )}
          {!hasSufficientBalance && selectedWalletId && parsedLanaAmount > 0 && (
            <p className="text-sm text-center text-destructive">
              {t("donate.insufficientInWallet")}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default DonateToProject;
