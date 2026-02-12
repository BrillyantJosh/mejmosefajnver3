import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, ImagePlus, X, Bug, Lightbulb } from "lucide-react";

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

const resizeImage = (file: File, maxWidth = 1200): Promise<Blob> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      let width = img.width;
      let height = img.height;
      if (width > maxWidth) {
        height = (height * maxWidth) / width;
        width = maxWidth;
      }
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("Could not get canvas context"));
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("Failed to create blob"))),
        "image/jpeg",
        0.85
      );
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
};

export default function ReportBug() {
  const { session } = useAuth();
  const { toast } = useToast();

  // Form state
  const [type, setType] = useState<"bug" | "feature">("bug");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [selectedImages, setSelectedImages] = useState<File[]>([]);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const [notifyMethod, setNotifyMethod] = useState("");
  const [notifyContact, setNotifyContact] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // History state
  const [reports, setReports] = useState<BugReport[]>([]);
  const [profiles, setProfiles] = useState<Record<string, NostrProfile>>({});
  const [loadingReports, setLoadingReports] = useState(true);

  const loadReports = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from("bug_reports")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      setReports(data || []);

      // Load profiles for all unique nostr_hex_ids
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
    } finally {
      setLoadingReports(false);
    }
  }, []);

  useEffect(() => {
    loadReports();
  }, [loadReports]);

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (selectedImages.length + files.length > 3) {
      toast({ title: "Maximum 3 images", variant: "destructive" });
      return;
    }

    for (const file of files) {
      if (file.size > 5 * 1024 * 1024) {
        toast({ title: "Image too large", description: "Max 5MB per image", variant: "destructive" });
        return;
      }
    }

    const newImages = [...selectedImages, ...files];
    setSelectedImages(newImages);

    // Generate previews
    files.forEach((file) => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        setImagePreviews((prev) => [...prev, ev.target?.result as string]);
      };
      reader.readAsDataURL(file);
    });

    // Reset input
    e.target.value = "";
  };

  const removeImage = (index: number) => {
    setSelectedImages((prev) => prev.filter((_, i) => i !== index));
    setImagePreviews((prev) => prev.filter((_, i) => i !== index));
  };

  const uploadImages = async (): Promise<string[]> => {
    if (selectedImages.length === 0 || !session?.nostrHexId) return [];

    const uploadedUrls: string[] = [];

    for (const file of selectedImages) {
      try {
        const resizedBlob = await resizeImage(file);
        const fileName = `bugs/${session.nostrHexId}/${Date.now()}-${Math.random().toString(36).substring(7)}.jpg`;

        const { data, error } = await supabase.storage
          .from("post-images")
          .upload(fileName, resizedBlob, {
            contentType: "image/jpeg",
            cacheControl: "3600",
            upsert: false,
          });

        if (error) throw error;

        const {
          data: { publicUrl },
        } = supabase.storage.from("post-images").getPublicUrl(data.path);

        uploadedUrls.push(publicUrl);
      } catch (error) {
        console.error("Image upload error:", error);
      }
    }

    return uploadedUrls;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!session?.nostrHexId) {
      toast({ title: "You must be logged in", variant: "destructive" });
      return;
    }

    if (!title.trim()) {
      toast({ title: "Title is required", variant: "destructive" });
      return;
    }

    if (!description.trim()) {
      toast({ title: "Description is required", variant: "destructive" });
      return;
    }

    setSubmitting(true);

    try {
      // Upload images
      const imageUrls = await uploadImages();

      // Insert report
      const { error } = await supabase.from("bug_reports").insert({
        nostr_hex_id: session.nostrHexId,
        type,
        title: title.trim(),
        description: description.trim(),
        images: imageUrls,
        notify_method: notifyMethod || "",
        notify_contact: notifyMethod === "dm" ? "" : (notifyContact || ""),
      });

      if (error) throw error;

      toast({ title: "Report submitted", description: "Thank you for your feedback!" });

      // Reset form
      setType("bug");
      setTitle("");
      setDescription("");
      setSelectedImages([]);
      setImagePreviews([]);
      setNotifyMethod("");
      setNotifyContact("");

      // Reload reports
      loadReports();
    } catch (error) {
      console.error("Submit error:", error);
      toast({
        title: "Failed to submit report",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const getNotifyPlaceholder = () => {
    switch (notifyMethod) {
      case "email": return "your@email.com";
      case "gsm": return "+386 XX XXX XXX";
      case "whatsapp": return "+386 XX XXX XXX";
      default: return "";
    }
  };

  const getProfileName = (hexId: string) => {
    const profile = profiles[hexId];
    if (profile?.display_name) return profile.display_name;
    if (profile?.full_name) return profile.full_name;
    return hexId.substring(0, 8) + "...";
  };

  const openReports = reports.filter((r) => r.status === "open" || r.status === "in_progress");
  const closedReports = reports.filter(
    (r) => r.status === "resolved" || r.status === "closed" || r.status === "wont_fix"
  );

  const formatDate = (dateStr: string) => {
    return new Date(dateStr + "Z").toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const ReportCard = ({ report }: { report: BugReport }) => (
    <Card className="mb-3">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <span className="text-xl mt-0.5">{report.type === "bug" ? "\uD83D\uDC1B" : "\uD83D\uDCA1"}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <h3 className="font-semibold text-sm">{report.title}</h3>
              <Badge variant="outline" className={STATUS_COLORS[report.status] || ""}>
                {STATUS_LABELS[report.status] || report.status}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground line-clamp-2 mb-2">{report.description}</p>
            {report.images && report.images.length > 0 && (
              <div className="flex gap-2 mb-2">
                {report.images.map((img, i) => (
                  <img
                    key={i}
                    src={img}
                    alt={`Screenshot ${i + 1}`}
                    className="h-16 w-16 object-cover rounded border"
                  />
                ))}
              </div>
            )}
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>{getProfileName(report.nostr_hex_id)}</span>
              <span>&middot;</span>
              <span>{formatDate(report.created_at)}</span>
            </div>
            {report.admin_notes && (
              <div className="mt-2 p-2 bg-muted rounded text-xs">
                <span className="font-semibold">Admin: </span>
                {report.admin_notes}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Report Bug / Request Feature</h1>
        <p className="text-muted-foreground">
          Report a bug or request a new feature. Check existing reports below before submitting.
        </p>
      </div>

      {/* Submit Form */}
      <Card className="mb-8">
        <CardHeader>
          <CardTitle className="text-lg">Submit New Report</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Type */}
            <div>
              <Label>Type</Label>
              <Select value={type} onValueChange={(v) => setType(v as "bug" | "feature")}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="bug">
                    <span className="flex items-center gap-2">
                      <Bug className="h-4 w-4" /> Bug Report
                    </span>
                  </SelectItem>
                  <SelectItem value="feature">
                    <span className="flex items-center gap-2">
                      <Lightbulb className="h-4 w-4" /> Feature Request
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Title */}
            <div>
              <Label htmlFor="title">Title *</Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={type === "bug" ? "Brief description of the bug" : "Brief description of the feature"}
                className="mt-1"
                required
              />
            </div>

            {/* Description */}
            <div>
              <Label htmlFor="description">Description *</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={
                  type === "bug"
                    ? "What happened? What did you expect to happen? Steps to reproduce..."
                    : "Describe the feature you'd like to see. Why would it be useful?"
                }
                className="mt-1 min-h-[120px]"
                required
              />
            </div>

            {/* Images */}
            <div>
              <Label>Screenshots (max 3)</Label>
              <div className="flex flex-wrap gap-3 mt-2">
                {imagePreviews.map((preview, i) => (
                  <div key={i} className="relative">
                    <img src={preview} alt={`Preview ${i + 1}`} className="h-20 w-20 object-cover rounded border" />
                    <button
                      type="button"
                      onClick={() => removeImage(i)}
                      className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground rounded-full p-0.5"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
                {selectedImages.length < 3 && (
                  <label className="h-20 w-20 border-2 border-dashed rounded flex items-center justify-center cursor-pointer hover:border-primary transition-colors">
                    <ImagePlus className="h-6 w-6 text-muted-foreground" />
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleImageSelect}
                      className="hidden"
                    />
                  </label>
                )}
              </div>
            </div>

            {/* Notification */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label>How should we notify you when resolved?</Label>
                <Select value={notifyMethod} onValueChange={setNotifyMethod}>
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Select method..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Don't notify me</SelectItem>
                    <SelectItem value="email">Email</SelectItem>
                    <SelectItem value="gsm">GSM / SMS</SelectItem>
                    <SelectItem value="dm">DM Chat</SelectItem>
                    <SelectItem value="whatsapp">WhatsApp</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {notifyMethod && notifyMethod !== "none" && notifyMethod !== "dm" && (
                <div>
                  <Label>Contact</Label>
                  <Input
                    value={notifyContact}
                    onChange={(e) => setNotifyContact(e.target.value)}
                    placeholder={getNotifyPlaceholder()}
                    className="mt-1"
                  />
                </div>
              )}
            </div>

            <Button type="submit" disabled={submitting} className="w-full">
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" /> Submitting...
                </>
              ) : (
                "Submit Report"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* History */}
      <div>
        <h2 className="text-xl font-bold mb-4">Reported Issues & Feature Requests</h2>

        {loadingReports ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : reports.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">No reports yet. Be the first to submit!</p>
        ) : (
          <Tabs defaultValue="open">
            <TabsList className="mb-4">
              <TabsTrigger value="open">
                Open ({openReports.length})
              </TabsTrigger>
              <TabsTrigger value="closed">
                Resolved ({closedReports.length})
              </TabsTrigger>
            </TabsList>
            <TabsContent value="open">
              {openReports.length === 0 ? (
                <p className="text-muted-foreground text-center py-4">No open issues</p>
              ) : (
                openReports.map((report) => <ReportCard key={report.id} report={report} />)
              )}
            </TabsContent>
            <TabsContent value="closed">
              {closedReports.length === 0 ? (
                <p className="text-muted-foreground text-center py-4">No resolved issues yet</p>
              ) : (
                closedReports.map((report) => <ReportCard key={report.id} report={report} />)
              )}
            </TabsContent>
          </Tabs>
        )}
      </div>
    </div>
  );
}
