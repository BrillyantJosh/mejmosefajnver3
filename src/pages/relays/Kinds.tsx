import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useSystemParameters } from "@/contexts/SystemParametersContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, ActivitySquare, ChevronDown, ChevronUp } from "lucide-react";
import { SimplePool, Event } from "nostr-tools";

type KindConfig = {
  kind: number;
  label: string;
  description: string;
  filterByAuthor: boolean;
};

const KINDS: KindConfig[] = [
  { kind: 0, label: "KIND 0", description: "Metadata", filterByAuthor: true },
  { kind: 1, label: "KIND 1", description: "Text Note", filterByAuthor: true },
  { kind: 88888, label: "KIND 88888", description: "Custom Event", filterByAuthor: false },
  { kind: 30889, label: "KIND 30889", description: "Custom Addressable", filterByAuthor: false },
];

export default function Kinds() {
  const { session } = useAuth();
  const { parameters } = useSystemParameters();
  const [selectedKind, setSelectedKind] = useState<number | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);

  const fetchEventsForKind = async (kindConfig: KindConfig) => {
    if (!session?.nostrHexId || !parameters?.relays) return;

    setIsLoading(true);
    setSelectedKind(kindConfig.kind);
    setEvents([]);

    const pool = new SimplePool();

    try {
      let filter: any = {
        kinds: [kindConfig.kind],
        limit: 50
      };

      if (kindConfig.filterByAuthor) {
        filter.authors = [session.nostrHexId];
      } else {
        filter['#p'] = [session.nostrHexId];
      }

      const fetchedEvents = await pool.querySync(parameters.relays, filter);
      
      // Filter KIND 30889 events to only include those from LanaRegistrar trusted signers
      let filteredEvents = fetchedEvents;
      if (kindConfig.kind === 30889) {
        const lanaRegistrarSigners = parameters?.trustedSigners?.LanaRegistrar || [];
        filteredEvents = fetchedEvents.filter(event => {
          const isAuthorized = lanaRegistrarSigners.includes(event.pubkey);
          if (!isAuthorized) {
            console.log(`Filtered out KIND 30889 event from unauthorized pubkey: ${event.pubkey}`);
          }
          return isAuthorized;
        });
        console.log(`Filtered KIND 30889: ${filteredEvents.length} of ${fetchedEvents.length} events from LanaRegistrar trusted signers`);
      }
      
      const sortedEvents = filteredEvents.sort((a, b) => b.created_at - a.created_at);
      setEvents(sortedEvents);
    } catch (error) {
      console.error("Failed to fetch events:", error);
    } finally {
      setIsLoading(false);
      pool.close(parameters.relays);
    }
  };

  const toggleEventExpansion = (eventId: string) => {
    setExpandedEventId(expandedEventId === eventId ? null : eventId);
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ActivitySquare className="h-5 w-5" />
            Event Kinds
          </CardTitle>
          <CardDescription>
            Select a KIND to view related events
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
            {KINDS.map((kindConfig) => (
              <Button
                key={kindConfig.kind}
                variant={selectedKind === kindConfig.kind ? "default" : "outline"}
                className="h-auto py-4 flex flex-col items-start gap-1"
                onClick={() => fetchEventsForKind(kindConfig)}
              >
                <span className="font-semibold">{kindConfig.label}</span>
                <span className="text-xs opacity-80">{kindConfig.description}</span>
                <span className="text-xs opacity-60">
                  {kindConfig.filterByAuthor ? "As Author" : "Tagged in 'p'"}
                </span>
              </Button>
            ))}
          </div>

          {isLoading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          )}

          {!isLoading && selectedKind !== null && (
            <div className="space-y-3">
              {events.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">
                  No events found for KIND {selectedKind}
                </p>
              ) : (
                <>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-semibold">
                      Found {events.length} event{events.length !== 1 ? 's' : ''}
                    </h3>
                  </div>
                  {events.map((event) => {
                    const isExpanded = expandedEventId === event.id;
                    return (
                      <div 
                        key={event.id}
                        className="p-4 rounded-lg border bg-card"
                      >
                        <div className="flex items-start justify-between gap-4 mb-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge variant="outline">Kind {event.kind}</Badge>
                            <span className="text-xs text-muted-foreground">
                              {new Date(event.created_at * 1000).toLocaleString()}
                            </span>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => toggleEventExpansion(event.id)}
                          >
                            {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                          </Button>
                        </div>
                        <p className="text-sm font-mono text-muted-foreground break-all mb-2">
                          ID: {isExpanded ? event.id : `${event.id.substring(0, 32)}...`}
                        </p>
                        {event.content && (
                          <p className={`text-sm break-words ${isExpanded ? '' : 'line-clamp-2'}`}>
                            {event.content}
                          </p>
                        )}
                        {isExpanded && event.tags.length > 0 && (
                          <div className="mt-3 space-y-1">
                            <p className="text-xs font-semibold text-muted-foreground">Tags:</p>
                            {event.tags.map((tag, idx) => (
                              <div key={idx} className="text-xs font-mono bg-secondary/50 p-2 rounded break-all">
                                [{tag.join(', ')}]
                              </div>
                            ))}
                          </div>
                        )}
                        {isExpanded && (
                          <div className="mt-3 space-y-1">
                            <p className="text-xs font-semibold text-muted-foreground">Full JSON:</p>
                            <pre className="text-xs font-mono bg-secondary/50 p-3 rounded overflow-x-auto">
                              {JSON.stringify(event, null, 2)}
                            </pre>
                          </div>
                        )}
                        {!isExpanded && event.tags.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {event.tags.slice(0, 3).map((tag, idx) => (
                              <Badge key={idx} variant="secondary" className="text-xs">
                                {tag[0]}: {tag[1]?.substring(0, 10)}...
                              </Badge>
                            ))}
                            {event.tags.length > 3 && (
                              <Badge variant="secondary" className="text-xs">
                                +{event.tags.length - 3} more
                              </Badge>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
