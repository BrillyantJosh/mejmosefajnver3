import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Search as SearchIcon, Calendar, Users, User } from "lucide-react";
import { getProxiedImageUrl } from '@/lib/imageProxy';
import { useNostrClosedCases } from '@/hooks/useNostrClosedCases';
import { useNostrProfilesCacheBulk } from '@/hooks/useNostrProfilesCacheBulk';
import { useNostrRevenueSharesBatch } from '@/hooks/useNostrRevenueSharesBatch';
import { useNostrDonationProposal } from '@/hooks/useNostrDonationProposal';
import { useAuth } from '@/contexts/AuthContext';
import { DonationProposalDialog } from '@/components/own/DonationProposalDialog';
import { fiatToLana, fiatToFiat, formatCurrency, formatLana, getUserCurrency } from '@/lib/currencyConversion';
import { format } from 'date-fns';

export default function Search() {
  const navigate = useNavigate();
  const { session } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCase, setSelectedCase] = useState<{ id: string; title: string } | null>(null);
  
  const { closedCases, isLoading: casesLoading } = useNostrClosedCases();
  
  // Get all unique pubkeys for profile fetching
  const allPubkeys = useMemo(() => {
    const pubkeys = new Set<string>();
    closedCases.forEach(c => {
      pubkeys.add(c.pubkey);
      c.participants.forEach(p => pubkeys.add(p));
    });
    return Array.from(pubkeys);
  }, [closedCases]);
  
  const { profiles } = useNostrProfilesCacheBulk(allPubkeys);
  
  // Get all case IDs for revenue share fetching (strip "own:" prefix for Nostr event matching)
  const processRecordIds = useMemo(() => 
    closedCases.map(c => c.id.replace(/^own:/, '')), 
    [closedCases]
  );
  
  const { revenueShares, isLoading: revenueLoading } = useNostrRevenueSharesBatch(processRecordIds);
  
  // Filter cases based on search query
  const filteredCases = useMemo(() => {
    if (!searchQuery.trim()) return closedCases;
    
    const query = searchQuery.toLowerCase();
    return closedCases.filter(c => 
      c.initialContent.toLowerCase().includes(query) ||
      c.title?.toLowerCase().includes(query) ||
      c.topic?.toLowerCase().includes(query)
    );
  }, [closedCases, searchQuery]);
  
  const calculatePrices = (processRecordId: string) => {
    // Strip "own:" prefix for revenue share lookup
    const lookupId = processRecordId.replace(/^own:/, '');
    const revenueShare = revenueShares[lookupId];
    
    if (!revenueShare?.data?.donation_amount) {
      return { lanAmount: 0, userFiatAmount: 0, userCurrency: 'EUR', sourceFiatAmount: 0, sourceCurrency: 'EUR', visibility: 'private' };
    }

    const sourceFiatAmount = parseFloat(revenueShare.data.donation_amount.toString());
    const sourceCurrency = revenueShare.currency || 'EUR';
    const userCurrency = getUserCurrency();
    const visibility = revenueShare.visibility || 'private';
    
    // Convert source fiat to LANA
    const lanAmount = fiatToLana(sourceFiatAmount, sourceCurrency);
    
    // Convert source fiat to user's fiat currency
    const userFiatAmount = sourceCurrency === userCurrency 
      ? sourceFiatAmount 
      : fiatToFiat(sourceFiatAmount, sourceCurrency, userCurrency);
    
    return { lanAmount, userFiatAmount, userCurrency, sourceFiatAmount, sourceCurrency, visibility };
  };
  
  const handleGetTranscript = (caseId: string, caseTitle: string) => {
    // Check if user already has payment proposal
    // This will be handled by the dialog component
    setSelectedCase({ id: caseId, title: caseTitle });
  };
  
  const handlePaymentSuccess = () => {
    if (selectedCase) {
      navigate(`/own/transcript/${selectedCase.id}`);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Search Cases</CardTitle>
          <CardDescription>
            Browse closed OWN ▲ process cases and access transcripts
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="relative">
            <SearchIcon className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input 
              placeholder="Search by title or description..." 
              className="pl-10"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4">
        {casesLoading ? (
          <>
            {[1, 2, 3].map(i => (
              <Card key={i}>
                <CardHeader>
                  <Skeleton className="h-6 w-3/4" />
                  <Skeleton className="h-4 w-1/2" />
                </CardHeader>
                <CardContent>
                  <Skeleton className="h-20 w-full" />
                </CardContent>
              </Card>
            ))}
          </>
        ) : filteredCases.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              {searchQuery ? 'No cases found matching your search' : 'No closed cases available'}
            </CardContent>
          </Card>
        ) : (
          filteredCases.map((ownCase) => {
            const { lanAmount, userFiatAmount, userCurrency, sourceFiatAmount, sourceCurrency, visibility } = calculatePrices(ownCase.id);
            const facilitator = profiles.get(ownCase.pubkey);
            
            return (
              <Card key={ownCase.id} className="hover:shadow-md transition-shadow">
                <CardHeader>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <CardTitle className="text-lg">{ownCase.title || ownCase.topic || 'Untitled Case'}</CardTitle>
                        <Badge variant="secondary">Closed</Badge>
                        {ownCase.lang && (
                          <Badge variant="outline" className="text-xs uppercase">
                            {ownCase.lang}
                          </Badge>
                        )}
                      </div>
                      <CardDescription className="line-clamp-2">
                        {ownCase.initialContent}
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
                    <div className="flex items-center gap-2">
                      <Calendar className="h-4 w-4" />
                      <span>Started: {format(new Date(ownCase.startedAt * 1000), 'dd/MM/yyyy')}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Calendar className="h-4 w-4" />
                      <span>Closed: {format(new Date(ownCase.closedAt * 1000), 'dd/MM/yyyy')}</span>
                    </div>
                  </div>

                  {facilitator && (
                    <div className="text-sm">
                      <span className="text-muted-foreground">Facilitator</span>
                      <div className="flex items-center gap-2 mt-1">
                        <Avatar className="h-6 w-6">
                          <AvatarImage src={getProxiedImageUrl(facilitator.picture)} />
                          <AvatarFallback>
                            <User className="h-3 w-3" />
                          </AvatarFallback>
                        </Avatar>
                        <span className="font-medium">
                          {facilitator.display_name || facilitator.full_name || `${ownCase.pubkey.slice(0, 8)}...`}
                        </span>
                      </div>
                    </div>
                  )}

                  {ownCase.participants.length > 0 && (
                    <div className="text-sm">
                      <div className="flex items-center gap-2 text-muted-foreground mb-2">
                        <Users className="h-4 w-4" />
                        <span>Participants ({ownCase.participants.length})</span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {Array.from(new Set(ownCase.participants)).slice(0, 5).map((pubkey) => {
                          const profile = profiles.get(pubkey);
                          return (
                            <div key={pubkey} className="flex items-center gap-1.5 bg-secondary px-2 py-1 rounded-md">
                              <Avatar className="h-5 w-5">
                                <AvatarImage src={getProxiedImageUrl(profile?.picture)} />
                                <AvatarFallback className="text-xs">
                                  <User className="h-3 w-3" />
                                </AvatarFallback>
                              </Avatar>
                              <span className="text-xs">
                                {profile?.display_name || profile?.full_name || `${pubkey.slice(0, 2)} ${pubkey.slice(2, 8)}...`}
                              </span>
                            </div>
                          );
                        })}
                        {ownCase.participants.length > 5 && (
                          <Badge variant="secondary" className="text-xs">
                            +{ownCase.participants.length - 5} more
                          </Badge>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="flex items-center justify-between pt-4 border-t">
                    <div className="flex gap-3 flex-wrap">
                      {lanAmount > 0 ? (
                        <>
                          <Badge className="bg-cyan-500/10 text-cyan-700 hover:bg-cyan-500/20">
                            {Math.round(lanAmount)} LANA
                          </Badge>
                          {userCurrency === sourceCurrency ? (
                            <Badge className="bg-cyan-500/10 text-cyan-700 hover:bg-cyan-500/20">
                              {formatCurrency(sourceFiatAmount, sourceCurrency)}
                            </Badge>
                          ) : (
                            <>
                              <Badge className="bg-cyan-500/10 text-cyan-700 hover:bg-cyan-500/20">
                                {formatCurrency(userFiatAmount, userCurrency)}
                              </Badge>
                              <Badge variant="outline" className="text-xs">
                                ≈ {formatCurrency(sourceFiatAmount, sourceCurrency)}
                              </Badge>
                            </>
                          )}
                        </>
                      ) : (
                        <span className="text-sm text-muted-foreground">Pricing not available</span>
                      )}
                    </div>
                    {visibility === 'public' && lanAmount > 0 && (
                      <Button 
                        className="bg-cyan-600 hover:bg-cyan-700"
                        onClick={() => handleGetTranscript(ownCase.id, ownCase.title || ownCase.topic || ownCase.initialContent)}
                        disabled={revenueLoading}
                      >
                        Get Transcript
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      {selectedCase && (
        <DonationProposalDialog
          isOpen={!!selectedCase}
          onClose={() => setSelectedCase(null)}
          processRecordId={selectedCase.id}
          caseTitle={selectedCase.title}
          lanAmount={calculatePrices(selectedCase.id).lanAmount}
          fiatAmount={calculatePrices(selectedCase.id).userFiatAmount}
          fiatCurrency={calculatePrices(selectedCase.id).userCurrency}
          onSuccess={handlePaymentSuccess}
        />
      )}
    </div>
  );
}
