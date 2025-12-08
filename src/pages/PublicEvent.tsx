import { useParams, useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { 
  Calendar, Clock, MapPin, Globe, Users, 
  ExternalLink, Youtube, FileText, Wallet, Loader2, AlertCircle, LogIn, Share2, AlertTriangle
} from "lucide-react";
import { format } from "date-fns";
import { useNostrPublicEvent } from "@/hooks/useNostrPublicEvent";
import { useSystemParameters } from "@/contexts/SystemParametersContext";
import { getEventStatus } from "@/hooks/useNostrEvents";
import { getProxiedImageUrl } from "@/lib/imageProxy";
import { toast } from "@/hooks/use-toast";
import { getTimezoneAbbreviation, getUserTimezone, formatTimeInTimezone } from "@/lib/timezones";

export default function PublicEvent() {
  const { dTag } = useParams<{ dTag: string }>();
  const navigate = useNavigate();
  const { parameters } = useSystemParameters();
  
  // Decode the URL-encoded dTag
  const decodedDTag = dTag ? decodeURIComponent(dTag) : '';
  
  const relays = parameters?.relays && parameters.relays.length > 0
    ? parameters.relays
    : undefined;

  const { event, profile, loading, error } = useNostrPublicEvent(decodedDTag, relays);

  const handleShare = async () => {
    // Use dTag for stable URL
    const shareUrl = `${window.location.origin}/event/${encodeURIComponent(event?.dTag || decodedDTag)}`;
    
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

  const getDisplayName = () => {
    if (profile?.display_name) return profile.display_name;
    if (profile?.name) return profile.name;
    if (event?.organizerPubkey) return `${event.organizerPubkey.slice(0, 8)}...`;
    return 'Unknown';
  };

  const getAvatarFallback = () => {
    const displayName = getDisplayName();
    return displayName.slice(0, 2).toUpperCase();
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="text-center space-y-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" />
          <p className="text-sm text-muted-foreground">Loading event from Nostr relays...</p>
        </div>
      </div>
    );
  }

  if (error || !event) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="max-w-2xl w-full space-y-4">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              {error || 'Event not found'}
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

  const status = getEventStatus(event);

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-2xl mx-auto space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Lana Event</h1>
            <p className="text-sm text-muted-foreground">Public event details</p>
          </div>
          <Button variant="outline" size="icon" onClick={handleShare}>
            <Share2 className="h-4 w-4" />
          </Button>
        </div>

        {event.cover && (
          <div className="relative h-48 md:h-64 w-full overflow-hidden rounded-lg">
            <img 
              src={event.cover} 
              alt={event.title}
              className="h-full w-full object-cover"
            />
            {status !== 'upcoming' && (
              <Badge 
                className={`absolute top-4 right-4 text-lg px-4 py-2 ${
                  status === 'happening-now' 
                    ? 'bg-green-500 text-white animate-pulse' 
                    : 'bg-amber-500 text-white'
                }`}
              >
                {status === 'happening-now' ? 'HAPPENING NOW' : 'TODAY'}
              </Badge>
            )}
          </div>
        )}

        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-2">
              <CardTitle className="text-2xl">{event.title}</CardTitle>
              <div className="flex gap-2">
                <Badge variant="secondary">{event.eventType}</Badge>
                <Badge variant="outline">{event.language.toUpperCase()}</Badge>
              </div>
            </div>
            
            {!event.cover && status !== 'upcoming' && (
              <Badge 
                className={`w-fit ${
                  status === 'happening-now' 
                    ? 'bg-green-500 text-white animate-pulse' 
                    : 'bg-amber-500 text-white'
                }`}
              >
                {status === 'happening-now' ? 'HAPPENING NOW' : 'TODAY'}
              </Badge>
            )}
          </CardHeader>
          
          <CardContent className="space-y-6">
            {/* Organizer */}
            <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
              <Avatar>
                <AvatarImage src={getProxiedImageUrl(profile?.picture, Date.now())} />
                <AvatarFallback>{getAvatarFallback()}</AvatarFallback>
              </Avatar>
              <div>
                <p className="text-sm text-muted-foreground">Organized by</p>
                <p className="font-semibold">{getDisplayName()}</p>
              </div>
            </div>

            {/* Date and Time */}
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-lg">
                <Calendar className="h-5 w-5 text-primary" />
                <span className="font-medium">{format(event.start, 'PPPP')}</span>
              </div>
              <div className="flex items-center gap-2 text-lg">
                <Clock className="h-5 w-5 text-primary" />
                <span>
                  {format(event.start, 'HH:mm')}
                  {event.end && ` - ${format(event.end, 'HH:mm')}`}
                  {event.timezone && (
                    <span className="ml-2 text-muted-foreground">
                      ({event.timezone})
                    </span>
                  )}
                </span>
              </div>
              
              {/* Show user's local time if different timezone */}
              {event.timezone && event.timezone !== getUserTimezone() && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 rounded-lg px-3 py-2">
                  <Clock className="h-4 w-4" />
                  <span>
                    Your local time: {format(event.start, 'HH:mm')}
                    {event.end && ` - ${format(event.end, 'HH:mm')}`}
                    {' '}({getTimezoneAbbreviation(event.start, getUserTimezone())})
                  </span>
                </div>
              )}
              
              {!event.timezone && (
                <div className="flex items-center gap-2 text-sm text-amber-500">
                  <AlertTriangle className="h-4 w-4" />
                  <span>Legacy event - timezone not specified (assumed Europe/Ljubljana)</span>
                </div>
              )}
            </div>

            {/* Location */}
            {event.isOnline ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Globe className="h-5 w-5 text-blue-500" />
                  <span className="font-medium text-blue-500">Online Event</span>
                </div>
                {event.youtubeUrl && (() => {
                  const getYouTubeId = (url: string): string | null => {
                    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
                    const match = url.match(regExp);
                    return match && match[2].length === 11 ? match[2] : null;
                  };
                  const videoId = getYouTubeId(event.youtubeUrl);
                  return videoId ? (
                    <div className="aspect-video w-full rounded-lg overflow-hidden">
                      <iframe
                        src={`https://www.youtube.com/embed/${videoId}`}
                        title="YouTube video"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                        className="w-full h-full"
                      />
                    </div>
                  ) : null;
                })()}
                {event.onlineUrl && (
                  <Button 
                    variant="outline" 
                    className="w-full"
                    onClick={() => window.open(event.onlineUrl, '_blank')}
                  >
                    <ExternalLink className="h-4 w-4 mr-2" />
                    Join Event
                  </Button>
                )}
                {event.youtubeUrl && (
                  <Button 
                    variant="outline" 
                    className="w-full"
                    onClick={() => window.open(event.youtubeUrl, '_blank')}
                  >
                    <Youtube className="h-4 w-4 mr-2" />
                    Open on YouTube
                  </Button>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                {event.location && (
                  <div className="flex items-center gap-2">
                    <MapPin className="h-5 w-5 text-red-500" />
                    <span className="font-medium">{event.location}</span>
                  </div>
                )}
                {event.lat && event.lon && (
                  <Button 
                    variant="outline" 
                    className="w-full"
                    onClick={() => window.open(`https://www.google.com/maps?q=${event.lat},${event.lon}`, '_blank')}
                  >
                    <MapPin className="h-4 w-4 mr-2" />
                    Open in Maps
                  </Button>
                )}
                {event.capacity && (
                  <div className="flex items-center gap-2">
                    <Users className="h-5 w-5" />
                    <span>Capacity: {event.capacity} people</span>
                  </div>
                )}
              </div>
            )}

            {/* Value and Donation */}
            {(event.fiatValue || event.donationWallet) && (
              <div className="border-t pt-4 space-y-3">
                {event.fiatValue && (
                  <div className="text-lg font-medium text-primary">
                    Event Value: €{event.fiatValue}
                  </div>
                )}
                {event.donationWallet && (
                  <>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Wallet className="h-4 w-4" />
                      <span className="font-mono truncate">{event.donationWallet}</span>
                    </div>
                    <Button 
                      className="w-full"
                      onClick={() => navigate('/login')}
                    >
                      <Wallet className="h-4 w-4 mr-2" />
                      {event.fiatValue ? `Pay €${event.fiatValue}` : 'Donate'} (Login required)
                    </Button>
                  </>
                )}
              </div>
            )}

            {/* Description */}
            {event.content && (
              <div className="border-t pt-4">
                <h3 className="font-semibold mb-2">Description</h3>
                <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap">
                  {event.content}
                </div>
              </div>
            )}

            {/* Attachments */}
            {event.attachments && event.attachments.length > 0 && (
              <div className="border-t pt-4">
                <h3 className="font-semibold mb-2">Attachments</h3>
                <div className="space-y-2">
                  {event.attachments.map((url, index) => (
                    <Button 
                      key={index}
                      variant="outline" 
                      className="w-full justify-start"
                      onClick={() => window.open(url, '_blank')}
                    >
                      <FileText className="h-4 w-4 mr-2" />
                      {url.split('/').pop() || `Attachment ${index + 1}`}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {/* Recording */}
            {event.recording && (
              <div className="border-t pt-4">
                <h3 className="font-semibold mb-2">Recording</h3>
                <Button 
                  variant="outline" 
                  className="w-full"
                  onClick={() => window.open(event.recording, '_blank')}
                >
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Watch Recording
                </Button>
              </div>
            )}

            {/* CTA for non-logged in users */}
            <div className="border-t pt-6">
              <div className="bg-primary/10 border border-primary/20 rounded-lg p-4 text-center space-y-3">
                <p className="font-medium">Want to register for this event?</p>
                <p className="text-sm text-muted-foreground">Log in to Lana.app to register and attend</p>
                <Button 
                  className="w-full"
                  onClick={() => navigate('/login')}
                >
                  <LogIn className="h-4 w-4 mr-2" />
                  Log in to Register
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
