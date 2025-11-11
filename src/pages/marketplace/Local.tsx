import { useState, useEffect } from "react";
import { useNostrMarketOffers } from "@/hooks/useNostrMarketOffers";
import { useNostrProfile } from "@/hooks/useNostrProfile";
import OfferCard from "@/components/marketplace/OfferCard";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { MapPin, Navigation } from "lucide-react";
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

  // Filter offers by distance
  const localOffers = offers.filter(offer => {
    if (!userLat || !userLng || !offer.latitude || !offer.longitude) {
      return false;
    }
    const dist = calculateDistance(userLat, userLng, offer.latitude, offer.longitude);
    return dist <= distance[0];
  });

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
      ) : !userLat || !userLng ? (
        <div className="text-center py-12 text-muted-foreground">
          <MapPin className="h-12 w-12 mx-auto mb-4" />
          <p className="text-lg font-medium mb-2">Set your location</p>
          <p>To see local offers, please set your current location</p>
        </div>
      ) : localOffers.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <p className="text-lg font-medium mb-2">No local offers found</p>
          <p>Try increasing the distance or check back later</p>
        </div>
      ) : (
        <>
          <div className="text-sm text-muted-foreground">
            Found {localOffers.length} offer{localOffers.length !== 1 ? 's' : ''} within {distance[0]} km
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {localOffers.map((offer) => (
              <OfferCard key={offer.id} offer={offer} />
            ))}
          </div>
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
