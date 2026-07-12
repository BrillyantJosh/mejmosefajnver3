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
import { useAdmin } from "@/contexts/AdminContext";
import { useSystemParameters } from "@/contexts/SystemParametersContext";
import { finalizeEvent } from "nostr-tools";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useNostrWallets } from "@/hooks/useNostrWallets";
import millionideasTranslations from "@/i18n/modules/millionideas";
import { useTranslation } from "@/i18n/I18nContext";

const PROJECT_TYPES = [
  { value: "Inspiration", label: "Inspiration" },
  { value: "Enhancement", label: "Enhancement" },
  { value: "Agreement", label: "Agreement" },
  { value: "Awareness", label: "Awareness" },
  { value: "OnlineEvent", label: "Online Event" },
  { value: "Event", label: "Event" },
];

const WHAT_TYPES = [
  { value: "IamAllowingMyself", label: "I am Allowing Myself" },
  { value: "EmbraceEnough", label: "Embracing Enough" },
  { value: "DigitalBeing", label: "Digital Being" },
  { value: "ProductOrService", label: "Product Or Service" },
];

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
  whatType?: string;
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
  const { t } = useTranslation(millionideasTranslations);
  const { session } = useAuth();
  const { appSettings } = useAdmin();
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
  const [projectType, setProjectType] = useState(initialData?.projectType || "Inspiration");
  const [whatType, setWhatType] = useState(initialData?.whatType || "");
  const [status, setStatus] = useState<"draft" | "active">(initialData?.status || "draft");
  const [responsibilityStatement, setResponsibilityStatement] = useState(
    initialData?.responsibilityStatement || t("form.responsibilityDefault")
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

  // Per-type settings from admin
  const pts = appSettings?.project_type_settings;
  const currentTypeConfig = pts?.[projectType as keyof typeof pts];
  const typeMaxAmount = currentTypeConfig?.maxAmount ?? 200;

  // Check if current user has a custom higher limit as authorized creator
  const creatorOverride = appSettings?.authorized_creators?.find(
    (c: any) => c.nostrHexId === session?.nostrHexId
  );
  const maxAllowedAmount = Math.max(typeMaxAmount, creatorOverride?.maxAmount ?? 0);

  // Filter PROJECT_TYPES to only show admin-enabled types
  const enabledProjectTypes = PROJECT_TYPES.filter(
    (pt) => pts?.[pt.value as keyof typeof pts]?.enabled !== false
  );

  // If current projectType was disabled by admin, reset to first enabled
  useEffect(() => {
    if (enabledProjectTypes.length > 0 && !enabledProjectTypes.find(pt => pt.value === projectType)) {
      setProjectType(enabledProjectTypes[0].value);
    }
  }, [pts]);

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

      if (!response.ok) throw new Error(t("form.err.uploadFailed"));

      const result = await response.json();
      return result.data?.publicUrl || `${API_URL}/api/storage/project-images/${fileName}`;
    } catch (error) {
      console.error("Error uploading image:", error);
      toast({
        title: t("form.toast.imageUploadError"),
        description: error instanceof Error ? error.message : t("form.toast.unknownError"),
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
      toast({ title: t("form.toast.error"), description: t("form.toast.mustLogin"), variant: "destructive" });
      return;
    }

    // Validation
    if (!title.trim()) {
      toast({ title: t("form.toast.error"), description: t("form.toast.titleRequired"), variant: "destructive" });
      return;
    }
    if (!shortDesc.trim()) {
      toast({ title: t("form.toast.error"), description: t("form.toast.shortDescRequired"), variant: "destructive" });
      return;
    }
    if (!content.trim()) {
      toast({ title: t("form.toast.error"), description: t("form.toast.contentRequired"), variant: "destructive" });
      return;
    }
    if (!fiatGoal || parseFloat(fiatGoal) <= 0) {
      toast({ title: t("form.toast.error"), description: t("form.toast.goalPositive"), variant: "destructive" });
      return;
    }
    if (parseFloat(fiatGoal) > maxAllowedAmount) {
      toast({ title: t("form.toast.error"), description: t("form.toast.goalExceeds", { max: maxAllowedAmount, currency }), variant: "destructive" });
      return;
    }
    if (!wallet) {
      toast({ title: t("form.toast.error"), description: t("form.toast.selectWallet"), variant: "destructive" });
      return;
    }
    if (!responsibilityAcknowledged) {
      toast({ title: t("form.toast.error"), description: t("form.toast.mustAcknowledge"), variant: "destructive" });
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

      // Add what_type if selected
      if (whatType) {
        tags.push(["what_type", whatType]);
      }

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
        throw new Error(publishError.message || t("form.err.publishFailed"));
      }

      const successCount = publishData?.publishedTo || 0;
      console.log(`✅ Project published to ${successCount} relays, event: ${signedEvent.id}`);

      // Immediately upsert into server SQLite — project visible without waiting for relay propagation
      try {
        await fetch(`${API_URL}/api/lanacrowd/projects/upsert`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            project: {
              id: dTag,
              eventId: signedEvent.id,
              pubkey: session.nostrHexId,
              ownerPubkey: session.nostrHexId,
              title: title.trim(),
              shortDesc: shortDesc.trim(),
              content: content.trim(),
              fiatGoal: parseFloat(fiatGoal),
              currency,
              wallet,
              responsibilityStatement: responsibilityStatement.trim(),
              projectType,
              whatType: whatType || null,
              status,
              coverImage: finalCoverUrl || null,
              galleryImages: uploadedGalleryUrls,
              videos: videoUrls.filter(u => u.trim()),
              files: fileUrls.filter(u => u.trim()),
              participants: [],
              nostrCreatedAt: signedEvent.created_at,
            }
          }),
        });
        console.log('✅ Project upserted to server SQLite');
      } catch (upsertErr) {
        // Non-fatal: background indexer will pick it up
        console.warn('⚠️ Server upsert failed (will be indexed later):', upsertErr);
      }

      toast({
        title: mode === "create" ? t("form.toast.projectCreated") : t("form.toast.projectUpdated"),
        description: `${t("form.toast.publishedTo")} ${successCount} ${t(successCount !== 1 ? "form.toast.relayMany" : "form.toast.relayOne")}`,
      });

      onSubmitSuccess();
    } catch (error) {
      console.error("Error publishing project:", error);
      toast({
        title: t("form.toast.error"),
        description: error instanceof Error ? error.message : t("form.toast.publishFailed"),
        variant: "destructive",
      });
    } finally {
      setPublishing(false);
      setUploading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Project Type — first because funding limits depend on it */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t("form.projectTypeTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Label htmlFor="projectType">{t("form.typeLabel")}</Label>
          <Select value={projectType} onValueChange={setProjectType}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {enabledProjectTypes.map((pt) => (
                <SelectItem key={pt.value} value={pt.value}>
                  {t(`form.projectType.${pt.value}` as Parameters<typeof t>[0])}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {t("form.maxFundingFor", { type: t(`form.projectType.${projectType}` as Parameters<typeof t>[0]), max: maxAllowedAmount, currency })}
          </p>
        </CardContent>
      </Card>

      {/* Funding */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t("form.fundingTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="fiatGoal">{t("form.fundingGoalLabel")}</Label>
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
                {t("form.maximum", { max: maxAllowedAmount, currency })}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="currency">{t("form.currencyLabel")}</Label>
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
              {t("form.projectWalletLabel")}
            </Label>
            <Select value={wallet} onValueChange={setWallet}>
              <SelectTrigger>
                <SelectValue placeholder={walletsLoading ? t("form.loadingWallets") : t("form.selectWallet")} />
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

      {/* Basic Info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t("form.projectDetailsTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="title">{t("form.titleLabel")}</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("form.titlePlaceholder")}
              maxLength={100}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="shortDesc">{t("form.shortDescLabel")}</Label>
            <Input
              id="shortDesc"
              value={shortDesc}
              onChange={(e) => setShortDesc(e.target.value)}
              placeholder={t("form.shortDescPlaceholder")}
              maxLength={200}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="content">{t("form.contentLabel")}</Label>
            <Textarea
              id="content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={t("form.contentPlaceholder")}
              rows={10}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="whatType">{t("form.whatTypeLabel")}</Label>
            <Select value={whatType} onValueChange={setWhatType}>
              <SelectTrigger>
                <SelectValue placeholder={t("form.whatTypePlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {WHAT_TYPES.map((wt) => (
                  <SelectItem key={wt.value} value={wt.value}>
                    {t(`form.whatType.${wt.value}` as Parameters<typeof t>[0])}
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
            {t("form.coverImageTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {(coverPreview || existingCoverUrl) ? (
            <div className="relative">
              <img
                src={coverPreview || existingCoverUrl}
                alt={t("form.coverPreviewAlt")}
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
              <span className="text-sm text-muted-foreground">{t("form.coverUploadHint")}</span>
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
          <CardTitle className="text-lg">{t("form.galleryTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            {existingGalleryUrls.map((url, index) => (
              <div key={`existing-${index}`} className="relative">
                <img
                  src={url}
                  alt={t("form.galleryAlt", { index: index + 1 })}
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
                  alt={t("form.galleryNewAlt", { index: index + 1 })}
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
            {t("form.addGalleryImages")}
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
            {t("form.videosTitle")}
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
            {t("form.addVideoUrl")}
          </Button>
        </CardContent>
      </Card>

      {/* Documents */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <FileText className="h-5 w-5" />
            {t("form.documentsTitle")}
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
            {t("form.addDocumentUrl")}
          </Button>
        </CardContent>
      </Card>

      {/* Status & Responsibility */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t("form.statusRespTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label>{t("form.projectStatusLabel")}</Label>
              <p className="text-sm text-muted-foreground">
                {status === "draft" ? t("form.statusDraftHint") : t("form.statusActiveHint")}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">{t("form.statusDraft")}</span>
              <Switch
                checked={status === "active"}
                onCheckedChange={(checked) => setStatus(checked ? "active" : "draft")}
                disabled={hasDonations}
              />
              <span className="text-sm text-muted-foreground">{t("form.statusActive")}</span>
            </div>
          </div>
          {hasDonations && (
            <p className="text-sm text-amber-600">
              {t("form.hasDonationsWarning")}
            </p>
          )}

          <div className="space-y-2">
            <Label htmlFor="responsibility">{t("form.responsibilityLabel")}</Label>
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
              {t("form.acknowledgeLabel")}
            </label>
          </div>
        </CardContent>
      </Card>

      {/* Submit */}
      <Button type="submit" className="w-full" disabled={publishing || uploading}>
        {(publishing || uploading) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {uploading
          ? t("form.uploadingImages")
          : publishing
          ? t("form.publishing")
          : mode === "create"
          ? t("form.createProject")
          : t("form.updateProject")}
      </Button>
    </form>
  );
}
