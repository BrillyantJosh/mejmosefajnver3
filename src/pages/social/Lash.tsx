import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Heart, CheckCircle, Clock, FileText } from "lucide-react";
import { useNostrReceivedLashes } from "@/hooks/useNostrReceivedLashes";
import { format } from "date-fns";
import { getProxiedImageUrl } from "@/lib/imageProxy";

const formatLanoshis = (amount: string) => {
  return parseInt(amount).toLocaleString('en-US');
};

const formatDate = (timestamp: number) => {
  return format(timestamp * 1000, 'MMM dd, yyyy HH:mm');
};

const truncateNpub = (pubkey: string) => {
  return `npub1${pubkey.slice(0, 8)}...${pubkey.slice(-8)}`;
};

const truncateContent = (content: string, maxLength: number = 100) => {
  if (content.length <= maxLength) return content;
  return content.slice(0, maxLength) + '...';
};

export default function Lash() {
  const { receivedLashes, loading } = useNostrReceivedLashes();

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-6">
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <Heart className="h-6 w-6 text-primary" />
          Received LASHes
        </h2>
        <p className="text-muted-foreground">LANA payments you've received from others</p>
      </div>

      <div className="space-y-4">
        {loading ? (
          // Loading skeletons
          Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-6">
                <div className="flex items-start gap-4">
                  <Skeleton className="h-12 w-12 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3 w-48" />
                  </div>
                  <Skeleton className="h-6 w-24" />
                </div>
              </CardContent>
            </Card>
          ))
        ) : receivedLashes.length === 0 ? (
          // Empty state
          <Card>
            <CardContent className="p-12 text-center">
              <Heart className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
              <p className="text-lg font-semibold text-muted-foreground">No LASHes received yet</p>
              <p className="text-sm text-muted-foreground mt-2">
                Share your content and receive LANA tips from the community!
              </p>
            </CardContent>
          </Card>
        ) : (
          // Received LASHes list
          receivedLashes.map((lash) => (
            <Card key={lash.lashId} className="hover:shadow-md transition-shadow">
              <CardContent className="p-6">
                <div className="flex items-start gap-4">
                  {/* Sender Avatar */}
                  <Avatar className="h-12 w-12">
                    <AvatarImage src={getProxiedImageUrl(lash.senderPicture, Date.now())} />
                    <AvatarFallback>
                      {lash.senderName?.[0]?.toUpperCase() || lash.senderDisplayName?.[0]?.toUpperCase() || '?'}
                    </AvatarFallback>
                  </Avatar>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    {/* Sender Info */}
                    <div className="flex items-center gap-2 mb-1">
                      <p className="font-semibold truncate">
                        {lash.senderDisplayName || lash.senderName || truncateNpub(lash.senderPubkey)}
                      </p>
                      <Badge variant={lash.isPaid ? "default" : "secondary"} className="shrink-0">
                        {lash.isPaid ? (
                          <><CheckCircle className="h-3 w-3 mr-1" /> Paid</>
                        ) : (
                          <><Clock className="h-3 w-3 mr-1" /> Pending</>
                        )}
                      </Badge>
                    </div>

                    {/* Date */}
                    <p className="text-xs text-muted-foreground mb-3">
                      {formatDate(lash.createdAt)}
                    </p>

                    {/* Amount */}
                    <div className="mb-3">
                      <p className="text-2xl font-bold text-primary">
                        {lash.amountLana} LANA
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatLanoshis(lash.amount)} lanoshis
                      </p>
                    </div>

                    {/* Memo */}
                    {lash.memo && (
                      <div className="mb-3 p-3 bg-secondary/50 rounded-lg">
                        <p className="text-sm italic">"{lash.memo}"</p>
                      </div>
                    )}

                    {/* Referenced Post */}
                    {lash.postContent && (
                      <div className="mt-3 p-3 border rounded-lg bg-background/50">
                        <div className="flex items-start gap-2 mb-2">
                          <FileText className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                          <p className="text-xs font-semibold text-muted-foreground">
                            Referenced post:
                          </p>
                        </div>
                        <p className="text-sm text-foreground/80 pl-6">
                          {truncateContent(lash.postContent)}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* Stats Summary */}
      {receivedLashes.length > 0 && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="text-lg">Summary</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-sm text-muted-foreground">Total Received</p>
              <p className="text-2xl font-bold">{receivedLashes.length}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Paid</p>
              <p className="text-2xl font-bold text-green-600">
                {receivedLashes.filter(l => l.isPaid).length}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Pending</p>
              <p className="text-2xl font-bold text-orange-600">
                {receivedLashes.filter(l => !l.isPaid).length}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Total LANA</p>
              <p className="text-2xl font-bold text-primary">
                {receivedLashes.reduce((sum, l) => sum + parseFloat(l.amountLana), 0).toFixed(8)}
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
