import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Globe, MapPin, Calendar, Play } from "lucide-react";
import { useNostrPastEvents } from "@/hooks/useNostrPastEvents";
import { format } from "date-fns";

// Extract YouTube video ID from URL
function getYouTubeId(url: string): string | null {
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
  const match = url.match(regExp);
  return (match && match[2].length === 11) ? match[2] : null;
}

export default function PastEvents() {
  const { events, loading, error } = useNostrPastEvents();

  if (loading) {
    return (
      <div className="p-4 space-y-4">
        <h1 className="text-2xl font-bold mb-6">Past Events</h1>
        {[1, 2, 3].map((i) => (
          <Card key={i}>
            <CardContent className="p-4">
              <Skeleton className="h-6 w-3/4 mb-2" />
              <Skeleton className="h-4 w-1/2 mb-4" />
              <Skeleton className="aspect-video w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4">
        <Card className="border-destructive">
          <CardContent className="p-4 text-destructive">
            Error loading past events: {error}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="p-4">
        <h1 className="text-2xl font-bold mb-6">Past Events</h1>
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            <Play className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>No past events with recordings available yet.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-2xl font-bold mb-6">Past Events</h1>
      
      {events.map((event) => {
        const videoId = getYouTubeId(event.youtubeRecordingUrl);
        
        return (
          <Card key={event.dTag} className="overflow-hidden">
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-2">
                <CardTitle className="text-lg leading-tight">{event.title}</CardTitle>
                <Badge variant={event.isOnline ? "secondary" : "outline"} className="shrink-0">
                  {event.isOnline ? (
                    <><Globe className="h-3 w-3 mr-1" /> Online</>
                  ) : (
                    <><MapPin className="h-3 w-3 mr-1" /> Live</>
                  )}
                </Badge>
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Calendar className="h-4 w-4" />
                {format(event.start, "d. M. yyyy")}
              </div>
            </CardHeader>
            
            <CardContent className="pt-2">
              {event.cover && (
                <img 
                  src={event.cover} 
                  alt={event.title}
                  className="w-full h-32 object-cover rounded-md mb-4"
                />
              )}
              
              {videoId ? (
                <div className="aspect-video w-full rounded-md overflow-hidden">
                  <iframe
                    src={`https://www.youtube.com/embed/${videoId}`}
                    title={event.title}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                    className="w-full h-full"
                  />
                </div>
              ) : (
                <a 
                  href={event.youtubeRecordingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-primary hover:underline"
                >
                  <Play className="h-4 w-4" />
                  Watch Recording
                </a>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
