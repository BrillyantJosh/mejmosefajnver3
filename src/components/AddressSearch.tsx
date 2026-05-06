import { useState } from 'react';
import { Navigation, Search, Loader2, X, Loader } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

interface AddressSearchProps {
  /** Called when the user picks a result OR auto-detects their location.
   *  Coordinates are passed as 6-decimal strings.
   *  `displayName` (when present) is the human-readable address from Nominatim. */
  onLocationChange: (lat: string, lng: string, displayName?: string) => void;
  labels?: {
    autoDetect?: string;
    placeholder?: string;
    noResults?: string;
    selectLocation?: string;
    searchFailed?: string;
    permissionDenied?: string;
    geoUnavailable?: string;
  };
}

interface SearchResult {
  display_name: string;
  lat: string;
  lon: string;
}

/**
 * Inline address search with auto-detect, ported from shop.lanapays.us.
 * Uses OpenStreetMap Nominatim — no API key required.
 *
 * Usage notes:
 *  - Nominatim asks for ≤1 req/sec from a single source. We debounce nothing
 *    since a search is only triggered by Enter / button click.
 *  - When the user picks a result, the parent receives lat/lng/displayName so
 *    it can populate its location-name + lat/lon inputs in one go.
 */
export function AddressSearch({ onLocationChange, labels }: AddressSearchProps) {
  const [isDetecting, setIsDetecting] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  const labelAutoDetect = labels?.autoDetect ?? 'Use my location';
  const labelPlaceholder = labels?.placeholder ?? 'Search address (e.g. Groharjeva, Ljubljana)';
  const labelNoResults = labels?.noResults ?? 'No results found';
  const labelSelectLocation = labels?.selectLocation ?? 'Select a location:';
  const labelSearchFailed = labels?.searchFailed ?? 'Search failed. Try again.';
  const labelPermissionDenied = labels?.permissionDenied ?? 'Location permission denied.';
  const labelGeoUnavailable = labels?.geoUnavailable ?? 'Location unavailable.';

  const detectLocation = () => {
    if (!navigator.geolocation) {
      setError(labelGeoUnavailable);
      return;
    }

    setIsDetecting(true);
    setError(null);

    const onSuccess = (position: GeolocationPosition) => {
      onLocationChange(
        position.coords.latitude.toFixed(6),
        position.coords.longitude.toFixed(6),
      );
      setIsDetecting(false);
    };

    const onError = (err: GeolocationPositionError) => {
      if (err.code === 1) setError(labelPermissionDenied);
      else setError(labelGeoUnavailable);
      setIsDetecting(false);
    };

    // Try low-accuracy first (faster on desktop), then fall back to GPS.
    navigator.geolocation.getCurrentPosition(
      onSuccess,
      (lowAccErr) => {
        if (lowAccErr.code === 1) {
          onError(lowAccErr);
          return;
        }
        navigator.geolocation.getCurrentPosition(onSuccess, onError, {
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 60000,
        });
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    );
  };

  const searchLocation = async () => {
    if (!searchQuery.trim()) return;

    setIsSearching(true);
    setError(null);
    setSearchResults([]);

    try {
      const encoded = encodeURIComponent(searchQuery.trim());
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encoded}&limit=5`,
        { headers: { 'Accept-Language': 'en' } },
      );
      if (!res.ok) throw new Error('Search failed');
      const data: SearchResult[] = await res.json();
      if (data.length === 0) {
        setError(labelNoResults);
      } else {
        setSearchResults(data);
      }
    } catch {
      setError(labelSearchFailed);
    } finally {
      setIsSearching(false);
    }
  };

  const selectResult = (result: SearchResult) => {
    onLocationChange(
      parseFloat(result.lat).toFixed(6),
      parseFloat(result.lon).toFixed(6),
      result.display_name,
    );
    setSearchResults([]);
    setSearchQuery('');
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-col sm:flex-row gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={detectLocation}
          disabled={isDetecting}
          className="gap-1.5 sm:flex-shrink-0 text-primary hover:text-primary"
        >
          {isDetecting ? <Loader className="h-4 w-4 animate-spin" /> : <Navigation className="h-4 w-4" />}
          {labelAutoDetect}
        </Button>

        <div className="flex-1 flex gap-1">
          <Input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                searchLocation();
              }
            }}
            placeholder={labelPlaceholder}
            className="flex-1"
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={searchLocation}
            disabled={isSearching || !searchQuery.trim()}
            className="flex-shrink-0"
          >
            {isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {searchResults.length > 0 && (
        <div className="border rounded-lg overflow-hidden bg-card">
          <div className="flex items-center justify-between px-3 py-1.5 bg-muted border-b">
            <span className="text-xs text-muted-foreground">{labelSelectLocation}</span>
            <button
              type="button"
              onClick={() => setSearchResults([])}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          {searchResults.map((r, i) => (
            <button
              key={i}
              type="button"
              onClick={() => selectResult(r)}
              className="w-full text-left px-3 py-2.5 hover:bg-accent border-b last:border-b-0 transition-colors"
            >
              <p className="text-sm leading-tight">{r.display_name}</p>
              <p className="text-xs text-muted-foreground mt-0.5 font-mono">
                {parseFloat(r.lat).toFixed(6)}, {parseFloat(r.lon).toFixed(6)}
              </p>
            </button>
          ))}
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
