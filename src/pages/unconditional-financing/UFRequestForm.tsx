import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Loader2,
  Plus,
  X,
  ImagePlus,
  Wallet,
  HeartHandshake,
  Leaf,
  Globe,
  Info,
  AlertTriangle,
  Link2,
  CheckCircle2,
  type LucideIcon,
} from "lucide-react";
import { finalizeEvent } from "nostr-tools";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useNostrWallets } from "@/hooks/useNostrWallets";
import { useLang } from "@/i18n/I18nContext";
import {
  UF_API,
  UF_REQUEST_KIND,
  ufTypeLabel,
  type UfRequestType,
} from "@/hooks/useUFData";

const API_URL = import.meta.env.VITE_API_URL ?? "";

const CURRENCIES = ["EUR", "USD", "GBP"];

/** Minimal shape of the user's own crowdfunding projects (offered as refs). */
interface MyCrowdProject {
  id: string;
  pubkey: string;
  title: string;
}

interface UFRequestFormProps {
  onSuccess: () => void;
}

export default function UFRequestForm({ onSuccess }: UFRequestFormProps) {
  const sl = useLang() === "sl";
  const { session } = useAuth();
  const { wallets, isLoading: walletsLoading } = useNostrWallets();

  // Recipient always receives on their Main Wallet (canonical lookup).
  const mainWallet =
    wallets.find((w) => w.walletType === "Main Wallet") ||
    wallets.find((w) => w.walletType === "Wallet");
  const walletFrozen = !!mainWallet?.freezeStatus;

  // ── Form state ──
  const [requestType, setRequestType] = useState<UfRequestType>("personal_hardship");
  const [title, setTitle] = useState("");
  const [shortDesc, setShortDesc] = useState("");
  const [content, setContent] = useState("");
  const [fiatGoal, setFiatGoal] = useState("");
  const [currency, setCurrency] = useState("EUR");

  // Cover image
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState("");

  // Gallery images
  const [galleryFiles, setGalleryFiles] = useState<File[]>([]);
  const [galleryPreviews, setGalleryPreviews] = useState<string[]>([]);

  // Crowdfunding references (required for wellbeing_project)
  const [myProjects, setMyProjects] = useState<MyCrowdProject[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [selectedProjectRefs, setSelectedProjectRefs] = useState<string[]>([]);
  const [externalRefs, setExternalRefs] = useState<string[]>([]);
  const [externalRefInput, setExternalRefInput] = useState("");

  // Status
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);

  const allRefs =
    requestType === "wellbeing_project"
      ? [...selectedProjectRefs, ...externalRefs]
      : [];

  const typeOptions: { value: UfRequestType; icon: LucideIcon; desc: string }[] = [
    {
      value: "personal_hardship",
      icon: HeartHandshake,
      desc: sl
        ? "Premostitev težke življenjske ali finančne situacije."
        : "Bridge a difficult life or financial situation.",
    },
    {
      value: "lifestyle_transition",
      icon: Leaf,
      desc: sl
        ? "Konkreten korak k bolj naravnemu, samooskrbnemu življenju."
        : "A concrete step toward a more natural, self-sufficient life.",
    },
    {
      value: "wellbeing_project",
      icon: Globe,
      desc: sl
        ? "Projekt, izdelek ali storitev za skupno dobro; zahteva predhodni crowdfunding projekt."
        : "A project, product, or service serving the common good; requires a prior crowdfunding project.",
    },
  ];

  // Fetch the user's own crowdfunding projects when the wellbeing type is chosen.
  useEffect(() => {
    if (requestType !== "wellbeing_project" || !session?.nostrHexId) return;
    let alive = true;
    setProjectsLoading(true);
    fetch(`${API_URL}/api/lanacrowd/my-projects/${encodeURIComponent(session.nostrHexId)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => {
        if (alive) setMyProjects(d.projects || []);
      })
      .catch(() => {})
      .finally(() => alive && setProjectsLoading(false));
    return () => {
      alive = false;
    };
  }, [requestType, session?.nostrHexId]);

  // ── Crowdfunding refs handling ──

  const toggleProjectRef = (ref: string) => {
    setSelectedProjectRefs((prev) =>
      prev.includes(ref) ? prev.filter((r) => r !== ref) : [...prev, ref]
    );
  };

  const addExternalRef = () => {
    const url = externalRefInput.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) {
      toast.error(sl ? "Vnesi veljaven URL (http/https)" : "Enter a valid URL (http/https)");
      return;
    }
    if (!externalRefs.includes(url)) {
      setExternalRefs((prev) => [...prev, url]);
    }
    setExternalRefInput("");
  };

  const removeExternalRef = (url: string) => {
    setExternalRefs((prev) => prev.filter((r) => r !== url));
  };

  // ── Image handling ──

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
      const path = `financing/${session.nostrHexId}/${Date.now()}-${Math.random()
        .toString(36)
        .substring(7)}.jpg`;

      const formData = new FormData();
      formData.append("path", path);
      formData.append("file", resizedBlob, path);

      const response = await fetch(`${API_URL}/api/storage/project-images/upload`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error(sl ? "Nalaganje slike ni uspelo" : "Image upload failed");
      }

      const result = await response.json();
      return result.data?.publicUrl || `${API_URL}/api/storage/project-images/${path}`;
    } catch (error) {
      console.error("Error uploading image:", error);
      toast.error(
        error instanceof Error
          ? error.message
          : sl
          ? "Nalaganje slike ni uspelo"
          : "Image upload failed"
      );
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
  };

  const handleGallerySelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    setGalleryFiles((prev) => [...prev, ...files]);
    const newPreviews = files.map((f) => URL.createObjectURL(f));
    setGalleryPreviews((prev) => [...prev, ...newPreviews]);
  };

  const removeGalleryImage = (index: number) => {
    if (galleryPreviews[index]?.startsWith("blob:")) {
      URL.revokeObjectURL(galleryPreviews[index]);
    }
    setGalleryFiles((prev) => prev.filter((_, i) => i !== index));
    setGalleryPreviews((prev) => prev.filter((_, i) => i !== index));
  };

  // ── Hex helper ──
  const hexToBytes = (hex: string): Uint8Array => {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
      bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
    }
    return bytes;
  };

  // ── Submit ──

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!session?.nostrHexId || !session?.nostrPrivateKey) {
      toast.error(sl ? "Za objavo se moraš prijaviti" : "You must be logged in to publish");
      return;
    }
    if (!title.trim()) {
      toast.error(sl ? "Naslov je obvezen" : "Title is required");
      return;
    }
    if (!shortDesc.trim()) {
      toast.error(sl ? "Kratek povzetek je obvezen" : "Short summary is required");
      return;
    }
    if (!content.trim()) {
      toast.error(sl ? "Zgodba je obvezna" : "Story is required");
      return;
    }
    const goalNum = parseFloat(fiatGoal);
    if (!fiatGoal || isNaN(goalNum) || goalNum <= 0) {
      toast.error(
        sl ? "Želeni znesek mora biti večji od 0" : "The desired amount must be greater than 0"
      );
      return;
    }
    if (requestType === "wellbeing_project" && allRefs.length === 0) {
      toast.error(
        sl
          ? "Projekt za skupno dobro zahteva vsaj eno referenco na predhodni crowdfunding projekt"
          : "A well-being project requires at least one prior crowdfunding reference"
      );
      return;
    }
    if (!mainWallet) {
      toast.error(
        sl
          ? "Za prejem financiranja potrebuješ glavno denarnico (Main Wallet)"
          : "You need a Main Wallet to receive financing"
      );
      return;
    }
    if (walletFrozen) {
      toast.error(
        sl
          ? "Tvoja glavna denarnica je zamrznjena in ne more pravilno prejemati financiranja"
          : "Your Main Wallet is frozen and cannot properly receive financing"
      );
      return;
    }

    setIsSubmitting(true);
    setUploading(true);

    try {
      // Upload images
      let finalCoverUrl = "";
      if (coverFile) {
        const url = await uploadImage(coverFile);
        if (url) finalCoverUrl = url;
      }

      const uploadedGalleryUrls: string[] = [];
      for (const file of galleryFiles) {
        const url = await uploadImage(file);
        if (url) uploadedGalleryUrls.push(url);
      }

      setUploading(false);

      // Build KIND 31240 tags (exact schema — parsed by the server indexer)
      const dTag = `uf:${crypto.randomUUID()}`;
      const pubTs = Math.floor(Date.now() / 1000);
      const fundingOpensAt = pubTs + 8 * 86400;

      const tags: string[][] = [
        ["d", dTag],
        ["service", "unconditional-financing"],
        ["title", title.trim()],
        ["summary", shortDesc.trim()],
        ["request_type", requestType],
        ["fiat_goal", String(goalNum)],
        ["currency", currency],
        ["wallet", mainWallet.walletId],
        ["published_at", String(pubTs)],
        ["funding_opens_at", String(fundingOpensAt)],
        ["status", "active"],
      ];

      if (finalCoverUrl) {
        tags.push(["img", finalCoverUrl, "cover"]);
      }
      uploadedGalleryUrls.forEach((url) => {
        tags.push(["img", url, "gallery"]);
      });
      allRefs.forEach((ref) => {
        tags.push(["crowdfunding", ref]);
      });
      tags.push(["client", "mejmosefajn"]);

      // Sign event
      const signedEvent = finalizeEvent(
        {
          kind: UF_REQUEST_KIND,
          created_at: pubTs,
          tags,
          content: content.trim(),
        },
        hexToBytes(session.nostrPrivateKey)
      );

      // Publish via server — a 0-relay publish is a FAILURE, not a success:
      // relays are the source of truth, so the form must not proceed on
      // {success:false, publishedTo:0}.
      const { data: pubData, error: publishError } = await supabase.functions.invoke(
        "publish-dm-event",
        { body: { event: signedEvent } }
      );

      if (publishError || pubData?.success !== true || (pubData?.publishedTo ?? 0) < 1) {
        throw new Error(
          publishError?.message ||
            (sl ? "Objava na relaye ni uspela — poskusi znova" : "Publish to relays failed — try again")
        );
      }

      // Immediately upsert into server SQLite. The server verifies the SIGNED
      // EVENT and derives all fields from it (hardened contract). It also
      // enforces the Lana8Wonder 4-Splits eligibility for new requests — a 403
      // here means the request is on relays but will not be listed by the app.
      try {
        const res = await fetch(`${UF_API}/requests/upsert`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ event: signedEvent }),
        });
        if (res.status === 403) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || (sl ? "Zahtevek ni bil sprejet" : "Request was not accepted"));
        }
      } catch (upsertErr) {
        if (upsertErr instanceof Error && upsertErr.message && !upsertErr.message.includes("fetch")) {
          throw upsertErr;
        }
        console.warn("UF request upsert failed (indexer will pick it up):", upsertErr);
      }

      toast.success(
        sl
          ? "Zahtevek je objavljen. 8-dnevno obdobje zorenja se je začelo — komentarji so odprti, financiranje se odpre po zorenju."
          : "Request published. The 8-day maturing period starts now — comments are open, funding opens after maturing."
      );

      onSuccess();
    } catch (error) {
      console.error("Error publishing UF request:", error);
      toast.error(
        error instanceof Error
          ? error.message
          : sl
          ? "Objava zahtevka ni uspela"
          : "Failed to publish the request"
      );
    } finally {
      setIsSubmitting(false);
      setUploading(false);
    }
  };

  const submitBlocked = walletsLoading || !mainWallet || walletFrozen;

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Maturing-period notice */}
      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          {sl
            ? "Po objavi zahtevek najprej 8 dni zori — komentarji so odprti, financiranje pa še zaprto. Po 8 dneh se financiranje odpre."
            : "After publishing, the request matures for 8 days — comments are open while funding stays closed. Funding opens after 8 days."}
        </AlertDescription>
      </Alert>

      {/* Request type */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            {sl ? "Vrsta financiranja" : "Request type"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3" role="radiogroup">
          {typeOptions.map((opt) => {
            const Icon = opt.icon;
            const selected = requestType === opt.value;
            return (
              <div
                key={opt.value}
                role="radio"
                aria-checked={selected}
                tabIndex={0}
                onClick={() => setRequestType(opt.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setRequestType(opt.value);
                  }
                }}
                className={`flex items-start gap-3 rounded-lg border p-4 cursor-pointer transition-colors ${
                  selected
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-muted-foreground/50"
                }`}
              >
                <Icon
                  className={`h-5 w-5 mt-0.5 shrink-0 ${
                    selected ? "text-primary" : "text-muted-foreground"
                  }`}
                />
                <div className="flex-1">
                  <p className="font-medium">{ufTypeLabel(opt.value, sl)}</p>
                  <p className="text-sm text-muted-foreground">{opt.desc}</p>
                </div>
                {selected && <CheckCircle2 className="h-5 w-5 text-primary shrink-0" />}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Presentation */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            {sl ? "Predstavitev" : "Presentation"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="title">{sl ? "Naslov" : "Title"}</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={sl ? "Naslov financiranja" : "Title of the financing"}
              maxLength={100}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="shortDesc">{sl ? "Kratek povzetek" : "Short summary"}</Label>
            <Input
              id="shortDesc"
              value={shortDesc}
              onChange={(e) => setShortDesc(e.target.value)}
              placeholder={
                sl ? "En stavek o namenu financiranja" : "One sentence about the purpose"
              }
              maxLength={200}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="content">{sl ? "Zgodba" : "Story"}</Label>
            <Textarea
              id="content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={
                sl
                  ? "Osebna zgodba ali opis projekta — komu pomaga, zakaj potrebuješ sredstva, za kaj bodo uporabljena ..."
                  : "Personal story or project description — who it helps, why you need the funds, what they will be used for..."
              }
              rows={8}
            />
          </div>
        </CardContent>
      </Card>

      {/* Amount */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            {sl ? "Želeni znesek" : "Desired amount"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="fiatGoal">{sl ? "Znesek" : "Amount"}</Label>
              <Input
                id="fiatGoal"
                type="number"
                step="0.01"
                min="0.01"
                value={fiatGoal}
                onChange={(e) => setFiatGoal(e.target.value)}
                placeholder="1000.00"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="currency">{sl ? "Valuta" : "Currency"}</Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            {sl
              ? "Financiranje se vodi v izbrani FIAT valuti; vsa dejanska plačila se izvedejo v LANI po menjalnem razmerju ob transakciji."
              : "The financing is tracked in the chosen FIAT currency; all actual payments are executed in LANA at the exchange rate at the moment of each transaction."}
          </p>
        </CardContent>
      </Card>

      {/* Cover image */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <ImagePlus className="h-5 w-5" />
            {sl ? "Naslovna slika" : "Cover image"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {coverPreview ? (
            <div className="relative">
              <img
                src={coverPreview}
                alt={sl ? "Predogled naslovne slike" : "Cover preview"}
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
              <span className="text-sm text-muted-foreground">
                {sl ? "Klikni za nalaganje naslovne slike" : "Click to upload a cover image"}
              </span>
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

      {/* Gallery images */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{sl ? "Galerija" : "Gallery"}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {galleryPreviews.length > 0 && (
            <div className="grid grid-cols-3 gap-3">
              {galleryPreviews.map((preview, index) => (
                <div key={index} className="relative">
                  <img
                    src={preview}
                    alt={
                      sl ? `Slika galerije ${index + 1}` : `Gallery image ${index + 1}`
                    }
                    className="w-full h-24 object-cover rounded-lg"
                  />
                  <Button
                    type="button"
                    variant="destructive"
                    size="icon"
                    className="absolute top-1 right-1 h-6 w-6"
                    onClick={() => removeGalleryImage(index)}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          )}
          <label className="flex items-center gap-2 cursor-pointer text-sm text-primary hover:underline">
            <Plus className="h-4 w-4" />
            {sl ? "Dodaj slike v galerijo" : "Add gallery images"}
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

      {/* Prior crowdfunding references — required for well-being projects */}
      {requestType === "wellbeing_project" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Link2 className="h-5 w-5" />
              {sl ? "Predhodni crowdfunding" : "Prior crowdfunding"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {sl
                ? "Projekt za skupno dobro zahteva vsaj en predhodni crowdfunding projekt, povezan z isto idejo ali njenim razvojem."
                : "A well-being project requires at least one prior crowdfunding project connected to the same idea or its development."}
            </p>

            {projectsLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {sl ? "Nalaganje tvojih projektov ..." : "Loading your projects..."}
              </div>
            ) : myProjects.length > 0 ? (
              <div className="space-y-2">
                <Label>
                  {sl ? "Tvoji crowdfunding projekti" : "Your crowdfunding projects"}
                </Label>
                <div className="flex flex-wrap gap-2">
                  {myProjects.map((p) => {
                    const ref = `31234:${p.pubkey}:${p.id}`;
                    const selected = selectedProjectRefs.includes(ref);
                    return (
                      <Button
                        key={p.id}
                        type="button"
                        size="sm"
                        variant={selected ? "default" : "outline"}
                        className="rounded-full"
                        onClick={() => toggleProjectRef(ref)}
                      >
                        {selected && <CheckCircle2 className="h-3.5 w-3.5 mr-1" />}
                        <span className="max-w-[200px] truncate">{p.title || p.id}</span>
                      </Button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                {sl
                  ? "Nimaš še nobenega crowdfunding projekta."
                  : "You don't have any crowdfunding projects yet."}
              </p>
            )}

            <div className="space-y-2">
              <Label htmlFor="externalRef">
                {sl ? "Ali dodaj zunanjo povezavo" : "Or add an external link"}
              </Label>
              <div className="flex gap-2">
                <Input
                  id="externalRef"
                  value={externalRefInput}
                  onChange={(e) => setExternalRefInput(e.target.value)}
                  placeholder="https://..."
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addExternalRef();
                    }
                  }}
                />
                <Button type="button" variant="outline" size="icon" onClick={addExternalRef}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              {externalRefs.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {externalRefs.map((url) => (
                    <span
                      key={url}
                      className="inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs"
                    >
                      <span className="max-w-[220px] truncate">{url}</span>
                      <button
                        type="button"
                        onClick={() => removeExternalRef(url)}
                        aria-label={sl ? "Odstrani" : "Remove"}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {allRefs.length === 0 && (
              <p className="text-xs text-amber-600">
                {sl
                  ? "Pred objavo izberi ali dodaj vsaj eno referenco."
                  : "Select or add at least one reference before publishing."}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Receiving wallet — read-only, always the Main Wallet */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Wallet className="h-5 w-5" />
            {sl ? "Prejemna denarnica" : "Receiving wallet"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {walletsLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {sl ? "Nalaganje denarnic ..." : "Loading wallets..."}
            </div>
          ) : mainWallet ? (
            <>
              <div className="rounded-lg border bg-muted/40 p-3">
                <p className="font-mono text-sm break-all">{mainWallet.walletId}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {sl
                    ? "Glavna denarnica — sredstva boš prejemal nanjo."
                    : "Main Wallet — you will receive the funds here."}
                </p>
              </div>
              {walletFrozen && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    {sl
                      ? "Tvoja glavna denarnica je zamrznjena in ne more pravilno prejemati financiranja. Objava je onemogočena."
                      : "Your Main Wallet is frozen and cannot properly receive financing. Publishing is disabled."}
                  </AlertDescription>
                </Alert>
              )}
            </>
          ) : (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                {sl
                  ? "Za prejem financiranja potrebuješ glavno denarnico (Main Wallet)."
                  : "You need a Main Wallet to receive financing."}
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Submit */}
      <Button
        type="submit"
        className="w-full"
        disabled={isSubmitting || uploading || submitBlocked}
      >
        {(isSubmitting || uploading) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {uploading
          ? sl
            ? "Nalaganje slik ..."
            : "Uploading images..."
          : isSubmitting
          ? sl
            ? "Objavljanje ..."
            : "Publishing..."
          : sl
          ? "Objavi zahtevek"
          : "Publish request"}
      </Button>
    </form>
  );
}
