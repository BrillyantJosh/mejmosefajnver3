import { useNostrBusinessUnits } from "@/hooks/useNostrBusinessUnits";
import { BusinessUnitCard } from "@/components/lanapays/BusinessUnitCard";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Globe } from "lucide-react";

export default function LanaPaysOnline() {
  const { businessUnits, isLoading } = useNostrBusinessUnits();

  // Filter only online businesses (category = "Online")
  const onlineUnits = businessUnits.filter(
    unit => unit.category === "Online"
  );

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Header Info */}
      <Card>
        <CardContent className="p-3 md:p-4 flex items-start gap-2 md:gap-3">
          <Globe className="h-4 w-4 md:h-5 md:w-5 text-primary mt-0.5 flex-shrink-0" />
          <div>
            <h3 className="font-semibold text-sm md:text-base">Online Merchants</h3>
            <p className="text-xs md:text-sm text-muted-foreground">
              Shop from anywhere in the world with these online businesses
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Business Units Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[...Array(6)].map((_, i) => (
            <Card key={i}>
              <Skeleton className="h-48 w-full rounded-t-lg" />
              <CardContent className="p-4 space-y-3">
                <Skeleton className="h-6 w-3/4" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-2/3" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : onlineUnits.length === 0 ? (
        <Card>
          <CardContent className="p-6 md:p-8 text-center">
            <Globe className="h-10 w-10 md:h-12 md:w-12 mx-auto text-muted-foreground mb-3 md:mb-4" />
            <p className="text-sm md:text-base text-muted-foreground">
              No online merchants available yet
            </p>
            <p className="text-xs md:text-sm text-muted-foreground mt-2">
              Check back later for new online businesses
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {onlineUnits.map(unit => (
            <BusinessUnitCard key={unit.id} unit={unit} />
          ))}
        </div>
      )}
    </div>
  );
}
