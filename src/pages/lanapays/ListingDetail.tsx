import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useNostrListings } from "@/hooks/useNostrListings";
import { useNostrBusinessUnits } from "@/hooks/useNostrBusinessUnits";
import {
  ArrowLeft,
  Loader2,
  MapPin,
  Leaf,
  Tag,
  Calendar,
  ShoppingBag,
  Truck,
  CreditCard,
  Clock,
  Users,
  CheckCircle,
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

export default function ListingDetail() {
  const { pubkey, listingId } = useParams<{ pubkey: string; listingId: string }>();
  const { listings, isLoading: listingsLoading } = useNostrListings();
  const { businessUnits, isLoading: unitsLoading } = useNostrBusinessUnits();
  const [selectedImage, setSelectedImage] = useState(0);

  const isLoading = listingsLoading || unitsLoading;

  const listing = listings.find(
    (l) => l.pubkey === pubkey && l.listingId === listingId
  );

  // Find parent unit
  const parentUnit = listing?.unitRef
    ? businessUnits.find((u) => {
        const parts = listing.unitRef.split(":");
        return parts.length >= 3 && u.unit_id === parts[2];
      })
    : null;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!listing) {
    return (
      <div className="container mx-auto px-4 py-12 text-center">
        <ShoppingBag className="w-12 h-12 mx-auto mb-3 text-muted-foreground/40" />
        <h2 className="font-display text-xl font-bold mb-2">Listing not found</h2>
        <Link to="/lanapays" className="text-primary hover:underline font-sans text-sm">
          Back to merchants
        </Link>
      </div>
    );
  }

  const allImages = [...listing.images, ...listing.thumbs].filter(Boolean);
  const unitId = listing.unitRef.split(":")[2];

  return (
    <div className="container mx-auto px-4 py-6 max-w-5xl">
      <Link
        to={parentUnit ? `/lanapays/unit/${parentUnit.unit_id}` : "/lanapays"}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-6 font-sans"
      >
        <ArrowLeft className="w-4 h-4" /> Back
      </Link>

      {/* Video */}
      {listing.video && (() => {
        const embedUrl = getYouTubeEmbedUrl(listing.video);
        return embedUrl ? (
          <div className="mb-6 rounded-xl overflow-hidden bg-muted">
            <div className="aspect-video">
              <iframe
                width="100%"
                height="100%"
                src={embedUrl}
                title={`${listing.title} video`}
                frameBorder="0"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>
          </div>
        ) : null;
      })()}

      <div className="grid lg:grid-cols-2 gap-8">
        {/* Image gallery */}
        <div>
          {allImages.length > 0 ? (
            <div>
              <div className="aspect-square rounded-xl overflow-hidden bg-muted mb-3">
                <img
                  src={allImages[selectedImage]}
                  alt={listing.title}
                  className="w-full h-full object-cover"
                />
              </div>
              {allImages.length > 1 && (
                <div className="flex gap-2 overflow-x-auto">
                  {allImages.map((img, i) => (
                    <button
                      key={i}
                      onClick={() => setSelectedImage(i)}
                      className={`w-16 h-16 rounded-lg overflow-hidden flex-shrink-0 border-2 transition ${
                        i === selectedImage ? "border-primary" : "border-transparent"
                      }`}
                    >
                      <img src={img} alt="" className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="aspect-square rounded-xl bg-muted flex items-center justify-center">
              <ShoppingBag className="w-16 h-16 text-muted-foreground/30" />
            </div>
          )}
        </div>

        {/* Info */}
        <div className="space-y-5">
          {/* Type badge */}
          <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-sans font-medium bg-primary/10 text-primary">
            {TYPE_LABELS[listing.type] || listing.type}
          </span>

          <h1 className="font-display text-2xl lg:text-3xl font-bold">{listing.title}</h1>

          {/* Price */}
          <div className="text-2xl font-bold text-foreground font-sans">
            {listing.price} {listing.priceCurrency}
            {listing.unit && (
              <span className="text-base font-normal text-muted-foreground">
                {" "}/ {listing.unit}
              </span>
            )}
          </div>

          {/* Cashback badge */}
          <span className="inline-flex items-center gap-1.5 bg-green-600 text-white px-3 py-1.5 rounded-full text-sm font-sans font-bold shadow-sm">
            🌿 {listing.cashbackPercent}% Abundance
          </span>

          {/* Description */}
          {listing.content && (
            <p className="text-sm text-muted-foreground font-sans leading-relaxed whitespace-pre-wrap">
              {listing.content}
            </p>
          )}

          {/* Eco labels */}
          {listing.eco.length > 0 && (
            <div>
              <h3 className="text-xs font-sans font-medium text-muted-foreground mb-2 uppercase tracking-wider">
                Eco Labels
              </h3>
              <div className="flex flex-wrap gap-2">
                {listing.eco.map((e) => (
                  <span
                    key={e}
                    className="inline-flex items-center gap-1 px-2.5 py-1 bg-green-50 text-green-700 rounded-full text-xs font-sans font-medium"
                  >
                    <Leaf className="w-3 h-3" /> {e.replace(/_/g, " ")}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Certificates */}
          {listing.cert.length > 0 && (
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-green-600" />
              <span className="text-sm font-sans">{listing.cert.join(", ")}</span>
            </div>
          )}

          {/* Category tags */}
          {listing.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {listing.tags.map((tg) => (
                <span
                  key={tg}
                  className="inline-flex items-center gap-1 px-2 py-0.5 bg-muted text-muted-foreground rounded text-xs font-sans"
                >
                  <Tag className="w-3 h-3" /> {tg.replace(/_/g, " ")}
                </span>
              ))}
            </div>
          )}

          {/* Stock */}
          {listing.stock && (
            <div className="text-sm font-sans text-muted-foreground">
              In stock:{" "}
              <span className="font-medium text-foreground">
                {listing.stock} {listing.unit}
              </span>
              {listing.minOrder && <span> (min: {listing.minOrder})</span>}
              {listing.maxOrder && <span> (max: {listing.maxOrder})</span>}
            </div>
          )}

          {/* Season */}
          {(listing.harvestSeason || listing.availableFrom) && (
            <div className="flex items-center gap-2 text-sm font-sans text-muted-foreground">
              <Calendar className="w-4 h-4" />
              {listing.harvestSeason && (
                <span className="capitalize">{listing.harvestSeason.replace(/_/g, " ")}</span>
              )}
              {listing.availableFrom && listing.availableUntil && (
                <span>
                  {listing.availableFrom} — {listing.availableUntil}
                </span>
              )}
            </div>
          )}

          {/* Delivery */}
          {listing.delivery.length > 0 && (
            <div>
              <h3 className="text-xs font-sans font-medium text-muted-foreground mb-2 uppercase tracking-wider">
                Delivery
              </h3>
              <div className="flex flex-wrap gap-2">
                {listing.delivery.map((d) => (
                  <span
                    key={d}
                    className="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-50 text-blue-700 rounded-full text-xs font-sans"
                  >
                    <Truck className="w-3 h-3" /> {d.replace(/_/g, " ")}
                  </span>
                ))}
              </div>
              {listing.deliveryRadiusKm && (
                <p className="text-xs text-muted-foreground font-sans mt-1">
                  Delivery radius: {listing.deliveryRadiusKm} km
                </p>
              )}
            </div>
          )}

          {/* Market days */}
          {listing.marketDays.length > 0 && (
            <div className="text-sm font-sans text-muted-foreground">
              <Clock className="w-4 h-4 inline mr-1" />
              Market days: {listing.marketDays.map((d) => d.slice(0, 3)).join(", ")}
            </div>
          )}

          {/* Subscription info */}
          {listing.type === "subscription" && listing.subscriptionInterval && (
            <div className="bg-accent/10 border border-accent/20 rounded-lg p-4">
              <h3 className="font-display font-semibold text-sm mb-1">Subscription</h3>
              <p className="text-sm font-sans">
                Interval: {listing.subscriptionInterval}
              </p>
              {listing.subscriptionContent && (
                <p className="text-sm font-sans text-muted-foreground mt-1">
                  {listing.subscriptionContent}
                </p>
              )}
            </div>
          )}

          {/* Experience details */}
          {(listing.capacity || listing.durationMin || listing.bookingRequired === "true") && (
            <div className="bg-purple-50 border border-purple-100 rounded-lg p-4 space-y-1">
              {listing.capacity && (
                <p className="text-sm font-sans">
                  <Users className="w-3.5 h-3.5 inline mr-1" />
                  Capacity: {listing.capacity}
                </p>
              )}
              {listing.durationMin && (
                <p className="text-sm font-sans">
                  <Clock className="w-3.5 h-3.5 inline mr-1" />
                  Duration: {listing.durationMin} min
                </p>
              )}
              {listing.bookingRequired === "true" && (
                <p className="text-sm font-sans text-purple-700">Booking required</p>
              )}
            </div>
          )}

          {/* Pre-order */}
          {listing.preOrder === "true" && (
            <div className="text-sm font-sans text-accent font-medium">
              Pre-order available
            </div>
          )}

          {/* Location override */}
          {listing.geoLat && listing.geoLon && (
            <div className="text-sm font-sans text-muted-foreground">
              <MapPin className="w-3.5 h-3.5 inline mr-1" />
              {listing.geoLabel || `${listing.geoLat}, ${listing.geoLon}`}
            </div>
          )}

          {/* Transparency */}
          {listing.sprayLog && (
            <div className="text-sm font-sans text-muted-foreground">
              Spray log: {listing.sprayLog}
            </div>
          )}
          {listing.soilTestYear && (
            <div className="text-sm font-sans text-muted-foreground">
              Soil test: {listing.soilTestYear}
            </div>
          )}

          {/* Payment */}
          {listing.payment.length > 0 && (
            <div>
              <h3 className="text-xs font-sans font-medium text-muted-foreground mb-2 uppercase tracking-wider">
                Payment
              </h3>
              <div className="flex flex-wrap gap-2">
                {listing.payment.map((p) => (
                  <span
                    key={p}
                    className="inline-flex items-center gap-1 px-2.5 py-1 bg-muted rounded-full text-xs font-sans"
                  >
                    <CreditCard className="w-3 h-3" /> {p.replace(/_/g, " ")}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Link to unit */}
          <div className="pt-4 border-t">
            {parentUnit ? (
              <Link
                to={`/lanapays/unit/${parentUnit.unit_id}`}
                className="inline-flex items-center gap-2 text-sm text-primary hover:underline font-sans font-medium"
              >
                <MapPin className="w-4 h-4" /> View {parentUnit.name}
              </Link>
            ) : unitId ? (
              <Link
                to={`/lanapays/unit/${unitId}`}
                className="inline-flex items-center gap-2 text-sm text-primary hover:underline font-sans font-medium"
              >
                <MapPin className="w-4 h-4" /> View merchant
              </Link>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
