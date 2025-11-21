import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useNostrDonationProposals } from "@/hooks/useNostrDonationProposals";
import { useNostrDonationPayments } from "@/hooks/useNostrDonationPayments";
import { useNostrUserWallets } from "@/hooks/useNostrUserWallets";
import { useAuth } from "@/contexts/AuthContext";
import { fiatToLana, getUserCurrency, formatCurrency, formatLana, lanaToLanoshi } from "@/lib/currencyConversion";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { Calendar, ExternalLink, CheckCircle } from "lucide-react";
import { format } from "date-fns";

interface DonationSelection {
  proposalId: string;
  amount: number; // in LANA
}

export default function Pending() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const { proposals, isLoading: proposalsLoading } = useNostrDonationProposals();
  const { payments } = useNostrDonationPayments();
  const { wallets, isLoading: walletsLoading } = useNostrUserWallets(session?.nostrHexId || null);
  
  const [selectedProposals, setSelectedProposals] = useState<Set<string>>(new Set());
  const [customAmounts, setCustomAmounts] = useState<{ [key: string]: number }>({});
  const [selectedWallet, setSelectedWallet] = useState<string>("");
  const userCurrency = getUserCurrency();

  // Update proposals with payment status
  const proposalsWithStatus = proposals.map(proposal => {
    const payment = payments.find(p => p.proposalDTag === proposal.d || p.proposalEventId === proposal.eventId);
    return {
      ...proposal,
      isPaid: !!payment,
      paymentTxId: payment?.txId
    };
  });

  const pendingProposals = proposalsWithStatus.filter(p => !p.isPaid);

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

  const handleToggleProposal = (proposalId: string) => {
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
  };

  const handleAmountChange = (proposalId: string, value: string) => {
    const amount = parseFloat(value);
    if (!isNaN(amount) && amount > 0) {
      setCustomAmounts({ ...customAmounts, [proposalId]: amount });
    }
  };

  const handleProceedToPayment = () => {
    if (selectedProposals.size === 0) {
      toast.error("Please select at least one donation");
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

    sessionStorage.setItem('pendingDonationPayment', JSON.stringify(paymentData));
    
    // Navigate to payment confirmation page
    navigate('/donate/confirm-payment');
  };

  if (proposalsLoading || walletsLoading) {
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
          <p className="text-muted-foreground">No pending donation proposals at the moment.</p>
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
              {wallets.map(wallet => (
                <SelectItem key={wallet.walletId} value={wallet.walletId}>
                  {wallet.walletType} {wallet.note ? `- ${wallet.note}` : ''} ({wallet.walletId.substring(0, 8)}...)
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* Donation Proposals */}
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
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-sm text-muted-foreground">Total Amount</p>
                <p className="text-2xl font-bold">{formatLana(totalLana)}</p>
                <p className="text-sm text-muted-foreground">≈ {totalInUserCurrency}</p>
              </div>
              <Button
                onClick={handleProceedToPayment}
                disabled={!selectedWallet}
                size="lg"
              >
                Proceed to Payment
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
