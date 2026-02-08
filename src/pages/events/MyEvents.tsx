import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { SimplePool } from "nostr-tools";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Calendar, Globe, MapPin, Edit, Users, ChevronDown, ChevronUp, User, Plus } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useSystemParameters } from "@/contexts/SystemParametersContext";
import { format } from "date-fns";
import { LanaEvent, getEventStatus } from "@/hooks/useNostrEvents";
import { useNostrEventRegistrationsBatch, EventRegistration } from "@/hooks/useNostrEventRegistrations";
import { useNostrProfileCache } from "@/hooks/useNostrProfileCache";

function AttendeeRow({ registration }: { registration: EventRegistration }) {
  const { profile } = useNostrProfileCache(registration.pubkey);
  const displayName = profile?.display_name || profile?.full_name || registration.pubkey.slice(0, 8) + '...';
  
  return (
    <div className="flex items-center gap-2 py-2">
      <Avatar className="h-8 w-8">
        {profile?.picture ? (
          <AvatarImage src={profile.picture} alt={displayName} />
        ) : null}
        <AvatarFallback>
          <User className="h-3 w-3" />
        </AvatarFallback>
      </Avatar>
      <span className="text-sm flex-1 truncate">{displayName}</span>
      <Badge variant={registration.status === 'going' ? 'default' : 'secondary'} className="text-xs">
        {registration.status === 'going' ? 'Going' : 'Interested'}
      </Badge>
    </div>
  );
}

interface EventCardWithRegistrationsProps {
  event: LanaEvent;
  registrations: EventRegistration[];
  onEdit: (eventId: string) => void;
}

function EventCardWithRegistrations({ event, registrations, onEdit }: EventCardWithRegistrationsProps) {
  const [isOpen, setIsOpen] = useState(false);
  const status = getEventStatus(event);
  const isPast = event.end ? event.end < new Date() : new Date(event.start.getTime() + 2 * 60 * 60 * 1000) < new Date();
  
  const goingCount = registrations.filter(r => r.status === 'going').length;
  const interestedCount = registrations.filter(r => r.status === 'interested').length;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <Card className={`${isPast ? 'opacity-60' : ''}`}>
        <CardContent className="p-4">
          <div className="flex gap-4">
            {event.cover && (
              <img 
                src={event.cover} 
                alt={event.title}
                className="w-20 h-20 object-cover rounded-lg flex-shrink-0"
              />
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-semibold truncate">{event.title}</h3>
                <Button 
                  variant="ghost" 
                  size="icon"
                  className="h-8 w-8 flex-shrink-0"
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdit(event.id);
                  }}
                >
                  <Edit className="h-4 w-4" />
                </Button>
              </div>
              
              <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
                {event.isOnline ? (
                  <Globe className="h-3 w-3" />
                ) : (
                  <MapPin className="h-3 w-3" />
                )}
                <span>{format(event.start, 'dd.MM.yyyy HH:mm')}</span>
              </div>

              <div className="flex gap-2 mt-2 flex-wrap">
                {status === 'happening-now' && (
                  <Badge className="bg-green-500 hover:bg-green-600 text-white">NOW</Badge>
                )}
                {status === 'today' && (
                  <Badge className="bg-amber-500 hover:bg-amber-600 text-white">TODAY</Badge>
                )}
                {isPast && <Badge variant="secondary">PAST</Badge>}
                {event.status === 'canceled' && <Badge variant="destructive">CANCELED</Badge>}
                <Badge variant="outline" className="text-xs">
                  {event.isOnline ? 'Online' : 'Live'}
                </Badge>
              </div>
            </div>
          </div>

          {/* Registration Stats */}
          <div className="mt-4 pt-3 border-t">
            <CollapsibleTrigger asChild>
              <div className="flex items-center justify-between cursor-pointer hover:bg-accent/50 rounded p-2 -m-2">
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-1">
                    <Users className="h-4 w-4 text-primary" />
                    <span className="font-medium">{registrations.length}</span>
                    <span className="text-sm text-muted-foreground">registered</span>
                  </div>
                  {goingCount > 0 && (
                    <Badge variant="default" className="text-xs">{goingCount} going</Badge>
                  )}
                  {interestedCount > 0 && (
                    <Badge variant="secondary" className="text-xs">{interestedCount} interested</Badge>
                  )}
                </div>
                {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </div>
            </CollapsibleTrigger>
          </div>

          <CollapsibleContent>
            <div className="mt-3 max-h-64 overflow-y-auto">
              {registrations.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No registrations yet</p>
              ) : (
                <div className="divide-y">
                  {registrations.map(reg => (
                    <AttendeeRow key={reg.id} registration={reg} />
                  ))}
                </div>
              )}
            </div>
          </CollapsibleContent>
        </CardContent>
      </Card>
    </Collapsible>
  );
}

export default function MyEvents() {
  const navigate = useNavigate();
  const { session } = useAuth();
  const { parameters: systemParameters } = useSystemParameters();
  const [events, setEvents] = useState<LanaEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const relays = systemParameters?.relays || [];

  // Get all event slugs for batch registration fetching
  const eventSlugs = events.map(e => e.dTag);
  const { registrationsByEvent, loading: loadingRegistrations } = useNostrEventRegistrationsBatch(eventSlugs);

  const parseEvent = (event: any): LanaEvent | null => {
    try {
      const tags = event.tags || [];
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
        id: event.id,
        pubkey: event.pubkey,
        created_at: event.created_at,
        title,
        content: event.content || '',
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
        timezone: getTagValue('timezone'),
      };
    } catch (err) {
      console.error('Error parsing event:', err);
      return null;
    }
  };

  const fetchMyEvents = useCallback(async () => {
    if (!session?.nostrHexId) {
      setLoading(false);
      return;
    }

    setLoading(true);

    try {
      const pool = new SimplePool();
      
      const rawEvents = await pool.querySync(relays, {
        kinds: [36677],
        authors: [session.nostrHexId],
        limit: 100
      });

      console.log('Fetched my events:', rawEvents.length);

      const parsedEvents: LanaEvent[] = [];
      const seenDTags = new Set<string>();
      const sortedEvents = [...rawEvents].sort((a, b) => b.created_at - a.created_at);

      for (const rawEvent of sortedEvents) {
        const parsed = parseEvent(rawEvent);
        if (parsed) {
          if (!seenDTags.has(parsed.dTag)) {
            seenDTags.add(parsed.dTag);
            parsedEvents.push(parsed);
          }
        }
      }

      // Sort by start date ascending
      parsedEvents.sort((a, b) => a.start.getTime() - b.start.getTime());
      setEvents(parsedEvents);

    } catch (err) {
      console.error('Error fetching my events:', err);
    } finally {
      setLoading(false);
    }
  }, [session?.nostrHexId, relays]);

  useEffect(() => {
    fetchMyEvents();
  }, [fetchMyEvents]);

  if (loading) {
    return (
      <div className="space-y-3 px-3 sm:px-4">
        <div className="flex items-center gap-2 mb-4">
          <Calendar className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
          <h1 className="text-lg sm:text-2xl font-bold">My Events</h1>
        </div>
        {[1, 2, 3].map(i => (
          <Skeleton key={i} className="h-32 sm:h-40 w-full" />
        ))}
      </div>
    );
  }

  if (!session) {
    return (
      <div className="px-3 sm:px-4 text-center py-12">
        <p className="text-muted-foreground text-sm sm:text-base">Please log in to see your events</p>
      </div>
    );
  }

  return (
    <div className="space-y-3 px-3 sm:px-4 pb-24">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Calendar className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
          <h1 className="text-lg sm:text-2xl font-bold">My Events</h1>
        </div>
        <Button onClick={() => navigate('/events/add')} size="sm">
          <Plus className="h-4 w-4 mr-1" />
          Add
        </Button>
      </div>

      {events.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-muted-foreground">You haven't created any events yet</p>
        </div>
      ) : (
        <div className="space-y-4">
          {events.map(event => (
            <EventCardWithRegistrations
              key={event.id}
              event={event}
              registrations={registrationsByEvent[event.dTag] || []}
              onEdit={(id) => navigate(`/events/edit/${id}`)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
