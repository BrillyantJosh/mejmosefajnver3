import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { RefreshCw, CheckCircle2, XCircle, Clock, Network, Send } from "lucide-react";
import { toast } from "sonner";
import { finalizeEvent } from "nostr-tools";

interface PendingEvent {
  id: string;
  event_id: string;
  event_kind: number;
  signed_event: string;
  retry_count: number;
  status: string;
  created_at: string;
  last_attempt_at: string | null;
  published_at: string | null;
}

interface RetryResult {
  relay: string;
  success: boolean;
  error?: string;
}

export default function RetryEvents() {
  const { session } = useAuth();
  const [events, setEvents] = useState<PendingEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [lastResults, setLastResults] = useState<Map<string, RetryResult[]>>(new Map());

  const fetchEvents = useCallback(async () => {
    if (!session?.nostrHexId) return;

    try {
      const { data, error } = await supabase.functions.invoke('get-pending-events', {
        body: { userPubkey: session.nostrHexId }
      });

      if (error) {
        console.error('Error fetching pending events:', error);
        toast.error("Failed to load events");
        return;
      }

      if (data?.events) {
        setEvents(data.events);
      }
    } catch (err) {
      console.error('Error:', err);
    } finally {
      setLoading(false);
    }
  }, [session?.nostrHexId]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  const handleRetry = async (eventId: string) => {
    if (!session?.nostrHexId || !session?.nostrPrivateKey) {
      toast.error("Nostr authentication required");
      return;
    }

    // Find the event in the list
    const pendingEvent = events.find(e => e.event_id === eventId);
    if (!pendingEvent) {
      toast.error("Event not found");
      return;
    }

    setRetrying(eventId);
    try {
      // Parse the original signed event to extract tags, kind, content
      const originalEvent = JSON.parse(pendingEvent.signed_event);

      // Create a NEW event template with fresh created_at
      const eventTemplate = {
        kind: originalEvent.kind,
        created_at: Math.floor(Date.now() / 1000),
        tags: originalEvent.tags,
        content: originalEvent.content,
        pubkey: session.nostrHexId
      };

      // Re-sign with the user's Nostr private key (produces new id + sig)
      const privateKeyBytes = new Uint8Array(
        session.nostrPrivateKey.match(/.{1,2}/g)!.map((byte: string) => parseInt(byte, 16))
      );
      const newSignedEvent = finalizeEvent(eventTemplate, privateKeyBytes);

      console.log(`🔄 Re-signed event: old=${eventId.substring(0, 8)}... → new=${newSignedEvent.id.substring(0, 8)}... (created_at: ${newSignedEvent.created_at})`);

      // Send the new signed event to the server for relay publishing
      const { data, error } = await supabase.functions.invoke('retry-pending-event', {
        body: {
          oldEventId: eventId,
          newSignedEvent: newSignedEvent,
          userPubkey: session.nostrHexId
        }
      });

      if (error) {
        toast.error("Retry failed", { description: error.message });
        return;
      }

      if (data?.alreadyPublished) {
        toast.info("Already published", { description: "This event was already published to relays" });
      } else if (data?.success) {
        toast.success("Published successfully!", { description: "Event re-signed and published to relays" });
      } else {
        toast.error("Publishing failed", { description: "Could not publish to any relay. Try again later." });
      }

      // Store relay results (keyed by the NEW event id since old one is replaced)
      if (data?.results) {
        setLastResults(prev => {
          const newMap = new Map(prev);
          newMap.delete(eventId); // clear old results
          newMap.set(newSignedEvent.id, data.results);
          return newMap;
        });
      }

      // Refresh the list
      await fetchEvents();
    } catch (err) {
      console.error('Retry error:', err);
      toast.error("Retry failed", { description: err instanceof Error ? err.message : 'Unknown error' });
    } finally {
      setRetrying(null);
    }
  };

  const handleRetryAll = async () => {
    const pendingEvents = events.filter(e => e.status === 'pending');
    if (pendingEvents.length === 0) {
      toast.info("No pending events to retry");
      return;
    }

    for (const event of pendingEvents) {
      await handleRetry(event.event_id);
    }
  };

  const pendingCount = events.filter(e => e.status === 'pending').length;
  const publishedCount = events.filter(e => e.status === 'published').length;

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '—';
    const d = new Date(dateStr + 'Z');
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) +
      ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary + Retry All */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {events.length} event{events.length !== 1 ? 's' : ''} total
          {pendingCount > 0 && <span className="text-yellow-600 dark:text-yellow-400"> • {pendingCount} pending</span>}
          {publishedCount > 0 && <span className="text-green-600 dark:text-green-400"> • {publishedCount} published</span>}
        </div>
        {pendingCount > 0 && (
          <Button
            size="sm"
            onClick={handleRetryAll}
            disabled={retrying !== null}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${retrying ? 'animate-spin' : ''}`} />
            Retry All ({pendingCount})
          </Button>
        )}
      </div>

      {/* Events list */}
      {events.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Network className="h-12 w-12 mx-auto mb-4" />
            <p className="text-lg font-medium mb-2">No queued events</p>
            <p className="text-sm">When you make a payment, relay events are queued here as fallback</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {events.map((event) => {
            const isRetrying = retrying === event.event_id;
            const results = lastResults.get(event.event_id);

            return (
              <Card key={event.id} className={event.status === 'published' ? 'opacity-70' : ''}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Send className="h-4 w-4" />
                      KIND {event.event_kind}
                    </CardTitle>
                    <Badge variant={event.status === 'published' ? 'default' : 'secondary'}>
                      {event.status === 'published' ? (
                        <span className="flex items-center gap-1">
                          <CheckCircle2 className="h-3 w-3" />
                          Published
                        </span>
                      ) : (
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          Pending
                        </span>
                      )}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {/* Event ID */}
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Event ID</p>
                    <code className="text-xs font-mono bg-muted px-2 py-1 rounded break-all block">
                      {event.event_id}
                    </code>
                  </div>

                  {/* Meta info */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                    <div>
                      <p className="text-xs text-muted-foreground">Queued</p>
                      <p>{formatDate(event.created_at)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Last Attempt</p>
                      <p>{formatDate(event.last_attempt_at)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Retries</p>
                      <p>{event.retry_count}</p>
                    </div>
                    {event.published_at && (
                      <div>
                        <p className="text-xs text-muted-foreground">Published At</p>
                        <p>{formatDate(event.published_at)}</p>
                      </div>
                    )}
                  </div>

                  {/* Relay results from last manual retry */}
                  {results && results.length > 0 && (
                    <div className="space-y-2 pt-2 border-t">
                      <p className="text-xs font-medium text-muted-foreground">Last Retry Results</p>
                      {results.map((r, i) => (
                        <div key={i} className="flex items-center justify-between text-xs">
                          <code className="font-mono truncate max-w-[70%]">{r.relay}</code>
                          {r.success ? (
                            <Badge variant="default" className="text-xs">
                              <CheckCircle2 className="h-3 w-3 mr-1" />
                              OK
                            </Badge>
                          ) : (
                            <Badge variant="destructive" className="text-xs">
                              <XCircle className="h-3 w-3 mr-1" />
                              Failed
                            </Badge>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Retry button */}
                  {event.status === 'pending' && (
                    <Button
                      className="w-full mt-2"
                      onClick={() => handleRetry(event.event_id)}
                      disabled={isRetrying}
                    >
                      {isRetrying ? (
                        <>
                          <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                          Re-signing & Publishing...
                        </>
                      ) : (
                        <>
                          <RefreshCw className="h-4 w-4 mr-2" />
                          Re-sign & Publish
                        </>
                      )}
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
