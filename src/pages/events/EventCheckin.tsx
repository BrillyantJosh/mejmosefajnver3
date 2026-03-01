import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { UserAvatar } from "@/components/ui/UserAvatar";
import {
  ArrowLeft, QrCode, Users, CheckCircle2, Loader2, AlertTriangle,
} from "lucide-react";
import { SimplePool } from "nostr-tools";
import { useAuth } from "@/contexts/AuthContext";
import { useSystemParameters } from "@/contexts/SystemParametersContext";
import { LanaEvent } from "@/hooks/useNostrEvents";
import { useNostrProfileCache } from "@/hooks/useNostrProfileCache";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { QRScanner } from "@/components/QRScanner";

interface TicketRow {
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

interface CheckinRow {
  id: string;
  ticket_id: string;
  checked_in_at: string;
  checked_in_by: string;
}

function AttendeeCheckinRow({
  ticket,
  isCheckedIn,
  onToggle,
  toggling,
}: {
  ticket: TicketRow;
  isCheckedIn: boolean;
  onToggle: (ticketId: string) => void;
  toggling: boolean;
}) {
  const { profile } = useNostrProfileCache(ticket.nostr_hex_id);
  const displayName =
    profile?.display_name || profile?.full_name || ticket.nostr_hex_id.slice(0, 8) + "...";

  return (
    <div
      className={`flex items-center gap-3 py-3 border-b last:border-b-0 ${
        isCheckedIn ? "opacity-70" : ""
      }`}
    >
      <Checkbox
        checked={isCheckedIn}
        onCheckedChange={() => onToggle(ticket.id)}
        disabled={toggling || isCheckedIn}
      />
      <UserAvatar
        pubkey={ticket.nostr_hex_id}
        picture={profile?.picture}
        name={displayName}
        className="h-10 w-10"
      />
      <div className="flex-1 min-w-0">
        <p className="font-medium truncate">{displayName}</p>
        <p className="text-xs text-muted-foreground">
          {ticket.amount_lana.toFixed(2)} LANA
          {ticket.amount_eur > 0 && ` (€${ticket.amount_eur.toFixed(2)})`}
        </p>
      </div>
      <Badge variant={ticket.wallet_type === "unregistered" ? "secondary" : "default"} className="text-xs">
        {ticket.wallet_type}
      </Badge>
      {isCheckedIn && <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />}
    </div>
  );
}

export default function EventCheckin() {
  const { dTag: urlDTag } = useParams<{ dTag: string }>();
  const navigate = useNavigate();
  const { session } = useAuth();
  const { parameters } = useSystemParameters();

  const decodedDTag = urlDTag ? decodeURIComponent(urlDTag) : "";
  const relays = parameters?.relays || [];

  const [event, setEvent] = useState<LanaEvent | null>(null);
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [checkins, setCheckins] = useState<CheckinRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [tab, setTab] = useState<"scan" | "list">("list");

  const checkedInSet = new Set(checkins.map((c) => c.ticket_id));

  const parseEvent = useCallback((rawEvent: any): LanaEvent | null => {
    try {
      const tags = rawEvent.tags || [];
      const getTagValue = (name: string): string | undefined => {
        const tag = tags.find((t: string[]) => t[0] === name);
        return tag ? tag[1] : undefined;
      };
      const getAllTagValues = (name: string): string[] =>
        tags.filter((t: string[]) => t[0] === name).map((t: string[]) => t[1]);

      const title = getTagValue("title");
      const status = getTagValue("status") as "active" | "archived" | "canceled";
      const startStr = getTagValue("start");
      const dTag = getTagValue("d");
      const language = getTagValue("language");
      const eventType = getTagValue("event_type");
      const organizerPubkey = getTagValue("p");

      if (!title || !status || !startStr || !dTag || !language || !eventType || !organizerPubkey)
        return null;

      const start = new Date(startStr);
      if (isNaN(start.getTime())) return null;

      const endStr = getTagValue("end");
      const end = endStr ? new Date(endStr) : undefined;
      const onlineUrl = getTagValue("online");
      const capacityStr = getTagValue("capacity");
      const fiatValueStr = getTagValue("fiat_value");
      const maxGuestsStr = getTagValue("max_guests");

      return {
        id: rawEvent.id,
        pubkey: rawEvent.pubkey,
        created_at: rawEvent.created_at,
        title,
        content: rawEvent.content || "",
        status,
        start,
        end: end && !isNaN(end.getTime()) ? end : undefined,
        language,
        eventType,
        organizerPubkey,
        isOnline: !!onlineUrl,
        onlineUrl,
        youtubeUrl: getTagValue("youtube"),
        location: getTagValue("location"),
        lat: getTagValue("lat") ? parseFloat(getTagValue("lat")!) : undefined,
        lon: getTagValue("lon") ? parseFloat(getTagValue("lon")!) : undefined,
        capacity: capacityStr ? parseInt(capacityStr, 10) : undefined,
        cover: getTagValue("cover"),
        donationWallet: getTagValue("donation_wallet"),
        donationWalletUnreg: getTagValue("donation_wallet_unreg"),
        donationWalletType:
          (getTagValue("donation_wallet_type") as "registered" | "unregistered") || undefined,
        fiatValue: fiatValueStr ? parseFloat(fiatValueStr) : undefined,
        guests: getAllTagValues("guest"),
        attachments: getAllTagValues("attachment"),
        category: getTagValue("category"),
        recording: getTagValue("recording"),
        maxGuests: maxGuestsStr ? parseInt(maxGuestsStr, 10) : undefined,
        dTag,
        timezone: getTagValue("timezone"),
      };
    } catch {
      return null;
    }
  }, []);

  // Load everything
  useEffect(() => {
    const load = async () => {
      if (!decodedDTag || !session) {
        setLoading(false);
        return;
      }

      try {
        // Fetch event
        if (relays.length > 0) {
          const pool = new SimplePool();
          const rawEvents = await pool.querySync(relays, {
            kinds: [36677],
            "#d": [decodedDTag],
          });
          if (rawEvents.length > 0) {
            const latest = rawEvents.reduce((a, b) =>
              b.created_at > a.created_at ? b : a
            );
            setEvent(parseEvent(latest));
          }
        }

        // Fetch tickets
        const { data: ticketData } = await supabase
          .from("event_tickets")
          .select("*")
          .eq("event_dtag", decodedDTag)
          .order("created_at", { ascending: true });

        if (ticketData) setTickets(ticketData);

        // Fetch checkins for these tickets
        if (ticketData && ticketData.length > 0) {
          const ticketIds = ticketData.map((t: TicketRow) => t.id);
          const { data: checkinData } = await supabase
            .from("event_checkins")
            .select("*")
            .in("ticket_id", ticketIds);

          if (checkinData) setCheckins(checkinData);
        }
      } catch (e) {
        console.error("Error loading checkin data:", e);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [decodedDTag, session, relays, parseEvent]);

  const performCheckin = async (ticketId: string) => {
    if (!session?.nostrHexId) return;
    if (checkedInSet.has(ticketId)) {
      toast({ title: "Already checked in", description: "This attendee is already checked in" });
      return;
    }

    setToggling(true);
    try {
      const { data, error } = await supabase
        .from("event_checkins")
        .insert({
          ticket_id: ticketId,
          checked_in_by: session.nostrHexId,
        })
        .select()
        .single();

      if (error) throw error;

      if (data) {
        setCheckins((prev) => [...prev, data]);
        toast({ title: "Checked in!", description: "Attendee checked in successfully" });
      }
    } catch (e: any) {
      console.error("Check-in error:", e);
      toast({
        title: "Check-in failed",
        description: e.message || "Unknown error",
        variant: "destructive",
      });
    } finally {
      setToggling(false);
    }
  };

  const handleScanResult = (scannedId: string) => {
    setShowScanner(false);
    // Look up ticket by scanned ID
    const ticket = tickets.find((t) => t.id === scannedId);
    if (!ticket) {
      toast({
        title: "Invalid ticket",
        description: "Scanned QR does not match any ticket for this event",
        variant: "destructive",
      });
      return;
    }
    performCheckin(ticket.id);
  };

  // Access check — only event creator
  const isOrganizer =
    event && session?.nostrHexId && event.organizerPubkey === session.nostrHexId;

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

  if (!isOrganizer) {
    return (
      <div className="space-y-4 px-4">
        <Button variant="ghost" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
        <Card>
          <CardContent className="p-6 flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            <p className="text-muted-foreground">
              Only the event organizer can access check-in
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const checkedInCount = checkins.length;
  const totalTickets = tickets.length;

  return (
    <div className="space-y-4 px-4 pb-24">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-xl font-bold truncate">Check-in: {event.title}</h1>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-green-500">{checkedInCount}</p>
            <p className="text-sm text-muted-foreground">Checked In</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold">{totalTickets}</p>
            <p className="text-sm text-muted-foreground">Total Tickets</p>
          </CardContent>
        </Card>
      </div>

      {/* Tab Toggle */}
      <div className="flex gap-1">
        <Button
          variant={tab === "scan" ? "default" : "outline"}
          size="sm"
          onClick={() => setTab("scan")}
          className="flex-1"
        >
          <QrCode className="h-4 w-4 mr-2" />
          QR Scan
        </Button>
        <Button
          variant={tab === "list" ? "default" : "outline"}
          size="sm"
          onClick={() => setTab("list")}
          className="flex-1"
        >
          <Users className="h-4 w-4 mr-2" />
          Attendee List
        </Button>
      </div>

      {/* Tab Content */}
      {tab === "scan" ? (
        <Card>
          <CardContent className="p-6 flex flex-col items-center gap-4">
            <QrCode className="h-16 w-16 text-muted-foreground" />
            <p className="text-muted-foreground text-center">
              Scan an attendee's ticket QR code to check them in
            </p>
            <Button onClick={() => setShowScanner(true)} className="w-full">
              <QrCode className="h-4 w-4 mr-2" />
              Open Scanner
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                Paid Attendees
              </span>
              <span className="text-sm font-normal text-muted-foreground">
                {checkedInCount} / {totalTickets}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {tickets.length === 0 ? (
              <p className="text-muted-foreground text-center py-8">
                No paid attendees yet
              </p>
            ) : (
              <div>
                {tickets.map((ticket) => (
                  <AttendeeCheckinRow
                    key={ticket.id}
                    ticket={ticket}
                    isCheckedIn={checkedInSet.has(ticket.id)}
                    onToggle={performCheckin}
                    toggling={toggling}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <QRScanner
        isOpen={showScanner}
        onClose={() => setShowScanner(false)}
        onScan={handleScanResult}
      />
    </div>
  );
}
