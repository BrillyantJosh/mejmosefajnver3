import { useState, useMemo } from 'react';
import { ArrowLeft, Globe, MapPin, Calendar, ExternalLink, FileText, Youtube, CheckCircle, XCircle, Clock, Wallet, AlertCircle, RefreshCw } from "lucide-react";

// Helper to format text with line breaks and bold
function FormattedText({ text }: { text: string }) {
  const formattedContent = useMemo(() => {
    if (!text) return null;
    
    // Split by line breaks
    const lines = text.split(/\n/);
    
    return lines.map((line, lineIndex) => {
      // Process bold text with ** or *
      const parts = line.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
      
      const formattedLine = parts.map((part, partIndex) => {
        // Check for **bold** pattern
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={partIndex}>{part.slice(2, -2)}</strong>;
        }
        // Check for *bold* pattern
        if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
          return <strong key={partIndex}>{part.slice(1, -1)}</strong>;
        }
        return part;
      });
      
      return (
        <span key={lineIndex}>
          {formattedLine}
          {lineIndex < lines.length - 1 && <br />}
        </span>
      );
    });
  }, [text]);
  
  return <>{formattedContent}</>;
}
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
    <div className="px-3 py-4 sm:p-4 max-w-4xl mx-auto">
      {/* Back button */}
      <Button 
        variant="ghost" 
        onClick={onBack} 
        className="mb-3 sm:mb-4 -ml-2 h-9 text-sm"
        size="sm"
      >
        <ArrowLeft className="h-4 w-4 mr-1.5" />
        Back
      </Button>

      {/* Header with image */}
      {proposal.img && (
        <div className="w-full h-40 sm:h-48 md:h-64 overflow-hidden rounded-lg mb-4 sm:mb-6">
          <img 
            src={proposal.img} 
            alt={proposal.title}
            className="w-full h-full object-cover"
          />
        </div>
      )}

      {/* Title and badges */}
      <div className="flex flex-col gap-2 sm:gap-3 mb-4 sm:mb-6">
        <h1 className="text-xl sm:text-2xl md:text-3xl font-bold leading-tight">{proposal.title}</h1>
        <div className="flex flex-wrap gap-1.5 sm:gap-2">
          <Badge variant={proposal.level === 'global' ? 'default' : 'secondary'} className="text-[10px] sm:text-xs">
            {proposal.level === 'global' ? (
              <><Globe className="h-2.5 w-2.5 sm:h-3 sm:w-3 mr-0.5 sm:mr-1" /> Global</>
            ) : (
              <><MapPin className="h-2.5 w-2.5 sm:h-3 sm:w-3 mr-0.5 sm:mr-1" /> Local</>
            )}
          </Badge>
          <Badge variant={timeRemaining.isEnded ? 'destructive' : 'outline'} className="text-[10px] sm:text-xs">
            <Clock className="h-2.5 w-2.5 sm:h-3 sm:w-3 mr-0.5 sm:mr-1" />
            {timeRemaining.text}
          </Badge>
        </div>
      </div>

      {/* Short perspective */}
      <p className="text-sm sm:text-base md:text-lg text-muted-foreground mb-4 sm:mb-6">
        {proposal.shortPerspective}
      </p>

      {/* Long perspective */}
      <Card className="mb-4 sm:mb-6">
        <CardHeader className="p-3 sm:p-4 pb-2">
          <CardTitle className="text-sm sm:text-base">Full Perspective</CardTitle>
        </CardHeader>
        <CardContent className="p-3 sm:p-4 pt-0">
          <div className="text-xs sm:text-sm leading-relaxed whitespace-pre-line">
            <FormattedText text={proposal.longPerspective} />
          </div>
        </CardContent>
      </Card>

      {/* Consequences */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 mb-4 sm:mb-6">
        <Card className="border-green-500/30 bg-green-500/5">
          <CardHeader className="p-3 sm:p-4 pb-1 sm:pb-2">
            <CardTitle className="text-sm sm:text-base flex items-center gap-1.5 sm:gap-2 text-green-600 dark:text-green-400">
              <CheckCircle className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              If Accepted
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 sm:p-4 pt-0">
            <p className="text-xs sm:text-sm">{proposal.consequenceYes || 'Not specified'}</p>
          </CardContent>
        </Card>
        
        <Card className="border-red-500/30 bg-red-500/5">
          <CardHeader className="p-3 sm:p-4 pb-1 sm:pb-2">
            <CardTitle className="text-sm sm:text-base flex items-center gap-1.5 sm:gap-2 text-red-600 dark:text-red-400">
              <XCircle className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              If Not Accepted
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 sm:p-4 pt-0">
            <p className="text-xs sm:text-sm">{proposal.consequenceNo || 'Not specified'}</p>
          </CardContent>
        </Card>
      </div>

      {/* Timeline */}
      <Card className="mb-4 sm:mb-6">
        <CardHeader className="p-3 sm:p-4 pb-2">
          <CardTitle className="text-sm sm:text-base flex items-center gap-1.5 sm:gap-2">
            <Calendar className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            Timeline
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3 sm:p-4 pt-0 space-y-1.5 sm:space-y-2 text-xs sm:text-sm">
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

      {/* YouTube Embed */}
      {proposal.youtube && (
        <Card className="mb-4 sm:mb-6">
          <CardHeader className="p-3 sm:p-4 pb-2">
            <CardTitle className="text-sm sm:text-base flex items-center gap-1.5 sm:gap-2">
              <Youtube className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              Video
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 sm:p-4 pt-0">
            <div className="aspect-video rounded-lg overflow-hidden">
              <iframe
                src={proposal.youtube.replace('watch?v=', 'embed/').replace('youtu.be/', 'www.youtube.com/embed/')}
                title="YouTube video"
                className="w-full h-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Other Resources */}
      {(proposal.doc || proposal.link || proposal.donationWallet) && (
        <Card className="mb-4 sm:mb-6">
          <CardHeader className="p-3 sm:p-4 pb-2">
            <CardTitle className="text-sm sm:text-base">Resources</CardTitle>
          </CardHeader>
          <CardContent className="p-3 sm:p-4 pt-0 space-y-2 sm:space-y-3">
            {proposal.doc && (
              <a 
                href={proposal.doc} 
                target="_blank" 
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 sm:gap-2 text-xs sm:text-sm text-primary hover:underline"
              >
                <FileText className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                View Document
              </a>
            )}
            {proposal.link && (
              <a 
                href={proposal.link} 
                target="_blank" 
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 sm:gap-2 text-xs sm:text-sm text-primary hover:underline"
              >
                <ExternalLink className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                External Link
              </a>
            )}
            {proposal.donationWallet && (
              <div className="flex items-center gap-1.5 sm:gap-2 text-xs sm:text-sm text-muted-foreground">
                <Wallet className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                <span className="font-mono text-[10px] sm:text-xs truncate max-w-[200px] sm:max-w-none">{proposal.donationWallet}</span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Separator className="my-4 sm:my-6" />

      {/* Current vote status */}
      {!isLoadingAck && acknowledgement && (
        <Alert className={`${acknowledgement.ack === 'yes' 
          ? 'border-green-500/30 bg-green-500/10' 
          : 'border-destructive/30 bg-destructive/10'} mb-3 sm:mb-4`}>
          <AlertCircle className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
          <AlertDescription className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex-1">
              <span className="text-xs sm:text-sm font-medium">You have already voted: </span>
              <Badge variant={acknowledgement.ack === 'yes' ? 'default' : 'destructive'} className="ml-1.5 sm:ml-2 text-[10px] sm:text-xs">
                {acknowledgement.ack === 'yes' ? 'Accepted' : 'Resisted'}
              </Badge>
              {acknowledgement.content && (
                <p className="text-[10px] sm:text-sm text-muted-foreground mt-1 italic">"{acknowledgement.content}"</p>
              )}
            </div>
            <Button variant="ghost" size="sm" onClick={() => refetch()} className="shrink-0 h-7 w-7 p-0 sm:h-8 sm:w-8">
              <RefreshCw className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Voting section */}
      <div className="space-y-3 sm:space-y-4">
        <h2 className="text-base sm:text-lg font-semibold">
          {acknowledgement ? 'Change Your Vote' : 'Cast Your Vote'}
        </h2>
        
        {timeRemaining.isEnded ? (
          <p className="text-xs sm:text-sm text-muted-foreground">Voting has ended for this proposal.</p>
        ) : (
          <>
            <div className="flex flex-col gap-2 sm:gap-3">
              <Button 
                onClick={() => handleOpenVoteDialog('yes')}
                className="w-full bg-green-600 hover:bg-green-700 h-10 sm:h-11 text-sm sm:text-base"
                disabled={isLoadingPermissions || isLoadingAck}
              >
                <CheckCircle className="h-4 w-4 mr-1.5 sm:mr-2" />
                {acknowledgement?.ack === 'yes' ? 'Change Acceptance' : 'Accept Proposal'}
              </Button>
              
              <Button 
                onClick={() => handleOpenVoteDialog('resistance')}
                variant="destructive"
                className="w-full h-10 sm:h-11 text-sm sm:text-base"
                disabled={isLoadingPermissions || isLoadingAck || !canResist}
              >
                <XCircle className="h-4 w-4 mr-1.5 sm:mr-2" />
                {acknowledgement?.ack === 'resistance' ? 'Change Resistance' : 'Resist Proposal'}
              </Button>
            </div>
            
            {!canResist && !isLoadingPermissions && (
              <p className="text-[10px] sm:text-sm text-muted-foreground">
                You can vote to accept, but cannot resist proposals. To resist, you need a Lana8Wonder plan and at least 3 real-life credentials.
              </p>
            )}

            {acknowledgement && (
              <p className="text-[10px] sm:text-sm text-muted-foreground">
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
