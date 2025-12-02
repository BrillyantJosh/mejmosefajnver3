import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Search as SearchIcon, Calendar, Users, User, Loader2 } from "lucide-react";
import { getProxiedImageUrl } from '@/lib/imageProxy';
import { useNostrClosedCases } from '@/hooks/useNostrClosedCases';
import { useNostrProfilesCacheBulk } from '@/hooks/useNostrProfilesCacheBulk';
import { useNostrRevenueSharesBatch } from '@/hooks/useNostrRevenueSharesBatch';
import { useNostrDonationProposal } from '@/hooks/useNostrDonationProposal';
import { useNostrUserPayments } from '@/hooks/useNostrUserPayments';
import { useAuth } from '@/contexts/AuthContext';
import { DonationProposalDialog } from '@/components/own/DonationProposalDialog';
import { fiatToLana, fiatToFiat, formatCurrency, formatLana, getUserCurrency } from '@/lib/currencyConversion';
import { format } from 'date-fns';
import { RevenueShareEvent } from '@/hooks/useNostrRevenueShare';

export default function Search() {
  const navigate = useNavigate();
  const { session } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCase, setSelectedCase] = useState<{ id: string; recordId: string; transcriptId?: string; title: string; revenueShare?: RevenueShareEvent } | null>(null);
  
  const { closedCases, isLoading: casesLoading } = useNostrClosedCases();
  const { paidProcessIds, isLoading: paymentsLoading } = useNostrUserPayments();
  
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
  
  const handleGetTranscript = (caseId: string, recordId: string, caseTitle: string) => {
    // Strip "own:" prefix for checking if already paid
    const lookupId = caseId.replace(/^own:/, '');
    const isPaid = paidProcessIds.has(lookupId);
    
    // If already paid, navigate directly to transcript
    if (isPaid) {
      navigate(`/own/transcript/${caseId}`);
      return;
    }
    
    // Otherwise, show payment dialog
    const revenueShareForCase = revenueShares[lookupId];
    
    setSelectedCase({ 
      id: caseId,
      recordId: recordId,
      transcriptId: revenueShareForCase?.transcriptEventId,
      title: caseTitle,
      revenueShare: revenueShareForCase
    });
  };
  
  const handlePaymentSuccess = () => {
    if (selectedCase) {
      navigate(`/own/transcript/${selectedCase.id}`);
    }
  };

  return (
    <div className="space-y-4 md:space-y-6 px-4 md:px-0">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg md:text-xl">Search Cases</CardTitle>
          <CardDescription className="text-sm">
            Browse closed OWN ▲ process cases and access transcripts
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="relative">
            <SearchIcon className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input 
              placeholder="Search by title or description..." 
              className="pl-10 text-base"
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
            const lookupId = ownCase.id.replace(/^own:/, '');
            const isPaid = paidProcessIds.has(lookupId);
            
            return (
              <Card key={ownCase.id} className="hover:shadow-md transition-shadow">
                <CardHeader className="pb-3">
                  <div className="flex flex-col gap-3">
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="secondary" className="text-xs">Closed</Badge>
                      {!paymentsLoading && isPaid && (
                        <Badge className="bg-green-500/10 text-green-700 hover:bg-green-500/20 text-xs">
                          Paid
                        </Badge>
                      )}
                      {ownCase.lang && (
                        <Badge variant="outline" className="text-xs uppercase">
                          {ownCase.lang}
                        </Badge>
                      )}
                    </div>
                    <div>
                      <CardTitle className="text-base md:text-lg leading-snug">
                        {ownCase.title || ownCase.topic || 'Untitled Case'}
                      </CardTitle>
                      <CardDescription className="line-clamp-2 text-sm mt-1">
                        {ownCase.initialContent}
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3 md:space-y-4">
                  <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-4 text-xs md:text-sm text-muted-foreground">
                    <div className="flex items-center gap-1.5">
                      <Calendar className="h-3.5 w-3.5 md:h-4 md:w-4" />
                      <span>Started: {format(new Date(ownCase.startedAt * 1000), 'dd/MM/yyyy')}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Calendar className="h-3.5 w-3.5 md:h-4 md:w-4" />
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

                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 pt-3 border-t">
                    <div className="flex gap-2 flex-wrap">
                      {lanAmount > 0 ? (
                        <>
                          <Badge className="bg-cyan-500/10 text-cyan-700 hover:bg-cyan-500/20 text-xs">
                            {Math.round(lanAmount)} LANA
                          </Badge>
                          {userCurrency === sourceCurrency ? (
                            <Badge className="bg-cyan-500/10 text-cyan-700 hover:bg-cyan-500/20 text-xs">
                              {formatCurrency(sourceFiatAmount, sourceCurrency)}
                            </Badge>
                          ) : (
                            <>
                              <Badge className="bg-cyan-500/10 text-cyan-700 hover:bg-cyan-500/20 text-xs">
                                {formatCurrency(userFiatAmount, userCurrency)}
                              </Badge>
                              <Badge variant="outline" className="text-xs">
                                ≈ {formatCurrency(sourceFiatAmount, sourceCurrency)}
                              </Badge>
                            </>
                          )}
                        </>
                      ) : (
                        <span className="text-xs md:text-sm text-muted-foreground">Pricing not available</span>
                      )}
                    </div>
                    {visibility === 'public' && lanAmount > 0 && (
                      <Button 
                        className="bg-cyan-600 hover:bg-cyan-700 w-full md:w-auto text-sm"
                        onClick={() => handleGetTranscript(ownCase.id, ownCase.recordId, ownCase.title || ownCase.topic || ownCase.initialContent)}
                        disabled={revenueLoading || paymentsLoading}
                      >
                        {paymentsLoading && (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        )}
                        {paymentsLoading ? 'Checking...' : isPaid ? 'View Transcript' : 'Get Transcript'}
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
            recordEventId={selectedCase.recordId}
            transcriptEventId={selectedCase.transcriptId}
            caseTitle={selectedCase.title}
            lanAmount={calculatePrices(selectedCase.id).lanAmount}
            fiatAmount={calculatePrices(selectedCase.id).userFiatAmount}
            fiatCurrency={calculatePrices(selectedCase.id).userCurrency}
            payerPubkey={session?.nostrHexId || ''}
            existingRevenueShare={selectedCase.revenueShare}
            onSuccess={handlePaymentSuccess}
          />
        )}
    </div>
  );
}
