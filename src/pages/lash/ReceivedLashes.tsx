import { useNostrReceivedLashes } from "@/hooks/useNostrReceivedLashes";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { Badge } from "@/components/ui/badge";
import { Heart } from "lucide-react";

const formatLanoshis = (amount: string) => {
  return parseInt(amount).toLocaleString();
};

const formatDate = (timestamp: number) => {
  return new Date(timestamp * 1000).toLocaleString();
};

const truncateNpub = (pubkey: string) => {
  if (!pubkey) return "";
  return `${pubkey.slice(0, 8)}...${pubkey.slice(-4)}`;
};

const truncateContent = (content: string, maxLength: number = 100) => {
  if (content.length <= maxLength) return content;
  return content.slice(0, maxLength) + "...";
};

export default function ReceivedLashes() {
  const { receivedLashes, loading } = useNostrReceivedLashes();

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (receivedLashes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Heart className="h-16 w-16 text-muted-foreground mb-4" />
        <h3 className="text-xl font-semibold mb-2">No Received LASHes</h3>
        <p className="text-muted-foreground">
          You haven't received any LASH payments yet.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Received Lashes List */}
      <div className="space-y-3">
        {receivedLashes.map((lash) => (
          <Card key={lash.lashId} className="p-4">
            <div className="space-y-3">
              {/* Sender Info */}
              <div className="flex items-start gap-3">
                <UserAvatar pubkey={lash.senderPubkey} picture={lash.senderPicture} name={lash.senderDisplayName || lash.senderName} className="h-10 w-10 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold truncate">
                      {lash.senderDisplayName ||
                        lash.senderName ||
                        truncateNpub(lash.senderPubkey)}
                    </span>
                    {lash.senderName && (
                      <span className="text-sm text-muted-foreground">
                        @{lash.senderName}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {formatDate(lash.createdAt)}
                  </div>
                </div>
                <Badge
                  variant={lash.isPaid ? "default" : "secondary"}
                  className={
                    lash.isPaid
                      ? "bg-green-600 hover:bg-green-700"
                      : "bg-yellow-600 hover:bg-yellow-700"
                  }
                >
                  {lash.isPaid ? "Paid" : "Pending"}
                </Badge>
              </div>

              {/* Amount */}
              <div className="pl-13">
                <div className="font-bold text-lg text-primary">
                  {(parseInt(lash.amount) / 100000000).toFixed(8)} LANA
                </div>
                <div className="text-xs text-muted-foreground">
                  {formatLanoshis(lash.amount)} lanoshis
                </div>
              </div>

              {/* Memo */}
              {lash.memo && (
                <div className="pl-13 text-sm text-muted-foreground italic border-l-2 border-muted pl-3">
                  "{lash.memo}"
                </div>
              )}

              {/* Referenced Post */}
              {lash.postContent && (
                <div className="pl-13 mt-2 p-3 bg-muted/50 rounded-lg text-sm">
                  <div className="text-xs text-muted-foreground mb-1">
                    For post:
                  </div>
                  <div>{truncateContent(lash.postContent)}</div>
                </div>
              )}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
