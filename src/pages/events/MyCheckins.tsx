import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { QrCode, Calendar, Globe, MapPin, Users, CheckCircle2 } from "lucide-react";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useSystemParameters } from "@/contexts/SystemParametersContext";
import { SimplePool } from "nostr-tools";
import { LanaEvent, getEventStatus } from "@/hooks/useNostrEvents";

interface TicketStats {
  total: number;
  checkedIn: number;
}

interface EventWithStats extends LanaEvent {
  ticketStats: TicketStats;
}

export default function MyCheckins() {
  const navigate = useNavigate();
  const { session } = useAuth();
  const { parameters } = useSystemParameters();
  const [events, setEvents] = useState<EventWithStats[]>([]);
  const [loading, setLoading] = useState(true);

  const relays = parameters?.relays || [];

  const parseEvent = useCallback((rawEvent: any): LanaEvent | null => {
    try {
      const tags = rawEvent.tags || [];
      const getTagValue = (name: string): string | undefined => {
        const tag = tags.find((t: string[]) => t[0] === name);
        return tag ? tag[1] : undefined;
      };
      const getAllTagValues = (name: string): string[] =>
        tags.filter((t: string[]) => t[0] === name).map((t: string[]) => t[1]);

      const title = getTagValue('title');
      const status = getTagValue('status') as 'active' | 'archived' | 'canceled';
      const startStr = getTagValue('start');
      const dTag = getTagValue('d');
      const language = getTagValue('language');
      const eventType = getTagValue('event_type');
      const organizerPubkey = getTagValue('p');

      if (!title || !status || !startStr || !dTag || !language || !eventType || !organizerPubkey)
        return null;

      const start = new Date(startStr);
      if (isNaN(start.getTime())) return null;

      const endStr = getTagValue('end');
      const end = endStr ? new Date(endStr) : undefined;
      const onlineUrl = getTagValue('online');
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
        isOnline: !!onlineUrl,
        onlineUrl,
        youtubeUrl: getTagValue('youtube'),
        location: getTagValue('location'),
        lat: getTagValue('lat') ? parseFloat(getTagValue('lat')!) : undefined,
        lon: getTagValue('lon') ? parseFloat(getTagValue('lon')!) : undefined,
        capacity: capacityStr ? parseInt(capacityStr, 10) : undefined,
        cover: getTagValue('cover'),
        donationWallet: getTagValue('donation_wallet'),
        donationWalletUnreg: getTagValue('donation_wallet_unreg'),
        donationWalletType: (getTagValue('donation_wallet_type') as 'registered' | 'unregistered') || undefined,
        fiatValue: fiatValueStr ? parseFloat(fiatValueStr) : undefined,
        guests: getAllTagValues('guest'),
        attachments: getAllTagValues('attachment'),
        category: getTagValue('category'),
        recording: getTagValue('recording'),
        maxGuests: maxGuestsStr ? parseInt(maxGuestsStr, 10) : undefined,
        dTag,
        timezone: getTagValue('timezone'),
      };
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    const load = async () => {
      if (!session?.nostrHexId) {
        setLoading(false);
        return;
      }

      try {
        // 1. Fetch all my events from Nostr (I'm the organizer)
        if (relays.length === 0) {
          setLoading(false);
          return;
        }

        const pool = new SimplePool();
        const rawEvents = await pool.querySync(relays, {
          kinds: [36677],
          authors: [session.nostrHexId],
          limit: 100
        });

        // Parse and deduplicate by dTag
        const parsedEvents: LanaEvent[] = [];
        const seenDTags = new Set<string>();
        const sortedEvents = [...rawEvents].sort((a, b) => b.created_at - a.created_at);

        for (const rawEvent of sortedEvents) {
          const parsed = parseEvent(rawEvent);
          if (parsed && parsed.status === 'active') {
            if (!seenDTags.has(parsed.dTag)) {
              seenDTags.add(parsed.dTag);
              parsedEvents.push(parsed);
            }
          }
        }

        if (parsedEvents.length === 0) {
          setEvents([]);
          setLoading(false);
          return;
        }

        // 2. Fetch ticket counts for all events
        const allDTags = parsedEvents.map(e => e.dTag);
        const { data: allTickets } = await supabase
          .from('event_tickets')
          .select('id, event_dtag')
          .in('event_dtag', allDTags);

        // 3. Fetch checkin counts
        let checkinMap = new Map<string, number>();
        if (allTickets && allTickets.length > 0) {
          const ticketIds = allTickets.map((t: any) => t.id);
          const { data: allCheckins } = await supabase
            .from('event_checkins')
            .select('ticket_id')
            .in('ticket_id', ticketIds);

          if (allCheckins) {
            // Map checkin ticket_id back to event_dtag
            const ticketToDTag = new Map<string, string>();
            for (const t of allTickets) {
              ticketToDTag.set(t.id, t.event_dtag);
            }
            for (const c of allCheckins) {
              const dTag = ticketToDTag.get(c.ticket_id);
              if (dTag) {
                checkinMap.set(dTag, (checkinMap.get(dTag) || 0) + 1);
              }
            }
          }
        }

        // 4. Build ticket stats per event
        const ticketCountMap = new Map<string, number>();
        if (allTickets) {
          for (const t of allTickets) {
            ticketCountMap.set(t.event_dtag, (ticketCountMap.get(t.event_dtag) || 0) + 1);
          }
        }

        // 5. Merge and sort (upcoming first, then past)
        const eventsWithStats: EventWithStats[] = parsedEvents.map(event => ({
          ...event,
          ticketStats: {
            total: ticketCountMap.get(event.dTag) || 0,
            checkedIn: checkinMap.get(event.dTag) || 0,
          }
        }));

        // Sort: upcoming events first (by start ascending), then past events (by start descending)
        eventsWithStats.sort((a, b) => {
          const now = new Date();
          const aIsPast = a.end ? a.end < now : new Date(a.start.getTime() + 2 * 60 * 60 * 1000) < now;
          const bIsPast = b.end ? b.end < now : new Date(b.start.getTime() + 2 * 60 * 60 * 1000) < now;

          if (aIsPast && !bIsPast) return 1;
          if (!aIsPast && bIsPast) return -1;
          if (!aIsPast && !bIsPast) return a.start.getTime() - b.start.getTime();
          return b.start.getTime() - a.start.getTime();
        });

        setEvents(eventsWithStats);
      } catch (e) {
        console.error('Error loading checkin events:', e);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [session?.nostrHexId, relays, parseEvent]);

  if (loading) {
    return (
      <div className="space-y-3 px-3 sm:px-4">
        <div className="flex items-center gap-2 mb-4">
          <QrCode className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
          <h1 className="text-lg sm:text-2xl font-bold">Check-in</h1>
        </div>
        {[1, 2, 3].map(i => (
          <Skeleton key={i} className="h-28 w-full" />
        ))}
      </div>
    );
  }

  if (!session) {
    return (
      <div className="px-3 sm:px-4 text-center py-12">
        <p className="text-muted-foreground text-sm sm:text-base">Please log in to manage check-ins</p>
      </div>
    );
  }

  return (
    <div className="space-y-3 px-3 sm:px-4 pb-24">
      <div className="flex items-center gap-2 mb-4">
        <QrCode className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
        <h1 className="text-lg sm:text-2xl font-bold">Check-in</h1>
      </div>

      {events.length === 0 ? (
        <div className="text-center py-12">
          <QrCode className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground">You haven't created any events yet</p>
          <Button variant="outline" className="mt-4" onClick={() => navigate('/events/add')}>
            Create Event
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {events.map(event => {
            const isPast = event.end ? event.end < new Date() : new Date(event.start.getTime() + 2 * 60 * 60 * 1000) < new Date();
            const status = getEventStatus(event);
            const { total, checkedIn } = event.ticketStats;
            const allCheckedIn = total > 0 && checkedIn === total;

            return (
              <Card
                key={event.id}
                className={`${isPast ? 'opacity-60' : ''}`}
              >
                <CardContent className="p-4">
                  <div className="flex gap-3">
                    {/* Event cover */}
                    {event.cover ? (
                      <img
                        src={event.cover}
                        alt={event.title}
                        className="w-16 h-16 object-cover rounded-lg flex-shrink-0"
                      />
                    ) : (
                      <div className="w-16 h-16 bg-gradient-to-br from-violet-500 to-indigo-600 rounded-lg flex-shrink-0 flex items-center justify-center">
                        <Calendar className="h-6 w-6 text-white" />
                      </div>
                    )}

                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold truncate text-sm sm:text-base">{event.title}</h3>

                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-1">
                        {event.isOnline ? (
                          <Globe className="h-3 w-3" />
                        ) : (
                          <MapPin className="h-3 w-3" />
                        )}
                        <Calendar className="h-3 w-3 ml-1" />
                        <span>{format(event.start, 'dd.MM.yyyy HH:mm')}</span>
                      </div>

                      <div className="flex items-center gap-2 mt-2">
                        {status === 'happening-now' && (
                          <Badge className="bg-green-500 hover:bg-green-600 text-white text-[10px] px-1.5 py-0">NOW</Badge>
                        )}
                        {status === 'today' && (
                          <Badge className="bg-amber-500 hover:bg-amber-600 text-white text-[10px] px-1.5 py-0">TODAY</Badge>
                        )}
                        {isPast && <Badge variant="secondary" className="text-[10px] px-1.5 py-0">PAST</Badge>}

                        {/* Ticket stats */}
                        <div className="flex items-center gap-1 text-xs text-muted-foreground ml-auto">
                          <Users className="h-3 w-3" />
                          <span>{total} ticket{total !== 1 ? 's' : ''}</span>
                          {total > 0 && (
                            <>
                              <span className="mx-0.5">·</span>
                              {allCheckedIn ? (
                                <CheckCircle2 className="h-3 w-3 text-green-500" />
                              ) : (
                                <span className="text-green-600">{checkedIn} in</span>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Check-in button */}
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full mt-3"
                    onClick={() => navigate(`/events/checkin/${encodeURIComponent(event.dTag)}`)}
                  >
                    <QrCode className="h-4 w-4 mr-2" />
                    {total === 0 ? 'Open Check-in' : `Check-in (${checkedIn}/${total})`}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
