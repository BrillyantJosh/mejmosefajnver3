import { useState } from "react";
import { Leaf, MapPin } from "lucide-react";
import { BusinessUnit } from "@/hooks/useNostrBusinessUnits";
import { Link } from "react-router-dom";

interface BusinessUnitCardProps {
  unit: BusinessUnit;
}

export const BusinessUnitCard = ({ unit }: BusinessUnitCardProps) => {
  const [imgError, setImgError] = useState(false);
  const hasImage = unit.images?.[0] && !imgError;

  return (
    <Link
      to={`/lanapays/unit/${unit.unit_id}`}
      className="group bg-card border rounded-xl overflow-hidden hover:shadow-lg transition-all duration-300"
    >
      <div className="aspect-[16/10] overflow-hidden bg-muted">
        {hasImage ? (
          <img
            src={unit.images[0]}
            alt={unit.name}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            loading="lazy"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Leaf className="w-12 h-12 text-muted-foreground/20" />
          </div>
        )}
      </div>
      <div className="p-5">
        <h3 className="font-display text-lg font-semibold text-foreground group-hover:text-primary transition-colors truncate">
          {unit.name}
        </h3>
        <div className="flex items-center gap-3 mt-2 text-sm text-muted-foreground font-sans">
          {(unit.receiver_city || unit.country) && (
            <span className="flex items-center gap-1">
              <MapPin className="w-3.5 h-3.5" />
              {[unit.receiver_city, unit.receiver_country || unit.country].filter(Boolean).join(', ')}
            </span>
          )}
        </div>
        {unit.content && (
          <p className="mt-3 text-sm text-muted-foreground font-sans line-clamp-2">
            {unit.content}
          </p>
        )}
        <div className="mt-4 flex items-center gap-2 flex-wrap">
          <span className="inline-flex items-center gap-1.5 bg-green-600 text-white px-3 py-1.5 rounded-full text-sm font-sans font-bold shadow-sm">
            🌿 5% Abundance
          </span>
          <span className="inline-flex items-center gap-1 bg-primary/10 text-primary px-2.5 py-1 rounded-full text-xs font-sans font-medium">
            <Leaf className="w-3 h-3" />
            {unit.category}
          </span>
          {unit.category_detail && (
            <span className="text-xs text-muted-foreground font-sans">{unit.category_detail}</span>
          )}
        </div>
      </div>
    </Link>
  );
};
