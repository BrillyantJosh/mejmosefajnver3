import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useNostrOwnCases } from "@/hooks/useNostrOwnCases";
import { useNostrProfilesCacheBulk } from "@/hooks/useNostrProfilesCacheBulk";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { Users, Calendar, Globe } from "lucide-react";
import CreateCaseDialog from "@/components/own/CreateCaseDialog";

export default function MyCases() {
  const { cases, isLoading } = useNostrOwnCases();
  
  // Get all unique participant pubkeys
  const allParticipants = Array.from(
    new Set(cases.flatMap(c => c.participants))
  );
  
  const { profiles: participantProfiles, isLoading: profilesLoading } = useNostrProfilesCacheBulk(allParticipants);

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <Card key={i}>
            <CardHeader>
              <Skeleton className="h-6 w-3/4" />
              <Skeleton className="h-4 w-1/2 mt-2" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-4 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (cases.length === 0) {
    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-2xl font-bold">My Cases</h2>
            <p className="text-muted-foreground">View and manage your cases</p>
          </div>
          <CreateCaseDialog />
        </div>
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground mb-4">
              No cases found. Create your first case to get started.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4 md:space-y-6 px-4 md:px-0">
      <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-3">
        <div>
          <h2 className="text-xl md:text-2xl font-bold">My Cases</h2>
          <p className="text-sm text-muted-foreground">{cases.length} active case{cases.length !== 1 ? 's' : ''}</p>
        </div>
        <CreateCaseDialog />
      </div>
      <div className="space-y-3 md:space-y-4">
      {cases.map((ownCase) => {
        const caseParticipants = ownCase.participants
          .map(pubkey => {
            const profile = participantProfiles.get(pubkey);
            return {
              pubkey,
              name: profile?.display_name || profile?.full_name || pubkey.slice(0, 8),
              picture: profile?.picture,
            };
          });

        return (
          <Card key={ownCase.id} className="hover:shadow-md transition-shadow">
            <CardHeader className="pb-3">
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap gap-2">
                  <Badge variant={ownCase.userRole === 'initiated' ? 'default' : 'secondary'} className="text-xs">
                    {ownCase.userRole === 'initiated' ? 'Initiated' : 'Participant'}
                  </Badge>
                  <Badge variant={ownCase.status === 'opened' ? 'default' : 'outline'} className="text-xs">
                    {ownCase.status}
                  </Badge>
                </div>
                <div>
                  <CardTitle className="text-base md:text-lg leading-snug">{ownCase.content}</CardTitle>
                  {ownCase.topic && (
                    <CardDescription className="mt-1 text-sm">
                      {ownCase.topic}
                    </CardDescription>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3 md:space-y-4">
              {/* Participants */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <Users className="h-3.5 w-3.5 md:h-4 md:w-4 text-muted-foreground" />
                  <span className="text-xs md:text-sm text-muted-foreground">Participants:</span>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {caseParticipants.map((participant) => (
                    <div key={participant.pubkey} className="flex items-center gap-1.5">
                      <UserAvatar pubkey={participant.pubkey} picture={participant.picture} name={participant.name} className="h-5 w-5 md:h-6 md:w-6" />
                      <span className="text-xs md:text-sm">{participant.name}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Metadata */}
              <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-4 text-xs md:text-sm text-muted-foreground">
                <div className="flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5 md:h-4 md:w-4" />
                  {new Date(ownCase.createdAt * 1000).toLocaleDateString()}
                </div>
                <div className="flex items-center gap-1.5">
                  <Globe className="h-3.5 w-3.5 md:h-4 md:w-4" />
                  {ownCase.lang.toUpperCase()}
                </div>
              </div>

              {/* Optional fields */}
              {ownCase.lanacoinTxid && (
                <div className="text-sm">
                  <span className="text-muted-foreground">Transaction: </span>
                  <a
                    href={`https://chainz.cryptoid.info/lana/tx.dws?${ownCase.lanacoinTxid}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                  >
                    {ownCase.lanacoinTxid.slice(0, 16)}...
                  </a>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
      </div>
    </div>
  );
}
