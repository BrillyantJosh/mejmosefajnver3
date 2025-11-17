import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useSystemParameters } from "@/contexts/SystemParametersContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Loader2, ListOrdered, Trash2, ChevronDown, ChevronUp, Search, Filter } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { SimplePool, Event, finalizeEvent, getPublicKey } from "nostr-tools";
import { toast } from "@/hooks/use-toast";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";

export default function MyEvents() {
  const { session } = useAuth();
  const { parameters } = useSystemParameters();
  const [events, setEvents] = useState<Event[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedEvents, setSelectedEvents] = useState<Set<string>>(new Set());
  const [isDeleting, setIsDeleting] = useState(false);
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);
  const [kindFilter, setKindFilter] = useState<string>("");
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedRelays, setSelectedRelays] = useState<string[]>([]);
  const [isRelayFilterOpen, setIsRelayFilterOpen] = useState(false);
  const [deletingEventId, setDeletingEventId] = useState<string | null>(null);
  const EVENTS_PER_PAGE = 100;

  // Initialize selected relays when parameters load
  useEffect(() => {
    if (parameters?.relays) {
      const stored = localStorage.getItem('myevents_selected_relays');
      if (stored) {
        try {
          const parsedRelays = JSON.parse(stored);
          // Only use stored relays that are still in the current relay list
          const validRelays = parsedRelays.filter((r: string) => parameters.relays.includes(r));
          setSelectedRelays(validRelays.length > 0 ? validRelays : parameters.relays);
        } catch {
          setSelectedRelays(parameters.relays);
        }
      } else {
        setSelectedRelays(parameters.relays);
      }
    }
  }, [parameters?.relays]);

  useEffect(() => {
    const fetchMyEvents = async () => {
      if (!session?.nostrHexId || !parameters?.relays || selectedRelays.length === 0) return;

      const pool = new SimplePool();
      setIsLoading(true);

      try {
        console.log(`Fetching events from ${selectedRelays.length} selected relays:`, selectedRelays);
        const fetchedEvents = await pool.querySync(selectedRelays, {
          authors: [session.nostrHexId],
          limit: 1000
        });

        const sortedEvents = fetchedEvents.sort((a, b) => b.created_at - a.created_at);
        setEvents(sortedEvents);
      } catch (error) {
        console.error("Failed to fetch events:", error);
      } finally {
        setIsLoading(false);
        pool.close(selectedRelays);
      }
    };

    fetchMyEvents();
  }, [session?.nostrHexId, selectedRelays]);

  const toggleEventExpansion = (eventId: string) => {
    setExpandedEventId(expandedEventId === eventId ? null : eventId);
  };

  const toggleRelay = (relay: string) => {
    setSelectedRelays(prev => {
      const newRelays = prev.includes(relay)
        ? prev.filter(r => r !== relay)
        : [...prev, relay];
      
      // Save to localStorage
      localStorage.setItem('myevents_selected_relays', JSON.stringify(newRelays));
      return newRelays;
    });
  };

  const selectAllRelays = () => {
    if (parameters?.relays) {
      setSelectedRelays(parameters.relays);
      localStorage.setItem('myevents_selected_relays', JSON.stringify(parameters.relays));
    }
  };

  const deselectAllRelays = () => {
    setSelectedRelays([]);
    localStorage.setItem('myevents_selected_relays', JSON.stringify([]));
  };

  // Filter events by kind if filter is active
  const filteredEvents = kindFilter 
    ? events.filter(e => e.kind.toString() === kindFilter)
    : events;

  // Pagination logic
  const totalPages = Math.ceil(filteredEvents.length / EVENTS_PER_PAGE);
  const startIndex = (currentPage - 1) * EVENTS_PER_PAGE;
  const endIndex = startIndex + EVENTS_PER_PAGE;
  const paginatedEvents = filteredEvents.slice(startIndex, endIndex);

  // Reset to page 1 when filter changes
  useEffect(() => {
    setCurrentPage(1);
  }, [kindFilter]);

  const handleSelectEvent = (eventId: string, isKind0: boolean) => {
    if (isKind0) return; // Cannot select KIND 0 events
    
    setSelectedEvents(prev => {
      const newSet = new Set(prev);
      if (newSet.has(eventId)) {
        newSet.delete(eventId);
      } else {
        newSet.add(eventId);
      }
      return newSet;
    });
  };

  const handleDeleteSelected = async () => {
    if (selectedEvents.size === 0 || !session?.nostrPrivateKey || !parameters?.relays) return;

    setIsDeleting(true);
    const pool = new SimplePool();

    try {
      const eventsToDelete = events.filter(e => selectedEvents.has(e.id));
      
      // Create deletion event (KIND 5)
      const privateKeyBytes = new Uint8Array(
        session.nostrPrivateKey.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16))
      );

      const deletionEvent = finalizeEvent({
        kind: 5,
        created_at: Math.floor(Date.now() / 1000),
        tags: eventsToDelete.map(e => ['e', e.id]),
        content: 'Deleted from Lana Wallet',
      }, privateKeyBytes);

      console.log('📡 Publishing deletion event (KIND 5):', deletionEvent);
      console.log('🔄 Publishing to', parameters.relays.length, 'relays...');

      // Publish deletion event to relays with proper timeout handling
      const publishResults = await Promise.allSettled(
        parameters.relays.map(relay => {
          console.log(`🔄 Connecting to ${relay}...`);
          const publishPromises = pool.publish([relay], deletionEvent);
          
          return Promise.race([
            Promise.all(publishPromises).then(() => {
              console.log(`✅ ${relay}: Successfully published deletion event`);
              return { relay, success: true };
            }),
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error('Timeout after 8 seconds')), 8000)
            )
          ]).catch(error => {
            const errorMsg = error instanceof Error ? error.message : 'Unknown error';
            console.error(`❌ ${relay}: ${errorMsg}`);
            return { relay, success: false, error: errorMsg };
          });
        })
      );

      const successfulRelays = publishResults.filter(
        r => r.status === 'fulfilled' && (r.value as any).success
      ).length;
      
      const failedRelays = publishResults.length - successfulRelays;

      console.log(`📊 Deletion event published to ${successfulRelays}/${parameters.relays.length} relays`);

      if (successfulRelays === 0) {
        throw new Error("Failed to publish to any relay");
      }

      // Remove deleted events from local state
      setEvents(prev => prev.filter(e => !selectedEvents.has(e.id)));
      setSelectedEvents(new Set());

      toast({
        title: "Events deleted",
        description: `Deletion event (KIND 5) published to ${successfulRelays} relay${successfulRelays > 1 ? 's' : ''}${failedRelays > 0 ? `, ${failedRelays} failed` : ''}`,
      });
    } catch (error) {
      console.error("❌ Failed to delete events:", error);
      toast({
        title: "Error",
        description: "Failed to publish deletion event. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
      pool.close(parameters.relays);
    }
  };

  const handleDeleteSingle = async (eventId: string) => {
    if (!session?.nostrPrivateKey || !parameters?.relays) return;

    setDeletingEventId(eventId);
    const pool = new SimplePool();

    try {
      const eventToDelete = events.find(e => e.id === eventId);
      if (!eventToDelete) return;
      
      // Create deletion event (KIND 5)
      const privateKeyBytes = new Uint8Array(
        session.nostrPrivateKey.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16))
      );

      const deletionEvent = finalizeEvent({
        kind: 5,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['e', eventId]],
        content: 'Deleted from Lana Wallet',
      }, privateKeyBytes);

      console.log('📡 Publishing deletion event (KIND 5):', deletionEvent);
      console.log('🔄 Publishing to', parameters.relays.length, 'relays...');

      // Publish deletion event to relays with proper timeout handling
      const publishResults = await Promise.allSettled(
        parameters.relays.map(relay => {
          console.log(`🔄 Connecting to ${relay}...`);
          const publishPromises = pool.publish([relay], deletionEvent);
          
          return Promise.race([
            Promise.all(publishPromises).then(() => {
              console.log(`✅ ${relay}: Successfully published deletion event`);
              return { relay, success: true };
            }),
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error('Timeout after 8 seconds')), 8000)
            )
          ]).catch(error => {
            const errorMsg = error instanceof Error ? error.message : 'Unknown error';
            console.error(`❌ ${relay}: ${errorMsg}`);
            return { relay, success: false, error: errorMsg };
          });
        })
      );

      const successfulRelays = publishResults.filter(
        r => r.status === 'fulfilled' && (r.value as any).success
      ).length;
      
      const failedRelays = publishResults.length - successfulRelays;

      console.log(`📊 Deletion event published to ${successfulRelays}/${parameters.relays.length} relays`);

      if (successfulRelays === 0) {
        throw new Error("Failed to publish to any relay");
      }

      // Remove deleted event from local state
      setEvents(prev => prev.filter(e => e.id !== eventId));
      setSelectedEvents(prev => {
        const newSet = new Set(prev);
        newSet.delete(eventId);
        return newSet;
      });

      toast({
        title: "Event deleted",
        description: `Deletion event (KIND 5) published to ${successfulRelays} relay${successfulRelays > 1 ? 's' : ''}${failedRelays > 0 ? `, ${failedRelays} failed` : ''}`,
      });
    } catch (error) {
      console.error("❌ Failed to delete event:", error);
      toast({
        title: "Error",
        description: "Failed to publish deletion event. Please try again.",
        variant: "destructive",
      });
    } finally {
      setDeletingEventId(null);
      pool.close(parameters.relays);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <ListOrdered className="h-5 w-5" />
                  My Events
                </CardTitle>
                <CardDescription>
                  History of all events where you are the author
                </CardDescription>
              </div>
              {selectedEvents.size > 0 && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleDeleteSelected}
                  disabled={isDeleting}
                >
                  {isDeleting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      Deleting...
                    </>
                  ) : (
                    <>
                      <Trash2 className="h-4 w-4 mr-2" />
                      Delete ({selectedEvents.size})
                    </>
                  )}
                </Button>
              )}
            </div>
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="relative flex-1 max-w-sm">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    type="number"
                    placeholder="Filter by Kind number..."
                    value={kindFilter}
                    onChange={(e) => setKindFilter(e.target.value)}
                    className="pl-9"
                  />
                </div>
                {kindFilter && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setKindFilter("")}
                  >
                    Clear
                  </Button>
                )}
              </div>

              <Collapsible open={isRelayFilterOpen} onOpenChange={setIsRelayFilterOpen}>
                <CollapsibleTrigger asChild>
                  <Button variant="outline" size="sm" className="w-full justify-between">
                    <div className="flex items-center gap-2">
                      <Filter className="h-4 w-4" />
                      Filter by Relays ({selectedRelays.length}/{parameters?.relays.length || 0})
                    </div>
                    <ChevronDown className={`h-4 w-4 transition-transform ${isRelayFilterOpen ? 'rotate-180' : ''}`} />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-3">
                  <Card className="p-4">
                    <div className="flex justify-between items-center mb-3">
                      <p className="text-sm font-medium">Select relays:</p>
                      <div className="flex gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={selectAllRelays}
                          disabled={selectedRelays.length === parameters?.relays.length}
                        >
                          All
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={deselectAllRelays}
                          disabled={selectedRelays.length === 0}
                        >
                          None
                        </Button>
                      </div>
                    </div>
                    <div className="space-y-2">
                      {parameters?.relays.map((relay) => (
                        <div key={relay} className="flex items-center gap-2">
                          <Checkbox
                            id={`relay-${relay}`}
                            checked={selectedRelays.includes(relay)}
                            onCheckedChange={() => toggleRelay(relay)}
                          />
                          <label
                            htmlFor={`relay-${relay}`}
                            className="text-sm font-mono cursor-pointer flex-1 truncate"
                            title={relay}
                          >
                            {relay}
                          </label>
                        </div>
                      ))}
                    </div>
                  </Card>
                </CollapsibleContent>
              </Collapsible>
            </div>
            {filteredEvents.length > 0 && (
              <p className="text-sm text-muted-foreground">
                Showing {startIndex + 1}-{Math.min(endIndex, filteredEvents.length)} of {filteredEvents.length} events
                {kindFilter && ` (filtered by Kind ${kindFilter})`}
              </p>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {filteredEvents.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">
              {kindFilter ? `No events found for Kind ${kindFilter}` : 'No events found'}
            </p>
          ) : (
            <>
              <div className="space-y-3">
                {paginatedEvents.map((event) => {
                  const isKind0 = event.kind === 0;
                  const isSelected = selectedEvents.has(event.id);
                  const isExpanded = expandedEventId === event.id;
                  
                  return (
                    <div 
                      key={event.id}
                      className="p-4 rounded-lg border bg-card"
                    >
                      <div className="flex items-start gap-4 mb-2">
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => handleSelectEvent(event.id, isKind0)}
                          disabled={isKind0}
                          className="mt-1 flex-shrink-0"
                        />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-4 mb-2">
                              <div className="flex items-center gap-2 flex-wrap">
                                <Badge variant="outline">Kind {event.kind}</Badge>
                                {isKind0 && (
                                  <Badge variant="secondary" className="text-xs">Cannot delete</Badge>
                                )}
                                <span className="text-xs text-muted-foreground">
                                  {new Date(event.created_at * 1000).toLocaleString()}
                                </span>
                              </div>
                              <div className="flex items-center gap-1">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleDeleteSingle(event.id)}
                                  disabled={isKind0 || deletingEventId === event.id}
                                  title={isKind0 ? "Cannot delete profile events" : "Delete this event"}
                                >
                                  {deletingEventId === event.id ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : (
                                    <Trash2 className="h-4 w-4 text-destructive" />
                                  )}
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => toggleEventExpansion(event.id)}
                                >
                                  {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                                </Button>
                              </div>
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
                                <Badge key={idx} variant="secondary" className="text-xs truncate max-w-[200px]">
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
                      </div>
                    </div>
                  );
                })}
              </div>

              {totalPages > 1 && (
                <Pagination className="mt-6">
                  <PaginationContent>
                    <PaginationItem>
                      <PaginationPrevious 
                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                        className={currentPage === 1 ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                      />
                    </PaginationItem>
                    
                    {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                      let pageNum;
                      if (totalPages <= 5) {
                        pageNum = i + 1;
                      } else if (currentPage <= 3) {
                        pageNum = i + 1;
                      } else if (currentPage >= totalPages - 2) {
                        pageNum = totalPages - 4 + i;
                      } else {
                        pageNum = currentPage - 2 + i;
                      }
                      
                      return (
                        <PaginationItem key={pageNum}>
                          <PaginationLink
                            onClick={() => setCurrentPage(pageNum)}
                            isActive={currentPage === pageNum}
                            className="cursor-pointer"
                          >
                            {pageNum}
                          </PaginationLink>
                        </PaginationItem>
                      );
                    })}

                    <PaginationItem>
                      <PaginationNext 
                        onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                        className={currentPage === totalPages ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                      />
                    </PaginationItem>
                  </PaginationContent>
                </Pagination>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
