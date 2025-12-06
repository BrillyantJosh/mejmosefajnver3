import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar, Clock, MapPin, Globe, Users } from "lucide-react";
import { format } from "date-fns";
import { LanaEvent, getEventStatus } from "@/hooks/useNostrEvents";
import { useNavigate } from "react-router-dom";

interface EventCardProps {
  event: LanaEvent;
}

export function EventCard({ event }: EventCardProps) {
  const navigate = useNavigate();
  const status = getEventStatus(event);

  const handleClick = () => {
    navigate(`/events/detail/${event.id}`);
  };

  return (
    <Card 
      className={`cursor-pointer transition-all hover:shadow-lg ${
        status === 'happening-now' 
          ? 'ring-2 ring-green-500 bg-green-500/10' 
          : status === 'today' 
            ? 'ring-2 ring-amber-500 bg-amber-500/10' 
            : ''
      }`}
      onClick={handleClick}
    >
      {event.cover && (
        <div className="relative h-40 w-full overflow-hidden rounded-t-lg">
          <img 
            src={event.cover} 
            alt={event.title}
            className="h-full w-full object-cover"
          />
          {status !== 'upcoming' && (
            <Badge 
              className={`absolute top-2 right-2 ${
                status === 'happening-now' 
                  ? 'bg-green-500 text-white animate-pulse' 
                  : 'bg-amber-500 text-white'
              }`}
            >
              {status === 'happening-now' ? 'HAPPENING NOW' : 'TODAY'}
            </Badge>
          )}
        </div>
      )}
      
      <CardContent className={`p-4 ${!event.cover ? 'pt-4' : ''}`}>
        {!event.cover && status !== 'upcoming' && (
          <Badge 
            className={`mb-2 ${
              status === 'happening-now' 
                ? 'bg-green-500 text-white animate-pulse' 
                : 'bg-amber-500 text-white'
            }`}
          >
            {status === 'happening-now' ? 'HAPPENING NOW' : 'TODAY'}
          </Badge>
        )}
        
        <div className="flex items-start justify-between gap-2 mb-2">
          <h3 className="font-semibold text-lg line-clamp-2">{event.title}</h3>
          <Badge variant="secondary" className="shrink-0">
            {event.eventType}
          </Badge>
        </div>
        
        <div className="space-y-2 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            <span>{format(event.start, 'PPP')}</span>
          </div>
          
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4" />
            <span>
              {format(event.start, 'HH:mm')}
              {event.end && ` - ${format(event.end, 'HH:mm')}`}
            </span>
          </div>
          
          {event.isOnline ? (
            <div className="flex items-center gap-2">
              <Globe className="h-4 w-4 text-blue-500" />
              <span className="text-blue-500">Online Event</span>
            </div>
          ) : (
            event.location && (
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-red-500" />
                <span className="line-clamp-1">{event.location}</span>
              </div>
            )
          )}
          
          {event.capacity && (
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              <span>Capacity: {event.capacity}</span>
            </div>
          )}
        </div>
        
        {event.content && (
          <p className="mt-3 text-sm text-muted-foreground line-clamp-2">
            {event.content.replace(/\*\*/g, '').replace(/\n/g, ' ')}
          </p>
        )}

        {event.fiatValue && (
          <div className="mt-3 text-sm font-medium text-primary">
            Value: €{event.fiatValue}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
