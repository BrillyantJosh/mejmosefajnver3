import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  Calendar, Clock, MapPin, Globe, Users, ArrowLeft, 
  ExternalLink, Youtube, FileText, Wallet
} from "lucide-react";
import { format } from "date-fns";
import { SimplePool } from "nostr-tools";
import { useAuth } from "@/contexts/AuthContext";
import { useSystemParameters } from "@/contexts/SystemParametersContext";
import { LanaEvent, getEventStatus } from "@/hooks/useNostrEvents";

const DEFAULT_RELAYS = [
  'wss://relay.lanavault.space',
  'wss://relay.lanacoin-eternity.com',
  'wss://relay.lanaheartvoice.com'
];

export default function EventDetail() {
  const { eventId } = useParams<{ eventId: string }>();
  const navigate = useNavigate();
  const { session } = useAuth();
  const { parameters: systemParameters } = useSystemParameters();
  const [event, setEvent] = useState<LanaEvent | null>(null);
  const [loading, setLoading] = useState(true);

  const relays = systemParameters?.relays && systemParameters.relays.length > 0 
    ? systemParameters.relays 
    : DEFAULT_RELAYS;

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
        location: getTagValue('location'),
        lat,
        lon,
        capacity: capacityStr ? parseInt(capacityStr, 10) : undefined,
        cover: getTagValue('cover'),
        donationWallet: getTagValue('donation_wallet'),
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

  useEffect(() => {
    const fetchEvent = async () => {
      if (!eventId || !session) {
        setLoading(false);
        return;
      }

      setLoading(true);

      try {
        const pool = new SimplePool();
        
        const rawEvents = await pool.querySync(relays, {
          kinds: [36677],
          ids: [eventId]
        });

        if (rawEvents.length > 0) {
          const parsed = parseEvent(rawEvents[0]);
          setEvent(parsed);
        }
      } catch (err) {
        console.error('Error fetching event:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchEvent();
  }, [eventId, session, relays, parseEvent]);

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
      <Button variant="ghost" onClick={() => navigate(-1)}>
        <ArrowLeft className="h-4 w-4 mr-2" />
        Back
      </Button>

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
              </span>
            </div>
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
              {event.youtubeUrl && (
                <Button 
                  variant="outline" 
                  className="w-full"
                  onClick={() => window.open(event.youtubeUrl, '_blank')}
                >
                  <Youtube className="h-4 w-4 mr-2" />
                  Watch on YouTube
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
            <div className="border-t pt-4 space-y-2">
              {event.fiatValue && (
                <div className="text-lg font-medium text-primary">
                  Event Value: €{event.fiatValue}
                </div>
              )}
              {event.donationWallet && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Wallet className="h-4 w-4" />
                  <span className="font-mono">{event.donationWallet}</span>
                </div>
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
        </CardContent>
      </Card>
    </div>
  );
}
