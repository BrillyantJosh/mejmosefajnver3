import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, ArrowLeft, Bug, Lightbulb, Mail, Phone, MessageSquare } from "lucide-react";

interface BugReport {
  id: string;
  nostr_hex_id: string;
  type: "bug" | "feature";
  title: string;
  description: string;
  images: string[];
  notify_method: string;
  notify_contact: string;
  status: string;
  admin_notes: string;
  created_at: string;
  updated_at: string;
}

interface NostrProfile {
  nostr_hex_id: string;
  display_name: string | null;
  full_name: string | null;
  picture: string | null;
}

const STATUS_LABELS: Record<string, string> = {
  open: "Open",
  in_progress: "In Progress",
  resolved: "Resolved",
  closed: "Closed",
  wont_fix: "Won't Fix",
};

const STATUS_COLORS: Record<string, string> = {
  open: "bg-yellow-500/10 text-yellow-600 border-yellow-500/20",
  in_progress: "bg-blue-500/10 text-blue-600 border-blue-500/20",
  resolved: "bg-green-500/10 text-green-600 border-green-500/20",
  closed: "bg-gray-500/10 text-gray-600 border-gray-500/20",
  wont_fix: "bg-red-500/10 text-red-600 border-red-500/20",
};

const NOTIFY_ICONS: Record<string, typeof Mail> = {
  email: Mail,
  gsm: Phone,
  dm: MessageSquare,
  whatsapp: Phone,
};

export default function BugReportsAdmin() {
  const { toast } = useToast();
  const [reports, setReports] = useState<BugReport[]>([]);
  const [profiles, setProfiles] = useState<Record<string, NostrProfile>>({});
  const [loading, setLoading] = useState(true);
  const [selectedReport, setSelectedReport] = useState<BugReport | null>(null);
  const [saving, setSaving] = useState(false);
  const [editStatus, setEditStatus] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterType, setFilterType] = useState("all");

  const loadReports = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from("bug_reports")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      setReports(data || []);

      // Load profiles
      const hexIds = [...new Set((data || []).map((r: BugReport) => r.nostr_hex_id))];
      if (hexIds.length > 0) {
        const { data: profileData } = await supabase
          .from("nostr_profiles")
          .select("nostr_hex_id,display_name,full_name,picture")
          .in("nostr_hex_id", hexIds);

        if (profileData) {
          const profileMap: Record<string, NostrProfile> = {};
          profileData.forEach((p: NostrProfile) => {
            profileMap[p.nostr_hex_id] = p;
          });
          setProfiles(profileMap);
        }
      }
    } catch (error) {
      console.error("Failed to load reports:", error);
      toast({ title: "Failed to load reports", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadReports();
  }, [loadReports]);

  const openReport = (report: BugReport) => {
    setSelectedReport(report);
    setEditStatus(report.status);
    setEditNotes(report.admin_notes || "");
  };

  const handleSave = async () => {
    if (!selectedReport) return;
    setSaving(true);

    try {
      const { error } = await supabase
        .from("bug_reports")
        .update({ status: editStatus, admin_notes: editNotes })
        .eq("id", `eq.${selectedReport.id}`);

      if (error) throw error;

      toast({ title: "Report updated" });

      // Update local state
      setReports((prev) =>
        prev.map((r) =>
          r.id === selectedReport.id ? { ...r, status: editStatus, admin_notes: editNotes } : r
        )
      );
      setSelectedReport({ ...selectedReport, status: editStatus, admin_notes: editNotes });
    } catch (error) {
      console.error("Save error:", error);
      toast({ title: "Failed to save", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const getProfileName = (hexId: string) => {
    const profile = profiles[hexId];
    if (profile?.display_name) return profile.display_name;
    if (profile?.full_name) return profile.full_name;
    return hexId.substring(0, 12) + "...";
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr + "Z").toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const filteredReports = reports.filter((r) => {
    if (filterStatus !== "all" && r.status !== filterStatus) return false;
    if (filterType !== "all" && r.type !== filterType) return false;
    return true;
  });

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Detail view
  if (selectedReport) {
    const NotifyIcon = selectedReport.notify_method
      ? NOTIFY_ICONS[selectedReport.notify_method] || Mail
      : null;

    return (
      <div className="space-y-6">
        <Button variant="ghost" onClick={() => setSelectedReport(null)} className="gap-2">
          <ArrowLeft className="h-4 w-4" /> Back to list
        </Button>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <span className="text-2xl">{selectedReport.type === "bug" ? "\uD83D\uDC1B" : "\uD83D\uDCA1"}</span>
              <div className="flex-1">
                <CardTitle className="text-xl">{selectedReport.title}</CardTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  by {getProfileName(selectedReport.nostr_hex_id)} &middot; {formatDate(selectedReport.created_at)}
                </p>
              </div>
              <Badge variant="outline" className={STATUS_COLORS[selectedReport.status] || ""}>
                {STATUS_LABELS[selectedReport.status] || selectedReport.status}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Description */}
            <div>
              <Label className="text-sm font-semibold">Description</Label>
              <p className="mt-1 text-sm whitespace-pre-wrap">{selectedReport.description}</p>
            </div>

            {/* Images */}
            {selectedReport.images && selectedReport.images.length > 0 && (
              <div>
                <Label className="text-sm font-semibold">Screenshots</Label>
                <div className="flex flex-wrap gap-3 mt-2">
                  {selectedReport.images.map((img, i) => (
                    <a key={i} href={img} target="_blank" rel="noopener noreferrer">
                      <img
                        src={img}
                        alt={`Screenshot ${i + 1}`}
                        className="h-32 w-auto object-cover rounded border hover:opacity-80 transition-opacity"
                      />
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* Contact Info */}
            {selectedReport.notify_method && selectedReport.notify_method !== "none" && (
              <div>
                <Label className="text-sm font-semibold">Notification Preference</Label>
                <div className="flex items-center gap-2 mt-1 text-sm">
                  {NotifyIcon && <NotifyIcon className="h-4 w-4" />}
                  <span className="capitalize">{selectedReport.notify_method}</span>
                  {selectedReport.notify_contact && (
                    <>
                      <span>&middot;</span>
                      <span className="font-mono">{selectedReport.notify_contact}</span>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Nostr Hex ID */}
            <div>
              <Label className="text-sm font-semibold">Nostr Hex ID</Label>
              <p className="mt-1 text-xs font-mono text-muted-foreground break-all">
                {selectedReport.nostr_hex_id}
              </p>
            </div>

            {/* Admin Controls */}
            <div className="border-t pt-4 space-y-4">
              <h3 className="font-semibold">Admin Actions</h3>

              <div>
                <Label>Status</Label>
                <Select value={editStatus} onValueChange={setEditStatus}>
                  <SelectTrigger className="mt-1 w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="open">Open</SelectItem>
                    <SelectItem value="in_progress">In Progress</SelectItem>
                    <SelectItem value="resolved">Resolved</SelectItem>
                    <SelectItem value="closed">Closed</SelectItem>
                    <SelectItem value="wont_fix">Won't Fix</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Admin Notes</Label>
                <Textarea
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  placeholder="Internal notes or public response..."
                  className="mt-1"
                />
              </div>

              <Button onClick={handleSave} disabled={saving}>
                {saving ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" /> Saving...
                  </>
                ) : (
                  "Save Changes"
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // List view
  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex flex-wrap gap-4">
        <div>
          <Label className="text-xs">Status</Label>
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-40 mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="in_progress">In Progress</SelectItem>
              <SelectItem value="resolved">Resolved</SelectItem>
              <SelectItem value="closed">Closed</SelectItem>
              <SelectItem value="wont_fix">Won't Fix</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Type</Label>
          <Select value={filterType} onValueChange={setFilterType}>
            <SelectTrigger className="w-40 mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="bug">Bug</SelectItem>
              <SelectItem value="feature">Feature</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-end">
          <p className="text-sm text-muted-foreground">
            {filteredReports.length} report{filteredReports.length !== 1 ? "s" : ""}
          </p>
        </div>
      </div>

      {/* Reports List */}
      {filteredReports.length === 0 ? (
        <p className="text-muted-foreground text-center py-8">No reports found</p>
      ) : (
        <div className="space-y-2">
          {filteredReports.map((report) => (
            <Card
              key={report.id}
              className="cursor-pointer hover:shadow-md transition-shadow"
              onClick={() => openReport(report)}
            >
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <span className="text-lg">{report.type === "bug" ? "\uD83D\uDC1B" : "\uD83D\uDCA1"}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm truncate">{report.title}</span>
                      <Badge variant="outline" className={`text-xs ${STATUS_COLORS[report.status] || ""}`}>
                        {STATUS_LABELS[report.status] || report.status}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {getProfileName(report.nostr_hex_id)} &middot; {formatDate(report.created_at)}
                      {report.notify_method && report.notify_method !== "none" && (
                        <> &middot; {report.notify_method}: {report.notify_contact}</>
                      )}
                    </p>
                  </div>
                  {report.images && report.images.length > 0 && (
                    <span className="text-xs text-muted-foreground">{report.images.length} img</span>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
