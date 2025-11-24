import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useNostrReceivedDonations } from "@/hooks/useNostrReceivedDonations";
import { useNostrProjects } from "@/hooks/useNostrProjects";
import { useNostrProfileCache } from "@/hooks/useNostrProfileCache";
import { Skeleton } from "@/components/ui/skeleton";
import { ExternalLink } from "lucide-react";
import { format } from "date-fns";

const MyDonations = () => {
  const { donations, isLoading } = useNostrReceivedDonations();
  const { projects } = useNostrProjects();

  // Calculate summary stats
  const totalReceived = donations.reduce((sum, d) => sum + parseFloat(d.amountFiat || '0'), 0);
  const totalDonations = donations.length;
  const supportedProjects = new Set(donations.map(d => d.projectDTag)).size;

  // Get project title for a donation
  const getProjectTitle = (projectDTag: string) => {
    const project = projects.find(p => p.id === projectDTag);
    return project?.title || 'Unknown Project';
  };

  // Get currency for a donation (use first donation's currency as default)
  const currency = donations[0]?.currency || 'EUR';

  if (isLoading) {
    return (
      <div className="container mx-auto p-6 space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Received Donations</h1>
          <p className="text-muted-foreground mt-2">
            Donations received for your projects
          </p>
        </div>
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Received Donations</h1>
        <p className="text-muted-foreground mt-2">
          Donations received for your projects
        </p>
      </div>

      {/* Summary Section */}
      <Card>
        <CardHeader>
          <CardTitle>Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <p className="text-sm text-muted-foreground mb-1">Total Received</p>
              <p className="text-3xl font-bold">{totalReceived.toFixed(2)} {currency}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground mb-1">Total Donations</p>
              <p className="text-3xl font-bold">{totalDonations}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground mb-1">Supported Projects</p>
              <p className="text-3xl font-bold">{supportedProjects}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Donations List */}
      {donations.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">No donations received yet.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {donations.map((donation) => (
            <DonationCard
              key={donation.id}
              donation={donation}
              projectTitle={getProjectTitle(donation.projectDTag)}
            />
          ))}
        </div>
      )}
    </div>
  );
};

interface DonationCardProps {
  donation: any;
  projectTitle: string;
}

const DonationCard = ({ donation, projectTitle }: DonationCardProps) => {
  const { profile } = useNostrProfileCache(donation.supporterPubkey);
  const amountLana = (parseFloat(donation.amountLanoshis) / 100000000).toFixed(2);

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <h3 className="font-semibold text-lg text-green-600">{projectTitle}</h3>
              <Badge variant="secondary">{donation.currency}</Badge>
            </div>
            
            <p className="text-sm text-muted-foreground mb-2">
              From: {profile?.display_name || profile?.full_name || donation.supporterPubkey.slice(0, 16) + '...'}
            </p>
            
            {donation.content && (
              <p className="text-sm italic mb-3">"{donation.content}"</p>
            )}
            
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <span>{format(new Date(donation.timestampPaid * 1000), 'dd/MM/yyyy')}</span>
              <a
                href={`https://explorer.lanacoin.com/tx/${donation.txId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-primary hover:underline"
              >
                View TX <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </div>
          
          <div className="text-right">
            <p className="text-2xl font-bold text-green-600">
              {parseFloat(donation.amountFiat).toFixed(2)} {donation.currency}
            </p>
            <p className="text-sm text-muted-foreground">{amountLana} LANA</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default MyDonations;
