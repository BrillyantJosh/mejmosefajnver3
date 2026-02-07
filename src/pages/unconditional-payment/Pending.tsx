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
import { fiatToLana, getUserCurrency, formatCurrency, formatLana, lanaToLanoshi } from "@/lib/currencyConversion";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { Calendar, ExternalLink, Wallet } from "lucide-react";
import { format } from "date-fns";

interface DonationSelection {
  proposalId: string;
  amount: number; // in LANA
}

export default function Pending() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const { proposals, isLoading: proposalsLoading } = useNostrDonationProposals(session?.nostrHexId);
  const { wallets, isLoading: walletsLoading } = useNostrUserWallets(session?.nostrHexId || null);

  const [selectedProposals, setSelectedProposals] = useState<Set<string>>(new Set());
  const [customAmounts, setCustomAmounts] = useState<{ [key: string]: number }>({});
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
  const pendingProposals = useMemo(() => proposals.filter(p => !p.isPaid), [proposals]);

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
      return sum + customAmount;
    }
    
    // Calculate from fiat to LANA
    const originalAmount = fiatToLana(parseFloat(proposal.fiatAmount), proposal.fiatCurrency);
    return sum + originalAmount;
  }, 0);

  const totalInUserCurrency = formatCurrency(totalLana / 250, userCurrency); // Simplified conversion

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
    const amount = parseFloat(value);
    if (!isNaN(amount) && amount > 0) {
      setCustomAmounts(prev => ({ ...prev, [proposalId]: amount }));
    }
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

    // Store payment details in session storage
    const paymentData = {
      selectedProposals: Array.from(selectedProposals).map(id => {
        const proposal = pendingProposals.find(p => p.eventId === id);
        const customAmount = customAmounts[id];
        const lanaAmount = customAmount !== undefined ? customAmount : fiatToLana(parseFloat(proposal!.fiatAmount), proposal!.fiatCurrency);
        
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

  return (
    <div className="space-y-6">
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
              <CardContent className="p-6">
                <div className="flex items-start gap-4">
                  <Checkbox
                    checked={isSelected}
                    onCheckedChange={() => handleToggleProposal(proposal.eventId)}
                    className="mt-1"
                  />
                  
                  <div className="flex-1 space-y-3">
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <h3 className="text-lg font-semibold">{proposal.service}</h3>
                        <span className="text-sm text-muted-foreground">
                          {formatCurrency(parseFloat(proposal.fiatAmount), proposal.fiatCurrency)}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground mb-2">{proposal.content}</p>
                      
                      {/* Recipient Information */}
                      <div className="mb-2 p-2 bg-muted/50 rounded space-y-1">
                        {(() => {
                          const profile = recipientProfiles.get(proposal.recipientPubkey);
                          return (
                            <>
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-medium text-muted-foreground">Recipient:</span>
                                <span className="text-xs font-medium">
                                  {profile?.display_name || profile?.full_name || 'Unknown'}
                                </span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-muted-foreground">Wallet:</span>
                                <span className="text-xs font-mono">{proposal.wallet}</span>
                              </div>
                            </>
                          );
                        })()}
                      </div>
                      
                      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                        {proposal.ref && (
                          <span>Ref: {proposal.ref}</span>
                        )}
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {format(new Date(proposal.createdAt * 1000), 'MMM d, yyyy')}
                        </span>
                        {proposal.expires && proposal.expires > Date.now() / 1000 && (
                          <span className="text-orange-500">
                            Expires: {format(new Date(proposal.expires * 1000), 'MMM d, yyyy')}
                          </span>
                        )}
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
          <CardContent className="p-6">
            <div className="space-y-4">
              {selectedWallet && (
                <div className="space-y-3 pb-4 border-b">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Wallet className="h-4 w-4" />
                    <span>Payment Breakdown</span>
                  </div>
                  
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Wallet Balance:</span>
                      <span className="font-medium">{formatLana(selectedWalletBalance)}</span>
                    </div>
                    
                    <div className="space-y-1 pl-4">
                      {Array.from(selectedProposals).map((proposalId, index) => {
                        const proposal = pendingProposals.find(p => p.eventId === proposalId);
                        if (!proposal) return null;
                        
                        const amount = customAmounts[proposalId] !== undefined 
                          ? customAmounts[proposalId] 
                          : fiatToLana(parseFloat(proposal.fiatAmount), proposal.fiatCurrency);
                        
                        return (
                          <div key={proposalId} className="flex justify-between text-muted-foreground">
                            <span>Payment {index + 1} ({proposal.service}):</span>
                            <span>-{formatLana(amount)}</span>
                          </div>
                        );
                      })}
                    </div>
                    
                    <div className="flex justify-between pt-2 border-t">
                      <span className="font-medium">Total Payment:</span>
                      <span className="font-medium text-primary">-{formatLana(totalLana)}</span>
                    </div>
                    
                    <div className="flex justify-between pt-2 border-t">
                      <span className="font-semibold">Remaining Balance:</span>
                      <span className={`font-semibold ${remainingBalance < 0 ? 'text-destructive' : 'text-success'}`}>
                        {formatLana(remainingBalance)}
                      </span>
                    </div>
                  </div>
                </div>
              )}
              
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Total Amount</p>
                  <p className="text-2xl font-bold">{formatLana(totalLana)}</p>
                  <p className="text-sm text-muted-foreground">≈ {totalInUserCurrency}</p>
                </div>
                <Button
                  onClick={handleProceedToPayment}
                  disabled={!selectedWallet || remainingBalance < 0}
                  size="lg"
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
