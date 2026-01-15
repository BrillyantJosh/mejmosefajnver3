import { Activity, History, Check, X } from "lucide-react";
import { useNostrAwarenessProposals, AwarenessProposal } from "@/hooks/useNostrAwarenessProposals";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useState } from "react";
import ProposalDetail from "@/components/lanaalignsworld/ProposalDetail";
import ProposalCard from "@/components/lanaalignsworld/ProposalCard";

function LoadingSkeleton() {
  return <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {[1, 2, 3].map(i => <Card key={i}>
          <CardHeader>
            <Skeleton className="h-6 w-3/4" />
          </CardHeader>
          <CardContent className="space-y-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/2" />
          </CardContent>
        </Card>)}
    </div>;
}

function formatEndDate(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });
}

interface ExpiredProposalRowProps {
  proposal: AwarenessProposal;
  onClick: () => void;
}

function ExpiredProposalRow({ proposal, onClick }: ExpiredProposalRowProps) {
  // For now, we assume accepted unless there was resistance
  // This could be enhanced with actual vote tallying logic
  const wasAccepted = true; // Placeholder - would need actual resistance check

  return (
    <div 
      onClick={onClick}
      className="flex items-center justify-between p-3 bg-muted/50 rounded-lg cursor-pointer hover:bg-muted transition-colors gap-3"
    >
      <div className="flex-1 min-w-0">
        <p className="font-medium truncate text-sm sm:text-base">{proposal.title}</p>
      </div>
      <div className="flex items-center gap-2 sm:gap-4 text-xs sm:text-sm text-muted-foreground shrink-0">
        <span className="hidden sm:inline">Ended: {formatEndDate(proposal.end)}</span>
        <span className="sm:hidden">{formatEndDate(proposal.end)}</span>
        <Badge 
          variant={wasAccepted ? "default" : "destructive"}
          className="flex items-center gap-1"
        >
          {wasAccepted ? (
            <>
              <Check className="h-3 w-3" />
              <span className="hidden sm:inline">Accepted</span>
            </>
          ) : (
            <>
              <X className="h-3 w-3" />
              <span className="hidden sm:inline">Resisted</span>
            </>
          )}
        </Badge>
      </div>
    </div>
  );
}

export default function ActiveAlignments() {
  const {
    activeProposals,
    expiredProposals,
    isLoading,
    error
  } = useNostrAwarenessProposals();
  const [selectedProposal, setSelectedProposal] = useState<AwarenessProposal | null>(null);
  
  if (selectedProposal) {
    return <ProposalDetail proposal={selectedProposal} onBack={() => setSelectedProposal(null)} />;
  }
  
  return (
    <div className="px-3 py-4 sm:p-4">
      {/* Active Proposals Section */}
      <div className="flex items-center gap-2 mb-4 sm:mb-6">
        <Activity className="h-5 w-5 text-primary" />
        <h1 className="text-lg sm:text-2xl font-bold">Active Alignments</h1>
      </div>

      {isLoading ? (
        <LoadingSkeleton />
      ) : error ? (
        <div className="text-center py-8 sm:py-12 text-destructive">
          <p>{error}</p>
        </div>
      ) : activeProposals.length === 0 ? (
        <div className="text-muted-foreground text-center py-8 sm:py-12">
          <Activity className="h-10 w-10 sm:h-12 sm:w-12 mx-auto mb-3 sm:mb-4 opacity-50" />
          <p className="text-sm sm:text-base">No active proposals at the moment.</p>
          <p className="text-xs sm:text-sm mt-2">Check back later for new alignment proposals.</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {activeProposals.map(proposal => (
            <ProposalCard 
              key={proposal.id} 
              proposal={proposal} 
              onClick={() => setSelectedProposal(proposal)} 
            />
          ))}
        </div>
      )}

      {/* Expired Proposals Section */}
      {!isLoading && !error && expiredProposals.length > 0 && (
        <div className="mt-8 sm:mt-12">
          <div className="flex items-center gap-2 mb-4">
            <History className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-base sm:text-xl font-semibold text-muted-foreground">Past Alignments</h2>
          </div>
          <div className="space-y-2">
            {expiredProposals.map(proposal => (
              <ExpiredProposalRow
                key={proposal.id}
                proposal={proposal}
                onClick={() => setSelectedProposal(proposal)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
