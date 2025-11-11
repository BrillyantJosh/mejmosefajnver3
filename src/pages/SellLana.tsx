import { useNostrSellOffers } from "@/hooks/useNostrSellOffers";
import { useNostrProfile } from "@/hooks/useNostrProfile";
import { useSystemParameters } from "@/contexts/SystemParametersContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { ExternalLink } from "lucide-react";

export default function SellLana() {
  const { offers, isLoading } = useNostrSellOffers();
  const { profile } = useNostrProfile();
  const { parameters } = useSystemParameters();

  // Get currency from profile
  const userCurrency = profile?.currency || 'EUR';

  // Get exchange rate from system parameters
  const exchangeRate = parameters?.exchangeRates?.[userCurrency as keyof typeof parameters.exchangeRates] || 0;

  // Convert Lanoshis to LANA (1 LANA = 100,000,000 Lanoshis)
  const lanoshisToLana = (lanoshis: string) => {
    const lanoshisNum = parseFloat(lanoshis);
    return lanoshisNum / 100000000;
  };

  // Calculate FIAT value
  const calculateFiatValue = (lanoshis: string) => {
    const lanaAmount = lanoshisToLana(lanoshis);
    return lanaAmount * exchangeRate;
  };

  // Format date
  const formatDate = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleDateString('sl-SI', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  };

  // Truncate wallet address
  const truncateWallet = (wallet: string) => {
    if (wallet.length <= 12) return wallet;
    return `${wallet.slice(0, 8)}...${wallet.slice(-4)}`;
  };

  // Use all offers from hook (already filtered by hook to exclude confirmed ones)
  const activeOffers = offers;

  // Calculate statistics
  const totalLanaAmount = activeOffers.reduce((sum, offer) => sum + lanoshisToLana(offer.amount), 0);
  const totalFiatValue = activeOffers.reduce((sum, offer) => sum + calculateFiatValue(offer.amount), 0);
  const totalOffers = activeOffers.length;

  // Get currency symbol
  const getCurrencySymbol = (currency: string) => {
    switch (currency) {
      case 'EUR': return '€';
      case 'USD': return '$';
      case 'GBP': return '£';
      default: return currency;
    }
  };

  if (isLoading) {
    return (
      <div className="container max-w-6xl mx-auto py-8 px-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-3xl font-bold">My Offers</CardTitle>
            <CardDescription>Loading your sell offers...</CardDescription>
          </CardHeader>
          <CardContent className="py-12">
            <div className="flex flex-col items-center justify-center space-y-4">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
              <p className="text-muted-foreground">Searching for offers...</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container max-w-6xl mx-auto py-8 px-4 space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-3xl font-bold">My Offers</CardTitle>
              <CardDescription>Overview of your active sell offers</CardDescription>
            </div>
            <Button 
              variant="outline" 
              asChild
              className="gap-2"
            >
              <a href="https://www.selllana.com" target="_blank" rel="noopener noreferrer">
                Manage offers
                <ExternalLink className="h-4 w-4" />
              </a>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {activeOffers.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              No active offers found
            </div>
          ) : (
            <div className="rounded-md border overflow-x-auto -mx-6 px-6">
              <Table className="min-w-[600px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs md:text-sm">Wallet</TableHead>
                    <TableHead className="text-xs md:text-sm">Amount</TableHead>
                    <TableHead className="text-xs md:text-sm">Price</TableHead>
                    <TableHead className="text-xs md:text-sm">Total</TableHead>
                    <TableHead className="text-xs md:text-sm">Date</TableHead>
                    <TableHead className="text-xs md:text-sm">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {activeOffers.map((offer) => {
                    const lanaAmount = lanoshisToLana(offer.amount);
                    const fiatTotal = calculateFiatValue(offer.amount);
                    const fiatPrice = exchangeRate;

                    return (
                      <TableRow key={offer.id}>
                        <TableCell className="font-mono text-xs md:text-sm">
                          {truncateWallet(offer.wallet)}
                        </TableCell>
                        <TableCell className="font-medium text-xs md:text-sm whitespace-nowrap">
                          {lanaAmount.toLocaleString('en-US', { 
                            minimumFractionDigits: 0,
                            maximumFractionDigits: 0 
                          })} LANA
                        </TableCell>
                        <TableCell className="text-xs md:text-sm whitespace-nowrap">
                          {getCurrencySymbol(userCurrency)}
                          {fiatPrice.toFixed(4)}
                        </TableCell>
                        <TableCell className="font-medium text-xs md:text-sm whitespace-nowrap">
                          {getCurrencySymbol(userCurrency)}
                          {fiatTotal.toFixed(2)}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-xs md:text-sm whitespace-nowrap">
                          {formatDate(offer.createdAt)}
                        </TableCell>
                        <TableCell>
                          {offer.status === 'active' ? (
                            <Badge variant="default" className="bg-green-500 hover:bg-green-600 text-white">
                              active
                            </Badge>
                          ) : (
                            <a 
                              href="https://www.selllana.com" 
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="inline-block"
                            >
                              <Badge 
                                variant="default" 
                                className="bg-yellow-500 hover:bg-yellow-600 text-black cursor-pointer transition-colors"
                              >
                                pending to pay
                              </Badge>
                            </a>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Statistics Card */}
      {activeOffers.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-xl font-bold">Statistics</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Total LANA for Sale</p>
                <p className="text-2xl font-bold">
                  {totalLanaAmount.toLocaleString('en-US', { 
                    minimumFractionDigits: 0,
                    maximumFractionDigits: 0 
                  })} LANA
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Total Value</p>
                <p className="text-2xl font-bold">
                  {getCurrencySymbol(userCurrency)}
                  {totalFiatValue.toLocaleString('en-US', { 
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2 
                  })}
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Number of Offers</p>
                <p className="text-2xl font-bold">{totalOffers}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
