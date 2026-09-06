import { Activity, History, Users, CheckCircle2, Hand } from "lucide-react";
import { useNostrAwarenessProposals, AwarenessProposal } from "@/hooks/useNostrAwarenessProposals";
import { useAlignmentTallies, tallyFor } from "@/hooks/useAlignmentTallies";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useMemo, useState } from "react";
import ProposalDetail from "@/components/lanaalignsworld/ProposalDetail";
import ProposalCard from "@/components/lanaalignsworld/ProposalCard";

function LoadingSkeleton() {
  return <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {[1, 2, 3].map(i => <Card key={i}>
          <Skeleton className="h-36 sm:h-44 w-full rounded-t-lg rounded-b-none" />
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
    activeProposals,
    expiredProposals,
    isLoading,
    error
  } = useNostrAwarenessProposals();
  const { tallies, resolved: talliesResolved, isLoading: talliesLoading, refetch: refetchTallies } = useAlignmentTallies();
  const [selectedProposal, setSelectedProposal] = useState<AwarenessProposal | null>(null);

  // What the whole page adds up to — the one figure that says whether the
  // world has been aligning at all.
  const summary = useMemo(() => {
    const all = [...activeProposals, ...expiredProposals];
    let voices = 0;
    let aligned = 0;
    let resisted = 0;
    for (const proposal of all) {
      const tally = tallyFor(tallies, proposal.dTag);
      if (!tally) continue;
      voices += tally.total;
      if (tally.outcome === 'resisted') resisted++;
      else if (tally.outcome === 'aligned') aligned++;
    }
    return { count: all.length, voices, aligned, resisted };
  }, [activeProposals, expiredProposals, tallies]);

  if (selectedProposal) {
    return (
      <ProposalDetail
        proposal={selectedProposal}
        onBack={() => setSelectedProposal(null)}
        tally={tallyFor(tallies, selectedProposal.dTag)}
        talliesResolved={talliesResolved}
        talliesLoading={talliesLoading}
        onRefreshTally={refetchTallies}
      />
    );
  }

  const cardProps = {
    talliesResolved,
    talliesLoading,
  };

  return (
    <div className="px-3 py-4 sm:p-4">
      {/* Active Proposals Section */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-4 sm:mb-6">
        <div className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-primary" />
          <h1 className="text-lg sm:text-2xl font-bold">Alignments</h1>
        </div>
        {!isLoading && !error && talliesResolved && summary.count > 0 && (
          <div className="flex items-center gap-3 text-[11px] sm:text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Users className="h-3 w-3" />
              {summary.voices} {summary.voices === 1 ? 'voice' : 'voices'}
            </span>
            {summary.aligned > 0 && (
              <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
                <CheckCircle2 className="h-3 w-3" />
                {summary.aligned} aligned
              </span>
            )}
            {summary.resisted > 0 && (
              <span className="flex items-center gap-1 text-red-600 dark:text-red-400">
                <Hand className="h-3 w-3" />
                {summary.resisted} with resistance
              </span>
            )}
          </div>
        )}
      </div>

      {isLoading ? (
        <LoadingSkeleton />
      ) : error ? (
        <div className="text-center py-8 sm:py-12 text-destructive">
          <p>{error}</p>
        </div>
      ) : activeProposals.length === 0 ? (
        <div className="text-muted-foreground text-center py-6 sm:py-10">
          <Activity className="h-10 w-10 sm:h-12 sm:w-12 mx-auto mb-3 sm:mb-4 opacity-50" />
          <p className="text-sm sm:text-base">No alignment is open for voting right now.</p>
          <p className="text-xs sm:text-sm mt-2">The finished ones are below, with their results.</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {activeProposals.map(proposal => (
            <ProposalCard
              key={proposal.id}
              proposal={proposal}
              onClick={() => setSelectedProposal(proposal)}
              tally={tallyFor(tallies, proposal.dTag)}
              {...cardProps}
            />
          ))}
        </div>
      )}

      {/* Finished alignments — cards with their result, not a grey list of
          names. Every one of them ended with a picture, a count and a decision
          the page simply never showed. */}
      {!isLoading && !error && expiredProposals.length > 0 && (
        <div className="mt-8 sm:mt-12">
          <div className="flex items-center gap-2 mb-4">
            <History className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-base sm:text-xl font-semibold text-muted-foreground">
              Past Alignments — results
            </h2>
          </div>
          <div className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {expiredProposals.map(proposal => (
              <ProposalCard
                key={proposal.id}
                proposal={proposal}
                onClick={() => setSelectedProposal(proposal)}
                tally={tallyFor(tallies, proposal.dTag)}
                {...cardProps}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
