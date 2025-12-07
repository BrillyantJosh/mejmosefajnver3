import { Globe, MapPin, Calendar, ExternalLink, FileText, Youtube, Image, CheckCircle, XCircle } from "lucide-react";
import { AwarenessProposal } from "@/hooks/useNostrAwarenessProposals";
import { useNostrUserAcknowledgement } from "@/hooks/useNostrUserAcknowledgement";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

function getTimeRemaining(endTimestamp: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = endTimestamp - now;
  if (diff <= 0) return 'Ended';
  const days = Math.floor(diff / 86400);
  const hours = Math.floor(diff % 86400 / 3600);
  if (days > 0) return `${days}d ${hours}h remaining`;
  return `${hours}h remaining`;
}

interface ProposalCardProps {
  proposal: AwarenessProposal;
  onClick: () => void;
}

export default function ProposalCard({ proposal, onClick }: ProposalCardProps) {
  const { acknowledgement, isLoading: isLoadingAck } = useNostrUserAcknowledgement(proposal.dTag, proposal.id);
  const hasMedia = proposal.img || proposal.youtube || proposal.doc || proposal.link;

  return (
    <Card 
      className="cursor-pointer hover:shadow-lg transition-shadow border-border/50 hover:border-primary/30" 
      onClick={onClick}
    >
      {proposal.img && (
        <div className="w-full h-40 overflow-hidden rounded-t-lg">
          <img src={proposal.img} alt={proposal.title} className="w-full h-full object-cover" />
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
        
        {/* User's vote status */}
        {!isLoadingAck && acknowledgement && (
          <div className={`flex items-center gap-2 text-xs font-medium ${
            acknowledgement.ack === 'yes' 
              ? 'text-green-600 dark:text-green-400' 
              : 'text-destructive'
          }`}>
            {acknowledgement.ack === 'yes' ? (
              <><CheckCircle className="h-3 w-3" /> You accepted</>
            ) : (
              <><XCircle className="h-3 w-3" /> You resisted</>
            )}
          </div>
        )}
        
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
