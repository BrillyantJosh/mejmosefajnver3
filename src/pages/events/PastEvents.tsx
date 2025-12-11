import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Globe, MapPin, Calendar, Play, Share2 } from "lucide-react";
import { useNostrPastEvents } from "@/hooks/useNostrPastEvents";
import { format } from "date-fns";
import { toast } from "@/hooks/use-toast";

const LANGUAGES = [
  { value: 'all', label: 'All Languages' },
  { value: 'sl', label: 'Slovenščina' },
  { value: 'en', label: 'English' },
  { value: 'de', label: 'Deutsch' },
  { value: 'hr', label: 'Hrvatski' },
  { value: 'sr', label: 'Srpski' }
];

// Extract YouTube video ID from URL
function getYouTubeId(url: string): string | null {
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
  const match = url.match(regExp);
  return (match && match[2].length === 11) ? match[2] : null;
}

function handleShare(dTag: string) {
  const shareUrl = `${window.location.origin}/event/${encodeURIComponent(dTag)}`;
  
  navigator.clipboard.writeText(shareUrl).then(() => {
    toast({
      title: "Link copied!",
      description: "Share this link with anyone"
    });
  }).catch(() => {
    toast({
      title: "Copy failed",
      description: shareUrl,
      variant: "destructive"
    });
  });
}

export default function PastEvents() {
  const { events, loading, error } = useNostrPastEvents();
  const [selectedLanguage, setSelectedLanguage] = useState<string>('all');

  const filteredEvents = useMemo(() => {
    if (selectedLanguage === 'all') return events;
    return events.filter(event => event.language === selectedLanguage);
  }, [events, selectedLanguage]);

  if (loading) {
    return (
      <div className="p-4 space-y-4">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">Past Events</h1>
          <Skeleton className="h-10 w-40" />
        </div>
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

  if (filteredEvents.length === 0) {
    return (
      <div className="p-4">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">Past Events</h1>
          <Select value={selectedLanguage} onValueChange={setSelectedLanguage}>
            <SelectTrigger className="w-40 bg-background">
              <SelectValue placeholder="Language" />
            </SelectTrigger>
            <SelectContent className="bg-background border shadow-lg z-50">
              {LANGUAGES.map(lang => (
                <SelectItem key={lang.value} value={lang.value}>
                  {lang.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            <Play className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>{selectedLanguage === 'all' 
              ? 'No past events with recordings available yet.' 
              : 'No past events with recordings in this language.'}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Past Events</h1>
        <Select value={selectedLanguage} onValueChange={setSelectedLanguage}>
          <SelectTrigger className="w-40 bg-background">
            <SelectValue placeholder="Language" />
          </SelectTrigger>
          <SelectContent className="bg-background border shadow-lg z-50">
            {LANGUAGES.map(lang => (
              <SelectItem key={lang.value} value={lang.value}>
                {lang.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      
      {filteredEvents.map((event) => {
        const videoId = getYouTubeId(event.youtubeRecordingUrl);
        
        return (
          <Card key={event.dTag} className="overflow-hidden">
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-2">
                <CardTitle className="text-lg leading-tight">{event.title}</CardTitle>
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => handleShare(event.dTag)}
                  >
                    <Share2 className="h-4 w-4" />
                  </Button>
                  <Badge variant={event.isOnline ? "secondary" : "outline"}>
                    {event.isOnline ? (
                      <><Globe className="h-3 w-3 mr-1" /> Online</>
                    ) : (
                      <><MapPin className="h-3 w-3 mr-1" /> Live</>
                    )}
                  </Badge>
                </div>
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
