import { useState, useEffect } from "react";
import { useNostrBusinessUnits } from "@/hooks/useNostrBusinessUnits";
import { useNostrProfile } from "@/hooks/useNostrProfile";
import { BusinessUnitCard } from "@/components/lanapays/BusinessUnitCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { MapPin, Navigation } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import LocationPicker from "@/components/LocationPicker";
import { toast } from "sonner";

// Haversine formula to calculate distance between two coordinates
const calculateDistance = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number => {
  const R = 6371; // Earth's radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

export default function LanaPaysLocation() {
  const { businessUnits, isLoading } = useNostrBusinessUnits();
  const { profile } = useNostrProfile();
  
  const [userLat, setUserLat] = useState<number | null>(profile?.latitude || null);
  const [userLng, setUserLng] = useState<number | null>(profile?.longitude || null);
  const [maxDistance, setMaxDistance] = useState<number>(50);
  const [showLocationPicker, setShowLocationPicker] = useState(false);

  // Update user location when profile loads
  useEffect(() => {
    if (profile?.latitude && profile?.longitude) {
      setUserLat(profile.latitude);
      setUserLng(profile.longitude);
    }
  }, [profile?.latitude, profile?.longitude]);

  // Filter business units by distance (exclude "Online" category)
  const localUnits = businessUnits
    .filter(unit => unit.category !== "Online")
    .map(unit => {
      if (!userLat || !userLng) return { unit, distance: null };
      const distance = calculateDistance(userLat, userLng, unit.latitude, unit.longitude);
      return { unit, distance };
    })
    .filter(item => item.distance === null || item.distance <= maxDistance)
    .sort((a, b) => (a.distance || 0) - (b.distance || 0));

  const handleGetCurrentLocation = () => {
    if (!navigator.geolocation) {
      toast.error("Geolocation is not supported by your browser");
      return;
    }

    toast.info("Getting your location...");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setUserLat(position.coords.latitude);
        setUserLng(position.coords.longitude);
        toast.success("Location updated!");
      },
      (error) => {
        console.error("Error getting location:", error);
        toast.error("Failed to get your location");
      }
    );
  };

  const handleLocationSelect = (lat: number, lng: number) => {
    setUserLat(lat);
    setUserLng(lng);
    toast.success("Location updated!");
  };

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Location Controls */}
      <Card>
        <CardContent className="p-3 md:p-4 space-y-3 md:space-y-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h3 className="font-semibold text-sm md:text-base">Your Location</h3>
              <p className="text-xs md:text-sm text-muted-foreground truncate">
                {userLat && userLng
                  ? `${userLat.toFixed(4)}, ${userLng.toFixed(4)}`
                  : "Not set"}
              </p>
            </div>
            <div className="flex gap-2 w-full sm:w-auto">
              <Button
                variant="outline"
                size="sm"
                onClick={handleGetCurrentLocation}
                className="flex-1 sm:flex-none"
              >
                <Navigation className="h-4 w-4 sm:mr-0 mr-2" />
                <span className="sm:hidden">Current Location</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowLocationPicker(true)}
                className="flex-1 sm:flex-none"
              >
                <MapPin className="h-4 w-4 sm:mr-0 mr-2" />
                <span className="sm:hidden">Pick on Map</span>
              </Button>
            </div>
          </div>

          {/* Distance Slider */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs md:text-sm font-medium">
                Distance: {maxDistance} km
              </label>
            </div>
            <Slider
              value={[maxDistance]}
              onValueChange={(value) => setMaxDistance(value[0])}
              min={1}
              max={100}
              step={1}
              className="w-full"
            />
          </div>
        </CardContent>
      </Card>

      {/* Business Units Grid */}
      {!userLat || !userLng ? (
        <Card>
          <CardContent className="p-6 md:p-8 text-center">
            <MapPin className="h-10 w-10 md:h-12 md:w-12 mx-auto text-muted-foreground mb-3 md:mb-4" />
            <h3 className="font-semibold text-base md:text-lg mb-2">Location Required</h3>
            <p className="text-xs md:text-sm text-muted-foreground mb-3 md:mb-4">
              Please set your location to see nearby merchants
            </p>
            <div className="flex flex-col sm:flex-row gap-2 justify-center">
              <Button onClick={handleGetCurrentLocation} size="sm" className="w-full sm:w-auto">
                <Navigation className="h-4 w-4 mr-2" />
                Use Current Location
              </Button>
              <Button variant="outline" size="sm" onClick={() => setShowLocationPicker(true)} className="w-full sm:w-auto">
                <MapPin className="h-4 w-4 mr-2" />
                Pick on Map
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : isLoading ? (
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
      ) : localUnits.length === 0 ? (
        <Card>
          <CardContent className="p-6 md:p-8 text-center">
            <p className="text-sm md:text-base text-muted-foreground">
              No merchants found within {maxDistance} km
            </p>
            <p className="text-xs md:text-sm text-muted-foreground mt-2">
              Try increasing the distance or changing your location
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {localUnits.map(({ unit, distance }) => (
            <BusinessUnitCard
              key={unit.id}
              unit={unit}
              distance={distance || undefined}
            />
          ))}
        </div>
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
