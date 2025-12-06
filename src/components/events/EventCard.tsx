import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar, Clock, MapPin, Globe, Users, UserPlus, Check, Loader2, Share2 } from "lucide-react";
import { format } from "date-fns";
import { LanaEvent, getEventStatus } from "@/hooks/useNostrEvents";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useSystemParameters } from "@/contexts/SystemParametersContext";
import { useNostrEventRegistrations } from "@/hooks/useNostrEventRegistrations";
import { SimplePool, finalizeEvent } from "nostr-tools";
import { toast } from "@/hooks/use-toast";

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
    navigate(`/events/detail/${event.id}`);
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
        <div className="relative h-40 w-full overflow-hidden rounded-t-lg">
          <img 
            src={event.cover} 
            alt={event.title}
            className="h-full w-full object-cover"
          />
          {status !== 'upcoming' && (
            <Badge 
              className={`absolute top-2 right-2 ${
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
      
      <CardContent className={`p-4 ${!event.cover ? 'pt-4' : ''}`}>
        {!event.cover && status !== 'upcoming' && (
          <Badge 
            className={`mb-2 ${
              status === 'happening-now' 
                ? 'bg-green-500 text-white animate-pulse' 
                : 'bg-amber-500 text-white'
            }`}
          >
            {status === 'happening-now' ? 'HAPPENING NOW' : 'TODAY'}
          </Badge>
        )}
        
        <div className="flex items-start justify-between gap-2 mb-2">
          <h3 className="font-semibold text-lg line-clamp-2">{event.title}</h3>
          <Badge variant="secondary" className="shrink-0">
            {event.eventType}
          </Badge>
        </div>
        
        <div className="space-y-2 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            <span>{format(event.start, 'PPP')}</span>
          </div>
          
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4" />
            <span>
              {format(event.start, 'HH:mm')}
              {event.end && ` - ${format(event.end, 'HH:mm')}`}
            </span>
          </div>
          
          {event.isOnline ? (
            <div className="flex items-center gap-2">
              <Globe className="h-4 w-4 text-blue-500" />
              <span className="text-blue-500">Online Event</span>
            </div>
          ) : (
            event.location && (
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-red-500" />
                <span className="line-clamp-1">{event.location}</span>
              </div>
            )
          )}
        </div>
        
        {event.content && (
          <p className="mt-3 text-sm text-muted-foreground line-clamp-2">
            {event.content.replace(/\*\*/g, '').replace(/\n/g, ' ')}
          </p>
        )}

        {event.fiatValue && (
          <div className="mt-3 text-sm font-medium text-primary">
            Value: €{event.fiatValue}
          </div>
        )}

        {/* Registration Section */}
        <div className="mt-4 pt-3 border-t flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Users className="h-4 w-4" />
            <span>{registrations.length} going</span>
          </div>
          
          <div className="flex items-center gap-2">
            <Button 
              variant="ghost" 
              size="icon"
              className="h-8 w-8"
              onClick={handleShare}
            >
              <Share2 className="h-4 w-4" />
            </Button>
            
            {userRegistration ? (
              <Button 
                variant="outline" 
                size="sm"
                className="bg-green-500/10 border-green-500/30 text-green-600 hover:bg-red-500/10 hover:border-red-500/30 hover:text-red-600"
                onClick={handleUnregister}
                disabled={unregistering}
              >
                {unregistering ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Check className="h-4 w-4 mr-1" />
                    Going
                  </>
                )}
              </Button>
            ) : (
              <Button 
                size="sm"
                onClick={handleRegister}
                disabled={registering}
              >
                {registering ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <UserPlus className="h-4 w-4 mr-1" />
                    I'm Going
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
    const shareUrl = `${window.location.origin}/event/${event.id}`;
    
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
