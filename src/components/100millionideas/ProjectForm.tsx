import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Plus, X, ImagePlus, Wallet, Video, FileText } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useSystemParameters } from "@/contexts/SystemParametersContext";
import { finalizeEvent } from "nostr-tools";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useNostrWallets } from "@/hooks/useNostrWallets";

const CURRENCIES = [
  { value: "EUR", label: "EUR" },
  { value: "USD", label: "USD" },
  { value: "GBP", label: "GBP" },
];

export interface ProjectFormInitialData {
  dTag: string;
  title: string;
  shortDesc: string;
  content: string;
  fiatGoal: string;
  currency: string;
  wallet: string;
  responsibilityStatement: string;
  projectType: string;
  status: "draft" | "active";
  coverImage?: string;
  galleryImages: string[];
  videoUrls: string[];
  fileUrls: string[];
  hasDonations: boolean;
}

interface ProjectFormProps {
  mode: "create" | "edit";
  initialData?: ProjectFormInitialData;
  onSubmitSuccess: () => void;
}

const API_URL = import.meta.env.VITE_API_URL ?? '';

export default function ProjectForm({ mode, initialData, onSubmitSuccess }: ProjectFormProps) {
  const { session } = useAuth();
  const { parameters: systemParameters } = useSystemParameters();
  const { wallets, isLoading: walletsLoading } = useNostrWallets();

  const EXCLUDED_WALLET_TYPES = ["LanaPays.Us", "Knights", "Lana8Wonder"];
  const availableWallets = wallets.filter(
    (w) => w.status === "active" && !EXCLUDED_WALLET_TYPES.includes(w.walletType)
  );

  // Form state
  const [title, setTitle] = useState(initialData?.title || "");
  const [shortDesc, setShortDesc] = useState(initialData?.shortDesc || "");
  const [content, setContent] = useState(initialData?.content || "");
  const [fiatGoal, setFiatGoal] = useState(initialData?.fiatGoal || "");
  const [currency, setCurrency] = useState(initialData?.currency || "EUR");
  const [wallet, setWallet] = useState(initialData?.wallet || "");
  const [projectType] = useState("Inspiration"); // Always "Inspiration" — locked
  const [status, setStatus] = useState<"draft" | "active">(initialData?.status || "draft");
  const [responsibilityStatement, setResponsibilityStatement] = useState(
    initialData?.responsibilityStatement || "I unconditionally accept full self-responsibility for this project and all related actions in the Lana Reality."
  );
  const [responsibilityAcknowledged, setResponsibilityAcknowledged] = useState(mode === "edit");

  // Cover image
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState(initialData?.coverImage || "");
  const [existingCoverUrl, setExistingCoverUrl] = useState(initialData?.coverImage || "");

  // Gallery images
  const [galleryFiles, setGalleryFiles] = useState<File[]>([]);
  const [galleryPreviews, setGalleryPreviews] = useState<string[]>([]);
  const [existingGalleryUrls, setExistingGalleryUrls] = useState<string[]>(initialData?.galleryImages || []);

  // Video URLs
  const [videoUrls, setVideoUrls] = useState<string[]>(initialData?.videoUrls || []);

  // File URLs
  const [fileUrls, setFileUrls] = useState<string[]>(initialData?.fileUrls || []);

  // Status
  const [publishing, setPublishing] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Max allowed funding amount from app_settings
  const [maxAllowedAmount, setMaxAllowedAmount] = useState(200);

  useEffect(() => {
    const fetchMaxAmount = async () => {
      try {
        const res = await fetch(`${API_URL}/api/db/app_settings?key=eq.inspiration_max_allowed_amount&select=key,value`);
        const rows = await res.json();
        if (rows?.[0]?.value) {
          const val = typeof rows[0].value === 'number' ? rows[0].value : parseInt(rows[0].value, 10);
          if (val > 0) setMaxAllowedAmount(val);
        }
      } catch (e) {
        console.error('Failed to load max amount setting:', e);
      }
    };
    fetchMaxAmount();
  }, []);

  // Lock status to active if project has donations
  const hasDonations = initialData?.hasDonations || false;

  useEffect(() => {
    if (hasDonations && status === "draft") {
      setStatus("active");
    }
  }, [hasDonations]);

  // Set wallet from initialData once wallets are loaded
  useEffect(() => {
    if (initialData?.wallet && wallets.length > 0 && !wallet) {
      setWallet(initialData.wallet);
    }
  }, [wallets, initialData?.wallet]);

  // --- Image handling ---

  const resizeImage = async (file: File, maxWidth: number = 1200): Promise<Blob> => {
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
        if (!ctx) {
          reject(new Error("Could not get canvas context"));
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob(
          (blob) => {
            if (blob) {
              resolve(blob);
            } else {
              reject(new Error("Failed to create blob"));
            }
          },
          "image/jpeg",
          0.85
        );
      };
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  };

  const uploadImage = async (file: File): Promise<string | null> => {
    if (!session?.nostrHexId) return null;
    try {
      const resizedBlob = await resizeImage(file);
      const fileName = `${session.nostrHexId}/${Date.now()}-${Math.random().toString(36).substring(7)}.jpg`;

      const formData = new FormData();
      formData.append("path", fileName);
      formData.append("file", resizedBlob, fileName);

      const response = await fetch(`${API_URL}/api/storage/project-images/upload`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) throw new Error("Upload failed");

      const result = await response.json();
      return result.data?.publicUrl || `${API_URL}/api/storage/project-images/${fileName}`;
    } catch (error) {
      console.error("Error uploading image:", error);
      toast({
        title: "Error uploading image",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
      return null;
    }
  };

  const handleCoverSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setCoverFile(file);
      setCoverPreview(URL.createObjectURL(file));
    }
  };

  const removeCover = () => {
    if (coverPreview && coverPreview.startsWith("blob:")) {
      URL.revokeObjectURL(coverPreview);
    }
    setCoverFile(null);
    setCoverPreview("");
    setExistingCoverUrl("");
  };

  const handleGallerySelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    setGalleryFiles((prev) => [...prev, ...files]);
    const newPreviews = files.map((f) => URL.createObjectURL(f));
    setGalleryPreviews((prev) => [...prev, ...newPreviews]);
  };

  const removeGalleryImage = (index: number, isExisting: boolean) => {
    if (isExisting) {
      setExistingGalleryUrls((prev) => prev.filter((_, i) => i !== index));
    } else {
      if (galleryPreviews[index]?.startsWith("blob:")) {
        URL.revokeObjectURL(galleryPreviews[index]);
      }
      setGalleryFiles((prev) => prev.filter((_, i) => i !== index));
      setGalleryPreviews((prev) => prev.filter((_, i) => i !== index));
    }
  };

  // --- Dynamic URL lists ---

  const addVideoUrl = () => setVideoUrls([...videoUrls, ""]);
  const removeVideoUrl = (index: number) => setVideoUrls(videoUrls.filter((_, i) => i !== index));
  const updateVideoUrl = (index: number, value: string) => {
    const updated = [...videoUrls];
    updated[index] = value;
    setVideoUrls(updated);
  };

  const addFileUrl = () => setFileUrls([...fileUrls, ""]);
  const removeFileUrl = (index: number) => setFileUrls(fileUrls.filter((_, i) => i !== index));
  const updateFileUrl = (index: number, value: string) => {
    const updated = [...fileUrls];
    updated[index] = value;
    setFileUrls(updated);
  };

  // --- Hex helper ---
  const hexToBytes = (hex: string): Uint8Array => {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
      bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
    }
    return bytes;
  };

  // --- Submit ---

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!session?.nostrHexId || !session?.nostrPrivateKey) {
      toast({ title: "Error", description: "You must be logged in", variant: "destructive" });
      return;
    }

    // Validation
    if (!title.trim()) {
      toast({ title: "Error", description: "Title is required", variant: "destructive" });
      return;
    }
    if (!shortDesc.trim()) {
      toast({ title: "Error", description: "Short description is required", variant: "destructive" });
      return;
    }
    if (!content.trim()) {
      toast({ title: "Error", description: "Project description is required", variant: "destructive" });
      return;
    }
    if (!fiatGoal || parseFloat(fiatGoal) <= 0) {
      toast({ title: "Error", description: "Funding goal must be greater than 0", variant: "destructive" });
      return;
    }
    if (parseFloat(fiatGoal) > maxAllowedAmount) {
      toast({ title: "Error", description: `Funding goal cannot exceed ${maxAllowedAmount} ${currency}`, variant: "destructive" });
      return;
    }
    if (!wallet) {
      toast({ title: "Error", description: "Please select a wallet", variant: "destructive" });
      return;
    }
    if (!responsibilityAcknowledged) {
      toast({ title: "Error", description: "You must acknowledge the responsibility statement", variant: "destructive" });
      return;
    }

    setPublishing(true);
    setUploading(true);

    try {
      // Upload images
      let finalCoverUrl = existingCoverUrl;
      if (coverFile) {
        const url = await uploadImage(coverFile);
        if (url) finalCoverUrl = url;
      }

      const uploadedGalleryUrls: string[] = [...existingGalleryUrls];
      for (const file of galleryFiles) {
        const url = await uploadImage(file);
        if (url) uploadedGalleryUrls.push(url);
      }

      setUploading(false);

      // Build tags
      const dTag = mode === "edit" && initialData?.dTag
        ? initialData.dTag
        : `project:${crypto.randomUUID()}`;

      const tags: string[][] = [
        ["d", dTag],
        ["service", "lanacrowd"],
        ["title", title.trim()],
        ["short_desc", shortDesc.trim()],
        ["fiat_goal", parseFloat(fiatGoal).toFixed(2)],
        ["currency", currency],
        ["wallet", wallet],
        ["responsibility_statement", responsibilityStatement.trim()],
        ["project_type", projectType],
        ["status", status],
        ["p", session.nostrHexId, "owner"],
        ["timestamp_created", String(Math.floor(Date.now() / 1000))],
      ];

      // Add cover image
      if (finalCoverUrl) {
        tags.push(["img", finalCoverUrl, "cover"]);
      }

      // Add gallery images
      uploadedGalleryUrls.forEach((url) => {
        tags.push(["img", url, "gallery"]);
      });

      // Add videos
      videoUrls.filter((u) => u.trim()).forEach((url, i) => {
        tags.push(["video", url.trim(), i === 0 ? "primary" : "extra"]);
      });

      // Add files
      fileUrls.filter((u) => u.trim()).forEach((url) => {
        tags.push(["file", url.trim(), "pdf"]);
      });

      // Sign event
      const eventTemplate = {
        kind: 31234,
        created_at: Math.floor(Date.now() / 1000),
        tags,
        content: content.trim(),
      };

      const signedEvent = finalizeEvent(eventTemplate, hexToBytes(session.nostrPrivateKey));

      // Publish via server
      const { data: publishData, error: publishError } = await supabase.functions.invoke(
        "publish-dm-event",
        { body: { event: signedEvent } }
      );

      if (publishError) {
        throw new Error(publishError.message || "Failed to publish");
      }

      const successCount = publishData?.publishedTo || 0;
      console.log(`✅ Project published to ${successCount} relays, event: ${signedEvent.id}`);

      toast({
        title: mode === "create" ? "Project Created" : "Project Updated",
        description: `Published to ${successCount} relay${successCount !== 1 ? "s" : ""}`,
      });

      onSubmitSuccess();
    } catch (error) {
      console.error("Error publishing project:", error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to publish project",
        variant: "destructive",
      });
    } finally {
      setPublishing(false);
      setUploading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Basic Info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Project Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="title">Title *</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="My Project Title"
              maxLength={100}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="shortDesc">Short Description *</Label>
            <Input
              id="shortDesc"
              value={shortDesc}
              onChange={(e) => setShortDesc(e.target.value)}
              placeholder="A brief summary of your project"
              maxLength={200}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="content">Full Description (Markdown) *</Label>
            <Textarea
              id="content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Describe your project in detail: vision, goals, how funds will be used..."
              rows={10}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="projectType">Project Type *</Label>
            <Input value="Inspiration" disabled className="bg-muted" />
          </div>
        </CardContent>
      </Card>

      {/* Funding */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Funding</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="fiatGoal">Funding Goal *</Label>
              <Input
                id="fiatGoal"
                type="number"
                step="0.01"
                min="0.01"
                max={maxAllowedAmount}
                value={fiatGoal}
                onChange={(e) => setFiatGoal(e.target.value)}
                placeholder="100.00"
              />
              <p className="text-xs text-muted-foreground">
                Maximum: {maxAllowedAmount} {currency}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="currency">Currency *</Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="wallet" className="flex items-center gap-2">
              <Wallet className="h-4 w-4" />
              Project Wallet *
            </Label>
            <Select value={wallet} onValueChange={setWallet}>
              <SelectTrigger>
                <SelectValue placeholder={walletsLoading ? "Loading wallets..." : "Select wallet"} />
              </SelectTrigger>
              <SelectContent>
                {availableWallets.map((w) => (
                  <SelectItem key={w.walletId} value={w.walletId}>
                    <div className="flex flex-col">
                      <span className="font-mono text-sm">{w.walletId}</span>
                      <span className="text-xs text-muted-foreground">
                        {w.walletType}
                        {w.note ? ` - ${w.note}` : ""}
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Cover Image */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <ImagePlus className="h-5 w-5" />
            Cover Image
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {(coverPreview || existingCoverUrl) ? (
            <div className="relative">
              <img
                src={coverPreview || existingCoverUrl}
                alt="Cover preview"
                className="w-full h-48 object-cover rounded-lg"
              />
              <Button
                type="button"
                variant="destructive"
                size="icon"
                className="absolute top-2 right-2 h-8 w-8"
                onClick={removeCover}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-muted-foreground/25 rounded-lg cursor-pointer hover:border-muted-foreground/50 transition-colors">
              <ImagePlus className="h-8 w-8 text-muted-foreground mb-2" />
              <span className="text-sm text-muted-foreground">Click to upload cover image</span>
              <input
                type="file"
                accept="image/*"
                onChange={handleCoverSelect}
                className="hidden"
              />
            </label>
          )}
        </CardContent>
      </Card>

      {/* Gallery Images */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Gallery Images</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            {existingGalleryUrls.map((url, index) => (
              <div key={`existing-${index}`} className="relative">
                <img
                  src={url}
                  alt={`Gallery ${index + 1}`}
                  className="w-full h-24 object-cover rounded-lg"
                />
                <Button
                  type="button"
                  variant="destructive"
                  size="icon"
                  className="absolute top-1 right-1 h-6 w-6"
                  onClick={() => removeGalleryImage(index, true)}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ))}
            {galleryPreviews.map((preview, index) => (
              <div key={`new-${index}`} className="relative">
                <img
                  src={preview}
                  alt={`New gallery ${index + 1}`}
                  className="w-full h-24 object-cover rounded-lg"
                />
                <Button
                  type="button"
                  variant="destructive"
                  size="icon"
                  className="absolute top-1 right-1 h-6 w-6"
                  onClick={() => removeGalleryImage(index, false)}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
          <label className="flex items-center gap-2 cursor-pointer text-sm text-primary hover:underline">
            <Plus className="h-4 w-4" />
            Add gallery images
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={handleGallerySelect}
              className="hidden"
            />
          </label>
        </CardContent>
      </Card>

      {/* Videos */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Video className="h-5 w-5" />
            Videos
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {videoUrls.map((url, index) => (
            <div key={index} className="flex gap-2">
              <Input
                value={url}
                onChange={(e) => updateVideoUrl(index, e.target.value)}
                placeholder="https://youtube.com/watch?v=..."
              />
              <Button type="button" variant="ghost" size="icon" onClick={() => removeVideoUrl(index)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={addVideoUrl} className="gap-2">
            <Plus className="h-4 w-4" />
            Add Video URL
          </Button>
        </CardContent>
      </Card>

      {/* Documents */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Documents
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {fileUrls.map((url, index) => (
            <div key={index} className="flex gap-2">
              <Input
                value={url}
                onChange={(e) => updateFileUrl(index, e.target.value)}
                placeholder="https://example.com/document.pdf"
              />
              <Button type="button" variant="ghost" size="icon" onClick={() => removeFileUrl(index)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={addFileUrl} className="gap-2">
            <Plus className="h-4 w-4" />
            Add Document URL
          </Button>
        </CardContent>
      </Card>

      {/* Status & Responsibility */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Status & Responsibility</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label>Project Status</Label>
              <p className="text-sm text-muted-foreground">
                {status === "draft" ? "Only visible to you" : "Publicly visible and can receive donations"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Draft</span>
              <Switch
                checked={status === "active"}
                onCheckedChange={(checked) => setStatus(checked ? "active" : "draft")}
                disabled={hasDonations}
              />
              <span className="text-sm text-muted-foreground">Active</span>
            </div>
          </div>
          {hasDonations && (
            <p className="text-sm text-amber-600">
              This project has received donations and cannot be reverted to draft.
            </p>
          )}

          <div className="space-y-2">
            <Label htmlFor="responsibility">Responsibility Statement *</Label>
            <Textarea
              id="responsibility"
              value={responsibilityStatement}
              onChange={(e) => setResponsibilityStatement(e.target.value)}
              rows={3}
            />
          </div>

          <div className="flex items-start gap-2">
            <Checkbox
              id="ack"
              checked={responsibilityAcknowledged}
              onCheckedChange={(checked) => setResponsibilityAcknowledged(checked === true)}
            />
            <label htmlFor="ack" className="text-sm leading-tight cursor-pointer">
              I acknowledge and accept the responsibility statement above
            </label>
          </div>
        </CardContent>
      </Card>

      {/* Submit */}
      <Button type="submit" className="w-full" disabled={publishing || uploading}>
        {(publishing || uploading) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {uploading
          ? "Uploading images..."
          : publishing
          ? "Publishing..."
          : mode === "create"
          ? "Create Project"
          : "Update Project"}
      </Button>
    </form>
  );
}
