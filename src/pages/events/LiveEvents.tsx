import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { MapPin, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNostrEvents } from "@/hooks/useNostrEvents";
import { EventCard } from "@/components/events/EventCard";

export default function LiveEvents() {
  const { events, loading, error, refetch } = useNostrEvents('live');

  return (
    <div className="space-y-3 px-3 sm:px-4 pb-24">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <MapPin className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
          <h1 className="text-lg sm:text-2xl font-bold">Live Events</h1>
        </div>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={refetch} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {loading && (
        <div className="space-y-4">
          {[1, 2, 3].map(i => (
            <Skeleton key={i} className="h-48 w-full" />
          ))}
        </div>
      )}

      {error && (
        <Card>
          <CardContent className="p-6">
            <p className="text-destructive">Error: {error}</p>
          </CardContent>
        </Card>
      )}

      {!loading && !error && events.length === 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">No Upcoming Live Events</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">
              There are no upcoming live/physical events. Be the first to add one!
            </p>
          </CardContent>
        </Card>
      )}

      {!loading && !error && events.length > 0 && (
        <div className="space-y-4">
          {events.map(event => (
            <EventCard key={event.id} event={event} />
          ))}
        </div>
      )}
    </div>
  );
}
