import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Ticket, Calendar, Globe, MapPin, ArrowRight } from "lucide-react";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useSystemParameters } from "@/contexts/SystemParametersContext";
import { SimplePool } from "nostr-tools";
import { LanaEvent } from "@/hooks/useNostrEvents";

interface TicketData {
  id: string;
  event_dtag: string;
  nostr_hex_id: string;
  wallet_address: string;
  tx_id: string;
  amount_lana: number;
  amount_eur: number;
  wallet_type: string;
  created_at: string;
}

interface TicketWithEvent extends TicketData {
  event?: LanaEvent;
}

export default function MyTickets() {
  const navigate = useNavigate();
  const { session } = useAuth();
  const { parameters } = useSystemParameters();
  const [tickets, setTickets] = useState<TicketWithEvent[]>([]);
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
        // 1. Fetch all tickets for this user
        const { data: ticketData, error } = await supabase
          .from('event_tickets')
          .select('*')
          .eq('nostr_hex_id', session.nostrHexId)
          .order('created_at', { ascending: false });

        if (error || !ticketData || ticketData.length === 0) {
          setTickets([]);
          setLoading(false);
          return;
        }

        // 2. Fetch events from Nostr for all unique dTags
        const uniqueDTags = [...new Set(ticketData.map((t: TicketData) => t.event_dtag))];
        const eventMap = new Map<string, LanaEvent>();

        if (relays.length > 0 && uniqueDTags.length > 0) {
          const pool = new SimplePool();
          const rawEvents = await pool.querySync(relays, {
            kinds: [36677],
            "#d": uniqueDTags
          });

          // Keep most recent version per dTag
          const latestByDTag = new Map<string, any>();
          for (const raw of rawEvents) {
            const dTag = raw.tags?.find((t: string[]) => t[0] === 'd')?.[1];
            if (dTag) {
              const existing = latestByDTag.get(dTag);
              if (!existing || raw.created_at > existing.created_at) {
                latestByDTag.set(dTag, raw);
              }
            }
          }

          for (const [dTag, raw] of latestByDTag) {
            const parsed = parseEvent(raw);
            if (parsed) eventMap.set(dTag, parsed);
          }
        }

        // 3. Merge tickets with events
        const ticketsWithEvents: TicketWithEvent[] = ticketData.map((t: TicketData) => ({
          ...t,
          event: eventMap.get(t.event_dtag),
        }));

        setTickets(ticketsWithEvents);
      } catch (e) {
        console.error('Error loading tickets:', e);
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
          <Ticket className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
          <h1 className="text-lg sm:text-2xl font-bold">My Tickets</h1>
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
        <p className="text-muted-foreground text-sm sm:text-base">Please log in to see your tickets</p>
      </div>
    );
  }

  return (
    <div className="space-y-3 px-3 sm:px-4 pb-24">
      <div className="flex items-center gap-2 mb-4">
        <Ticket className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
        <h1 className="text-lg sm:text-2xl font-bold">My Tickets</h1>
      </div>

      {tickets.length === 0 ? (
        <div className="text-center py-12">
          <Ticket className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground">You haven't purchased any tickets yet</p>
          <Button variant="outline" className="mt-4" onClick={() => navigate('/events/online')}>
            Browse Events
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {tickets.map(ticket => {
            const event = ticket.event;
            const isPast = event ? (event.end ? event.end < new Date() : new Date(event.start.getTime() + 2 * 60 * 60 * 1000) < new Date()) : false;

            return (
              <Card
                key={ticket.id}
                className={`cursor-pointer hover:shadow-md transition-shadow ${isPast ? 'opacity-60' : ''}`}
                onClick={() => navigate(`/events/ticket/${ticket.id}`)}
              >
                <CardContent className="p-4">
                  <div className="flex gap-3">
                    {/* Event cover */}
                    {event?.cover ? (
                      <img
                        src={event.cover}
                        alt={event.title}
                        className="w-16 h-16 object-cover rounded-lg flex-shrink-0"
                      />
                    ) : (
                      <div className="w-16 h-16 bg-gradient-to-br from-violet-500 to-indigo-600 rounded-lg flex-shrink-0 flex items-center justify-center">
                        <Ticket className="h-6 w-6 text-white" />
                      </div>
                    )}

                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold truncate text-sm sm:text-base">
                        {event?.title || ticket.event_dtag}
                      </h3>

                      {event && (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-1">
                          {event.isOnline ? (
                            <Globe className="h-3 w-3" />
                          ) : (
                            <MapPin className="h-3 w-3" />
                          )}
                          <Calendar className="h-3 w-3 ml-1" />
                          <span>{format(event.start, 'dd.MM.yyyy HH:mm')}</span>
                        </div>
                      )}

                      <div className="flex items-center gap-2 mt-2">
                        <span className="text-sm font-medium">{ticket.amount_lana.toFixed(2)} LANA</span>
                        {ticket.amount_eur > 0 && (
                          <span className="text-xs text-muted-foreground">(€{ticket.amount_eur.toFixed(2)})</span>
                        )}
                        <Badge variant={ticket.wallet_type === 'unregistered' ? 'secondary' : 'default'} className="text-[10px] px-1.5 py-0">
                          {ticket.wallet_type}
                        </Badge>
                      </div>
                    </div>

                    <ArrowRight className="h-4 w-4 text-muted-foreground self-center flex-shrink-0" />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
