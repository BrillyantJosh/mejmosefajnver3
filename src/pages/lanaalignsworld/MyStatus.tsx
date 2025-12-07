import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle, XCircle, Wallet, User, FileCheck, Shield, Star, Clock, AlertCircle } from "lucide-react";
import { useNostrWallets } from "@/hooks/useNostrWallets";
import { useWalletBalances } from "@/hooks/useWalletBalances";
import { useNostrRealLifeCredential } from "@/hooks/useNostrRealLifeCredential";
import { useNostrLana8Wonder } from "@/hooks/useNostrLana8Wonder";
import { useMemo } from "react";

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

const formatLana = (lanoshis: number): string => {
  const lana = lanoshis / 100000000;
  return lana.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

export default function MyStatus() {
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

  // Calculate overall status
  const allRequirementsMet = useMemo(() => {
    return (
      wallets.length > 0 &&
      totalBalance > 0 &&
      credentialStatus.hasRealLifeReference &&
      lana8WonderStatus.exists
    );
  }, [wallets, totalBalance, credentialStatus, lana8WonderStatus]);

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
        <CardContent>
          <div className="flex items-center gap-4">
            <Badge 
              variant={allRequirementsMet ? "default" : "destructive"}
              className="text-lg px-4 py-2"
            >
              {allRequirementsMet ? "In Quorum" : "Not In Quorum"}
            </Badge>
            {allRequirementsMet ? (
              <p className="text-muted-foreground">All requirements are met. You can participate in alignment decisions.</p>
            ) : (
              <p className="text-muted-foreground">Some requirements are not met. Complete them to join the quorum.</p>
            )}
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
              <span className="text-sm">You need to register at least one wallet to join the quorum.</span>
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
            value={credentialStatus.hasRealLifeReference ? "OK" : "Missing"}
            icon={<CheckCircle className="h-5 w-5" />}
            isOk={credentialStatus.hasRealLifeReference}
            detail={
              credentialStatus.hasRealLifeReference 
                ? `${credentialStatus.referenceCount} real-life reference${credentialStatus.referenceCount !== 1 ? 's' : ''} (KIND 87033)`
                : "Need at least 1 real-life reference"
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
                : "No Lana8Wonder plan found"
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
