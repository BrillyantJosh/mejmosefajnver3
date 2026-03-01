import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Copy, Check, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

interface LossReport {
  id: string;
  nostr_hex_id: string;
  wallet_address: string;
  wallet_note: string;
  balance: number;
  description: string;
  created_at: string;
}

interface NostrProfile {
  nostr_hex_id: string;
  display_name: string | null;
  full_name: string | null;
  picture: string | null;
}

export default function LossBoard() {
  const [reports, setReports] = useState<LossReport[]>([]);
  const [profiles, setProfiles] = useState<Record<string, NostrProfile>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    loadReports();
  }, []);

  const loadReports = async () => {
    try {
      const { data, error } = await supabase
        .from("loss_reports")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;

      const reportsList = (data || []) as LossReport[];
      setReports(reportsList);

      // Load profiles for all reporters
      const hexIds = [...new Set(reportsList.map((r) => r.nostr_hex_id))];
      if (hexIds.length > 0) {
        const { data: profileData } = await supabase
          .from("nostr_profiles")
          .select("nostr_hex_id,display_name,full_name,picture")
          .in("nostr_hex_id", hexIds);

        if (profileData) {
          const profileMap: Record<string, NostrProfile> = {};
          (profileData as NostrProfile[]).forEach((p) => {
            profileMap[p.nostr_hex_id] = p;
          });
          setProfiles(profileMap);
        }
      }
    } catch (error: any) {
      console.error("Error loading loss reports:", error);
      toast.error("Failed to load loss reports");
    } finally {
      setIsLoading(false);
    }
  };

  const copyAddress = (address: string, id: string) => {
    navigator.clipboard.writeText(address);
    setCopiedId(id);
    toast.success("Address copied");
    setTimeout(() => setCopiedId(null), 2000);
  };

  const getDisplayName = (hexId: string) => {
    const profile = profiles[hexId];
    if (profile?.display_name) return profile.display_name;
    if (profile?.full_name) return profile.full_name;
    return hexId.substring(0, 8) + "..." + hexId.substring(hexId.length - 8);
  };

  const getAvatar = (hexId: string) => {
    return profiles[hexId]?.picture || undefined;
  };

  const formatDate = (dateStr: string) => {
    try {
      const date = new Date(dateStr + "Z");
      return date.toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch {
      return dateStr;
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-muted-foreground">Loading loss board...</span>
      </div>
    );
  }

  if (reports.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <AlertTriangle className="h-12 w-12 mb-4 opacity-30" />
        <p className="text-lg font-medium">No loss reports yet</p>
        <p className="text-sm">
          When wallets are reported as lost, they will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="px-4 space-y-3">
      <p className="text-sm text-muted-foreground">
        {reports.length} lost wallet{reports.length !== 1 ? "s" : ""} reported
      </p>

      {reports.map((report) => (
        <Card key={report.id} className="border-red-500/20">
          <CardContent className="p-4 space-y-3">
            {/* Wallet Address */}
            <div className="flex items-center gap-2">
              <p className="font-mono text-sm truncate flex-1">
                {report.wallet_address}
              </p>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                onClick={() => copyAddress(report.wallet_address, report.id)}
              >
                {copiedId === report.id ? (
                  <Check className="h-3.5 w-3.5 text-green-500" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </Button>
            </div>

            {/* Wallet Note & Balance */}
            {(report.wallet_note || report.balance > 0) && (
              <div className="flex items-center gap-3 flex-wrap text-xs">
                {report.wallet_note && (
                  <span className="text-muted-foreground">{report.wallet_note}</span>
                )}
                {report.balance > 0 && (
                  <span className="font-medium text-red-600 dark:text-red-400">
                    {new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(report.balance)} LANA lost
                  </span>
                )}
              </div>
            )}

            {/* Description */}
            <p className="text-sm text-muted-foreground">{report.description}</p>

            {/* Reporter & Date */}
            <div className="flex items-center justify-between pt-1 border-t">
              <div className="flex items-center gap-2">
                <Avatar className="h-6 w-6">
                  <AvatarImage src={getAvatar(report.nostr_hex_id)} />
                  <AvatarFallback className="text-[10px]">
                    {getDisplayName(report.nostr_hex_id).substring(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span className="text-xs text-muted-foreground truncate max-w-[180px]">
                  {getDisplayName(report.nostr_hex_id)}
                </span>
              </div>
              <span className="text-xs text-muted-foreground shrink-0">
                {formatDate(report.created_at)}
              </span>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
