import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { useNostrBusinessUnits } from "@/hooks/useNostrBusinessUnits";
import { useNostrListings } from "@/hooks/useNostrListings";
import { BusinessUnitCard } from "@/components/lanapays/BusinessUnitCard";
import { Filter, X, Leaf, Loader2, ShoppingBag, ArrowRight } from "lucide-react";

export default function LanaPaysDiscover() {
  const { businessUnits, isLoading } = useNostrBusinessUnits();
  const { listings, isLoading: listingsLoading } = useNostrListings();
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
      if (selectedCategory !== "all" && unit.category !== selectedCategory) return false;
      const country = unit.receiver_country || unit.country;
      if (selectedCountry !== "all" && country !== selectedCountry) return false;
      return true;
    });
  }, [businessUnits, selectedCategory, selectedCountry]);

  // Latest listings — first 6
  const latestListings = useMemo(() => {
    return [...listings].sort((a, b) => b.created_at - a.created_at).slice(0, 6);
  }, [listings]);

  const hasActiveFilters = selectedCategory !== "all" || selectedCountry !== "all";

  const clearFilters = () => {
    setSelectedCategory("all");
    setSelectedCountry("all");
  };

  return (
    <div className="space-y-10">
      {/* Filters */}
      <div className="bg-card border rounded-xl p-4 md:p-5">
        <div className="flex items-center gap-2 mb-3">
          <Filter className="h-4 w-4 text-primary flex-shrink-0" />
          <h3 className="font-display font-semibold text-sm md:text-base">Filters</h3>
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
            <label className="text-xs text-muted-foreground font-sans font-medium mb-1.5 block uppercase tracking-wider">
              Category
            </label>
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => setSelectedCategory("all")}
                className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-sans font-medium transition-colors ${
                  selectedCategory === "all"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:text-foreground"
                }`}
              >
                All
              </button>
              {categories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(selectedCategory === cat ? "all" : cat)}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-sans font-medium transition-colors ${
                    selectedCategory === cat
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Leaf className="w-3 h-3" />
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {/* Country Filter */}
          <div>
            <label className="text-xs text-muted-foreground font-sans font-medium mb-1.5 block uppercase tracking-wider">
              Country
            </label>
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => setSelectedCountry("all")}
                className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-sans font-medium transition-colors ${
                  selectedCountry === "all"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:text-foreground"
                }`}
              >
                All
              </button>
              {countries.map((country) => (
                <button
                  key={country}
                  onClick={() => setSelectedCountry(selectedCountry === country ? "all" : country)}
                  className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-sans font-medium transition-colors ${
                    selectedCountry === country
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {country}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Merchants section */}
      <section>
        <div className="flex items-end justify-between mb-6">
          <div>
            <h2 className="font-display text-2xl md:text-3xl font-bold">Merchants</h2>
            <p className="text-muted-foreground font-sans mt-1">
              {filteredUnits.length} merchant{filteredUnits.length !== 1 ? "s" : ""}{" "}
              {hasActiveFilters ? "found" : "available"}
            </p>
          </div>
        </div>

        {isLoading && (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-primary mr-2" />
            <span className="text-muted-foreground font-sans text-sm">Loading from relays...</span>
          </div>
        )}

        {!isLoading && filteredUnits.length === 0 && (
          <div className="text-center py-16">
            <Leaf className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-muted-foreground font-sans">No merchants found</p>
            {hasActiveFilters && (
              <button onClick={clearFilters} className="text-sm text-primary hover:underline mt-2 font-sans">
                Clear filters
              </button>
            )}
          </div>
        )}

        {!isLoading && filteredUnits.length > 0 && (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredUnits.map((unit) => (
              <BusinessUnitCard key={unit.id} unit={unit} />
            ))}
          </div>
        )}
      </section>

      {/* Latest Listings */}
      {!listingsLoading && latestListings.length > 0 && (
        <section>
          <div className="flex items-end justify-between mb-6">
            <div>
              <h2 className="font-display text-2xl md:text-3xl font-bold">Latest Listings</h2>
              <p className="text-muted-foreground font-sans mt-1">
                Products, subscriptions, services and experiences
              </p>
            </div>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {latestListings.map((listing) => (
              <Link
                key={`${listing.pubkey}-${listing.listingId}`}
                to={`/lanapays/listing/${listing.pubkey}/${listing.listingId}`}
                className="group bg-card border rounded-xl overflow-hidden hover:shadow-lg transition-all duration-300"
              >
                <div className="aspect-[16/10] overflow-hidden bg-muted">
                  {listing.images[0] ? (
                    <img
                      src={listing.images[0]}
                      alt={listing.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                      loading="lazy"
                      onError={(e) => { e.currentTarget.style.display = 'none'; }}
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <ShoppingBag className="w-10 h-10 text-muted-foreground/30" />
                    </div>
                  )}
                </div>
                <div className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-sans font-medium text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                        {listing.type.charAt(0).toUpperCase() + listing.type.slice(1)}
                      </span>
                      <span className="text-sm font-sans font-bold text-white bg-green-600 px-3 py-1 rounded-full shadow-sm">
                        🌿 5% Abundance
                      </span>
                    </div>
                    <span className="text-sm font-semibold font-sans">
                      {listing.price} {listing.priceCurrency}
                      {listing.unit && <span className="text-xs font-normal text-muted-foreground">/{listing.unit}</span>}
                    </span>
                  </div>
                  <h3 className="font-display text-base font-semibold truncate">{listing.title}</h3>
                  {listing.content && (
                    <p className="text-xs text-muted-foreground font-sans mt-1 line-clamp-2">{listing.content}</p>
                  )}
                  {listing.eco.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {listing.eco.slice(0, 2).map((e) => (
                        <span key={e} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-green-50 text-green-700 rounded text-[10px] font-sans">
                          <Leaf className="w-2.5 h-2.5" />
                          {e.replace(/_/g, " ")}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
