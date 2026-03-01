import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { UserAvatar } from '@/components/ui/UserAvatar';
import { ArrowLeft, Users, Calendar, Edit, QrCode } from "lucide-react";
import { format } from "date-fns";
import { SimplePool } from "nostr-tools";
import { useAuth } from "@/contexts/AuthContext";
import { useSystemParameters } from "@/contexts/SystemParametersContext";
import { LanaEvent, getEventStatus } from "@/hooks/useNostrEvents";
import { useNostrEventRegistrations, EventRegistration } from "@/hooks/useNostrEventRegistrations";
import { useNostrProfileCache } from "@/hooks/useNostrProfileCache";

function AttendeeRow({ registration }: { registration: EventRegistration }) {
  const { profile, isLoading } = useNostrProfileCache(registration.pubkey);
  
  const displayName = profile?.display_name || profile?.full_name || registration.pubkey.slice(0, 8) + '...';
  
  return (
    <div className="flex items-center gap-3 py-3 border-b last:border-b-0">
      <UserAvatar pubkey={registration.pubkey} picture={profile?.picture} name={displayName} className="h-10 w-10" />
      <div className="flex-1 min-w-0">
        <p className="font-medium truncate">{displayName}</p>
        {registration.note && (
          <p className="text-sm text-muted-foreground truncate">{registration.note}</p>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Badge variant={registration.status === 'going' ? 'default' : 'secondary'}>
          {registration.status === 'going' ? 'Going' : 'Interested'}
        </Badge>
        {registration.seats && registration.seats > 1 && (
          <Badge variant="outline">{registration.seats} seats</Badge>
        )}
      </div>
    </div>
  );
}

export default function EventRegistrations() {
  const { dTag: urlDTag } = useParams<{ dTag: string }>();
  const navigate = useNavigate();
  const { session } = useAuth();
  const { parameters: systemParameters } = useSystemParameters();
  const [event, setEvent] = useState<LanaEvent | null>(null);
  const [loading, setLoading] = useState(true);

  // Decode the URL-encoded dTag
  const decodedDTag = urlDTag ? decodeURIComponent(urlDTag) : '';

  const relays = systemParameters?.relays || [];

  const { registrations, loading: loadingRegistrations } = useNostrEventRegistrations(event?.dTag || decodedDTag);

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
        donationWalletUnreg: getTagValue('donation_wallet_unreg'),
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

  const goingCount = registrations.filter(r => r.status === 'going').length;
  const interestedCount = registrations.filter(r => r.status === 'interested').length;
  const totalSeats = registrations.reduce((sum, r) => sum + (r.seats || 1), 0);

  if (loading) {
    return (
      <div className="space-y-4 px-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!event) {
    return (
      <div className="space-y-4 px-4">
        <Button variant="ghost" onClick={() => navigate('/events/my')}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
        <p className="text-muted-foreground">Event not found</p>
      </div>
    );
  }

  const status = getEventStatus(event);

  return (
    <div className="space-y-4 px-4 pb-24">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => navigate('/events/my')}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-xl font-bold truncate">{event.title}</h1>
      </div>

      {/* Event Summary Card */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-4">
            {event.cover && (
              <img 
                src={event.cover} 
                alt={event.title}
                className="w-16 h-16 object-cover rounded-lg flex-shrink-0"
              />
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Calendar className="h-4 w-4" />
                <span>{format(event.start, 'dd.MM.yyyy HH:mm')}</span>
              </div>
              <div className="flex gap-2 mt-2 flex-wrap">
                {status === 'happening-now' && (
                  <Badge className="bg-green-500 text-white">NOW</Badge>
                )}
                {status === 'today' && (
                  <Badge className="bg-amber-500 text-white">TODAY</Badge>
                )}
                <Badge variant="outline">{event.isOnline ? 'Online' : 'Live'}</Badge>
              </div>
            </div>
            <div className="flex gap-1">
              <Button variant="outline" size="sm" onClick={() => navigate(`/events/checkin/${encodeURIComponent(event.dTag)}`)}>
                <QrCode className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="sm" onClick={() => navigate(`/events/edit/${event.id}`)}>
                <Edit className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Registration Stats */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-primary">{goingCount}</p>
            <p className="text-sm text-muted-foreground">Going</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold">{interestedCount}</p>
            <p className="text-sm text-muted-foreground">Interested</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold">{totalSeats}</p>
            <p className="text-sm text-muted-foreground">Total Seats</p>
          </CardContent>
        </Card>
      </div>

      {/* Registrations List */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Registered Attendees ({registrations.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loadingRegistrations ? (
            <div className="space-y-4">
              {[1, 2, 3].map(i => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : registrations.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">
              No one has registered yet
            </p>
          ) : (
            <div>
              {registrations.map(reg => (
                <AttendeeRow key={reg.id} registration={reg} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
