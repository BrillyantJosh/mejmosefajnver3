import { useState, useEffect, useMemo } from "react";
import { useNostrMarketOffers } from "@/hooks/useNostrMarketOffers";
import { useNostrProfile } from "@/hooks/useNostrProfile";
import OfferCard from "@/components/marketplace/OfferCard";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { MapPin, Navigation, Globe } from "lucide-react";
import LocationPicker from "@/components/LocationPicker";
import { toast } from "sonner";

export default function MarketplaceLocal() {
  const { offers, isLoading } = useNostrMarketOffers({ status: 'active' });
  const { profile } = useNostrProfile();
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const [loadingLocation, setLoadingLocation] = useState(false);

  // User's current location (either from profile or manually set)
  const [userLat, setUserLat] = useState<number | undefined>(profile?.latitude);
  const [userLng, setUserLng] = useState<number | undefined>(profile?.longitude);

  // Distance filter (in km)
  const [distance, setDistance] = useState([50]);

  // Update user location from profile
  useEffect(() => {
    if (profile?.latitude && profile?.longitude) {
      setUserLat(profile.latitude);
      setUserLng(profile.longitude);
    }
  }, [profile]);

  // Auto-detect location on mount if not set from profile
  useEffect(() => {
    if (!userLat && !userLng && navigator.geolocation) {
      setLoadingLocation(true);
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const lat = Math.round(position.coords.latitude * 1e6) / 1e6;
          const lng = Math.round(position.coords.longitude * 1e6) / 1e6;
          setUserLat(lat);
          setUserLng(lng);
          setLoadingLocation(false);
          toast.success("Location detected", {
            description: `Coordinates: ${lat}, ${lng}`
          });
        },
        () => {
          setLoadingLocation(false);
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 300000 }
      );
    }
  }, []);

  // Calculate distance between two coordinates (Haversine formula)
  const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
    const R = 6371; // Earth's radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  };

  // Split offers: with geo data vs without
  const geoOffers = useMemo(() => offers.filter(o => o.latitude && o.longitude), [offers]);
  const noGeoOffers = useMemo(() => offers.filter(o => !o.latitude || !o.longitude), [offers]);

  // Filter geo offers by distance from user
  const localOffers = useMemo(() => {
    if (!userLat || !userLng) return [];
    return geoOffers.filter(offer => {
      const dist = calculateDistance(userLat, userLng, offer.latitude!, offer.longitude!);
      return dist <= distance[0];
    });
  }, [geoOffers, userLat, userLng, distance]);

  const handleGetCurrentLocation = () => {
    if (!navigator.geolocation) {
      toast.error("Geolocation not supported", {
        description: "Your browser doesn't support geolocation"
      });
      return;
    }

    setLoadingLocation(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = Math.round(position.coords.latitude * 1000000) / 1000000;
        const lng = Math.round(position.coords.longitude * 1000000) / 1000000;
        
        setUserLat(lat);
        setUserLng(lng);
        
        toast.success("Location detected", {
          description: `Coordinates: ${lat}, ${lng}`
        });
        
        setLoadingLocation(false);
      },
      (error) => {
        console.error('Geolocation error:', error);
        toast.error("Unable to get location", {
          description: "Please enable location access in your browser"
        });
        setLoadingLocation(false);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      }
    );
  };

  const handleLocationSelect = (latitude: number, longitude: number) => {
    setUserLat(latitude);
    setUserLng(longitude);
    toast.success("Location selected", {
      description: `Coordinates: ${latitude.toFixed(6)}, ${longitude.toFixed(6)}`
    });
  };

  return (
    <div className="space-y-6">
      {/* Location Controls */}
      <div className="bg-card rounded-lg border p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold">Your Location</h3>
            {userLat && userLng ? (
              <p className="text-sm text-muted-foreground">
                {userLat.toFixed(4)}, {userLng.toFixed(4)}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">No location set</p>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleGetCurrentLocation}
              disabled={loadingLocation}
            >
              <Navigation className="h-4 w-4 mr-2" />
              Current Location
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowLocationPicker(true)}
            >
              <MapPin className="h-4 w-4 mr-2" />
              Pick on Map
            </Button>
          </div>
        </div>

        {/* Distance Slider */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium">Distance</label>
            <span className="text-sm text-muted-foreground">{distance[0]} km</span>
          </div>
          <Slider
            value={distance}
            onValueChange={setDistance}
            min={0}
            max={100}
            step={5}
            className="w-full"
          />
        </div>
      </div>

      {/* Offers Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="space-y-3">
              <Skeleton className="aspect-[4/3] w-full" />
              <Skeleton className="h-6 w-3/4" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-8 w-1/2" />
            </div>
          ))}
        </div>
      ) : (
        <>
          {/* Stats */}
          <div className="text-sm text-muted-foreground">
            {offers.length} offers total
            {geoOffers.length > 0 && ` • ${geoOffers.length} with location`}
            {noGeoOffers.length > 0 && ` • ${noGeoOffers.length} without location`}
          </div>

          {/* Location prompt if not set */}
          {loadingLocation && (
            <div className="text-center py-4 text-muted-foreground">
              <Navigation className="h-6 w-6 mx-auto mb-2 animate-pulse" />
              <p className="text-sm">Detecting your location...</p>
            </div>
          )}

          {!userLat && !userLng && !loadingLocation && (
            <div className="text-center py-6 text-muted-foreground bg-card rounded-lg border">
              <MapPin className="h-8 w-8 mx-auto mb-2" />
              <p className="text-sm font-medium mb-1">Location not set</p>
              <p className="text-xs">Click "Current Location" or "Pick on Map" to see nearby offers</p>
            </div>
          )}

          {/* Local offers (with geo data, filtered by distance) */}
          {userLat && userLng && (
            <>
              {localOffers.length > 0 ? (
                <div className="space-y-3">
                  <h3 className="font-semibold text-sm flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-green-500" />
                    Nearby offers ({localOffers.length} within {distance[0]} km)
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {localOffers.map((offer) => (
                      <OfferCard key={offer.id} offer={offer} />
                    ))}
                  </div>
                </div>
              ) : geoOffers.length > 0 ? (
                <div className="text-center py-4 text-muted-foreground text-sm">
                  No offers within {distance[0]} km. Try increasing the distance.
                </div>
              ) : null}
            </>
          )}

          {/* Offers without geo data */}
          {noGeoOffers.length > 0 && (
            <div className="space-y-3">
              <h3 className="font-semibold text-sm flex items-center gap-2">
                <Globe className="h-4 w-4 text-muted-foreground" />
                Offers without location ({noGeoOffers.length})
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {noGeoOffers.map((offer) => (
                  <OfferCard key={offer.id} offer={offer} />
                ))}
              </div>
            </div>
          )}

          {/* No offers at all */}
          {offers.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              <p className="text-lg font-medium mb-2">No offers</p>
              <p>There are currently no active offers on the marketplace</p>
            </div>
          )}
        </>
      )}

      {/* Location Picker Modal */}
      {showLocationPicker && (
        <LocationPicker
          onLocationSelect={handleLocationSelect}
          onClose={() => setShowLocationPicker(false)}
          initialLat={userLat || 46.0569}
          initialLng={userLng || 14.5058}
        />
      )}
    </div>
  );
}
