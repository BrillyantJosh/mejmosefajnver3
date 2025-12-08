import { useParams, useNavigate } from "react-router-dom";
import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  Calendar, Clock, Globe, MapPin, ExternalLink, Youtube, FileText, 
  Wallet, Loader2, AlertCircle, LogIn, Share2, CheckCircle, XCircle
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { useNostrPublicProposal } from "@/hooks/useNostrPublicProposal";
import { useSystemParameters } from "@/contexts/SystemParametersContext";
import { toast } from "@/hooks/use-toast";

// Helper to format text with line breaks and bold
function FormattedText({ text }: { text: string }) {
  const formattedContent = useMemo(() => {
    if (!text) return null;
    
    const lines = text.split(/\n/);
    
    return lines.map((line, lineIndex) => {
      const parts = line.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
      
      const formattedLine = parts.map((part, partIndex) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={partIndex}>{part.slice(2, -2)}</strong>;
        }
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

export default function PublicProposal() {
  const { dTag } = useParams<{ dTag: string }>();
  const navigate = useNavigate();
  const { parameters } = useSystemParameters();
  
  const decodedDTag = dTag ? decodeURIComponent(dTag) : '';
  
  const relays = parameters?.relays && parameters.relays.length > 0
    ? parameters.relays
    : undefined;

  const { proposal, loading, error } = useNostrPublicProposal(decodedDTag, relays);

  const handleShare = async () => {
    const shareUrl = `${window.location.origin}/proposal/${encodeURIComponent(proposal?.dTag || decodedDTag)}`;
    
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast({
        title: "Link copied!",
        description: "Share this link with anyone"
      });
    } catch (err) {
      toast({
        title: "Copy failed",
        description: shareUrl,
        variant: "destructive"
      });
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="text-center space-y-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" />
          <p className="text-sm text-muted-foreground">Loading proposal from Nostr relays...</p>
        </div>
      </div>
    );
  }

  if (error || !proposal) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="max-w-2xl w-full space-y-4">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              {error || 'Proposal not found'}
            </AlertDescription>
          </Alert>
          <Button 
            onClick={() => window.location.reload()} 
            className="w-full"
          >
            Try Again
          </Button>
          <Button 
            variant="outline"
            onClick={() => navigate('/login')} 
            className="w-full"
          >
            <LogIn className="h-4 w-4 mr-2" />
            Log in to Lana.app
          </Button>
        </div>
      </div>
    );
  }

  const timeRemaining = getTimeRemaining(proposal.end);

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-2xl mx-auto space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Lana Aligns World</h1>
            <p className="text-sm text-muted-foreground">Public proposal details</p>
          </div>
          <Button variant="outline" size="icon" onClick={handleShare}>
            <Share2 className="h-4 w-4" />
          </Button>
        </div>

        {/* Cover Image */}
        {proposal.img && (
          <div className="relative w-full overflow-hidden rounded-lg">
            <img 
              src={proposal.img} 
              alt={proposal.title}
              className="w-full h-auto max-h-[50vh] object-contain mx-auto"
            />
          </div>
        )}

        <Card>
          <CardHeader>
            <div className="flex flex-col gap-3">
              <CardTitle className="text-2xl">{proposal.title}</CardTitle>
              <div className="flex flex-wrap gap-2">
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
          </CardHeader>
          
          <CardContent className="space-y-6">
            {/* Short perspective */}
            <p className="text-base text-muted-foreground">
              {proposal.shortPerspective}
            </p>

            {/* Full perspective */}
            <div className="bg-muted/30 border rounded-lg p-4">
              <h3 className="font-semibold mb-3">Full Perspective</h3>
              <div className="text-sm leading-relaxed whitespace-pre-line">
                <FormattedText text={proposal.longPerspective} />
              </div>
            </div>

            {/* Consequences */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="border border-green-500/30 bg-green-500/5 rounded-lg p-4">
                <div className="flex items-center gap-2 text-green-600 dark:text-green-400 font-medium mb-2">
                  <CheckCircle className="h-4 w-4" />
                  If Accepted
                </div>
                <p className="text-sm">{proposal.consequenceYes || 'Not specified'}</p>
              </div>
              
              <div className="border border-red-500/30 bg-red-500/5 rounded-lg p-4">
                <div className="flex items-center gap-2 text-red-600 dark:text-red-400 font-medium mb-2">
                  <XCircle className="h-4 w-4" />
                  If Not Accepted
                </div>
                <p className="text-sm">{proposal.consequenceNo || 'Not specified'}</p>
              </div>
            </div>

            {/* Timeline */}
            <div className="border rounded-lg p-4">
              <div className="flex items-center gap-2 font-medium mb-3">
                <Calendar className="h-4 w-4" />
                Timeline
              </div>
              <div className="space-y-2 text-sm">
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
              </div>
            </div>

            {/* YouTube Embed */}
            {proposal.youtube && (
              <div className="border rounded-lg p-4">
                <div className="flex items-center gap-2 font-medium mb-3">
                  <Youtube className="h-4 w-4" />
                  Video
                </div>
                <div className="aspect-video rounded-lg overflow-hidden">
                  <iframe
                    src={proposal.youtube.replace('watch?v=', 'embed/').replace('youtu.be/', 'www.youtube.com/embed/')}
                    title="YouTube video"
                    className="w-full h-full"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  />
                </div>
              </div>
            )}

            {/* Resources */}
            {(proposal.doc || proposal.link || proposal.donationWallet) && (
              <div className="border rounded-lg p-4">
                <h3 className="font-medium mb-3">Resources</h3>
                <div className="space-y-3">
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
                </div>
              </div>
            )}

            <Separator />

            {/* CTA for non-logged in users */}
            <div className="bg-primary/10 border border-primary/20 rounded-lg p-4 text-center space-y-3">
              <p className="font-medium">Want to vote on this proposal?</p>
              <p className="text-sm text-muted-foreground">Log in to Lana.app to participate in alignment</p>
              <Button 
                className="w-full"
                onClick={() => navigate('/login')}
              >
                <LogIn className="h-4 w-4 mr-2" />
                Log in to Vote
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
