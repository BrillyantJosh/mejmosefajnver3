import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Button } from "@/components/ui/button";
import { MapPin, X } from "lucide-react";

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
}

const LocationPicker = ({ 
  onLocationSelect, 
  onClose, 
  initialLat = 46.0569,
  initialLng = 14.5058 
}: LocationPickerProps) => {
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const [selectedPosition, setSelectedPosition] = useState<{ lat: number; lng: number } | null>(
    { lat: initialLat, lng: initialLng }
  );

  useEffect(() => {
    // Prepreči ponovno inicializacijo, če zemljevid že obstaja
    if (!mapContainerRef.current || mapRef.current) return;

    // 1. Inicializiraj zemljevid
    const map = L.map(mapContainerRef.current).setView([initialLat, initialLng], 13);
    
    // 2. Dodaj tile layer (OpenStreetMap)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);

    // 3. Dodaj marker z možnostjo vlečenja
    const marker = L.marker([initialLat, initialLng], { 
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

    // 6. Cleanup funkcija
    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [initialLat, initialLng]);

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
            Select Location on Map
          </h3>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        
        <div className="flex-1 p-4 space-y-3 overflow-y-auto">
          <p className="text-sm text-muted-foreground">
            Click on the map or drag the marker to select a location
          </p>
          
          {/* Kontejner za zemljevid */}
          <div className="rounded-lg overflow-hidden border border-border h-[400px]">
            <div ref={mapContainerRef} className="w-full h-full" />
          </div>
          
          {/* Prikaz izbranih koordinat */}
          {selectedPosition && (
            <div className="p-3 bg-muted rounded-md">
              <p className="text-sm">
                <span className="font-medium">Selected:</span>{" "}
                {selectedPosition.lat.toFixed(6)}, {selectedPosition.lng.toFixed(6)}
              </p>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 p-4 border-t border-border">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={!selectedPosition}>
            Confirm Location
          </Button>
        </div>
      </div>
    </div>
  );
};

export default LocationPicker;
