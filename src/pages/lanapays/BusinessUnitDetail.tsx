import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useNostrBusinessUnits } from "@/hooks/useNostrBusinessUnits";
import { useNostrListings } from "@/hooks/useNostrListings";
import {
  ArrowLeft,
  MapPin,
  Clock,
  Globe,
  Tag,
  Leaf,
  ChevronLeft,
  ChevronRight,
  X,
  ExternalLink,
  ShoppingBag,
  Loader2,
} from "lucide-react";

const TYPE_LABELS: Record<string, string> = {
  product: "Product",
  subscription: "Subscription",
  service: "Service",
  experience: "Experience",
};

const getYouTubeEmbedUrl = (url: string) => {
  const match = url.match(
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/
  );
  return match ? `https://www.youtube.com/embed/${match[1]}` : null;
};

interface OpeningHoursFormatted {
  [day: string]: { enabled: boolean; from: string; to: string };
}

export default function BusinessUnitDetail() {
  const { unitId } = useParams<{ unitId: string }>();
  const { businessUnits, isLoading } = useNostrBusinessUnits();
  const { listings, isLoading: listingsLoading } = useNostrListings();
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);

  const unit = businessUnits.find((u) => u.unit_id === unitId);

  // Filter listings for this unit
  const unitListings = listings.filter((l) => {
    const parts = l.unitRef.split(":");
    return parts.length >= 3 && parts[2] === unitId;
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-pulse text-muted-foreground font-sans">Loading...</div>
      </div>
    );
  }

  if (!unit) {
    return (
      <div className="container mx-auto px-4 py-20 text-center">
        <p className="text-lg text-muted-foreground font-sans mb-4">Business not found</p>
        <Link to="/lanapays" className="text-primary font-sans hover:underline">Back to merchants</Link>
      </div>
    );
  }

  const images = unit.images.filter(Boolean);
  const heroImage = images[0] || null;
  const galleryImages = images.slice(1);

  let openingHours: OpeningHoursFormatted | null = null;
  try {
    if (unit.opening_hours) {
      // Convert from the hook's format to the display format
      const oh = unit.opening_hours;
      if (oh.always_open) {
        openingHours = null; // We'll show "Open 24/7" separately
      } else if (oh.week) {
        const days = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
        const dayMap: Record<string, string> = {
          mon: "monday", tue: "tuesday", wed: "wednesday", thu: "thursday",
          fri: "friday", sat: "saturday", sun: "sunday",
        };
        const result: OpeningHoursFormatted = {};
        days.forEach((d) => {
          const slots = oh.week[d as keyof typeof oh.week];
          if (slots && slots.length > 0) {
            result[dayMap[d]] = { enabled: true, from: slots[0].open, to: slots[0].close };
          } else {
            result[dayMap[d]] = { enabled: false, from: "", to: "" };
          }
        });
        openingHours = result;
      }
    }
  } catch {}

  const hasLocation =
    unit.latitude && unit.longitude && unit.latitude !== 0 && unit.longitude !== 0;

  const dayLabels: Record<string, string> = {
    monday: "Monday", tuesday: "Tuesday", wednesday: "Wednesday",
    thursday: "Thursday", friday: "Friday", saturday: "Saturday", sunday: "Sunday",
  };

  return (
    <div className="pb-16">
      {/* Hero image */}
      {heroImage && (
        <div className="relative w-full h-[40vh] md:h-[50vh] overflow-hidden">
          <img
            src={heroImage}
            alt={unit.name}
            className="w-full h-full object-cover cursor-pointer"
            onClick={() => setLightboxIdx(0)}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-foreground/60 to-transparent" />
          <div className="absolute bottom-0 left-0 right-0 p-6 md:p-10">
            <div className="container mx-auto">
              <Link
                to="/lanapays"
                className="inline-flex items-center gap-1 text-primary-foreground/80 text-sm font-sans mb-3 hover:text-primary-foreground"
              >
                <ArrowLeft className="w-4 h-4" /> Back
              </Link>
              <h1 className="font-display text-3xl md:text-5xl font-bold text-primary-foreground">
                {unit.name}
              </h1>
              <div className="flex flex-wrap items-center gap-3 mt-3">
                {unit.category && (
                  <span className="inline-flex items-center gap-1 bg-primary/80 text-primary-foreground px-3 py-1 rounded-full text-sm font-sans">
                    <Leaf className="w-3.5 h-3.5" />
                    {unit.category}
                    {unit.category_detail ? ` / ${unit.category_detail}` : ""}
                  </span>
                )}
                {(unit.receiver_city || unit.country) && (
                  <span className="inline-flex items-center gap-1 bg-primary-foreground/20 text-primary-foreground px-3 py-1 rounded-full text-sm font-sans">
                    <MapPin className="w-3.5 h-3.5" />
                    {[unit.receiver_city, unit.receiver_country || unit.country]
                      .filter(Boolean)
                      .join(", ")}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* No hero fallback */}
      {!heroImage && (
        <div className="bg-primary/10 py-16">
          <div className="container mx-auto px-4">
            <Link
              to="/lanapays"
              className="inline-flex items-center gap-1 text-muted-foreground text-sm font-sans mb-3 hover:text-foreground"
            >
              <ArrowLeft className="w-4 h-4" /> Back
            </Link>
            <h1 className="font-display text-3xl md:text-5xl font-bold text-foreground">
              {unit.name}
            </h1>
            <div className="flex flex-wrap items-center gap-3 mt-3">
              {unit.category && (
                <span className="inline-flex items-center gap-1 bg-primary text-primary-foreground px-3 py-1 rounded-full text-sm font-sans">
                  <Leaf className="w-3.5 h-3.5" />
                  {unit.category}
                </span>
              )}
              {(unit.receiver_city || unit.country) && (
                <span className="inline-flex items-center gap-1 bg-muted text-muted-foreground px-3 py-1 rounded-full text-sm font-sans">
                  <MapPin className="w-3.5 h-3.5" />
                  {[unit.receiver_city, unit.receiver_country || unit.country]
                    .filter(Boolean)
                    .join(", ")}
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="container mx-auto px-4 mt-8">
        <div className="grid md:grid-cols-3 gap-8">
          {/* Main content — left 2 cols */}
          <div className="md:col-span-2 space-y-8">
            {/* Description */}
            {unit.content && (
              <section>
                <h2 className="font-display text-xl font-semibold mb-3">About</h2>
                <p className="text-muted-foreground font-sans leading-relaxed whitespace-pre-line">
                  {unit.content}
                </p>
              </section>
            )}

            {unit.note && (
              <section className="bg-primary/5 border border-primary/20 rounded-xl p-5">
                <p className="text-sm font-sans text-foreground italic">"{unit.note}"</p>
              </section>
            )}

            {/* Gallery */}
            {galleryImages.length > 0 && (
              <section>
                <h2 className="font-display text-xl font-semibold mb-4">Gallery</h2>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {galleryImages.map((img, idx) => (
                    <div
                      key={idx}
                      className="aspect-square rounded-xl overflow-hidden cursor-pointer hover:opacity-90 transition"
                      onClick={() => setLightboxIdx(idx + 1)}
                    >
                      <img
                        src={img}
                        alt={`${unit.name} ${idx + 2}`}
                        className="w-full h-full object-cover"
                      />
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Listings */}
            {!listingsLoading && unitListings.length > 0 && (
              <section>
                <h2 className="font-display text-xl font-semibold mb-4 flex items-center gap-2">
                  <ShoppingBag className="w-5 h-5 text-primary" />
                  Listings ({unitListings.length})
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {unitListings.map((listing) => (
                    <Link
                      key={`${listing.pubkey}-${listing.listingId}`}
                      to={`/lanapays/listing/${listing.pubkey}/${listing.listingId}`}
                      className="group bg-card border rounded-xl overflow-hidden hover:shadow-md transition"
                    >
                      {listing.images[0] && (
                        <div className="aspect-[16/9] overflow-hidden bg-muted">
                          <img
                            src={listing.images[0]}
                            alt={listing.title}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                            loading="lazy"
                            onError={(e) => { e.currentTarget.style.display = 'none'; }}
                          />
                        </div>
                      )}
                      <div className="p-3">
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-1">
                            <span className="text-[10px] font-sans font-medium text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                              {TYPE_LABELS[listing.type] || listing.type}
                            </span>
                            <span className="text-xs font-sans font-bold text-white bg-green-600 px-2.5 py-1 rounded-full shadow-sm">
                              🌿 5%
                            </span>
                          </div>
                          <span className="text-sm font-semibold font-sans">
                            {listing.price} {listing.priceCurrency}
                            {listing.unit && (
                              <span className="text-xs font-normal text-muted-foreground">
                                /{listing.unit}
                              </span>
                            )}
                          </span>
                        </div>
                        <h3 className="font-display text-sm font-semibold truncate">
                          {listing.title}
                        </h3>
                        {listing.eco.length > 0 && (
                          <div className="flex gap-1 mt-1.5">
                            {listing.eco.slice(0, 2).map((e) => (
                              <span
                                key={e}
                                className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-green-50 text-green-700 rounded text-[9px] font-sans"
                              >
                                <Leaf className="w-2 h-2" />
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

            {listingsLoading && (
              <div className="flex items-center gap-2 text-muted-foreground text-sm font-sans py-4">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading listings...
              </div>
            )}
          </div>

          {/* Sidebar — right col */}
          <div className="space-y-6">
            {/* Info card */}
            <div className="bg-card border rounded-xl p-5 space-y-4">
              <h3 className="font-display text-lg font-semibold">Details</h3>

              {unit.category && (
                <div className="flex items-start gap-3">
                  <Tag className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground font-sans">Category</p>
                    <p className="text-sm font-sans font-medium">
                      {unit.category}
                      {unit.category_detail ? ` / ${unit.category_detail}` : ""}
                    </p>
                  </div>
                </div>
              )}

              {(unit.receiver_city || unit.country) && (
                <div className="flex items-start gap-3">
                  <MapPin className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground font-sans">Location</p>
                    <p className="text-sm font-sans font-medium">
                      {[unit.receiver_city, unit.receiver_country || unit.country]
                        .filter(Boolean)
                        .join(", ")}
                    </p>
                  </div>
                </div>
              )}

              {unit.currency && (
                <div className="flex items-start gap-3">
                  <Globe className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground font-sans">Currency</p>
                    <p className="text-sm font-sans font-medium">{unit.currency}</p>
                  </div>
                </div>
              )}

              {unit.url && (
                <a
                  href={unit.url.startsWith("http") ? unit.url : `https://${unit.url}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm text-primary font-sans hover:underline"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Visit website
                </a>
              )}
            </div>

            {/* Opening hours */}
            {unit.opening_hours?.always_open && (
              <div className="bg-card border rounded-xl p-5">
                <h3 className="font-display text-lg font-semibold mb-3 flex items-center gap-2">
                  <Clock className="w-4 h-4 text-primary" />
                  Opening Hours
                </h3>
                <p className="text-sm font-sans font-medium text-green-600">Open 24/7</p>
              </div>
            )}

            {openingHours && (
              <div className="bg-card border rounded-xl p-5">
                <h3 className="font-display text-lg font-semibold mb-3 flex items-center gap-2">
                  <Clock className="w-4 h-4 text-primary" />
                  Opening Hours
                </h3>
                <div className="space-y-2">
                  {Object.entries(dayLabels).map(([key, label]) => {
                    const day = openingHours?.[key];
                    return (
                      <div key={key} className="flex justify-between text-sm font-sans">
                        <span className={day?.enabled ? "text-foreground" : "text-muted-foreground"}>
                          {label}
                        </span>
                        <span
                          className={
                            day?.enabled
                              ? "text-foreground font-medium"
                              : "text-muted-foreground"
                          }
                        >
                          {day?.enabled ? `${day.from} – ${day.to}` : "Closed"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Logo */}
            {unit.logo && (
              <div className="bg-card border rounded-xl p-5 flex justify-center">
                <img
                  src={unit.logo}
                  alt={`${unit.name} logo`}
                  className="max-h-24 object-contain"
                />
              </div>
            )}

            {/* Video */}
            {unit.video &&
              (() => {
                const embedUrl = getYouTubeEmbedUrl(unit.video);
                return embedUrl ? (
                  <div className="bg-card border rounded-xl p-5">
                    <h3 className="font-display text-sm font-semibold mb-3">Video</h3>
                    <div className="aspect-video rounded-lg overflow-hidden bg-muted">
                      <iframe
                        src={embedUrl}
                        className="w-full h-full"
                        allowFullScreen
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        title={`${unit.name} video`}
                      />
                    </div>
                  </div>
                ) : null;
              })()}

            {/* Map */}
            {hasLocation && (
              <div className="bg-card border rounded-xl p-5">
                <h3 className="font-display text-sm font-semibold mb-3">Location</h3>
                <div className="aspect-square rounded-lg overflow-hidden border">
                  <iframe
                    src={`https://www.openstreetmap.org/export/embed.html?bbox=${unit.longitude - 0.01},${unit.latitude - 0.005},${unit.longitude + 0.01},${unit.latitude + 0.005}&layer=mapnik&marker=${unit.latitude},${unit.longitude}`}
                    className="w-full h-full"
                    title="Location"
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Lightbox */}
      {lightboxIdx !== null && images.length > 0 && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center"
          onClick={() => setLightboxIdx(null)}
        >
          <button
            className="absolute top-4 right-4 text-white/80 hover:text-white p-2"
            onClick={() => setLightboxIdx(null)}
          >
            <X className="w-6 h-6" />
          </button>

          {images.length > 1 && (
            <>
              <button
                className="absolute left-4 text-white/80 hover:text-white p-2"
                onClick={(e) => {
                  e.stopPropagation();
                  setLightboxIdx((lightboxIdx - 1 + images.length) % images.length);
                }}
              >
                <ChevronLeft className="w-8 h-8" />
              </button>
              <button
                className="absolute right-4 text-white/80 hover:text-white p-2"
                onClick={(e) => {
                  e.stopPropagation();
                  setLightboxIdx((lightboxIdx + 1) % images.length);
                }}
              >
                <ChevronRight className="w-8 h-8" />
              </button>
            </>
          )}

          <img
            src={images[lightboxIdx]}
            alt={`${unit.name} ${lightboxIdx + 1}`}
            className="max-w-[90vw] max-h-[85vh] object-contain rounded-lg"
            onClick={(e) => e.stopPropagation()}
          />

          <div className="absolute bottom-4 text-white/60 text-sm font-sans">
            {lightboxIdx + 1} / {images.length}
          </div>
        </div>
      )}
    </div>
  );
}
