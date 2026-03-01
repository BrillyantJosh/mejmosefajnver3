import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Download, Calendar, MapPin, Globe, Ticket, Loader2 } from "lucide-react";
import { format } from "date-fns";
import QRCode from "react-qr-code";
import { toPng } from "html-to-image";
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

interface AttendeeProfile {
  name?: string;
  picture?: string;
  npub?: string;
}

export default function EventTicket() {
  const { ticketId } = useParams<{ ticketId: string }>();
  const navigate = useNavigate();
  const { session } = useAuth();
  const { parameters } = useSystemParameters();
  const cardRef = useRef<HTMLDivElement>(null);

  const [ticket, setTicket] = useState<TicketData | null>(null);
  const [event, setEvent] = useState<LanaEvent | null>(null);
  const [profile, setProfile] = useState<AttendeeProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);

  const relays = parameters?.relays || [];

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
        lat: latStr ? parseFloat(latStr) : undefined,
        lon: lonStr ? parseFloat(lonStr) : undefined,
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
      if (!ticketId) {
        setLoading(false);
        return;
      }

      try {
        // 1. Fetch ticket from DB
        const { data: ticketData, error: ticketError } = await supabase
          .from('event_tickets')
          .select('*')
          .eq('id', ticketId)
          .single();

        if (ticketError || !ticketData) {
          console.error('Ticket not found:', ticketError);
          setLoading(false);
          return;
        }

        setTicket(ticketData);

        // 2. Fetch event from Nostr relays
        if (relays.length > 0) {
          const pool = new SimplePool();
          const rawEvents = await pool.querySync(relays, {
            kinds: [36677],
            "#d": [ticketData.event_dtag]
          });

          if (rawEvents.length > 0) {
            const latest = rawEvents.reduce((a, b) => b.created_at > a.created_at ? b : a);
            setEvent(parseEvent(latest));
          }

          // 3. Fetch attendee profile (KIND 0)
          const profiles = await pool.querySync(relays, {
            kinds: [0],
            authors: [ticketData.nostr_hex_id],
            limit: 1
          });

          if (profiles.length > 0) {
            try {
              const profileData = JSON.parse(profiles[0].content);
              setProfile({
                name: profileData.name || profileData.display_name,
                picture: profileData.picture,
              });
            } catch {}
          }
        }
      } catch (e) {
        console.error('Error loading ticket:', e);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [ticketId, relays, parseEvent]);

  const handleDownload = async () => {
    if (!cardRef.current) return;
    setDownloading(true);
    try {
      const dataUrl = await toPng(cardRef.current, {
        cacheBust: true,
        pixelRatio: 2,
        backgroundColor: '#ffffff',
      });
      const link = document.createElement('a');
      link.download = `ticket-${ticketId}.png`;
      link.href = dataUrl;
      link.click();
    } catch (e) {
      console.error('Error downloading ticket:', e);
    } finally {
      setDownloading(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4 px-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!ticket) {
    return (
      <div className="space-y-4 px-4">
        <Button variant="ghost" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
        <Card>
          <CardContent className="p-6 text-center">
            <p className="text-muted-foreground">Ticket not found</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4 px-4 pb-24">
      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
        <Button variant="outline" onClick={handleDownload} disabled={downloading}>
          {downloading ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Download className="h-4 w-4 mr-2" />
          )}
          Download
        </Button>
      </div>

      {/* Ticket Card */}
      <div ref={cardRef} className="rounded-2xl overflow-hidden border-2 border-primary/20 bg-white dark:bg-zinc-900">
        {/* Header */}
        <div className="bg-gradient-to-r from-violet-600 to-indigo-600 px-6 py-4 text-white">
          <div className="flex items-center gap-2 mb-1">
            <Ticket className="h-5 w-5" />
            <span className="text-sm font-medium uppercase tracking-wider">Event Ticket</span>
          </div>
          <h2 className="text-xl font-bold">{event?.title || 'Event'}</h2>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4">
          {/* Event Info */}
          {event && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <span>{format(event.start, 'PPP p')}</span>
              </div>
              {event.isOnline ? (
                <div className="flex items-center gap-2 text-sm">
                  <Globe className="h-4 w-4 text-blue-500" />
                  <span>Online Event</span>
                </div>
              ) : event.location ? (
                <div className="flex items-center gap-2 text-sm">
                  <MapPin className="h-4 w-4 text-red-500" />
                  <span>{event.location}</span>
                </div>
              ) : null}
            </div>
          )}

          {/* Divider */}
          <div className="border-t border-dashed" />

          {/* Attendee */}
          <div className="flex items-center gap-3">
            {profile?.picture ? (
              <img
                src={profile.picture}
                alt={profile.name || 'Attendee'}
                className="w-10 h-10 rounded-full object-cover"
              />
            ) : (
              <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center text-muted-foreground text-lg font-bold">
                {(profile?.name || '?')[0].toUpperCase()}
              </div>
            )}
            <div>
              <p className="font-semibold">{profile?.name || 'Anonymous'}</p>
              <p className="text-xs text-muted-foreground font-mono">
                {ticket.nostr_hex_id.substring(0, 8)}...{ticket.nostr_hex_id.substring(ticket.nostr_hex_id.length - 8)}
              </p>
            </div>
          </div>

          {/* Divider */}
          <div className="border-t border-dashed" />

          {/* Payment Info */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Amount Paid</p>
              <p className="text-lg font-bold">{ticket.amount_lana.toFixed(2)} LANA</p>
              {ticket.amount_eur > 0 && (
                <p className="text-sm text-muted-foreground">€{ticket.amount_eur.toFixed(2)}</p>
              )}
            </div>
            <Badge variant={ticket.wallet_type === 'unregistered' ? 'secondary' : 'default'}>
              {ticket.wallet_type}
            </Badge>
          </div>

          {/* Divider */}
          <div className="border-t border-dashed" />

          {/* QR Code */}
          <div className="flex flex-col items-center gap-3">
            <div className="bg-white p-3 rounded-lg">
              <QRCode
                value={ticket.id}
                size={160}
                level="H"
              />
            </div>
            <p className="font-mono text-xs text-muted-foreground text-center">
              {ticket.id}
            </p>
          </div>
        </div>
      </div>

      {/* TX link */}
      {ticket.tx_id && (
        <Button
          variant="outline"
          className="w-full"
          onClick={() => window.open(`https://chainz.cryptoid.info/lana/tx.dws?${ticket.tx_id}.htm`, '_blank')}
        >
          View Transaction on Explorer
        </Button>
      )}
    </div>
  );
}
