import { useState, useMemo, useCallback, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useNostrDonationProposals } from "@/hooks/useNostrDonationProposals";
import { useNostrUserWallets } from "@/hooks/useNostrUserWallets";
import { useWalletBalances } from "@/hooks/useWalletBalances";
import { useAuth } from "@/contexts/AuthContext";
import { useNostrProfilesCacheBulk } from "@/hooks/useNostrProfilesCacheBulk";
import { fiatToLana, lanaToFiat, getUserCurrency, formatCurrency, formatLana, lanaToLanoshi } from "@/lib/currencyConversion";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { Calendar, ExternalLink, Wallet, TrendingUp } from "lucide-react";
import { format } from "date-fns";
import { useNostrPaymentScore } from "@/hooks/useNostrPaymentScore";

interface DonationSelection {
  proposalId: string;
  amount: number; // in LANA
}

export default function Pending() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const { proposals, isLoading: proposalsLoading } = useNostrDonationProposals(session?.nostrHexId);
  const { wallets, isLoading: walletsLoading } = useNostrUserWallets(session?.nostrHexId || null);
  const { score, isLoading: scoreLoading } = useNostrPaymentScore(session?.nostrHexId);

  const [selectedProposals, setSelectedProposals] = useState<Set<string>>(new Set());
  const [customAmounts, setCustomAmounts] = useState<{ [key: string]: string }>({});
  const [selectedWallet, setSelectedWallet] = useState<string>("");
  const userCurrency = getUserCurrency();

  // Cleanup old sessionStorage key
  useEffect(() => {
    sessionStorage.removeItem('pendingDonationPayment');
  }, []);

  // Fetch wallet balances
  const walletAddresses = useMemo(() => wallets.map(w => w.walletId), [wallets]);
  const { balances, isLoading: balancesLoading } = useWalletBalances(walletAddresses);

  // Server already matches proposals with confirmations (KIND 90901) and sets isPaid
  const pendingProposals = useMemo(() =>
    proposals.filter(p => !p.isPaid && p.payerPubkey === session?.nostrHexId),
    [proposals, session?.nostrHexId]
  );

  // Fetch profiles for all recipient pubkeys
  const recipientPubkeys = useMemo(() => 
    Array.from(new Set(pendingProposals.map(p => p.recipientPubkey))),
    [pendingProposals]
  );
  const { profiles: recipientProfiles } = useNostrProfilesCacheBulk(recipientPubkeys);

  // Calculate total amount
  const totalLana = Array.from(selectedProposals).reduce((sum, proposalId) => {
    const proposal = pendingProposals.find(p => p.eventId === proposalId);
    if (!proposal) return sum;
    
    const customAmount = customAmounts[proposalId];
    if (customAmount !== undefined) {
      const parsed = parseFloat(customAmount);
      return sum + (isNaN(parsed) ? 0 : parsed);
    }
    
    // Calculate from fiat to LANA
    const originalAmount = fiatToLana(parseFloat(proposal.fiatAmount), proposal.fiatCurrency);
    return sum + originalAmount;
  }, 0);

  const totalInUserCurrency = formatCurrency(lanaToFiat(totalLana, userCurrency), userCurrency);

  // Get selected wallet balance
  const selectedWalletBalance = selectedWallet ? (balances.get(selectedWallet) || 0) : 0;
  const remainingBalance = selectedWalletBalance - totalLana;

  const handleToggleProposal = useCallback((proposalId: string) => {
    const newSet = new Set(selectedProposals);
    if (newSet.has(proposalId)) {
      newSet.delete(proposalId);
      const newAmounts = { ...customAmounts };
      delete newAmounts[proposalId];
      setCustomAmounts(newAmounts);
    } else {
      newSet.add(proposalId);
    }
    setSelectedProposals(newSet);
  }, [selectedProposals, customAmounts]);

  const handleAmountChange = useCallback((proposalId: string, value: string) => {
    setCustomAmounts(prev => ({ ...prev, [proposalId]: value }));
  }, []);

  const handleProceedToPayment = () => {
    if (selectedProposals.size === 0) {
      toast.error("Please select at least one payment");
      return;
    }
    
    if (!selectedWallet) {
      toast.error("Please select a wallet to pay from");
      return;
    }

    // Validate that all selected proposals have valid amounts > 0
    for (const id of selectedProposals) {
      const customAmount = customAmounts[id];
      if (customAmount !== undefined) {
        const parsed = parseFloat(customAmount);
        if (isNaN(parsed) || parsed <= 0) {
          toast.error("Please enter a valid amount greater than 0 for all selected payments");
          return;
        }
      }
    }

    // Store payment details in session storage
    const paymentData = {
      selectedProposals: Array.from(selectedProposals).map(id => {
        const proposal = pendingProposals.find(p => p.eventId === id);
        const customAmount = customAmounts[id];
        const lanaAmount = customAmount !== undefined ? parseFloat(customAmount) : fiatToLana(parseFloat(proposal!.fiatAmount), proposal!.fiatCurrency);
        
        return {
          proposalId: id,
          proposalDTag: proposal!.d,
          recipientWallet: proposal!.wallet,
          recipientPubkey: proposal!.recipientPubkey,
          lanaAmount,
          lanoshiAmount: lanaToLanoshi(lanaAmount),
          service: proposal!.service
        };
      }),
      senderWallet: selectedWallet,
      totalLana
    };

    sessionStorage.setItem('pendingUnconditionalPayment', JSON.stringify(paymentData));
    
    // Navigate to payment confirmation page
    navigate('/unconditional-payment/confirm-payment');
  };

  if ((proposalsLoading && proposals.length === 0) || walletsLoading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map(i => (
          <Card key={i}>
            <CardContent className="p-6">
              <Skeleton className="h-24 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (pendingProposals.length === 0) {
    return (
      <Card>
        <CardContent className="p-12 text-center">
          <p className="text-muted-foreground">No pending payment proposals at the moment.</p>
        </CardContent>
      </Card>
    );
  }

  const scoreNum = score ? parseFloat(score.score) : 0;
  const getScoreColor = (s: number) => s >= 7 ? 'text-green-600 dark:text-green-400' : s >= 5 ? 'text-yellow-600 dark:text-yellow-400' : 'text-red-600 dark:text-red-400';
  const getScoreBg = (s: number) => s >= 7 ? 'bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800' : s >= 5 ? 'bg-yellow-50 dark:bg-yellow-950/30 border-yellow-200 dark:border-yellow-800' : 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800';
  const formatLanoshi = (l: string) => { const v = parseInt(l, 10); return isNaN(v) ? l : (v / 100_000_000).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' LANA'; };
  const formatPeriod = (start: string, end: string) => {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const fmt = (ym: string) => { const [y, m] = ym.split('-'); return `${months[parseInt(m, 10) - 1] || m} ${y}`; };
    return `${fmt(start)} – ${fmt(end)}`;
  };

  return (
    <div className="space-y-6">
      {/* Payment Score - only when there are pending proposals */}
      {!scoreLoading && score && (
        <Card className={`border ${getScoreBg(scoreNum)}`}>
          <CardContent className="p-3 sm:p-4">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <div className="flex items-center gap-2">
                <TrendingUp className={`h-5 w-5 flex-shrink-0 ${getScoreColor(scoreNum)}`} />
                <span className="text-sm font-medium text-muted-foreground">Payment Score</span>
              </div>
              <div className="flex items-baseline gap-1">
                <span className={`text-2xl font-bold ${getScoreColor(scoreNum)}`}>
                  {score.score}
                </span>
                <span className="text-sm text-muted-foreground">/10</span>
              </div>
              <div className="sm:ml-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {score.periodStart && score.periodEnd && (
                  <span>{formatPeriod(score.periodStart, score.periodEnd)}</span>
                )}
                {score.paidLanoshi && score.proposedLanoshi && (
                  <span>
                    Paid {formatLanoshi(score.paidLanoshi)} / {formatLanoshi(score.proposedLanoshi)}
                  </span>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Wallet Selection */}
      <Card>
        <CardHeader>
          <CardTitle>Select Payment Wallet</CardTitle>
        </CardHeader>
        <CardContent>
          <Select value={selectedWallet} onValueChange={setSelectedWallet}>
            <SelectTrigger>
              <SelectValue placeholder="Choose a wallet..." />
            </SelectTrigger>
            <SelectContent>
              {wallets
                .filter(wallet => !wallet.walletType?.toLowerCase().includes('lana8wonder'))
                .map(wallet => {
                  const balance = balances.get(wallet.walletId);
                  const walletType = wallet.walletType || 'Wallet';
                  const addressPreview = wallet.walletId.substring(0, 8) + '...';
                  const displayText = wallet.note 
                    ? `${wallet.note.substring(0, 20)}${wallet.note.length > 20 ? '...' : ''}`
                    : `${walletType} - ${addressPreview}`;
                  return (
                    <SelectItem key={wallet.walletId} value={wallet.walletId}>
                      <div className="flex items-center justify-between w-full gap-4">
                        <span className="truncate max-w-[200px]">
                          {displayText}
                        </span>
                        <span className="text-sm text-muted-foreground whitespace-nowrap">
                          {balance !== undefined ? formatLana(balance) : '...'}
                        </span>
                      </div>
                    </SelectItem>
                  );
                })}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* Payment Proposals */}
      <div className="space-y-4">
        {pendingProposals.map(proposal => {
          const isSelected = selectedProposals.has(proposal.eventId);
          const originalLana = fiatToLana(parseFloat(proposal.fiatAmount), proposal.fiatCurrency);
          const displayAmount = customAmounts[proposal.eventId] !== undefined 
            ? customAmounts[proposal.eventId] 
            : originalLana;

          return (
            <Card key={proposal.eventId} className={isSelected ? 'border-primary' : ''}>
              <CardContent className="p-4 sm:p-6">
                <div className="flex items-start gap-3 sm:gap-4 min-w-0">
                  <Checkbox
                    checked={isSelected}
                    onCheckedChange={() => handleToggleProposal(proposal.eventId)}
                    className="mt-1 flex-shrink-0"
                  />

                  <div className="flex-1 min-w-0 space-y-3">
                    <div className="min-w-0">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <h3 className="text-base sm:text-lg font-semibold truncate">{proposal.service}</h3>
                        <span className="text-sm text-muted-foreground whitespace-nowrap flex-shrink-0">
                          {formatCurrency(lanaToFiat(originalLana, userCurrency), userCurrency)}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground mb-2">{proposal.content}</p>

                      {/* Recipient Information */}
                      <div className="mb-2 p-2 bg-muted/50 rounded space-y-1 overflow-hidden">
                        {(() => {
                          const profile = recipientProfiles.get(proposal.recipientPubkey);
                          return (
                            <>
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-medium text-muted-foreground flex-shrink-0">Recipient:</span>
                                <span className="text-xs font-medium truncate">
                                  {profile?.display_name || profile?.full_name || 'Unknown'}
                                </span>
                              </div>
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="text-xs text-muted-foreground flex-shrink-0">Wallet:</span>
                                <span className="text-xs font-mono truncate">{proposal.wallet}</span>
                              </div>
                            </>
                          );
                        })()}
                      </div>

                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        {proposal.ref && (
                          <span className="truncate max-w-full">Ref: {proposal.ref}</span>
                        )}
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3 flex-shrink-0" />
                          {format(new Date(proposal.createdAt * 1000), 'MMM d, yyyy')}
                        </span>
                        {proposal.expires && proposal.expires > Date.now() / 1000 && (
                          <span className="text-orange-500">
                            Expires: {format(new Date(proposal.expires * 1000), 'MMM d, yyyy')}
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-muted-foreground/60 font-mono truncate mt-1">
                        Event: {proposal.eventId}
                      </div>
                    </div>

                    {isSelected && (
                      <div className="space-y-2">
                        <Label htmlFor={`amount-${proposal.eventId}`}>
                          Amount in LANA (Original: {formatLana(originalLana)})
                        </Label>
                        <Input
                          id={`amount-${proposal.eventId}`}
                          type="number"
                          step="0.01"
                          min="0"
                          value={displayAmount}
                          onChange={(e) => handleAmountChange(proposal.eventId, e.target.value)}
                          className="max-w-xs"
                        />
                      </div>
                    )}

                    {proposal.url && (
                      <a
                        href={proposal.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                      >
                        Learn more <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Payment Summary */}
      {selectedProposals.size > 0 && (
        <Card>
          <CardContent className="p-4 sm:p-6">
            <div className="space-y-4">
              {selectedWallet && (
                <div className="space-y-3 pb-4 border-b">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Wallet className="h-4 w-4 flex-shrink-0" />
                    <span>Payment Breakdown</span>
                  </div>

                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between gap-2">
                      <span className="text-muted-foreground">Wallet Balance:</span>
                      <span className="font-medium whitespace-nowrap">{formatLana(selectedWalletBalance)}</span>
                    </div>

                    <div className="space-y-1 pl-2 sm:pl-4">
                      {Array.from(selectedProposals).map((proposalId, index) => {
                        const proposal = pendingProposals.find(p => p.eventId === proposalId);
                        if (!proposal) return null;

                        const customAmount = customAmounts[proposalId];
                        const amount = customAmount !== undefined
                          ? (parseFloat(customAmount) || 0)
                          : fiatToLana(parseFloat(proposal.fiatAmount), proposal.fiatCurrency);

                        return (
                          <div key={proposalId} className="flex justify-between gap-2 text-muted-foreground">
                            <span className="truncate">{proposal.service}:</span>
                            <span className="whitespace-nowrap flex-shrink-0">-{formatLana(amount)}</span>
                          </div>
                        );
                      })}
                    </div>

                    <div className="flex justify-between gap-2 pt-2 border-t">
                      <span className="font-medium">Total Payment:</span>
                      <span className="font-medium text-primary whitespace-nowrap">-{formatLana(totalLana)}</span>
                    </div>

                    <div className="flex justify-between gap-2 pt-2 border-t">
                      <span className="font-semibold">Remaining Balance:</span>
                      <span className={`font-semibold whitespace-nowrap ${remainingBalance < 0 ? 'text-destructive' : 'text-success'}`}>
                        {formatLana(remainingBalance)}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Total Amount</p>
                  <p className="text-2xl font-bold">{formatLana(totalLana)}</p>
                  <p className="text-sm text-muted-foreground">≈ {totalInUserCurrency}</p>
                </div>
                <Button
                  onClick={handleProceedToPayment}
                  disabled={!selectedWallet || remainingBalance < 0}
                  size="lg"
                  className="w-full sm:w-auto"
                >
                  Proceed to Payment
                </Button>
              </div>
              
              {!selectedWallet && (
                <p className="text-sm text-destructive">
                  Please select a wallet to proceed with payment.
                </p>
              )}
              
              {selectedWallet && remainingBalance < 0 && (
                <p className="text-sm text-destructive">
                  Insufficient funds. You need {formatLana(Math.abs(remainingBalance))} more LANA.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
