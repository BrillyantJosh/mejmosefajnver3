import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle, XCircle, Wallet, User, FileCheck, Shield, Star, Clock, AlertCircle, Info } from "lucide-react";
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
  <div className="flex items-start sm:items-center justify-between p-3 sm:p-4 rounded-lg bg-muted/50 gap-2">
    <div className="flex items-start sm:items-center gap-2 sm:gap-3 flex-1 min-w-0">
      <div className={`p-1.5 sm:p-2 rounded-full shrink-0 ${isOk ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'}`}>
        <div className="h-4 w-4 sm:h-5 sm:w-5 [&>svg]:h-full [&>svg]:w-full">
          {icon}
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-medium text-sm sm:text-base">{label}</p>
        {detail && <p className="text-[10px] sm:text-sm text-muted-foreground break-words">{detail}</p>}
      </div>
    </div>
    <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
      <span className="text-xs sm:text-sm font-medium">{value}</span>
      {isOk ? (
        <CheckCircle className="h-4 w-4 sm:h-5 sm:w-5 text-green-500" />
      ) : (
        <XCircle className="h-4 w-4 sm:h-5 sm:w-5 text-red-500" />
      )}
    </div>
  </div>
);

const formatLana = (balance: number): string => {
  // Balance is already in LANA units from the edge function
  return balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

  // In Quorum = Profile OK, Registry OK, Self Responsibility OK (all default true)
  const isInQuorum = true; // All defaults are OK

  // Can Resist = In Lana8Wonder AND has at least 3 real-life credentials
  const canResist = lana8WonderStatus.exists && credentialStatus.referenceCount >= 3;

  if (isLoading) {
    return (
      <div className="px-3 py-4 sm:p-4 space-y-4 sm:space-y-6">
        <h1 className="text-lg sm:text-2xl font-bold">My Status</h1>
        <Card>
          <CardHeader className="p-3 sm:p-4">
            <Skeleton className="h-5 sm:h-6 w-40 sm:w-48" />
          </CardHeader>
          <CardContent className="p-3 sm:p-4 pt-0 space-y-3 sm:space-y-4">
            {[...Array(6)].map((_, i) => (
              <Skeleton key={i} className="h-14 sm:h-16 w-full" />
            ))}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="px-3 py-4 sm:p-4 space-y-4 sm:space-y-6">
      <h1 className="text-lg sm:text-2xl font-bold">My Status</h1>
      
      {/* Overall Status Card */}
      <Card>
        <CardHeader className="p-3 sm:p-4">
          <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
            <Shield className="h-4 w-4 sm:h-5 sm:w-5" />
            Quorum Eligibility
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3 sm:p-4 pt-0 space-y-3 sm:space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
            <Badge 
              variant={isInQuorum ? "default" : "destructive"}
              className="text-sm sm:text-lg px-3 sm:px-4 py-1.5 sm:py-2 w-fit"
            >
              {isInQuorum ? "In Quorum" : "Not In Quorum"}
            </Badge>
            <p className="text-xs sm:text-sm text-muted-foreground">
              {isInQuorum 
                ? "All requirements are met. You can participate in alignment decisions." 
                : "Some requirements are not met. Complete them to join the quorum."}
            </p>
          </div>

          {/* Can Resist Status */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 p-3 sm:p-4 rounded-lg bg-muted/50">
            <div className="flex items-start sm:items-center gap-2 sm:gap-3 flex-1">
              <div className={`p-1.5 sm:p-2 rounded-full shrink-0 ${canResist ? 'bg-green-500/10 text-green-500' : 'bg-amber-500/10 text-amber-500'}`}>
                <Shield className="h-4 w-4 sm:h-5 sm:w-5" />
              </div>
              <div className="min-w-0">
                <p className="font-medium text-sm sm:text-base">Resist Capability</p>
                <p className="text-[10px] sm:text-sm text-muted-foreground">
                  {canResist 
                    ? "You can vote and resist proposals." 
                    : "You can vote, but cannot resist proposals. Register in Lana8Wonder and get at least 3 real-life credentials to unlock."}
                </p>
              </div>
            </div>
            <Badge variant={canResist ? "default" : "secondary"} className="w-fit text-[10px] sm:text-xs">
              {canResist ? "Allow" : "Not Yet"}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* Holdings Card */}
      <Card>
        <CardHeader className="p-3 sm:p-4">
          <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
            <Wallet className="h-4 w-4 sm:h-5 sm:w-5" />
            Holdings
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3 sm:p-4 pt-0 space-y-3 sm:space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between p-3 sm:p-4 rounded-lg bg-muted/50 gap-3 sm:gap-4">
            <div className="flex items-center gap-2 sm:gap-3">
              <div className={`p-1.5 sm:p-2 rounded-full shrink-0 ${wallets.length > 0 ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'}`}>
                <Wallet className="h-4 w-4 sm:h-5 sm:w-5" />
              </div>
              <div>
                <p className="font-medium text-sm sm:text-base">Registered Wallets</p>
                <p className="text-[10px] sm:text-sm text-muted-foreground">{wallets.length} wallet{wallets.length !== 1 ? 's' : ''} found</p>
              </div>
            </div>
            <div className="text-left sm:text-right pl-8 sm:pl-0">
              <p className="text-xl sm:text-2xl font-bold">{formatLana(totalBalance)} LANA</p>
              <p className="text-[10px] sm:text-sm text-muted-foreground">Total Balance</p>
            </div>
          </div>
          
          {wallets.length === 0 && (
            <div className="flex items-center gap-2 p-2.5 sm:p-3 rounded-lg bg-yellow-500/10 text-yellow-600">
              <AlertCircle className="h-3.5 w-3.5 sm:h-4 sm:w-4 shrink-0" />
              <span className="text-xs sm:text-sm">You need to register at least one wallet.</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Requirements Breakdown */}
      <Card>
        <CardHeader className="p-3 sm:p-4">
          <CardTitle className="text-base sm:text-lg">Requirements Breakdown</CardTitle>
        </CardHeader>
        <CardContent className="p-3 sm:p-4 pt-0 space-y-2 sm:space-y-3">
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
