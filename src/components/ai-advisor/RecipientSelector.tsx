import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Loader2, Search, User, Wallet, ChevronRight } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useSystemParameters } from '@/contexts/SystemParametersContext';

interface RecipientWallet {
  walletId: string;
  walletType: string;
  note: string;
}

interface SearchResult {
  pubkey: string;
  name: string;
  displayName: string;
  picture?: string;
  wallets: RecipientWallet[];
}

interface RecipientSelectorProps {
  searchQuery: string;
  onSelect: (recipient: {
    name: string;
    pubkey: string;
    walletId: string;
    walletType: string;
  }) => void;
  onCancel: () => void;
}

export function RecipientSelector({ searchQuery, onSelect, onCancel }: RecipientSelectorProps) {
  const { parameters } = useSystemParameters();
  const [query, setQuery] = useState(searchQuery);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState('');
  const [hasSearched, setHasSearched] = useState(false);

  const handleSearch = async () => {
    if (!query.trim() || query.trim().length < 2) {
      setError('Iskalni niz mora imeti vsaj 2 znaka');
      return;
    }

    setIsSearching(true);
    setError('');
    setResults([]);
    setHasSearched(true);

    try {
      const { data, error: searchError } = await supabase.functions.invoke('search-recipient', {
        body: {
          searchQuery: query.trim(),
          relays: parameters?.relays || [],
        },
      });

      if (searchError) throw searchError;

      if (data?.results) {
        setResults(data.results);
        if (data.results.length === 0) {
          setError('Ni najdenih uporabnikov z denarnicami');
        }
      } else {
        setError('Iskanje ni vrnilo rezultatov');
      }
    } catch (err) {
      console.error('Search error:', err);
      setError('Napaka pri iskanju. Poskusite ponovno.');
    } finally {
      setIsSearching(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <Search className="h-5 w-5" />
          Izberi prejemnika
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Search Input */}
        <div className="space-y-2">
          <Label>Ime ali prikazno ime</Label>
          <div className="flex gap-2">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Vnesite ime uporabnika..."
              disabled={isSearching}
            />
            <Button onClick={handleSearch} disabled={isSearching || query.trim().length < 2}>
              {isSearching ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Search className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <p className="text-sm text-destructive text-center">{error}</p>
        )}

        {/* Loading State */}
        {isSearching && (
          <div className="flex flex-col items-center py-8 gap-2">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Iščem uporabnike...</p>
          </div>
        )}

        {/* Results */}
        {!isSearching && results.length > 0 && (
          <ScrollArea className="h-[300px]">
            <div className="space-y-3">
              {results.map((result) => (
                <Card key={result.pubkey} className="p-3">
                  <div className="flex items-start gap-3 mb-3">
                    <Avatar className="h-10 w-10">
                      <AvatarImage src={result.picture} alt={result.displayName} />
                      <AvatarFallback>
                        <User className="h-5 w-5" />
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold truncate">{result.displayName}</p>
                      {result.name && result.name !== result.displayName && (
                        <p className="text-sm text-muted-foreground truncate">@{result.name}</p>
                      )}
                    </div>
                  </div>

                  <div className="space-y-2">
                    {result.wallets.map((wallet, idx) => (
                      <Button
                        key={idx}
                        variant="outline"
                        className="w-full justify-between h-auto py-2 px-3"
                        onClick={() => onSelect({
                          name: result.displayName || result.name,
                          pubkey: result.pubkey,
                          walletId: wallet.walletId,
                          walletType: wallet.walletType,
                        })}
                      >
                        <div className="flex items-center gap-2 text-left flex-1 min-w-0">
                          <Wallet className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                          <div className="min-w-0">
                            <p className="font-mono text-xs truncate">{wallet.walletId}</p>
                            <p className="text-xs text-muted-foreground">
                              {wallet.walletType}
                              {wallet.note && ` • ${wallet.note.slice(0, 20)}${wallet.note.length > 20 ? '...' : ''}`}
                            </p>
                          </div>
                        </div>
                        <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                      </Button>
                    ))}
                  </div>
                </Card>
              ))}
            </div>
          </ScrollArea>
        )}

        {/* No Results */}
        {!isSearching && hasSearched && results.length === 0 && !error && (
          <div className="text-center py-8">
            <User className="h-12 w-12 mx-auto text-muted-foreground/50 mb-2" />
            <p className="text-sm text-muted-foreground">Ni najdenih uporabnikov</p>
          </div>
        )}

        {/* Cancel Button */}
        <Button variant="outline" onClick={onCancel} className="w-full">
          Prekliči
        </Button>
      </CardContent>
    </Card>
  );
}
