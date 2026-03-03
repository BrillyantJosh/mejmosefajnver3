import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Button } from "@/components/ui/button";
import { MapPin, X, LocateFixed, Loader2 } from "lucide-react";

// KRITIČNO: Fix za ikone markerjev
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

const defaultIcon = L.icon({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

interface LocationPickerProps {
  onLocationSelect: (latitude: number, longitude: number) => void;
  onClose: () => void;
  initialLat?: number;
  initialLng?: number;
  labels?: {
    title?: string;
    hint?: string;
    selected?: string;
    cancel?: string;
    confirm?: string;
    myLocation?: string;
    locating?: string;
  };
}

const FALLBACK_LAT = 46.0569;
const FALLBACK_LNG = 14.5058;

const LocationPicker = ({
  onLocationSelect,
  onClose,
  initialLat,
  initialLng,
  labels
}: LocationPickerProps) => {
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const [selectedPosition, setSelectedPosition] = useState<{ lat: number; lng: number } | null>(
    initialLat && initialLng ? { lat: initialLat, lng: initialLng } : null
  );
  const [locating, setLocating] = useState(false);
  const geoAttemptedRef = useRef(false);

  const titleText = labels?.title || 'Select Location on Map';
  const hintText = labels?.hint || 'Click on the map or drag the marker to select a location';
  const selectedText = labels?.selected || 'Selected';
  const cancelText = labels?.cancel || 'Cancel';
  const confirmText = labels?.confirm || 'Confirm Location';
  const myLocationText = labels?.myLocation || 'My Location';
  const locatingText = labels?.locating || 'Locating...';

  // Determine starting coordinates for the map
  const startLat = initialLat || FALLBACK_LAT;
  const startLng = initialLng || FALLBACK_LNG;

  const panToLocation = (lat: number, lng: number) => {
    if (mapRef.current && markerRef.current) {
      const latlng = L.latLng(lat, lng);
      markerRef.current.setLatLng(latlng);
      mapRef.current.setView(latlng, 15);
      setSelectedPosition({ lat, lng });
    }
  };

  const handleGeolocation = () => {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        panToLocation(lat, lng);
        setLocating(false);
      },
      () => {
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    // 1. Inicializiraj zemljevid
    const map = L.map(mapContainerRef.current).setView([startLat, startLng], 13);

    // 2. Dodaj tile layer (OpenStreetMap)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);

    // 3. Dodaj marker z možnostjo vlečenja
    const marker = L.marker([startLat, startLng], {
      icon: defaultIcon,
      draggable: true
    }).addTo(map);

    // 4. Handler za vlečenje markerja
    marker.on('dragend', () => {
      const position = marker.getLatLng();
      setSelectedPosition({ lat: position.lat, lng: position.lng });
    });

    // 5. Handler za klik na zemljevid
    map.on('click', (e: L.LeafletMouseEvent) => {
      marker.setLatLng(e.latlng);
      setSelectedPosition({ lat: e.latlng.lat, lng: e.latlng.lng });
    });

    mapRef.current = map;
    markerRef.current = marker;

    // 6. Auto-geolocation: če ni podanih initialnih koordinat, poskusi najti uporabnika
    if (!initialLat && !initialLng && !geoAttemptedRef.current) {
      geoAttemptedRef.current = true;
      if (navigator.geolocation) {
        setLocating(true);
        navigator.geolocation.getCurrentPosition(
          (position) => {
            const lat = position.coords.latitude;
            const lng = position.coords.longitude;
            const latlng = L.latLng(lat, lng);
            marker.setLatLng(latlng);
            map.setView(latlng, 15);
            setSelectedPosition({ lat, lng });
            setLocating(false);
          },
          () => {
            setLocating(false);
          },
          { enableHighAccuracy: true, timeout: 10000 }
        );
      }
    }

    // 7. Cleanup funkcija
    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [startLat, startLng, initialLat, initialLng]);

  const handleConfirm = () => {
    if (selectedPosition) {
      onLocationSelect(selectedPosition.lat, selectedPosition.lng);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-background border border-border rounded-lg shadow-lg w-full max-w-3xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <MapPin className="h-5 w-5" />
            {titleText}
          </h3>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex-1 p-4 space-y-3 overflow-y-auto">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {hintText}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleGeolocation}
              disabled={locating}
              className="shrink-0 ml-2"
            >
              {locating ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : (
                <LocateFixed className="h-4 w-4 mr-1" />
              )}
              {locating ? locatingText : myLocationText}
            </Button>
          </div>

          {/* Kontejner za zemljevid */}
          <div className="rounded-lg overflow-hidden border border-border h-[400px]">
            <div ref={mapContainerRef} className="w-full h-full" />
          </div>

          {/* Prikaz izbranih koordinat */}
          {selectedPosition && (
            <div className="p-3 bg-muted rounded-md">
              <p className="text-sm">
                <span className="font-medium">{selectedText}:</span>{" "}
                {selectedPosition.lat.toFixed(6)}, {selectedPosition.lng.toFixed(6)}
              </p>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 p-4 border-t border-border">
          <Button variant="outline" onClick={onClose}>
            {cancelText}
          </Button>
          <Button onClick={handleConfirm} disabled={!selectedPosition}>
            {confirmText}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default LocationPicker;
