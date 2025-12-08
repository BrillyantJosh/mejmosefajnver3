import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar, Clock, MapPin, Globe, Users, UserPlus, Check, Loader2, Share2, Wallet, AlertTriangle } from "lucide-react";
import { format } from "date-fns";
import { LanaEvent, getEventStatus } from "@/hooks/useNostrEvents";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useSystemParameters } from "@/contexts/SystemParametersContext";
import { useNostrEventRegistrations } from "@/hooks/useNostrEventRegistrations";
import { SimplePool, finalizeEvent } from "nostr-tools";
import { toast } from "@/hooks/use-toast";
import { getTimezoneAbbreviation, getUserTimezone, formatTimeInTimezone } from "@/lib/timezones";

const DEFAULT_RELAYS = [
  'wss://relay.lanavault.space',
  'wss://relay.lanacoin-eternity.com',
  'wss://relay.lanaheartvoice.com'
];

interface EventCardProps {
  event: LanaEvent;
}

export function EventCard({ event }: EventCardProps) {
  const navigate = useNavigate();
  const { session } = useAuth();
  const { parameters: systemParameters } = useSystemParameters();
  const [registering, setRegistering] = useState(false);
  const [unregistering, setUnregistering] = useState(false);
  
  const { registrations, userRegistration, refetch } = useNostrEventRegistrations(event.dTag);
  
  const relays = systemParameters?.relays && systemParameters.relays.length > 0 
    ? systemParameters.relays 
    : DEFAULT_RELAYS;

  const status = getEventStatus(event);

  const handleClick = () => {
    navigate(`/events/detail/${encodeURIComponent(event.dTag)}`);
  };

  const handleDonateClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    
    // Calculate LANA amount if fiatValue is set
    // Exchange rate format: 1 LANA = X EUR (e.g., 0.004)
    // To convert EUR to LANA: EUR / exchangeRate = LANA
    let preFilledLanaAmount: number | undefined;
    if (event.fiatValue && systemParameters?.exchangeRates?.EUR) {
      preFilledLanaAmount = event.fiatValue / systemParameters.exchangeRates.EUR;
    }
    
    navigate(`/events/donate/${encodeURIComponent(event.dTag)}`, {
      state: {
        isPay: !!event.fiatValue,
        preFilledLanaAmount
      }
    });
  };

  const handleRegister = async (e: React.MouseEvent) => {
    e.stopPropagation();
    
    if (!session?.nostrPrivateKey || !session?.nostrHexId) {
      toast({
        title: "Error",
        description: "You must be logged in to register",
        variant: "destructive"
      });
      return;
    }

    setRegistering(true);

    try {
      const pool = new SimplePool();
      const privKeyBytes = new Uint8Array(session.nostrPrivateKey.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));

      const tags: string[][] = [
        ["event", event.dTag],
        ["status", "going"],
        ["p", session.nostrHexId],
        ["seats", "1"],
        ["source", "Lana.app"]
      ];

      const registrationEvent = finalizeEvent({
        kind: 53333,
        created_at: Math.floor(Date.now() / 1000),
        tags,
        content: "",
      }, privKeyBytes);

      const publishPromises = pool.publish(relays, registrationEvent);
      const publishArray = Array.from(publishPromises);
      let successCount = 0;

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          if (successCount === 0) {
            reject(new Error('Publish timeout'));
          } else {
            resolve();
          }
        }, 10000);

        publishArray.forEach((promise) => {
          promise
            .then(() => {
              successCount++;
              if (successCount === 1) {
                clearTimeout(timeout);
                resolve();
              }
            })
            .catch(() => {});
        });
      });

      toast({
        title: "Registered!",
        description: "You're going to this event!"
      });

      refetch();

    } catch (error) {
      console.error('Error registering:', error);
      toast({
        title: "Error registering",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive"
      });
    } finally {
      setRegistering(false);
    }
  };

  const handleUnregister = async (e: React.MouseEvent) => {
    e.stopPropagation();
    
    if (!session?.nostrPrivateKey || !session?.nostrHexId || !userRegistration) {
      return;
    }

    setUnregistering(true);

    try {
      const pool = new SimplePool();
      const privKeyBytes = new Uint8Array(session.nostrPrivateKey.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));

      // KIND 5 is the deletion event in Nostr
      const deleteEvent = finalizeEvent({
        kind: 5,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ["e", userRegistration.id],
          ["k", "53333"]
        ],
        content: "Cancelled registration",
      }, privKeyBytes);

      const publishPromises = pool.publish(relays, deleteEvent);
      const publishArray = Array.from(publishPromises);
      let successCount = 0;

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          if (successCount === 0) {
            reject(new Error('Publish timeout'));
          } else {
            resolve();
          }
        }, 10000);

        publishArray.forEach((promise) => {
          promise
            .then(() => {
              successCount++;
              if (successCount === 1) {
                clearTimeout(timeout);
                resolve();
              }
            })
            .catch(() => {});
        });
      });

      toast({
        title: "Unregistered",
        description: "Your registration has been cancelled"
      });

      refetch();

    } catch (error) {
      console.error('Error unregistering:', error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive"
      });
    } finally {
      setUnregistering(false);
    }
  };

  return (
    <Card 
      className={`cursor-pointer transition-all hover:shadow-lg ${
        status === 'happening-now' 
          ? 'ring-2 ring-green-500 bg-green-500/10' 
          : status === 'today' 
            ? 'ring-2 ring-amber-500 bg-amber-500/10' 
            : ''
      }`}
      onClick={handleClick}
    >
      {event.cover && (
        <div className="relative h-32 sm:h-40 w-full overflow-hidden rounded-t-lg">
          <img 
            src={event.cover} 
            alt={event.title}
            className="h-full w-full object-cover"
          />
          {status !== 'upcoming' && (
            <Badge 
              className={`absolute top-2 right-2 text-xs ${
                status === 'happening-now' 
                  ? 'bg-green-500 text-white animate-pulse' 
                  : 'bg-amber-500 text-white'
              }`}
            >
              {status === 'happening-now' ? 'NOW' : 'TODAY'}
            </Badge>
          )}
        </div>
      )}
      
      <CardContent className={`p-3 sm:p-4 ${!event.cover ? 'pt-3 sm:pt-4' : ''}`}>
        {!event.cover && status !== 'upcoming' && (
          <Badge 
            className={`mb-2 text-xs ${
              status === 'happening-now' 
                ? 'bg-green-500 text-white animate-pulse' 
                : 'bg-amber-500 text-white'
            }`}
          >
            {status === 'happening-now' ? 'NOW' : 'TODAY'}
          </Badge>
        )}
        
        <div className="flex items-start justify-between gap-2 mb-2">
          <h3 className="font-semibold text-base sm:text-lg line-clamp-2">{event.title}</h3>
          <Badge variant="secondary" className="shrink-0 text-xs">
            {event.eventType}
          </Badge>
        </div>
        
        <div className="space-y-1.5 text-xs sm:text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <Calendar className="h-3.5 w-3.5 sm:h-4 sm:w-4 shrink-0" />
            <span className="truncate">{format(event.start, 'dd.MM.yyyy')}</span>
            <Clock className="h-3.5 w-3.5 sm:h-4 sm:w-4 shrink-0 ml-1" />
            <span>
              {format(event.start, 'HH:mm')}
              {event.end && ` - ${format(event.end, 'HH:mm')}`}
              {event.timezone && (
                <span className="ml-1 text-muted-foreground">
                  ({getTimezoneAbbreviation(event.start, event.timezone)})
                </span>
              )}
            </span>
          </div>
          
          {!event.timezone && (
            <div className="flex items-center gap-1 text-amber-500">
              <AlertTriangle className="h-3 w-3" />
              <span className="text-xs">Legacy event (no timezone)</span>
            </div>
          )}
          
          {event.isOnline ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Globe className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-blue-500 shrink-0" />
                <span className="text-blue-500">Online</span>
              </div>
              {event.youtubeUrl && (() => {
                const getYouTubeId = (url: string): string | null => {
                  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
                  const match = url.match(regExp);
                  return match && match[2].length === 11 ? match[2] : null;
                };
                const videoId = getYouTubeId(event.youtubeUrl);
                return videoId ? (
                  <div 
                    className="aspect-video w-full rounded-lg overflow-hidden"
                    onClick={(e) => e.stopPropagation()}
                  >
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
            </div>
          ) : (
            event.location && (
              <div className="flex items-center gap-2">
                <MapPin className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-red-500 shrink-0" />
                <span className="line-clamp-1">{event.location}</span>
              </div>
            )
          )}
        </div>
        
        {event.content && (
          <p className="mt-2 text-xs sm:text-sm text-muted-foreground line-clamp-2">
            {event.content.replace(/\*\*/g, '').replace(/\n/g, ' ')}
          </p>
        )}

        {event.fiatValue && (
          <div className="mt-2 text-xs sm:text-sm font-medium text-primary">
            €{event.fiatValue}
          </div>
        )}

        {/* Donate/Pay Button */}
        {event.donationWallet && (
          <div className="mt-2">
            <Button
              variant="outline"
              size="sm"
              className="w-full h-8 text-xs sm:text-sm"
              onClick={handleDonateClick}
            >
              <Wallet className="h-3.5 w-3.5 sm:h-4 sm:w-4 mr-1.5" />
              {event.fiatValue ? `Pay €${event.fiatValue}` : 'Donate'}
            </Button>
          </div>
        )}

        {/* Registration Section */}
        <div className="mt-3 pt-2 sm:pt-3 border-t flex items-center justify-between gap-1 sm:gap-2">
          <div className="flex items-center gap-1.5 text-xs sm:text-sm text-muted-foreground">
            <Users className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            <span>{registrations.length}</span>
          </div>
          
          <div className="flex items-center gap-1 sm:gap-2">
            <Button 
              variant="ghost" 
              size="icon"
              className="h-7 w-7 sm:h-8 sm:w-8"
              onClick={handleShare}
            >
              <Share2 className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            </Button>
            
            {userRegistration ? (
              <Button 
                variant="outline" 
                size="sm"
                className="h-7 sm:h-8 text-xs sm:text-sm px-2 sm:px-3 bg-green-500/10 border-green-500/30 text-green-600 hover:bg-red-500/10 hover:border-red-500/30 hover:text-red-600"
                onClick={handleUnregister}
                disabled={unregistering}
              >
                {unregistering ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <>
                    <Check className="h-3.5 w-3.5 sm:mr-1" />
                    <span className="hidden sm:inline">Going</span>
                  </>
                )}
              </Button>
            ) : (
              <Button 
                size="sm"
                className="h-7 sm:h-8 text-xs sm:text-sm px-2 sm:px-3"
                onClick={handleRegister}
                disabled={registering}
              >
                {registering ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <>
                    <UserPlus className="h-3.5 w-3.5 sm:mr-1" />
                    <span className="hidden sm:inline">I'm Going</span>
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );

  function handleShare(e: React.MouseEvent) {
    e.stopPropagation();
    // Use dTag for stable URL
    const shareUrl = `${window.location.origin}/event/${encodeURIComponent(event.dTag)}`;
    
    navigator.clipboard.writeText(shareUrl).then(() => {
      toast({
        title: "Link copied!",
        description: "Share this link with anyone"
      });
    }).catch(() => {
      toast({
        title: "Copy failed",
        description: shareUrl,
        variant: "destructive"
      });
    });
  }
}
