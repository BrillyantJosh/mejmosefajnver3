import { useParams, useNavigate } from "react-router-dom";
import { useNostrBusinessUnits } from "@/hooks/useNostrBusinessUnits";
import { useNostrListings, EcoListing } from "@/hooks/useNostrListings";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  ArrowLeft,
  MapPin,
  Clock,
  CreditCard,
  Building2,
  Globe,
  ExternalLink,
  ShoppingBag,
  Leaf,
  Loader2,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from "@/components/ui/carousel";

const TYPE_LABELS: Record<string, string> = {
  product: 'Product',
  subscription: 'Subscription',
  service: 'Service',
  experience: 'Experience',
};

const getYouTubeEmbedUrl = (url: string) => {
  if (!url) return null;
  const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/);
  return match ? `https://www.youtube.com/embed/${match[1]}` : null;
};

export default function BusinessUnitDetail() {
  const { unitId } = useParams<{ unitId: string }>();
  const navigate = useNavigate();
  const { businessUnits, isLoading } = useNostrBusinessUnits();
  const { listings, isLoading: listingsLoading } = useNostrListings();

  const unit = businessUnits.find(u => u.unit_id === unitId);
  const isOnline = unit?.category === "Online";

  // Filter listings for this unit
  const unitListings = listings.filter(l => {
    // unitRef format: "30901:<pubkey>:<unitId>"
    const parts = l.unitRef.split(':');
    return parts.length >= 3 && parts[2] === unitId;
  });

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

  if (!unit) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Card className="max-w-md w-full">
          <CardContent className="p-8 text-center">
            <h3 className="font-semibold mb-2">Business Not Found</h3>
            <p className="text-muted-foreground mb-4">
              The business you're looking for doesn't exist or has been removed.
            </p>
            <Button onClick={() => navigate('/lanapays')}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to List
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const formatOpeningHours = () => {
    if (!unit.opening_hours) return null;
    if (unit.opening_hours.always_open) return "Open 24/7";

    const days = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
    const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

    return days.map((day, idx) => {
      const hours = unit.opening_hours!.week[day as keyof typeof unit.opening_hours.week];
      return (
        <div key={day} className="flex justify-between text-sm">
          <span className="font-medium">{dayNames[idx]}</span>
          <span className="text-muted-foreground">
            {hours && hours.length > 0
              ? hours.map(h => `${h.open} - ${h.close}`).join(', ')
              : 'Closed'}
          </span>
        </div>
      );
    });
  };

  return (
    <div className="min-h-screen bg-background pb-8">
      <div className="container py-6 space-y-6">
        {/* Back Button */}
        <Button variant="ghost" onClick={() => navigate('/lanapays')}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>

        {/* Video */}
        {unit.video && getYouTubeEmbedUrl(unit.video) && (
          <Card className="overflow-hidden">
            <CardContent className="p-0">
              <div className="aspect-video">
                <iframe
                  width="100%"
                  height="100%"
                  src={getYouTubeEmbedUrl(unit.video)!}
                  title={`${unit.name} video`}
                  frameBorder="0"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
            </CardContent>
          </Card>
        )}

        {/* Image Carousel */}
        {unit.images && unit.images.length > 0 && (
          <Card className="overflow-hidden">
            <Carousel className="w-full">
              <CarouselContent>
                {unit.images.map((image, idx) => (
                  <CarouselItem key={idx}>
                    <div className="relative h-[400px] bg-muted">
                      <img
                        src={image}
                        alt={`${unit.name} - Image ${idx + 1}`}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          e.currentTarget.src = '/placeholder.svg';
                        }}
                      />
                    </div>
                  </CarouselItem>
                ))}
              </CarouselContent>
              {unit.images.length > 1 && (
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
            <div className="flex items-start justify-between">
              <div className="space-y-2 flex-1">
                <div className="flex items-center gap-3">
                  {unit.logo && (
                    <img
                      src={unit.logo}
                      alt={`${unit.name} logo`}
                      className="w-16 h-16 object-contain rounded-lg bg-muted p-2"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none';
                      }}
                    />
                  )}
                  <CardTitle className="text-3xl">{unit.name}</CardTitle>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge>{unit.category}</Badge>
                  {unit.category_detail && (
                    <Badge variant="outline">{unit.category_detail}</Badge>
                  )}
                  <Badge variant="secondary">{unit.status}</Badge>
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {unit.content && (
              <>
                <p className="text-muted-foreground">{unit.content}</p>
                <Separator />
              </>
            )}

            {/* Location */}
            {!isOnline && (
              <div className="flex items-start gap-3">
                <MapPin className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-medium">Location</p>
                  <p className="text-sm text-muted-foreground">
                    {unit.receiver_address}<br />
                    {unit.receiver_zip} {unit.receiver_city}<br />
                    {unit.receiver_country}
                  </p>
                </div>
              </div>
            )}

            {/* Currency */}
            <div className="flex items-start gap-3">
              <CreditCard className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-medium">Accepted Currency</p>
                <p className="text-sm text-muted-foreground">{unit.currency}</p>
              </div>
            </div>

            {/* Website */}
            {unit.url && (
              <div className="flex items-start gap-3">
                <Globe className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
                <div className="flex-1">
                  <p className="font-medium">{isOnline ? 'Online Store' : 'Website'}</p>
                  <a
                    href={unit.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-primary hover:underline flex items-center gap-1 break-all"
                  >
                    {unit.url}
                    <ExternalLink className="h-3 w-3 flex-shrink-0" />
                  </a>
                  {isOnline && (
                    <Button
                      className="mt-2"
                      onClick={(e) => {
                        e.stopPropagation();
                        window.open(unit.url, '_blank');
                      }}
                    >
                      Visit Store
                      <ExternalLink className="h-4 w-4 ml-2" />
                    </Button>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ───── LISTINGS SECTION ───── */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShoppingBag className="h-5 w-5" />
              Listings
              {!listingsLoading && unitListings.length > 0 && (
                <Badge variant="secondary" className="ml-1">{unitListings.length}</Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {listingsLoading ? (
              <div className="flex items-center gap-2 text-muted-foreground text-sm py-4">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading listings...
              </div>
            ) : unitListings.length === 0 ? (
              <p className="text-sm text-muted-foreground py-2">
                No listings available for this merchant.
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {unitListings.map((listing) => (
                  <div
                    key={`${listing.pubkey}-${listing.listingId}`}
                    className="group cursor-pointer bg-muted/30 border rounded-xl overflow-hidden hover:shadow-md transition"
                    onClick={() => navigate(`/lanapays/listing/${listing.pubkey}/${listing.listingId}`)}
                  >
                    {listing.images[0] && (
                      <div className="aspect-[16/9] overflow-hidden bg-muted">
                        <img
                          src={listing.images[0]}
                          alt={listing.title}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          loading="lazy"
                          onError={(e) => { e.currentTarget.src = '/placeholder.svg'; }}
                        />
                      </div>
                    )}
                    <div className="p-3 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1">
                          <Badge variant="outline" className="text-[10px]">
                            {TYPE_LABELS[listing.type] || listing.type}
                          </Badge>
                        </div>
                        <span className="text-sm font-semibold">
                          {listing.price} {listing.priceCurrency}
                          {listing.unit && (
                            <span className="text-xs font-normal text-muted-foreground">
                              /{listing.unit}
                            </span>
                          )}
                        </span>
                      </div>
                      <h3 className="font-semibold text-sm truncate">
                        {listing.title}
                      </h3>
                      {listing.eco.length > 0 && (
                        <div className="flex gap-1 flex-wrap">
                          {listing.eco.slice(0, 3).map((e) => (
                            <span
                              key={e}
                              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300 rounded text-[9px]"
                            >
                              <Leaf className="w-2 h-2" />
                              {e.replace(/_/g, " ")}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Map for non-online businesses */}
        {!isOnline && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MapPin className="h-5 w-5" />
                Location Map
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="aspect-video rounded-lg overflow-hidden bg-muted">
                  <iframe
                    width="100%"
                    height="100%"
                    style={{ border: 0 }}
                    loading="lazy"
                    allowFullScreen
                    referrerPolicy="no-referrer-when-downgrade"
                    src={`https://www.openstreetmap.org/export/embed.html?bbox=${Number(unit.longitude) - 0.005},${Number(unit.latitude) - 0.003},${Number(unit.longitude) + 0.005},${Number(unit.latitude) + 0.003}&layer=mapnik&marker=${unit.latitude},${unit.longitude}`}
                  />
                </div>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={(e) => {
                    e.stopPropagation();
                    window.open(`https://www.google.com/maps?q=${unit.latitude},${unit.longitude}`, '_blank');
                  }}
                >
                  <MapPin className="h-4 w-4 mr-2" />
                  Open in Google Maps
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Opening Hours */}
        {!isOnline && unit.opening_hours && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5" />
                Opening Hours
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {formatOpeningHours()}
              {unit.opening_hours.notes && (
                <>
                  <Separator className="my-3" />
                  <p className="text-sm text-muted-foreground italic">
                    {unit.opening_hours.notes}
                  </p>
                </>
              )}
            </CardContent>
          </Card>
        )}

        {/* Banking Details */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              Banking Information
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <p className="text-sm font-medium">Receiver</p>
              <p className="text-sm text-muted-foreground">{unit.receiver_name}</p>
            </div>
            <Separator />
            <div>
              <p className="text-sm font-medium">Bank</p>
              <p className="text-sm text-muted-foreground">{unit.bank_name}</p>
              <p className="text-sm text-muted-foreground">{unit.bank_address}</p>
            </div>
            <Separator />
            <div>
              <p className="text-sm font-medium">SWIFT/BIC</p>
              <p className="text-sm text-muted-foreground font-mono">{unit.bank_swift}</p>
            </div>
            <div>
              <p className="text-sm font-medium">Account Number</p>
              <p className="text-sm text-muted-foreground font-mono">{unit.bank_account}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
