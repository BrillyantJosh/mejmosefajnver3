import { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { UserAvatar } from '@/components/ui/UserAvatar';
import { Loader2, Search, User, Wallet, ChevronRight } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useSystemParameters } from '@/contexts/SystemParametersContext';
import { t } from '@/lib/aiAdvisorTranslations';

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
  language?: string;
  onSelect: (recipient: {
    name: string;
    pubkey: string;
    walletId: string;
    walletType: string;
  }) => void;
  onCancel: () => void;
}

export function RecipientSelector({ searchQuery, language, onSelect, onCancel }: RecipientSelectorProps) {
  const { parameters } = useSystemParameters();
  const [query, setQuery] = useState(searchQuery);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState('');
  const [hasSearched, setHasSearched] = useState(false);

  const handleSearch = async () => {
    if (!query.trim() || query.trim().length < 2) {
      setError(t('searchMinChars', language));
      return;
    }

    setIsSearching(true);
    setError('');
    setResults([]);
    setHasSearched(true);

    try {
      const { data, error: searchError } = await supabase.functions.invoke('search-recipient', {
        body: {
          query: query.trim(),
          relays: parameters?.relays || [],
        },
      });

      if (searchError) throw searchError;

      if (data?.results) {
        setResults(data.results);
        if (data.results.length === 0) {
          setError(t('noUsersWithWallets', language));
        }
      } else {
        setError(t('noResultsReturned', language));
      }
    } catch (err) {
      console.error('Search error:', err);
      setError(t('searchError', language));
    } finally {
      setIsSearching(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  // Auto-search on mount if a search query was provided
  const hasAutoSearched = useRef(false);
  useEffect(() => {
    if (!hasAutoSearched.current && searchQuery && searchQuery.trim().length >= 2) {
      hasAutoSearched.current = true;
      handleSearch();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <Search className="h-5 w-5" />
          {t('selectRecipient', language)}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>{t('nameOrDisplayName', language)}</Label>
          <div className="flex gap-2">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t('enterUserName', language)}
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

        {error && (
          <p className="text-sm text-destructive text-center">{error}</p>
        )}

        {isSearching && (
          <div className="flex flex-col items-center py-8 gap-2">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">{t('searchingUsers', language)}</p>
          </div>
        )}

        {!isSearching && results.length > 0 && (
          <ScrollArea className="h-[300px]">
            <div className="space-y-3">
              {results.map((result) => (
                <Card key={result.pubkey} className="p-3">
                  <div className="flex items-start gap-3 mb-3">
                    <UserAvatar pubkey={result.pubkey} picture={result.picture} name={result.displayName} className="h-10 w-10" />
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

        {!isSearching && hasSearched && results.length === 0 && !error && (
          <div className="text-center py-8">
            <User className="h-12 w-12 mx-auto text-muted-foreground/50 mb-2" />
            <p className="text-sm text-muted-foreground">{t('noUsersFound', language)}</p>
          </div>
        )}

        <Button variant="outline" onClick={onCancel} className="w-full">
          {t('cancel', language)}
        </Button>
      </CardContent>
    </Card>
  );
}
