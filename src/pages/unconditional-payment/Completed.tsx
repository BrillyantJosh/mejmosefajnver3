import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { useNostrDonationProposals } from "@/hooks/useNostrDonationProposals";
import { useNostrDonationPayments } from "@/hooks/useNostrDonationPayments";
import { useNostrProfilesCacheBulk } from "@/hooks/useNostrProfilesCacheBulk";
import { formatLana, formatCurrency } from "@/lib/currencyConversion";
import { CheckCircle, ExternalLink, Wallet } from "lucide-react";
import { format } from "date-fns";
import { useMemo } from "react";

export default function Completed() {
  const { proposals, isLoading: proposalsLoading } = useNostrDonationProposals();
  const { payments, isLoading: paymentsLoading } = useNostrDonationPayments();

  // Collect all unique recipient pubkeys
  const recipientPubkeys = useMemo(() => {
    const pubkeys = new Set<string>();
    payments.forEach(payment => {
      if (payment.recipientPubkey) pubkeys.add(payment.recipientPubkey);
    });
    return Array.from(pubkeys);
  }, [payments]);

  // Fetch profiles for all recipients
  const { profiles } = useNostrProfilesCacheBulk(recipientPubkeys);

  // Show loading only if actually loading AND no data yet
  const isInitialLoading = (proposalsLoading && proposals.length === 0) || (paymentsLoading && payments.length === 0);

  if (isInitialLoading) {
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

  if (payments.length === 0) {
    return (
      <Card>
        <CardContent className="p-12 text-center">
          <p className="text-muted-foreground">You haven't made any unconditional payments yet.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {payments.map(payment => {
        const proposal = proposals.find(p => p.d === payment.proposalDTag || p.eventId === payment.proposalEventId);
        const recipientProfile = profiles[payment.recipientPubkey];
        const recipientName = recipientProfile?.display_name || recipientProfile?.full_name || 'Unknown';
        const recipientWallet = payment.toWallet || proposal?.wallet;

        return (
          <Card key={payment.id}>
            <CardContent className="p-6">
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0">
                  <CheckCircle className="h-6 w-6 text-green-500" />
                </div>
                
                <div className="flex-1 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold">{payment.service}</h3>
                    <span className="text-sm font-medium text-green-600">
                      {formatLana(parseFloat(payment.amountLana))}
                    </span>
                  </div>
                  
                  {proposal && (
                    <p className="text-sm text-muted-foreground">{proposal.content}</p>
                  )}

                  {/* Recipient Info */}
                  <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
                    <Avatar className="h-8 w-8">
                      <AvatarImage src={recipientProfile?.picture} />
                      <AvatarFallback>{recipientName.charAt(0).toUpperCase()}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{recipientName}</p>
                      {recipientWallet && (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Wallet className="h-3 w-3" />
                          <a
                            href={`https://chainz.cryptoid.info/lana/address.dws?${recipientWallet}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:text-primary hover:underline truncate"
                          >
                            {recipientWallet}
                          </a>
                          <ExternalLink className="h-3 w-3 flex-shrink-0" />
                        </div>
                      )}
                    </div>
                  </div>
                  
                  <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                    <span>
                      {formatCurrency(parseFloat(payment.fiatAmount), payment.fiatCurrency)}
                    </span>
                    <span>
                      Paid: {format(new Date(payment.timestampPaid * 1000), 'MMM d, yyyy HH:mm')}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground">TX:</span>
                    <code className="bg-muted px-2 py-1 rounded text-xs">
                      {payment.txId.substring(0, 16)}...{payment.txId.substring(payment.txId.length - 8)}
                    </code>
                    <a
                      href={`https://chainz.cryptoid.info/lana/tx.dws?${payment.txId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-primary hover:underline"
                    >
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
