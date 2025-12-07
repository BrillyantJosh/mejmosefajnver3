import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle, XCircle, Wallet, User, FileCheck, Shield, Star, Clock, AlertCircle } from "lucide-react";
import { useNostrWallets } from "@/hooks/useNostrWallets";
import { useWalletBalances } from "@/hooks/useWalletBalances";
import { useNostrRealLifeCredential } from "@/hooks/useNostrRealLifeCredential";
import { useNostrLana8Wonder } from "@/hooks/useNostrLana8Wonder";
import { useAuth } from "@/contexts/AuthContext";
import { useMemo, useEffect } from "react";

interface StatusItemProps {
  label: string;
  value: string;
  icon: React.ReactNode;
  isOk: boolean;
  detail?: string;
}

const StatusItem = ({ label, value, icon, isOk, detail }: StatusItemProps) => (
  <div className="flex items-center justify-between p-4 rounded-lg bg-muted/50">
    <div className="flex items-center gap-3">
      <div className={`p-2 rounded-full ${isOk ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'}`}>
        {icon}
      </div>
      <div>
        <p className="font-medium">{label}</p>
        {detail && <p className="text-sm text-muted-foreground">{detail}</p>}
      </div>
    </div>
    <div className="flex items-center gap-2">
      <span className="text-sm font-medium">{value}</span>
      {isOk ? (
        <CheckCircle className="h-5 w-5 text-green-500" />
      ) : (
        <XCircle className="h-5 w-5 text-red-500" />
      )}
    </div>
  </div>
);

const formatLana = (balance: number): string => {
  // Balance is already in LANA units from the edge function
  return balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

export default function MyStatus() {
  const { updateQuorumStatus } = useAuth();
  
  // Fetch wallets (KIND 30889)
  const { wallets, isLoading: walletsLoading } = useNostrWallets();
  
  // Get wallet addresses for balance fetch
  const walletAddresses = useMemo(() => wallets.map(w => w.walletId), [wallets]);
  
  // Fetch balances
  const { totalBalance, isLoading: balancesLoading } = useWalletBalances(walletAddresses);
  
  // Fetch credentials (KIND 87033 with real_life)
  const { status: credentialStatus, isLoading: credentialsLoading } = useNostrRealLifeCredential();
  
  // Fetch Lana8Wonder status (KIND 88888)
  const { status: lana8WonderStatus, isLoading: lana8WonderLoading } = useNostrLana8Wonder();

  const isLoading = walletsLoading || balancesLoading || credentialsLoading || lana8WonderLoading;

  // In Quorum = Profile OK, Registry OK, Self Responsibility OK (all default true)
  const isInQuorum = true; // All defaults are OK

  // Can Resist = In Lana8Wonder AND has at least 3 real-life credentials
  const canResist = lana8WonderStatus.exists && credentialStatus.referenceCount >= 3;

  // Save quorum status to session when data loads
  useEffect(() => {
    if (!isLoading) {
      updateQuorumStatus(isInQuorum, canResist);
    }
  }, [isLoading, isInQuorum, canResist, updateQuorumStatus]);

  if (isLoading) {
    return (
      <div className="container mx-auto p-4 space-y-6">
        <h1 className="text-2xl font-bold">My Status</h1>
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-48" />
          </CardHeader>
          <CardContent className="space-y-4">
            {[...Array(6)].map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 space-y-6">
      <h1 className="text-2xl font-bold">My Status</h1>
      
      {/* Overall Status Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Quorum Eligibility
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <Badge 
              variant={isInQuorum ? "default" : "destructive"}
              className="text-lg px-4 py-2"
            >
              {isInQuorum ? "In Quorum" : "Not In Quorum"}
            </Badge>
            <p className="text-muted-foreground">
              {isInQuorum 
                ? "All requirements are met. You can participate in alignment decisions." 
                : "Some requirements are not met. Complete them to join the quorum."}
            </p>
          </div>

          {/* Can Resist Status */}
          <div className="flex items-center gap-4 p-4 rounded-lg bg-muted/50">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-full ${canResist ? 'bg-green-500/10 text-green-500' : 'bg-amber-500/10 text-amber-500'}`}>
                <Shield className="h-5 w-5" />
              </div>
              <div>
                <p className="font-medium">Resist Capability</p>
                <p className="text-sm text-muted-foreground">
                  {canResist 
                    ? "You can vote and resist proposals." 
                    : "You can vote, but cannot resist proposals. Register in Lana8Wonder and get at least 3 real-life credentials to unlock."}
                </p>
              </div>
            </div>
            <Badge variant={canResist ? "default" : "secondary"} className="ml-auto">
              {canResist ? "Allow" : "Not Yet"}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* Holdings Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5" />
            Holdings
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between p-4 rounded-lg bg-muted/50">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-full ${wallets.length > 0 ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'}`}>
                <Wallet className="h-5 w-5" />
              </div>
              <div>
                <p className="font-medium">Registered Wallets</p>
                <p className="text-sm text-muted-foreground">{wallets.length} wallet{wallets.length !== 1 ? 's' : ''} found</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold">{formatLana(totalBalance)} LANA</p>
              <p className="text-sm text-muted-foreground">Total Balance</p>
            </div>
          </div>
          
          {wallets.length === 0 && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-yellow-500/10 text-yellow-600">
              <AlertCircle className="h-4 w-4" />
              <span className="text-sm">You need to register at least one wallet.</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Requirements Breakdown */}
      <Card>
        <CardHeader>
          <CardTitle>Requirements Breakdown</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <StatusItem
            label="Profile"
            value="OK"
            icon={<User className="h-5 w-5" />}
            isOk={true}
            detail="Verified at login (KIND 0)"
          />
          
          <StatusItem
            label="Registry"
            value="OK"
            icon={<FileCheck className="h-5 w-5" />}
            isOk={true}
            detail="Default: registered"
          />
          
          <StatusItem
            label="Self Responsibility"
            value="OK"
            icon={<Shield className="h-5 w-5" />}
            isOk={true}
            detail="Default: accepted"
          />
          
          <StatusItem
            label="Credentials"
            value={credentialStatus.hasRealLifeReference ? `${credentialStatus.referenceCount}` : "0"}
            icon={<CheckCircle className="h-5 w-5" />}
            isOk={credentialStatus.referenceCount >= 3}
            detail={
              credentialStatus.referenceCount >= 3 
                ? `${credentialStatus.referenceCount} real-life references (KIND 87033) - meets requirement`
                : `Need at least 3 real-life references for resist capability (have ${credentialStatus.referenceCount})`
            }
          />
          
          <StatusItem
            label="Lana8Wonder"
            value={lana8WonderStatus.exists ? "OK" : "Missing"}
            icon={<Star className="h-5 w-5" />}
            isOk={lana8WonderStatus.exists}
            detail={
              lana8WonderStatus.exists 
                ? `Plan registered (KIND 88888)`
                : "No Lana8Wonder plan found - required for resist capability"
            }
          />
          
          <StatusItem
            label="Last Activity"
            value="Now"
            icon={<Clock className="h-5 w-5" />}
            isOk={true}
            detail="Currently active"
          />
        </CardContent>
      </Card>
    </div>
  );
}
