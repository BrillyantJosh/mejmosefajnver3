import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MapPin, Clock } from "lucide-react";
import { BusinessUnit } from "@/hooks/useNostrBusinessUnits";
import { useNavigate } from "react-router-dom";

interface BusinessUnitCardProps {
  unit: BusinessUnit;
  distance?: number;
}

export const BusinessUnitCard = ({ unit, distance }: BusinessUnitCardProps) => {
  const navigate = useNavigate();

  const handleClick = () => {
    navigate(`/lanapays/unit/${unit.unit_id}`);
  };

  const isOnline = unit.category === "Online";

  return (
    <Card 
      className="cursor-pointer hover:shadow-lg transition-shadow overflow-hidden active:scale-[0.98]"
      onClick={handleClick}
    >
      {/* Image */}
      <div className="relative h-40 md:h-48 bg-muted">
        {unit.images?.[0] ? (
          <img
            src={unit.images[0]}
            alt={unit.name}
            className="w-full h-full object-cover"
            onError={(e) => {
              e.currentTarget.src = '/placeholder.svg';
            }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground">
            No Image
          </div>
        )}
        
        {/* Logo overlay */}
        {unit.logo && (
          <div className="absolute top-2 left-2 w-10 h-10 md:w-12 md:h-12 bg-background rounded-full p-1 shadow-lg">
            <img
              src={unit.logo}
              alt={`${unit.name} logo`}
              className="w-full h-full object-contain rounded-full"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
              }}
            />
          </div>
        )}
        
        {/* Status Badge */}
        <div className="absolute top-2 right-2">
          <Badge variant="secondary" className="bg-background/90 backdrop-blur-sm">
            {unit.status}
          </Badge>
        </div>
      </div>

      <CardContent className="p-3 md:p-4 space-y-2 md:space-y-3">
        {/* Title and Category */}
        <div>
          <h3 className="font-semibold text-base md:text-lg truncate">{unit.name}</h3>
          <div className="flex items-center gap-1.5 md:gap-2 mt-1 flex-wrap">
            <Badge variant="outline" className="text-xs">
              {unit.category}
            </Badge>
            {unit.category_detail && (
              <span className="text-xs text-muted-foreground truncate">
                {unit.category_detail}
              </span>
            )}
          </div>
        </div>

        {/* Location */}
        <div className="flex items-start gap-1.5 md:gap-2 text-xs md:text-sm text-muted-foreground">
          <MapPin className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="truncate">{unit.receiver_city}, {unit.receiver_country}</p>
            {distance !== undefined && (
              <p className="text-xs mt-0.5">~{distance.toFixed(1)} km away</p>
            )}
          </div>
        </div>

        {/* Opening Hours Indicator */}
        {!isOnline && unit.opening_hours && (
          <div className="flex items-center gap-1.5 md:gap-2 text-xs md:text-sm">
            <Clock className="h-3.5 w-3.5 md:h-4 md:w-4 flex-shrink-0 text-primary" />
            <span className="text-xs text-muted-foreground">
              {unit.opening_hours.always_open ? 'Open 24/7' : 'See opening hours'}
            </span>
          </div>
        )}

        {/* Currency */}
        <div className="flex items-center justify-between pt-2 border-t">
          <span className="text-xs text-muted-foreground">Currency</span>
          <Badge variant="secondary" className="text-xs">{unit.currency}</Badge>
        </div>
      </CardContent>
    </Card>
  );
};
