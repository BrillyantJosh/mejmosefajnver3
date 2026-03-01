import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  Calendar, Clock, MapPin, Globe, Users, ArrowLeft, 
  ExternalLink, Youtube, FileText, Wallet, UserPlus, Check, Loader2, X, Share2, AlertTriangle, Timer
} from "lucide-react";
import { format } from "date-fns";
import { SimplePool, finalizeEvent } from "nostr-tools";
import { useAuth } from "@/contexts/AuthContext";
import { useSystemParameters } from "@/contexts/SystemParametersContext";
import { LanaEvent, getEventStatus } from "@/hooks/useNostrEvents";
import { useNostrEventRegistrations } from "@/hooks/useNostrEventRegistrations";
import { toast } from "@/hooks/use-toast";
import { formatTimeInTimezone, getTimezoneAbbreviation, getUserTimezone } from "@/lib/timezones";
import { useEventCountdown } from "@/hooks/useEventCountdown";
import { useCoinGeckoRate } from "@/hooks/useCoinGeckoRate";
import { supabase } from "@/integrations/supabase/client";
import { Ticket } from "lucide-react";
export default function EventDetail() {
  const { dTag: urlDTag } = useParams<{ dTag: string }>();
  const navigate = useNavigate();
  const { session } = useAuth();
  const { parameters: systemParameters } = useSystemParameters();
  const [event, setEvent] = useState<LanaEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [registering, setRegistering] = useState(false);
  const [existingTicketId, setExistingTicketId] = useState<string | null>(null);
  const { rate: marketRate } = useCoinGeckoRate();

  // Decode the URL-encoded dTag
  const decodedDTag = urlDTag ? decodeURIComponent(urlDTag) : '';

  const { registrations, userRegistration, refetch: refetchRegistrations } = useNostrEventRegistrations(event?.dTag || decodedDTag);

  // Countdown hook - must be called unconditionally (before any early returns)
  const countdown = useEventCountdown(event?.start || new Date());

  const relays = systemParameters?.relays || [];

  // Check if user already has a ticket for this event
  useEffect(() => {
    if (!session?.nostrHexId || !decodedDTag) return;
    const checkTicket = async () => {
      try {
        const { data } = await supabase
          .from('event_tickets')
          .select('id')
          .eq('event_dtag', decodedDTag)
          .eq('nostr_hex_id', session.nostrHexId)
          .limit(1);
        if (data && data.length > 0) {
          setExistingTicketId(data[0].id);
        }
      } catch (e) {
        console.error('Error checking ticket:', e);
      }
    };
    checkTicket();
  }, [session?.nostrHexId, decodedDTag]);

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

  const parseEvent = useCallback((rawEvent: any): LanaEvent | null => {
    try {
      const tags = rawEvent.tags || [];
      const getTagValue = (name: string): string | undefined => {
        const tag = tags.find((t: string[]) => t[0] === name);
        return tag ? tag[1] : undefined;
      };
      const getAllTagValues = (name: string): string[] => {
        return tags.filter((t: string[]) => t[0] === name).map((t: string[]) => t[1]);
      };

      const title = getTagValue('title');
      const status = getTagValue('status') as 'active' | 'archived' | 'canceled';
      const startStr = getTagValue('start');
      const dTag = getTagValue('d');
      const language = getTagValue('language');
      const eventType = getTagValue('event_type');
      const organizerPubkey = getTagValue('p');

      if (!title || !status || !startStr || !dTag || !language || !eventType || !organizerPubkey) {
        return null;
      }

      const start = new Date(startStr);
      if (isNaN(start.getTime())) return null;

      const endStr = getTagValue('end');
      const end = endStr ? new Date(endStr) : undefined;

      const onlineUrl = getTagValue('online');
      const isOnline = !!onlineUrl;

      const latStr = getTagValue('lat');
      const lonStr = getTagValue('lon');
      const lat = latStr ? parseFloat(latStr) : undefined;
      const lon = lonStr ? parseFloat(lonStr) : undefined;

      const capacityStr = getTagValue('capacity');
      const fiatValueStr = getTagValue('fiat_value');
      const maxGuestsStr = getTagValue('max_guests');

      return {
        id: rawEvent.id,
        pubkey: rawEvent.pubkey,
        created_at: rawEvent.created_at,
        title,
        content: rawEvent.content || '',
        status,
        start,
        end: end && !isNaN(end.getTime()) ? end : undefined,
        language,
        eventType,
        organizerPubkey,
        isOnline,
        onlineUrl,
        youtubeUrl: getTagValue('youtube'),
        youtubeRecordingUrl: getTagValue('youtube_recording'),
        location: getTagValue('location'),
        lat,
        lon,
        capacity: capacityStr ? parseInt(capacityStr, 10) : undefined,
        cover: getTagValue('cover'),
        donationWallet: getTagValue('donation_wallet'),
        donationWalletType: (getTagValue('donation_wallet_type') as 'registered' | 'unregistered') || undefined,
        fiatValue: fiatValueStr ? parseFloat(fiatValueStr) : undefined,
        guests: getAllTagValues('guest'),
        attachments: getAllTagValues('attachment'),
        category: getTagValue('category'),
        recording: getTagValue('recording'),
        maxGuests: maxGuestsStr ? parseInt(maxGuestsStr, 10) : undefined,
        dTag,
      };
    } catch (err) {
      console.error('Error parsing event:', err);
      return null;
    }
  }, []);

  const handleDonateClick = () => {
    if (!event) return;
    
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

  useEffect(() => {
    const fetchEvent = async () => {
      if (!decodedDTag || !session) {
        setLoading(false);
        return;
      }

      setLoading(true);

      try {
        const pool = new SimplePool();
        
        // Fetch by d tag for replaceable events
        const rawEvents = await pool.querySync(relays, {
          kinds: [36677],
          "#d": [decodedDTag]
        });

        if (rawEvents.length > 0) {
          // Get the most recent event (by created_at) since it's a replaceable event
          const latestEvent = rawEvents.reduce((latest, current) => 
            current.created_at > latest.created_at ? current : latest
          );
          const parsed = parseEvent(latestEvent);
          setEvent(parsed);
        }
      } catch (err) {
        console.error('Error fetching event:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchEvent();
  }, [decodedDTag, session, relays, parseEvent]);

  if (loading) {
    return (
      <div className="space-y-4 px-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (!event) {
    return (
      <div className="space-y-4 px-4">
        <Button variant="ghost" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
        <Card>
          <CardContent className="p-6">
            <p className="text-muted-foreground">Event not found</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const status = getEventStatus(event);

  return (
    <div className="space-y-4 px-4 pb-24">
      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
        <Button variant="outline" size="icon" onClick={handleShare}>
          <Share2 className="h-4 w-4" />
        </Button>
      </div>

      {event.cover && (
        <div className="relative w-full overflow-hidden rounded-lg bg-muted/30">
          <img 
            src={event.cover} 
            alt={event.title}
            className="w-full h-auto max-h-[70vh] object-contain mx-auto"
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
          {/* Countdown */}
          {countdown.isWithin12Hours && !countdown.isStarted && (
            <div className="bg-primary/10 border border-primary/30 rounded-lg p-4 flex items-center justify-center gap-3">
              <Timer className="h-5 w-5 text-primary animate-pulse" />
              <span className="text-lg font-semibold text-primary">
                Starts in {countdown.displayString}
              </span>
            </div>
          )}
          
          {/* Date and Time */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-lg">
              <Calendar className="h-5 w-5 text-primary" />
              <span className="font-medium">{format(event.start, 'PPPP')}</span>
            </div>
            <div className="flex items-center gap-2 text-lg">
              <Clock className="h-5 w-5 text-primary" />
              <span>
                {formatTimeInTimezone(event.start, event.timezone || 'Europe/Ljubljana')}
                {event.end && ` - ${formatTimeInTimezone(event.end, event.timezone || 'Europe/Ljubljana')}`}
                <span className="ml-2 text-muted-foreground">
                  ({getTimezoneAbbreviation(event.start, event.timezone || 'Europe/Ljubljana')})
                </span>
              </span>
            </div>
            
            {/* Show user's local time if different timezone */}
            {(event.timezone || 'Europe/Ljubljana') !== getUserTimezone() && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 rounded-lg px-3 py-2">
                <Clock className="h-4 w-4" />
                <span>
                  Your local time: {formatTimeInTimezone(event.start, getUserTimezone())}
                  {event.end && ` - ${formatTimeInTimezone(event.end, getUserTimezone())}`}
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
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Globe className="h-5 w-5 text-blue-500" />
                <span className="font-medium text-blue-500">Online Event</span>
              </div>
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
              {event.youtubeRecordingUrl && (
                <Button 
                  variant="default" 
                  className="w-full"
                  onClick={() => window.open(event.youtubeRecordingUrl, '_blank')}
                >
                  <Youtube className="h-4 w-4 mr-2" />
                  Posnetek dogodka
                </Button>
              )}
              {event.youtubeUrl && (
                <Button 
                  variant="outline" 
                  className="w-full"
                  onClick={() => window.open(event.youtubeUrl, '_blank')}
                >
                  <Youtube className="h-4 w-4 mr-2" />
                  Promo Video
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
                <>
                  <div className="text-lg font-medium text-primary">
                    Event Value: €{event.fiatValue}
                  </div>
                  {/* Dual pricing display */}
                  <div className="bg-muted/50 rounded-lg p-3 space-y-2">
                    {systemParameters?.exchangeRates?.EUR && (
                      <div className="flex justify-between items-center text-sm">
                        <span className="text-muted-foreground">Registered LANA:</span>
                        <span className="font-semibold">
                          {(event.fiatValue / systemParameters.exchangeRates.EUR).toFixed(2)} LANA
                        </span>
                      </div>
                    )}
                    {marketRate && (
                      <div className="flex justify-between items-center text-sm">
                        <span className="text-muted-foreground">Market LANA:</span>
                        <span className="font-semibold">
                          {(event.fiatValue / marketRate).toFixed(2)} LANA
                        </span>
                      </div>
                    )}
                  </div>
                </>
              )}
              {event.donationWallet && (
                <>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Wallet className="h-4 w-4" />
                    <span className="font-mono">{event.donationWallet}</span>
                  </div>
                  {existingTicketId ? (
                    <Button
                      className="w-full"
                      variant="outline"
                      onClick={() => navigate(`/events/ticket/${existingTicketId}`)}
                    >
                      <Ticket className="h-4 w-4 mr-2" />
                      View Ticket
                    </Button>
                  ) : (
                    <Button
                      className="w-full"
                      onClick={handleDonateClick}
                    >
                      <Wallet className="h-4 w-4 mr-2" />
                      {event.fiatValue ? `Pay €${event.fiatValue}` : 'Donate'}
                    </Button>
                  )}
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
          {event.attachments.length > 0 && (
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

          {/* Registration Section */}
          <div className="border-t pt-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold">Registration</h3>
              <Badge variant="secondary">
                <Users className="h-3 w-3 mr-1" />
                {registrations.length} going
              </Badge>
            </div>
            
            {userRegistration ? (
              <div className="space-y-3">
                <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4">
                  <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
                    <Check className="h-5 w-5" />
                    <span className="font-medium">You are going!</span>
                  </div>
                </div>
                <Button 
                  variant="outline" 
                  className="w-full text-destructive hover:bg-destructive/10"
                  onClick={handleUnregister}
                  disabled={registering}
                >
                  {registering ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <X className="h-4 w-4 mr-2" />
                  )}
                  Cancel Registration
                </Button>
              </div>
            ) : (
              <Button 
                className="w-full"
                onClick={handleRegister}
                disabled={registering}
              >
                {registering && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                <UserPlus className="h-4 w-4 mr-2" />
                I'm Going
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );

  async function handleRegister() {
    if (!session?.nostrPrivateKey || !session?.nostrHexId || !event?.dTag) {
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

      console.log('Publishing registration:', registrationEvent);

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

      refetchRegistrations();

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
  }

  async function handleUnregister() {
    if (!session?.nostrPrivateKey || !session?.nostrHexId || !userRegistration) {
      return;
    }

    setRegistering(true);

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

      refetchRegistrations();

    } catch (error) {
      console.error('Error unregistering:', error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive"
      });
    } finally {
      setRegistering(false);
    }
  }
}
