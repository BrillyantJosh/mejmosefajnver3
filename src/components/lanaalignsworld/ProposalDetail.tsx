import { useState } from 'react';
import { ArrowLeft, Globe, MapPin, Calendar, ExternalLink, FileText, Youtube, CheckCircle, XCircle, Clock, Wallet, AlertCircle, RefreshCw } from "lucide-react";
import { AwarenessProposal } from "@/hooks/useNostrAwarenessProposals";
import { useNostrUserAcknowledgement } from "@/hooks/useNostrUserAcknowledgement";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import VoteDialog from "./VoteDialog";

import { useNostrLana8Wonder } from "@/hooks/useNostrLana8Wonder";
import { useNostrRealLifeCredential } from "@/hooks/useNostrRealLifeCredential";
import { toast } from "sonner";

interface ProposalDetailProps {
  proposal: AwarenessProposal;
  onBack: () => void;
}

function formatDate(timestamp: number): string {
  if (!timestamp) return 'N/A';
  return new Date(timestamp * 1000).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getTimeRemaining(endTimestamp: number): { text: string; isEnded: boolean } {
  const now = Math.floor(Date.now() / 1000);
  const diff = endTimestamp - now;
  
  if (diff <= 0) return { text: 'Voting ended', isEnded: true };
  
  const days = Math.floor(diff / 86400);
  const hours = Math.floor((diff % 86400) / 3600);
  const minutes = Math.floor((diff % 3600) / 60);
  
  if (days > 0) return { text: `${days}d ${hours}h remaining`, isEnded: false };
  if (hours > 0) return { text: `${hours}h ${minutes}m remaining`, isEnded: false };
  return { text: `${minutes}m remaining`, isEnded: false };
}

export default function ProposalDetail({ proposal, onBack }: ProposalDetailProps) {
  const { status: lana8WonderStatus, isLoading: isLoadingLana8Wonder } = useNostrLana8Wonder();
  const { status: credentialStatus, isLoading: isLoadingCredentials } = useNostrRealLifeCredential();
  const { acknowledgement, isLoading: isLoadingAck, submitVote, refetch } = useNostrUserAcknowledgement(proposal.dTag, proposal.id);
  
  const [voteDialogOpen, setVoteDialogOpen] = useState(false);
  const [voteType, setVoteType] = useState<'yes' | 'resistance'>('yes');
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const timeRemaining = getTimeRemaining(proposal.end);
  const isLoadingPermissions = isLoadingLana8Wonder || isLoadingCredentials;
  
  // Can vote if in quorum (Profile, Registry, Self Responsibility are OK by default)
  const canVote = true;
  
  // Can resist if has Lana8Wonder AND 3+ credentials
  const canResist = lana8WonderStatus.exists && (credentialStatus?.referenceCount || 0) >= 3;

  const handleOpenVoteDialog = (type: 'yes' | 'resistance') => {
    if (type === 'resistance' && !canResist) {
      toast.error("You need Lana8Wonder and at least 3 real-life credentials to resist a proposal");
      return;
    }
    setVoteType(type);
    setVoteDialogOpen(true);
  };

  const handleSubmitVote = async (content: string) => {
    setIsSubmitting(true);
    try {
      await submitVote(voteType, content);
      toast.success(voteType === 'yes' ? 'Acceptance submitted successfully' : 'Resistance submitted successfully');
      setVoteDialogOpen(false);
    } catch (error) {
      toast.error('Failed to submit vote. Please try again.');
      console.error('Vote submission error:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="p-4 max-w-4xl mx-auto">
      {/* Back button */}
      <Button 
        variant="ghost" 
        onClick={onBack} 
        className="mb-4 -ml-2"
      >
        <ArrowLeft className="h-4 w-4 mr-2" />
        Back to Proposals
      </Button>

      {/* Header with image */}
      {proposal.img && (
        <div className="w-full h-48 sm:h-64 overflow-hidden rounded-lg mb-6">
          <img 
            src={proposal.img} 
            alt={proposal.title}
            className="w-full h-full object-cover"
          />
        </div>
      )}

      {/* Title and badges */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold">{proposal.title}</h1>
        <div className="flex gap-2 shrink-0">
          <Badge variant={proposal.level === 'global' ? 'default' : 'secondary'}>
            {proposal.level === 'global' ? (
              <><Globe className="h-3 w-3 mr-1" /> Global</>
            ) : (
              <><MapPin className="h-3 w-3 mr-1" /> Local</>
            )}
          </Badge>
          <Badge variant={timeRemaining.isEnded ? 'destructive' : 'outline'}>
            <Clock className="h-3 w-3 mr-1" />
            {timeRemaining.text}
          </Badge>
        </div>
      </div>

      {/* Short perspective */}
      <p className="text-lg text-muted-foreground mb-6">
        {proposal.shortPerspective}
      </p>

      {/* Long perspective */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Full Perspective</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm leading-relaxed">{proposal.longPerspective}</p>
        </CardContent>
      </Card>

      {/* Consequences */}
      <div className="grid sm:grid-cols-2 gap-4 mb-6">
        <Card className="border-green-500/30 bg-green-500/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2 text-green-600 dark:text-green-400">
              <CheckCircle className="h-4 w-4" />
              If Accepted
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm">{proposal.consequenceYes || 'Not specified'}</p>
          </CardContent>
        </Card>
        
        <Card className="border-red-500/30 bg-red-500/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2 text-red-600 dark:text-red-400">
              <XCircle className="h-4 w-4" />
              If Not Accepted
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm">{proposal.consequenceNo || 'Not specified'}</p>
          </CardContent>
        </Card>
      </div>

      {/* Timeline */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            Timeline
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Started</span>
            <span>{formatDate(proposal.start)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Ends</span>
            <span>{formatDate(proposal.end)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Tally</span>
            <span>{formatDate(proposal.tallyAt)}</span>
          </div>
        </CardContent>
      </Card>

      {/* Resources */}
      {(proposal.youtube || proposal.doc || proposal.link || proposal.donationWallet) && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">Resources</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {proposal.youtube && (
              <a 
                href={proposal.youtube} 
                target="_blank" 
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-sm text-primary hover:underline"
              >
                <Youtube className="h-4 w-4" />
                Watch Video
              </a>
            )}
            {proposal.doc && (
              <a 
                href={proposal.doc} 
                target="_blank" 
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-sm text-primary hover:underline"
              >
                <FileText className="h-4 w-4" />
                View Document
              </a>
            )}
            {proposal.link && (
              <a 
                href={proposal.link} 
                target="_blank" 
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-sm text-primary hover:underline"
              >
                <ExternalLink className="h-4 w-4" />
                External Link
              </a>
            )}
            {proposal.donationWallet && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Wallet className="h-4 w-4" />
                <span className="font-mono text-xs truncate">{proposal.donationWallet}</span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Separator className="my-6" />

      {/* Current vote status */}
      {!isLoadingAck && acknowledgement && (
        <Alert className={acknowledgement.ack === 'yes' 
          ? 'border-green-500/30 bg-green-500/10 mb-4' 
          : 'border-destructive/30 bg-destructive/10 mb-4'}>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="flex items-center justify-between">
            <div>
              <strong>You have already voted: </strong>
              <Badge variant={acknowledgement.ack === 'yes' ? 'default' : 'destructive'} className="ml-2">
                {acknowledgement.ack === 'yes' ? 'Accepted' : 'Resisted'}
              </Badge>
              {acknowledgement.content && (
                <p className="text-sm text-muted-foreground mt-1 italic">"{acknowledgement.content}"</p>
              )}
            </div>
            <Button variant="ghost" size="sm" onClick={() => refetch()} className="shrink-0">
              <RefreshCw className="h-4 w-4" />
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Voting section */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">
          {acknowledgement ? 'Change Your Vote' : 'Cast Your Vote'}
        </h2>
        
        {timeRemaining.isEnded ? (
          <p className="text-muted-foreground">Voting has ended for this proposal.</p>
        ) : (
          <>
            <div className="flex flex-col sm:flex-row gap-3">
              <Button 
                onClick={() => handleOpenVoteDialog('yes')}
                className="flex-1 bg-green-600 hover:bg-green-700"
                disabled={isLoadingPermissions || isLoadingAck}
              >
                <CheckCircle className="h-4 w-4 mr-2" />
                {acknowledgement?.ack === 'yes' ? 'Change Acceptance' : 'Accept Proposal'}
              </Button>
              
              <Button 
                onClick={() => handleOpenVoteDialog('resistance')}
                variant="destructive"
                className="flex-1"
                disabled={isLoadingPermissions || isLoadingAck || !canResist}
              >
                <XCircle className="h-4 w-4 mr-2" />
                {acknowledgement?.ack === 'resistance' ? 'Change Resistance' : 'Resist Proposal'}
              </Button>
            </div>
            
            {!canResist && !isLoadingPermissions && (
              <p className="text-sm text-muted-foreground">
                You can vote to accept, but cannot resist proposals. To resist, you need a Lana8Wonder plan and at least 3 real-life credentials.
              </p>
            )}

            {acknowledgement && (
              <p className="text-sm text-muted-foreground">
                You can change your vote at any time while voting is open.
              </p>
            )}
          </>
        )}
      </div>

      {/* Vote Dialog */}
      <VoteDialog
        isOpen={voteDialogOpen}
        onClose={() => setVoteDialogOpen(false)}
        voteType={voteType}
        proposalTitle={proposal.title}
        onSubmit={handleSubmitVote}
        isSubmitting={isSubmitting}
        existingContent={acknowledgement?.ack === voteType ? acknowledgement.content : ''}
      />
    </div>
  );
}
