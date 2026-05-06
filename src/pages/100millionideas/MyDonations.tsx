import { useEffect, useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useNostrReceivedDonations } from "@/hooks/useNostrReceivedDonations";
import { useNostrProfileCache } from "@/hooks/useNostrProfileCache";
import { Skeleton } from "@/components/ui/skeleton";
import { ExternalLink } from "lucide-react";
import { format } from "date-fns";

const MyDonations = () => {
  const { donations, isLoading } = useNostrReceivedDonations();

  // Build project-id → title map from server SQLite (server-first architecture).
  // Fetches all projects with high limit so titles can be looked up locally.
  const [projectTitleMap, setProjectTitleMap] = useState<Record<string, string>>({});
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/lanacrowd/projects?filter=all&limit=500');
        if (!res.ok) return;
        const json = await res.json();
        if (cancelled) return;
        const map: Record<string, string> = {};
        for (const p of json.projects || []) {
          if (p.id && p.title) map[p.id] = p.title;
        }
        setProjectTitleMap(map);
      } catch (err) {
        console.warn('Failed to load project title map:', err);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Calculate summary stats
  const totalReceived = donations.reduce((sum, d) => sum + parseFloat(d.amountFiat || '0'), 0);
  const totalDonations = donations.length;
  const supportedProjects = useMemo(() => new Set(donations.map(d => d.projectDTag)).size, [donations]);

  // Get project title for a donation (falls back to truncated d-tag if not found)
  const getProjectTitle = (projectDTag: string) => {
    if (projectTitleMap[projectDTag]) return projectTitleMap[projectDTag];
    // Friendlier fallback than "Unknown Project"
    return projectDTag.startsWith('project:')
      ? `Project ${projectDTag.slice(8, 16)}…`
      : projectDTag.slice(0, 24);
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
                href={`https://chainz.cryptoid.info/lana/tx.dws?${donation.txId}`}
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
