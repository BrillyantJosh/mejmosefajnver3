import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Search as SearchIcon, Calendar, Users } from "lucide-react";
import { useNostrClosedCases } from '@/hooks/useNostrClosedCases';
import { useNostrProfilesCacheBulk } from '@/hooks/useNostrProfilesCacheBulk';
import { useNostrRevenueSharesBatch } from '@/hooks/useNostrRevenueSharesBatch';
import { useNostrDonationProposal } from '@/hooks/useNostrDonationProposal';
import { useAuth } from '@/contexts/AuthContext';
import { DonationProposalDialog } from '@/components/own/DonationProposalDialog';
import { fiatToLana, formatCurrency, formatLana, getUserCurrency } from '@/lib/currencyConversion';
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
  
  // Get all case IDs for revenue share fetching
  const processRecordIds = useMemo(() => 
    closedCases.map(c => c.id), 
    [closedCases]
  );
  
  const { revenueShares, isLoading: revenueLoading } = useNostrRevenueSharesBatch(processRecordIds);
  
  // Filter cases based on search query
  const filteredCases = useMemo(() => {
    if (!searchQuery.trim()) return closedCases;
    
    const query = searchQuery.toLowerCase();
    return closedCases.filter(c => 
      c.content.toLowerCase().includes(query) ||
      c.topic?.toLowerCase().includes(query)
    );
  }, [closedCases, searchQuery]);
  
  const calculatePrices = (processRecordId: string) => {
    const revenueShare = revenueShares[processRecordId];
    
    if (!revenueShare?.data?.donation_amount) {
      return { lanAmount: 0, fiatAmount: 0, currency: 'EUR' };
    }

    const fiatAmount = revenueShare.data.donation_amount;
    const currency = revenueShare.data.currency || 'EUR';
    const userCurrency = getUserCurrency();
    
    // Convert fiat to LAN
    const lanAmount = fiatToLana(fiatAmount, currency);
    
    return { lanAmount, fiatAmount, currency };
  };
  
  const handleGetTranscript = (caseId: string, caseTitle: string) => {
    // Check if user already has payment proposal
    // This will be handled by the dialog component
    setSelectedCase({ id: caseId, title: caseTitle });
  };
  
  const handlePaymentSuccess = () => {
    if (selectedCase) {
      navigate(`/environment/transcription/${selectedCase.id}`);
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
            const { lanAmount, fiatAmount, currency } = calculatePrices(ownCase.id);
            const facilitator = profiles[ownCase.pubkey];
            
            return (
              <Card key={ownCase.id} className="hover:shadow-md transition-shadow">
                <CardHeader>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <CardTitle className="text-lg">{ownCase.topic || 'Untitled Case'}</CardTitle>
                        <Badge variant="secondary">zaprto</Badge>
                      </div>
                      <CardDescription className="line-clamp-2">
                        {ownCase.content}
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    <div className="flex items-center gap-2">
                      <Calendar className="h-4 w-4" />
                      <span>{format(new Date(ownCase.createdAt * 1000), 'dd/MM/yyyy')}</span>
                    </div>
                  </div>

                  {facilitator && (
                    <div className="text-sm">
                      <span className="text-muted-foreground">Facilitator</span>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge variant="outline" className="font-normal">
                          {facilitator.display_name || facilitator.full_name || `${ownCase.pubkey.slice(0, 8)}...`}
                        </Badge>
                      </div>
                    </div>
                  )}

                  {ownCase.participants.length > 0 && (
                    <div className="text-sm">
                      <div className="flex items-center gap-2 text-muted-foreground mb-2">
                        <Users className="h-4 w-4" />
                        <span>Udeleženci ({ownCase.participants.length})</span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {ownCase.participants.slice(0, 5).map((pubkey) => (
                          <Badge key={pubkey} variant="secondary" className="text-xs">
                            {pubkey.slice(0, 2)} {pubkey.slice(2, 8)}...
                          </Badge>
                        ))}
                        {ownCase.participants.length > 5 && (
                          <Badge variant="secondary" className="text-xs">
                            +{ownCase.participants.length - 5} more
                          </Badge>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="flex items-center justify-between pt-4 border-t">
                    <div className="flex gap-3">
                      {lanAmount > 0 && (
                        <>
                          <Badge className="bg-cyan-500/10 text-cyan-700 hover:bg-cyan-500/20">
                            {Math.round(lanAmount)} Lanas
                          </Badge>
                          <Badge className="bg-cyan-500/10 text-cyan-700 hover:bg-cyan-500/20">
                            {formatCurrency(fiatAmount, currency)}
                          </Badge>
                        </>
                      )}
                    </div>
                    <Button 
                      className="bg-cyan-600 hover:bg-cyan-700"
                      onClick={() => handleGetTranscript(ownCase.id, ownCase.topic || ownCase.content)}
                      disabled={revenueLoading || lanAmount === 0}
                    >
                      Pridobi
                    </Button>
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
          fiatAmount={calculatePrices(selectedCase.id).fiatAmount}
          fiatCurrency={calculatePrices(selectedCase.id).currency}
          onSuccess={handlePaymentSuccess}
        />
      )}
    </div>
  );
}
