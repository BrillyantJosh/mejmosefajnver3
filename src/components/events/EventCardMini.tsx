import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar, Clock, MapPin, Globe, Timer } from "lucide-react";
import { format } from "date-fns";
import { LanaEvent, getEventStatus } from "@/hooks/useNostrEvents";
import { useNavigate } from "react-router-dom";
import { getTimezoneAbbreviation, formatTimeInTimezone } from "@/lib/timezones";
import { useEventCountdown } from "@/hooks/useEventCountdown";

interface EventCardMiniProps {
  event: LanaEvent;
}

export function EventCardMini({ event }: EventCardMiniProps) {
  const navigate = useNavigate();
  const status = getEventStatus(event);
  const countdown = useEventCountdown(event.start);

  const handleClick = () => {
    navigate(`/events/detail/${encodeURIComponent(event.dTag)}`);
  };

  return (
    <Card 
      className={`cursor-pointer transition-all hover:shadow-md h-full ${
        status === 'happening-now' 
          ? 'ring-2 ring-green-500 bg-green-500/10' 
          : status === 'today' 
            ? 'ring-2 ring-amber-500 bg-amber-500/10' 
            : ''
      }`}
      onClick={handleClick}
    >
      {event.cover && (
        <div className="relative h-20 w-full overflow-hidden rounded-t-lg">
          <img 
            src={event.cover} 
            alt={event.title}
            className="h-full w-full object-cover"
          />
          {status !== 'upcoming' && (
            <Badge 
              className={`absolute top-1 right-1 text-[10px] px-1.5 py-0.5 ${
                status === 'happening-now' 
                  ? 'bg-green-500 text-white animate-pulse' 
                  : 'bg-amber-500 text-white'
              }`}
            >
              {status === 'happening-now' ? 'NOW' : 'TODAY'}
            </Badge>
          )}
        </div>
      )}
      
      <CardContent className={`p-2.5 ${!event.cover ? 'pt-2.5' : ''}`}>
        {!event.cover && status !== 'upcoming' && (
          <Badge 
            className={`mb-1.5 text-[10px] px-1.5 py-0.5 ${
              status === 'happening-now' 
                ? 'bg-green-500 text-white animate-pulse' 
                : 'bg-amber-500 text-white'
            }`}
          >
            {status === 'happening-now' ? 'NOW' : 'TODAY'}
          </Badge>
        )}
        
        <h3 className="font-medium text-sm line-clamp-2 mb-1.5">{event.title}</h3>
        
        <div className="space-y-1 text-[11px] text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <Calendar className="h-3 w-3 shrink-0" />
            <span>{format(event.start, 'dd.MM.yyyy')}</span>
          </div>
          
          <div className="flex items-center gap-1.5">
            <Clock className="h-3 w-3 shrink-0" />
            <span>
              {formatTimeInTimezone(event.start, event.timezone || 'Europe/Ljubljana')}
              <span className="ml-1 text-muted-foreground/70">
                ({getTimezoneAbbreviation(event.start, event.timezone || 'Europe/Ljubljana')})
              </span>
            </span>
          </div>
          
          {countdown.isWithin12Hours && !countdown.isStarted && (
            <div className="flex items-center gap-1 text-primary">
              <Timer className="h-3 w-3 animate-pulse" />
              <span className="text-[10px] font-medium">{countdown.displayString}</span>
            </div>
          )}
          
          {event.isOnline ? (
            <div className="flex items-center gap-1.5">
              <Globe className="h-3 w-3 text-blue-500 shrink-0" />
              <span className="text-blue-500">Online</span>
            </div>
          ) : (
            event.location && (
              <div className="flex items-center gap-1.5">
                <MapPin className="h-3 w-3 text-red-500 shrink-0" />
                <span className="line-clamp-1">{event.location}</span>
              </div>
            )
          )}
        </div>

        {event.fiatValue && (
          <div className="mt-1.5 text-xs font-medium text-primary">
            €{event.fiatValue}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
