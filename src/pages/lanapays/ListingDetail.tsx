import { useParams, useNavigate } from "react-router-dom";
import { useNostrListings, EcoListing } from "@/hooks/useNostrListings";
import { useNostrBusinessUnits } from "@/hooks/useNostrBusinessUnits";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";
import {
  ArrowLeft,
  Leaf,
  Package,
  Truck,
  Calendar,
  Tag,
  ShoppingBag,
  Store,
} from "lucide-react";

const TYPE_LABELS: Record<string, string> = {
  product: "Product",
  subscription: "Subscription",
  service: "Service",
  experience: "Experience",
};

const SEASON_LABELS: Record<string, string> = {
  spring: "Spring",
  summer: "Summer",
  autumn: "Autumn",
  winter: "Winter",
  year_round: "Year Round",
};

const DELIVERY_LABELS: Record<string, string> = {
  pickup: "Pickup",
  local_delivery: "Local Delivery",
  farmers_market: "Farmers Market",
  shipping: "Shipping",
  box_scheme: "Box Scheme",
};

const getYouTubeEmbedUrl = (url: string) => {
  const match = url.match(
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/
  );
  return match ? `https://www.youtube.com/embed/${match[1]}` : url;
};

export default function ListingDetail() {
  const { pubkey, listingId } = useParams<{
    pubkey: string;
    listingId: string;
  }>();
  const navigate = useNavigate();
  const { listings, isLoading: listingsLoading } = useNostrListings();
  const { businessUnits, isLoading: unitsLoading } = useNostrBusinessUnits();

  const isLoading = listingsLoading || unitsLoading;

  // Find this listing
  const listing = listings.find(
    (l) => l.pubkey === pubkey && l.listingId === listingId
  );

  // Find parent business unit from a-tag
  const parentUnit = listing?.unitRef
    ? businessUnits.find((u) => {
        // unitRef format: "30901:<pubkey>:<unitId>"
        const parts = listing.unitRef.split(":");
        return parts.length >= 3 && u.unit_id === parts[2];
      })
    : null;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <div className="container py-6 space-y-6">
          <Skeleton className="h-10 w-32" />
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      </div>
    );
  }

  if (!listing) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Card className="max-w-md w-full">
          <CardContent className="p-8 text-center">
            <h3 className="font-semibold mb-2">Listing Not Found</h3>
            <p className="text-muted-foreground mb-4">
              This listing doesn't exist or has been removed.
            </p>
            <Button onClick={() => navigate(-1)}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Go Back
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-8">
      <div className="container py-6 space-y-6">
        {/* Back Button */}
        <Button variant="ghost" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>

        {/* Video */}
        {listing.video && (
          <Card className="overflow-hidden">
            <CardContent className="p-0">
              <div className="aspect-video">
                <iframe
                  width="100%"
                  height="100%"
                  src={getYouTubeEmbedUrl(listing.video)}
                  title={`${listing.title} video`}
                  frameBorder="0"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
            </CardContent>
          </Card>
        )}

        {/* Image Carousel */}
        {listing.images && listing.images.length > 0 && (
          <Card className="overflow-hidden">
            <Carousel className="w-full">
              <CarouselContent>
                {listing.images.map((image, idx) => (
                  <CarouselItem key={idx}>
                    <div className="relative h-[300px] md:h-[400px] bg-muted">
                      <img
                        src={image}
                        alt={`${listing.title} - Image ${idx + 1}`}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          e.currentTarget.src = "/placeholder.svg";
                        }}
                      />
                    </div>
                  </CarouselItem>
                ))}
              </CarouselContent>
              {listing.images.length > 1 && (
                <>
                  <CarouselPrevious className="left-4" />
                  <CarouselNext className="right-4" />
                </>
              )}
            </Carousel>
          </Card>
        )}

        {/* Basic Info */}
        <Card>
          <CardHeader>
            <div className="space-y-3">
              <CardTitle className="text-2xl md:text-3xl">
                {listing.title}
              </CardTitle>
              <div className="flex items-center gap-2 flex-wrap">
                <Badge>{TYPE_LABELS[listing.type] || listing.type}</Badge>
                {listing.eco.map((e) => (
                  <Badge key={e} variant="secondary" className="gap-1">
                    <Leaf className="h-3 w-3" />
                    {e.replace(/_/g, " ")}
                  </Badge>
                ))}
              </div>
              {/* Price */}
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-bold text-primary">
                  {listing.price} {listing.priceCurrency}
                </span>
                {listing.unit && (
                  <span className="text-muted-foreground">/ {listing.unit}</span>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {listing.content && (
              <>
                <p className="text-muted-foreground whitespace-pre-line">
                  {listing.content}
                </p>
                <Separator />
              </>
            )}

            {/* Tags */}
            {listing.tags.length > 0 && (
              <div className="flex items-start gap-3">
                <Tag className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
                <div className="flex flex-wrap gap-1.5">
                  {listing.tags.map((tag) => (
                    <Badge key={tag} variant="outline" className="text-xs">
                      {tag.replace(/_/g, " ")}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Stock */}
            {listing.stock && (
              <div className="flex items-start gap-3">
                <Package className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-medium">Stock</p>
                  <p className="text-sm text-muted-foreground">
                    {listing.stock} available
                    {listing.minOrder &&
                      ` · Min order: ${listing.minOrder}`}
                    {listing.maxOrder &&
                      ` · Max order: ${listing.maxOrder}`}
                  </p>
                </div>
              </div>
            )}

            {/* Season / Availability */}
            {(listing.harvestSeason || listing.availableFrom) && (
              <div className="flex items-start gap-3">
                <Calendar className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-medium">Availability</p>
                  <p className="text-sm text-muted-foreground">
                    {listing.harvestSeason &&
                      `Season: ${SEASON_LABELS[listing.harvestSeason] || listing.harvestSeason}`}
                    {listing.availableFrom &&
                      ` · From: ${listing.availableFrom}`}
                    {listing.availableUntil &&
                      ` · Until: ${listing.availableUntil}`}
                  </p>
                </div>
              </div>
            )}

            {/* Delivery */}
            {listing.delivery.length > 0 && (
              <div className="flex items-start gap-3">
                <Truck className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-medium">Delivery</p>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {listing.delivery.map((d) => (
                      <Badge key={d} variant="outline" className="text-xs">
                        {DELIVERY_LABELS[d] || d.replace(/_/g, " ")}
                      </Badge>
                    ))}
                  </div>
                  {listing.deliveryRadiusKm && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Delivery radius: {listing.deliveryRadiusKm} km
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Certifications */}
            {listing.cert.length > 0 && (
              <div className="flex items-start gap-3">
                <ShoppingBag className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-medium">Certifications</p>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {listing.cert.map((c, i) => (
                      <Badge key={c} variant="secondary" className="text-xs">
                        {listing.certUrl[i] ? (
                          <a
                            href={listing.certUrl[i]}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:underline"
                          >
                            {c}
                          </a>
                        ) : (
                          c
                        )}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Subscription-specific */}
            {listing.type === "subscription" && listing.subscriptionInterval && (
              <>
                <Separator />
                <div>
                  <p className="font-medium">Subscription Details</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Interval: {listing.subscriptionInterval}
                  </p>
                  {listing.subscriptionContent && (
                    <p className="text-sm text-muted-foreground">
                      Contents: {listing.subscriptionContent}
                    </p>
                  )}
                </div>
              </>
            )}

            {/* Experience-specific */}
            {listing.type === "experience" && (
              <>
                <Separator />
                <div>
                  <p className="font-medium">Experience Details</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {listing.capacity && `Capacity: ${listing.capacity}`}
                    {listing.durationMin &&
                      ` · Duration: ${listing.durationMin} min`}
                    {listing.bookingRequired === "true" &&
                      " · Booking required"}
                  </p>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Parent Business Unit */}
        {parentUnit && (
          <Card
            className="cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => navigate(`/lanapays/unit/${parentUnit.unit_id}`)}
          >
            <CardContent className="p-4 flex items-center gap-4">
              <Store className="h-8 w-8 text-primary flex-shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted-foreground">
                  Offered by
                </p>
                <p className="font-semibold truncate">{parentUnit.name}</p>
                <p className="text-sm text-muted-foreground truncate">
                  {parentUnit.receiver_city}, {parentUnit.receiver_country}
                </p>
              </div>
              {parentUnit.logo && (
                <img
                  src={parentUnit.logo}
                  alt={parentUnit.name}
                  className="w-12 h-12 rounded-full object-contain bg-muted p-1"
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
                  }}
                />
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
