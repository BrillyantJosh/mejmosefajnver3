import { Activity, Globe, MapPin, Calendar, ExternalLink, FileText, Youtube, Image } from "lucide-react";
import { useNostrAwarenessProposals, AwarenessProposal } from "@/hooks/useNostrAwarenessProposals";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useState } from "react";
import ProposalDetail from "@/components/lanaalignsworld/ProposalDetail";

function formatDate(timestamp: number): string {
  if (!timestamp) return 'N/A';
  return new Date(timestamp * 1000).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function getTimeRemaining(endTimestamp: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = endTimestamp - now;
  
  if (diff <= 0) return 'Ended';
  
  const days = Math.floor(diff / 86400);
  const hours = Math.floor((diff % 86400) / 3600);
  
  if (days > 0) return `${days}d ${hours}h remaining`;
  return `${hours}h remaining`;
}

interface ProposalCardProps {
  proposal: AwarenessProposal;
  onClick: () => void;
}

function ProposalCard({ proposal, onClick }: ProposalCardProps) {
  const hasMedia = proposal.img || proposal.youtube || proposal.doc || proposal.link;
  
  return (
    <Card 
      className="cursor-pointer hover:shadow-lg transition-shadow border-border/50 hover:border-primary/30"
      onClick={onClick}
    >
      {proposal.img && (
        <div className="w-full h-40 overflow-hidden rounded-t-lg">
          <img 
            src={proposal.img} 
            alt={proposal.title}
            className="w-full h-full object-cover"
          />
        </div>
      )}
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-lg leading-tight">{proposal.title}</CardTitle>
          <Badge variant={proposal.level === 'global' ? 'default' : 'secondary'} className="shrink-0">
            {proposal.level === 'global' ? (
              <><Globe className="h-3 w-3 mr-1" /> Global</>
            ) : (
              <><MapPin className="h-3 w-3 mr-1" /> Local</>
            )}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground line-clamp-2">
          {proposal.shortPerspective}
        </p>
        
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <div className="flex items-center gap-1">
            <Calendar className="h-3 w-3" />
            <span>{getTimeRemaining(proposal.end)}</span>
          </div>
          {hasMedia && (
            <div className="flex items-center gap-2">
              {proposal.youtube && <Youtube className="h-3 w-3" />}
              {proposal.doc && <FileText className="h-3 w-3" />}
              {proposal.link && <ExternalLink className="h-3 w-3" />}
              {proposal.img && <Image className="h-3 w-3" />}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function LoadingSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {[1, 2, 3].map((i) => (
        <Card key={i}>
          <CardHeader>
            <Skeleton className="h-6 w-3/4" />
          </CardHeader>
          <CardContent className="space-y-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/2" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default function ActiveAlignments() {
  const { proposals, isLoading, error } = useNostrAwarenessProposals();
  const [selectedProposal, setSelectedProposal] = useState<AwarenessProposal | null>(null);

  if (selectedProposal) {
    return (
      <ProposalDetail 
        proposal={selectedProposal} 
        onBack={() => setSelectedProposal(null)} 
      />
    );
  }

  return (
    <div className="p-4">
      <div className="flex items-center gap-2 mb-6">
        <Activity className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
        <h1 className="text-lg sm:text-2xl font-bold">Active Proposals</h1>
      </div>

      {isLoading ? (
        <LoadingSkeleton />
      ) : error ? (
        <div className="text-center py-12 text-destructive">
          <p>{error}</p>
        </div>
      ) : proposals.length === 0 ? (
        <div className="text-muted-foreground text-center py-12">
          <Activity className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p>No active proposals at the moment.</p>
          <p className="text-sm mt-2">Check back later for new alignment proposals.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {proposals.map((proposal) => (
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
