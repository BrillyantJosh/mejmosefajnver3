import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { RefreshCw, CheckCircle2, XCircle, Clock, Network, Send } from "lucide-react";
import { toast } from "sonner";

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
    if (!session?.nostrHexId) return;

    setRetrying(eventId);
    try {
      const { data, error } = await supabase.functions.invoke('retry-pending-event', {
        body: { eventId, userPubkey: session.nostrHexId }
      });

      if (error) {
        toast.error("Retry failed", { description: error.message });
        return;
      }

      if (data?.alreadyPublished) {
        toast.info("Already published", { description: "This event was already published to relays" });
      } else if (data?.success) {
        toast.success("Published successfully!", { description: "Event published to relays with new timestamp" });
      } else {
        toast.error("Publishing failed", { description: "Could not publish to any relay. Try again later." });
      }

      // Store relay results
      if (data?.results) {
        setLastResults(prev => new Map(prev).set(eventId, data.results));
      }

      // Refresh the list
      await fetchEvents();
    } catch (err) {
      console.error('Retry error:', err);
      toast.error("Retry failed");
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
                          Retrying...
                        </>
                      ) : (
                        <>
                          <RefreshCw className="h-4 w-4 mr-2" />
                          Retry with New Timestamp
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
