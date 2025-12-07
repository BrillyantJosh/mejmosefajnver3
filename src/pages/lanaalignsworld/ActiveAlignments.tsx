import { Activity } from "lucide-react";
import { useNostrAwarenessProposals, AwarenessProposal } from "@/hooks/useNostrAwarenessProposals";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
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
export default function ActiveAlignments() {
  const {
    proposals,
    isLoading,
    error
  } = useNostrAwarenessProposals();
  const [selectedProposal, setSelectedProposal] = useState<AwarenessProposal | null>(null);
  
  if (selectedProposal) {
    return <ProposalDetail proposal={selectedProposal} onBack={() => setSelectedProposal(null)} />;
  }
  
  return (
    <div className="px-3 py-4 sm:p-4">
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
      ) : proposals.length === 0 ? (
        <div className="text-muted-foreground text-center py-8 sm:py-12">
          <Activity className="h-10 w-10 sm:h-12 sm:w-12 mx-auto mb-3 sm:mb-4 opacity-50" />
          <p className="text-sm sm:text-base">No active proposals at the moment.</p>
          <p className="text-xs sm:text-sm mt-2">Check back later for new alignment proposals.</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {proposals.map(proposal => (
            <ProposalCard 
              key={proposal.id} 
              proposal={proposal} 
              onClick={() => setSelectedProposal(proposal)} 
            />
          ))}
        </div>
      )}
    </div>
  );
}