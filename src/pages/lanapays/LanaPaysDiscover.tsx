import { useState, useMemo } from "react";
import { useNostrBusinessUnits } from "@/hooks/useNostrBusinessUnits";
import { BusinessUnitCard } from "@/components/lanapays/BusinessUnitCard";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Filter, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export default function LanaPaysDiscover() {
  const { businessUnits, isLoading } = useNostrBusinessUnits();
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [selectedCountry, setSelectedCountry] = useState<string>("all");

  // Extract unique categories and countries from data
  const { categories, countries } = useMemo(() => {
    const cats = new Set<string>();
    const ctrs = new Set<string>();
    businessUnits.forEach((unit) => {
      if (unit.category) cats.add(unit.category);
      const country = unit.receiver_country || unit.country;
      if (country) ctrs.add(country);
    });
    return {
      categories: Array.from(cats).sort(),
      countries: Array.from(ctrs).sort(),
    };
  }, [businessUnits]);

  // Filter units
  const filteredUnits = useMemo(() => {
    return businessUnits.filter((unit) => {
      if (selectedCategory !== "all" && unit.category !== selectedCategory)
        return false;
      const country = unit.receiver_country || unit.country;
      if (selectedCountry !== "all" && country !== selectedCountry) return false;
      return true;
    });
  }, [businessUnits, selectedCategory, selectedCountry]);

  const hasActiveFilters =
    selectedCategory !== "all" || selectedCountry !== "all";

  const clearFilters = () => {
    setSelectedCategory("all");
    setSelectedCountry("all");
  };

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Filters */}
      <Card>
        <CardContent className="p-3 md:p-4">
          <div className="flex items-center gap-2 mb-3">
            <Filter className="h-4 w-4 text-primary flex-shrink-0" />
            <h3 className="font-semibold text-sm md:text-base">Filters</h3>
            {hasActiveFilters && (
              <button
                onClick={clearFilters}
                className="ml-auto flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="h-3 w-3" />
                Clear
              </button>
            )}
          </div>

          <div className="space-y-3">
            {/* Category Filter */}
            <div>
              <label className="text-xs text-muted-foreground font-medium mb-1.5 block">
                Category
              </label>
              <div className="flex flex-wrap gap-1.5">
                <Badge
                  variant={selectedCategory === "all" ? "default" : "outline"}
                  className="cursor-pointer text-xs"
                  onClick={() => setSelectedCategory("all")}
                >
                  All
                </Badge>
                {categories.map((cat) => (
                  <Badge
                    key={cat}
                    variant={selectedCategory === cat ? "default" : "outline"}
                    className="cursor-pointer text-xs"
                    onClick={() =>
                      setSelectedCategory(
                        selectedCategory === cat ? "all" : cat
                      )
                    }
                  >
                    {cat}
                  </Badge>
                ))}
              </div>
            </div>

            {/* Country Filter */}
            <div>
              <label className="text-xs text-muted-foreground font-medium mb-1.5 block">
                Country
              </label>
              <div className="flex flex-wrap gap-1.5">
                <Badge
                  variant={selectedCountry === "all" ? "default" : "outline"}
                  className="cursor-pointer text-xs"
                  onClick={() => setSelectedCountry("all")}
                >
                  All
                </Badge>
                {countries.map((country) => (
                  <Badge
                    key={country}
                    variant={selectedCountry === country ? "default" : "outline"}
                    className="cursor-pointer text-xs"
                    onClick={() =>
                      setSelectedCountry(
                        selectedCountry === country ? "all" : country
                      )
                    }
                  >
                    {country}
                  </Badge>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Results count */}
      {!isLoading && (
        <p className="text-xs md:text-sm text-muted-foreground">
          {filteredUnits.length} merchant{filteredUnits.length !== 1 ? "s" : ""}{" "}
          {hasActiveFilters ? "found" : "available"}
        </p>
      )}

      {/* Business Units Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
          {[...Array(6)].map((_, i) => (
            <Card key={i}>
              <Skeleton className="h-40 md:h-48 w-full rounded-t-lg" />
              <CardContent className="p-3 md:p-4 space-y-3">
                <Skeleton className="h-6 w-3/4" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-2/3" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : filteredUnits.length === 0 ? (
        <Card>
          <CardContent className="p-6 md:p-8 text-center">
            <p className="text-sm md:text-base text-muted-foreground">
              No merchants found
            </p>
            {hasActiveFilters && (
              <button
                onClick={clearFilters}
                className="text-sm text-primary hover:underline mt-2"
              >
                Clear filters
              </button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
          {filteredUnits.map((unit) => (
            <BusinessUnitCard key={unit.id} unit={unit} />
          ))}
        </div>
      )}
    </div>
  );
}
