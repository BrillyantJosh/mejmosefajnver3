import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { UserAvatar } from '@/components/ui/UserAvatar';
import { useNostrDonationProposals } from "@/hooks/useNostrDonationProposals";
import { useNostrDonationPayments } from "@/hooks/useNostrDonationPayments";
import { useNostrSellerProfiles } from "@/hooks/useNostrSellerProfiles";
import { useAuth } from "@/contexts/AuthContext";
import { formatLana, formatCurrency } from "@/lib/currencyConversion";
import { CheckCircle, ExternalLink } from "lucide-react";
import { format } from "date-fns";
import { useMemo } from "react";

export default function Completed() {
  const { session } = useAuth();
  const { proposals, isLoading: proposalsLoading } = useNostrDonationProposals(session?.nostrHexId);
  const { payments, isLoading: paymentsLoading } = useNostrDonationPayments(session?.nostrHexId);
  
  // Extract unique recipient pubkeys
  const recipientPubkeys = useMemo(() => {
    return Array.from(new Set(payments.map(p => p.recipientPubkey)));
  }, [payments]);
  
  // Fetch profiles for all recipients
  const { profiles, isLoading: profilesLoading } = useNostrSellerProfiles(recipientPubkeys);

  if ((proposalsLoading && proposals.length === 0) || (paymentsLoading && payments.length === 0)) {
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
        const profile = profiles.get(payment.recipientPubkey);

        return (
          <Card key={payment.id}>
            <CardContent className="p-4 sm:p-6">
              <div className="flex items-start gap-3 sm:gap-4 min-w-0">
                <div className="flex-shrink-0">
                  <CheckCircle className="h-5 w-5 sm:h-6 sm:w-6 text-green-500" />
                </div>

                <div className="flex-1 min-w-0 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-base sm:text-lg font-semibold truncate">{payment.service}</h3>
                    <span className="text-sm font-medium text-green-600 whitespace-nowrap flex-shrink-0">
                      {formatLana(parseFloat(payment.amountLana))}
                    </span>
                  </div>

                  {proposal && (
                    <p className="text-sm text-muted-foreground">{proposal.content}</p>
                  )}

                  {/* Profile Information */}
                  {profile && (
                    <div className="flex items-center gap-3 p-2 sm:p-3 bg-muted/50 rounded-lg min-w-0">
                      <UserAvatar pubkey={payment.recipientPubkey} picture={profile.picture} name={profile.display_name || profile.name} className="h-8 w-8 sm:h-10 sm:w-10 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm truncate">
                          {profile.display_name || profile.name || 'Anonymous'}
                        </div>
                        {profile.name && profile.display_name && profile.name !== profile.display_name && (
                          <div className="text-xs text-muted-foreground truncate">{profile.name}</div>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>
                      {formatCurrency(parseFloat(payment.fiatAmount), payment.fiatCurrency)}
                    </span>
                    <span>
                      Paid: {format(new Date(payment.timestampPaid * 1000), 'MMM d, yyyy HH:mm')}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 text-xs min-w-0">
                    <span className="text-muted-foreground flex-shrink-0">TX:</span>
                    <code className="bg-muted px-2 py-1 rounded text-xs truncate">
                      {payment.txId}
                    </code>
                    <a
                      href={`https://chainz.cryptoid.info/lana/tx.dws?${payment.txId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-primary hover:underline flex-shrink-0"
                    >
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                  <div className="text-[10px] text-muted-foreground/60 font-mono truncate">
                    Event: {payment.id}
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
