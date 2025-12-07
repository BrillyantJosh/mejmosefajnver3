import { User, CheckCircle, XCircle, Loader2, Shield, Wallet, MapPin, Clock, UserCheck, FileCheck, Zap } from "lucide-react";
import { useNostrQuorumStatus } from "@/hooks/useNostrQuorumStatus";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface StatusItemProps {
  label: string;
  value: 'ok' | 'missing' | 'allow' | 'not_yet' | 'unresolved' | string | undefined;
  icon: React.ReactNode;
  successValues?: string[];
}

const StatusItem = ({ label, value, icon, successValues = ['ok', 'allow'] }: StatusItemProps) => {
  const isSuccess = value && successValues.includes(value);
  
  return (
    <div className="flex items-center justify-between py-3 border-b border-border/50 last:border-0">
      <div className="flex items-center gap-3">
        <div className="text-muted-foreground">{icon}</div>
        <span className="text-sm font-medium">{label}</span>
      </div>
      <div className="flex items-center gap-2">
        {value ? (
          <>
            {isSuccess ? (
              <CheckCircle className="h-4 w-4 text-green-500" />
            ) : (
              <XCircle className="h-4 w-4 text-destructive" />
            )}
            <span className={`text-sm ${isSuccess ? 'text-green-500' : 'text-destructive'}`}>
              {value}
            </span>
          </>
        ) : (
          <span className="text-sm text-muted-foreground">N/A</span>
        )}
      </div>
    </div>
  );
};

export default function MyStatus() {
  const { quorumStatus, isLoading } = useNostrQuorumStatus();

  const formatTimestamp = (timestamp: number | undefined) => {
    if (!timestamp) return 'N/A';
    return new Date(timestamp * 1000).toLocaleString();
  };

  const formatHoldings = (holdings: string | undefined) => {
    if (!holdings) return 'N/A';
    const lanoshis = parseInt(holdings, 10);
    const lana = lanoshis / 100000000;
    return `${lana.toLocaleString()} LANA`;
  };

  if (isLoading) {
    return (
      <div className="p-4">
        <div className="flex items-center gap-2 mb-6">
          <User className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
          <h1 className="text-lg sm:text-2xl font-bold">My Status</h1>
        </div>
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </div>
    );
  }

  if (!quorumStatus) {
    return (
      <div className="p-4">
        <div className="flex items-center gap-2 mb-6">
          <User className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
          <h1 className="text-lg sm:text-2xl font-bold">My Status</h1>
        </div>
        <Card>
          <CardContent className="py-12">
            <div className="text-center text-muted-foreground">
              <XCircle className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
              <p className="text-lg font-medium">No Quorum Status Found</p>
              <p className="text-sm mt-2">Your quorum status has not been evaluated yet.</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4">
      <div className="flex items-center gap-2 mb-6">
        <User className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
        <h1 className="text-lg sm:text-2xl font-bold">My Status</h1>
      </div>

      {/* Main Status Card */}
      <Card className="mb-4">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base sm:text-lg">Quorum Status</CardTitle>
            <Badge 
              variant={quorumStatus.status === 'in-quorum' ? 'default' : 'destructive'}
              className="text-xs"
            >
              {quorumStatus.status === 'in-quorum' ? 'In Quorum' : 'Not In Quorum'}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Scope</span>
              <p className="font-medium">{quorumStatus.scope}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Can Resist</span>
              <p className={`font-medium ${quorumStatus.canResist === 'allow' ? 'text-green-500' : 'text-amber-500'}`}>
                {quorumStatus.canResist === 'allow' ? 'Yes' : 'Not Yet'}
              </p>
            </div>
            <div>
              <span className="text-muted-foreground">Last Updated</span>
              <p className="font-medium text-xs">{formatTimestamp(quorumStatus.updatedAt)}</p>
            </div>
            {quorumStatus.location && (
              <div>
                <span className="text-muted-foreground">Location</span>
                <p className="font-medium">{quorumStatus.location}</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Holdings Card */}
      {(quorumStatus.wallet || quorumStatus.holdings) && (
        <Card className="mb-4">
          <CardHeader className="pb-3">
            <CardTitle className="text-base sm:text-lg flex items-center gap-2">
              <Wallet className="h-4 w-4" />
              Holdings
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 text-sm">
              {quorumStatus.wallet && (
                <div>
                  <span className="text-muted-foreground">Wallet ID</span>
                  <p className="font-mono text-xs break-all">{quorumStatus.wallet}</p>
                </div>
              )}
              {quorumStatus.holdings && (
                <div>
                  <span className="text-muted-foreground">Total Holdings</span>
                  <p className="font-bold text-lg text-primary">{formatHoldings(quorumStatus.holdings)}</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Requirements Breakdown */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base sm:text-lg flex items-center gap-2">
            <Shield className="h-4 w-4" />
            Requirements Breakdown
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <StatusItem 
            label="Profile (KIND 0)" 
            value={quorumStatus.profile} 
            icon={<UserCheck className="h-4 w-4" />}
          />
          <StatusItem 
            label="Registry" 
            value={quorumStatus.registry} 
            icon={<FileCheck className="h-4 w-4" />}
          />
          <StatusItem 
            label="Self Responsibility" 
            value={quorumStatus.selfResp} 
            icon={<Shield className="h-4 w-4" />}
            successValues={['ok']}
          />
          <StatusItem 
            label="Credentials" 
            value={quorumStatus.credentials} 
            icon={<FileCheck className="h-4 w-4" />}
          />
          <StatusItem 
            label="Lana8Wonder" 
            value={quorumStatus.lana8wonder} 
            icon={<Zap className="h-4 w-4" />}
          />
          {quorumStatus.location && (
            <StatusItem 
              label="Location" 
              value={quorumStatus.location} 
              icon={<MapPin className="h-4 w-4" />}
              successValues={[quorumStatus.location]}
            />
          )}
          {quorumStatus.activity && (
            <div className="flex items-center justify-between py-3 border-b border-border/50 last:border-0">
              <div className="flex items-center gap-3">
                <div className="text-muted-foreground"><Clock className="h-4 w-4" /></div>
                <span className="text-sm font-medium">Last Activity</span>
              </div>
              <span className="text-sm text-muted-foreground">
                {formatTimestamp(quorumStatus.activity)}
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* TTL Info */}
      {quorumStatus.ttl && (
        <p className="text-xs text-muted-foreground mt-4 text-center">
          Status expires: {formatTimestamp(quorumStatus.ttl)}
        </p>
      )}
    </div>
  );
}
