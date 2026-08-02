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
  type UfRequest,
  type UfRequestType,
} from "@/hooks/useUFData";
import { useUfSettings } from "@/hooks/useUFSettings";
import { formatDays, formatDaysAfter } from "@/lib/ufSettings";

const API_URL = import.meta.env.VITE_API_URL ?? "";

const CURRENCIES = ["EUR", "USD", "GBP"];

/** Wallet types (KIND 30889) that may receive an Unconditional Financing. */
const RECEIVING_WALLET_TYPES = ["Main Wallet", "Wallet", "Lana.Discount"];

/** Minimal shape of the user's own crowdfunding projects (offered as refs). */
interface MyCrowdProject {
  id: string;
  pubkey: string;
  title: string;
}

interface UFRequestFormProps {
  onSuccess: () => void;
  /**
   * When present the form edits this request instead of creating a new one:
   * the d-tag and the original publication date are kept, so relays and the
   * server treat the result as a new version of the same request.
   */
  existing?: UfRequest | null;
}

export default function UFRequestForm({ onSuccess, existing }: UFRequestFormProps) {
  const isEdit = !!existing;
  // Refining is a maturing-phase freedom; once funding is open the date is fixed.
  const isStillMaturing = !!existing && Math.floor(Date.now() / 1000) < existing.fundingOpensAt;
  const sl = useLang() === "sl";
  const { session } = useAuth();
  const { wallets, isLoading: walletsLoading } = useNostrWallets();
  // Admin-configured module rules (maturing length, per-group caps).
  const { settings: ufSettings } = useUfSettings();

  // The Main Wallet is only the DEFAULT choice now (canonical lookup).
  const mainWallet =
    wallets.find((w) => w.walletType === "Main Wallet") ||
    wallets.find((w) => w.walletType === "Wallet");
  // A new request may receive on ANY of the author's registered wallets
  // (KIND 30889). Frozen ones are left out — financing cannot be properly
  // received on them. On an EDIT the wallet is NOT reconsidered at all: the
  // request keeps the address it was published with, so correcting the text can
  // never silently redirect where contributions arrive.
  const [chosenWalletId, setChosenWalletId] = useState("");
  // Only these types can receive a financing (same trio the wallet page treats
  // as spendable everyday wallets) — LanaPays.Us, Retail, Knights and
  // Lana8Wonder wallets serve other purposes and are not offered.
  const eligibleWallets = wallets.filter((w) =>
    RECEIVING_WALLET_TYPES.includes(w.walletType)
  );
  const selectableWallets = eligibleWallets.filter((w) => !w.freezeStatus);
  const frozenWallets = eligibleWallets.filter((w) => !!w.freezeStatus);
  const chosenWallet =
    selectableWallets.find((w) => w.walletId === chosenWalletId) || mainWallet;

  /** Where the funds arrive: fixed at first publication, never changed by an edit. */
  const receivingWallet = existing ? existing.wallet : chosenWallet?.walletId || "";

  // ── Form state (prefilled from the request being edited) ──
  const [requestType, setRequestType] = useState<UfRequestType>(
    existing?.requestType ?? "personal_hardship"
  );
  const [title, setTitle] = useState(existing?.title ?? "");
  const [shortDesc, setShortDesc] = useState(existing?.shortDesc ?? "");
  const [content, setContent] = useState(existing?.content ?? "");
  const [fiatGoal, setFiatGoal] = useState(existing ? String(existing.fiatGoal) : "");
  const [currency, setCurrency] = useState(existing?.currency ?? "EUR");

  // Cover image — an edit starts with the already-published one; picking a new
  // file replaces it, leaving it alone re-publishes the same URL.
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState(existing?.coverImage ?? "");
  const [keptCoverUrl, setKeptCoverUrl] = useState(existing?.coverImage ?? "");

  // Gallery images
  const [galleryFiles, setGalleryFiles] = useState<File[]>([]);
  const [galleryPreviews, setGalleryPreviews] = useState<string[]>(existing?.galleryImages ?? []);
  const [keptGalleryUrls, setKeptGalleryUrls] = useState<string[]>(existing?.galleryImages ?? []);

  // Crowdfunding references (required for wellbeing_project)
  const [myProjects, setMyProjects] = useState<MyCrowdProject[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [selectedProjectRefs, setSelectedProjectRefs] = useState<string[]>([]);
  const [externalRefs, setExternalRefs] = useState<string[]>(existing?.crowdfundingRefs ?? []);
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

  // Default to the Main Wallet as soon as the wallet list arrives, without
  // overriding a choice the user has already made.
  useEffect(() => {
    if (isEdit || chosenWalletId) return;
    if (mainWallet && !mainWallet.freezeStatus) setChosenWalletId(mainWallet.walletId);
    else if (selectableWallets.length > 0) setChosenWalletId(selectableWallets[0].walletId);
  }, [isEdit, chosenWalletId, mainWallet?.walletId, selectableWallets.length]);

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
    setKeptCoverUrl("");
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
    // Previews render as [...already-published, ...newly picked], so the index
    // decides which of the two underlying lists the removal applies to.
    const keptCount = keptGalleryUrls.length;
    if (index < keptCount) {
      setKeptGalleryUrls((prev) => prev.filter((_, i) => i !== index));
    } else {
      const fileIndex = index - keptCount;
      setGalleryFiles((prev) => prev.filter((_, i) => i !== fileIndex));
    }
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
    // Per-group cap (0 = uncapped). The server enforces this too; checking here
    // keeps the user from paying the publish round-trip just to be rejected.
    const cap = ufSettings.maxAmounts[requestType] || 0;
    if (cap > 0 && goalNum > cap) {
      toast.error(
        sl
          ? `Najvišji znesek za to skupino je ${cap} ${currency}`
          : `The maximum amount for this group is ${cap} ${currency}`
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
    if (!isEdit && !receivingWallet) {
      toast.error(
        sl
          ? "Izberi denarnico, na katero boš prejel financiranje"
          : "Choose the wallet that will receive the financing"
      );
      return;
    }
    if (!isEdit && chosenWallet?.freezeStatus) {
      toast.error(
        sl
          ? "Izbrana denarnica je zamrznjena in ne more pravilno prejemati financiranja"
          : "The selected wallet is frozen and cannot properly receive financing"
      );
      return;
    }

    setIsSubmitting(true);
    setUploading(true);

    try {
      // Upload images. On an edit, already-published images are kept as-is
      // unless the user replaced or removed them.
      let finalCoverUrl = keptCoverUrl;
      if (coverFile) {
        const url = await uploadImage(coverFile);
        if (url) finalCoverUrl = url;
      }

      const uploadedGalleryUrls: string[] = [...keptGalleryUrls];
      for (const file of galleryFiles) {
        const url = await uploadImage(file);
        if (url) uploadedGalleryUrls.push(url);
      }

      setUploading(false);

      // Build KIND 31240 tags (exact schema — parsed by the server indexer)
      const nowTs = Math.floor(Date.now() / 1000);
      // An edit keeps the request's identity (d-tag) and its ORIGINAL publication
      // date; only the event's created_at moves. A new request gets both fresh.
      const dTag = existing ? existing.id : `uf:${crypto.randomUUID()}`;
      const pubTs = existing ? existing.publishedAt : nowTs;
      // The server re-derives this and ignores our value; we publish the same
      // number so the event is self-consistent on relays. Editing during
      // maturing restarts the review period from now.
      const maturingSecs = ufSettings.maturingDays * 86400;
      const fundingOpensAt =
        existing && nowTs < existing.fundingOpensAt
          ? Math.max(existing.fundingOpensAt, nowTs + maturingSecs)
          : existing
            ? existing.fundingOpensAt
            : nowTs + maturingSecs;

      const tags: string[][] = [
        ["d", dTag],
        ["service", "unconditional-financing"],
        ["title", title.trim()],
        ["summary", shortDesc.trim()],
        ["request_type", requestType],
        ["fiat_goal", String(goalNum)],
        ["currency", currency],
        ["wallet", receivingWallet],
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
          // Always NOW: relays keep the newest version of an addressable event,
          // so an edit signed with the original date would not replace it.
          created_at: nowTs,
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

      // Report the date that was actually saved, so the requester knows exactly
      // when funding opens after refining the request.
      const opensLabel = new Date(fundingOpensAt * 1000).toLocaleString(sl ? "sl-SI" : "en-GB", {
        dateStyle: "long",
        timeStyle: "short",
      });
      const restarted = !!existing && fundingOpensAt > existing.fundingOpensAt;

      toast.success(
        isEdit
          ? restarted
            ? sl
              ? `Zahtevek je posodobljen. Zorenje se je začelo znova — financiranje se odpre ${opensLabel}.`
              : `Request updated. Maturing has restarted — funding opens ${opensLabel}.`
            : sl
              ? "Zahtevek je posodobljen."
              : "Request updated."
          : sl
            ? `Zahtevek je objavljen. Obdobje zorenja se je začelo — komentarji so odprti, financiranje se odpre ${opensLabel}.`
            : `Request published. The maturing period starts now — comments are open, funding opens ${opensLabel}.`
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

  // Publishing needs a usable Main Wallet; editing an existing request does not
  // — the address is already fixed, and the author must always be able to
  // correct their own text.
  const submitBlocked = isEdit
    ? false
    : walletsLoading || !receivingWallet || !!chosenWallet?.freezeStatus;

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Maturing-period notice */}
      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          {isEdit
            ? isStillMaturing
              ? sl
                ? `Zahtevek še zori, zato ga lahko dodelaš. Ko shraniš, se zorenje začne znova: financiranje se odpre ${formatDaysAfter(ufSettings.maturingDays, true)} od shranitve, da skupnost vidi dopolnjeno različico.`
                : `The request is still maturing, so you can refine it. When you save, maturing restarts: funding opens ${formatDays(ufSettings.maturingDays, false)} from the moment you save, so the community sees the updated version.`
              : sl
                ? "Financiranje tega zahtevka je že odprto. Popravki besedila ne premaknejo datuma odprtja."
                : "Funding for this request is already open. Editing the text does not move the opening date."
            : ufSettings.maturingDays === 0
              ? sl
                ? "Financiranje tega zahtevka se odpre takoj po objavi."
                : "Funding for this request opens immediately after publishing."
              : sl
                ? `Po objavi zahtevek najprej ${formatDays(ufSettings.maturingDays, true)} zori — komentarji so odprti, financiranje pa še zaprto. Po ${formatDaysAfter(ufSettings.maturingDays, true)} se financiranje odpre.`
                : `After publishing, the request matures for ${formatDays(ufSettings.maturingDays, false)} — comments are open while funding stays closed. Funding opens after ${formatDays(ufSettings.maturingDays, false)}.`}
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
                  {ufSettings.maxAmounts[opt.value] > 0 && (
                    <p className="mt-1 text-xs font-medium text-primary">
                      {sl ? "Do " : "Up to "}
                      {ufSettings.maxAmounts[opt.value]} {currency}
                    </p>
                  )}
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
                max={ufSettings.maxAmounts[requestType] || undefined}
                value={fiatGoal}
                onChange={(e) => setFiatGoal(e.target.value)}
                placeholder="1000.00"
              />
              {ufSettings.maxAmounts[requestType] > 0 && (
                <p
                  className={`text-xs ${
                    parseFloat(fiatGoal) > ufSettings.maxAmounts[requestType]
                      ? "text-destructive font-medium"
                      : "text-muted-foreground"
                  }`}
                >
                  {sl
                    ? `Najvišji znesek za to skupino: ${ufSettings.maxAmounts[requestType]} ${currency}`
                    : `Maximum for this group: ${ufSettings.maxAmounts[requestType]} ${currency}`}
                </p>
              )}
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

      {/* Receiving wallet — any of the author's registered (KIND 30889) wallets */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Wallet className="h-5 w-5" />
            {sl ? "Prejemna denarnica" : "Receiving wallet"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {isEdit ? (
            // An existing request keeps the address it was published with.
            <div className="rounded-lg border bg-muted/40 p-3">
              <p className="font-mono text-sm break-all">{receivingWallet}</p>
              <p className="text-xs text-muted-foreground mt-1">
                {sl
                  ? "Denarnica tega zahtevka ostane nespremenjena — urejanje besedila je ne premakne."
                  : "This request keeps its receiving wallet — editing the text does not change it."}
              </p>
            </div>
          ) : walletsLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {sl ? "Nalaganje denarnic ..." : "Loading wallets..."}
            </div>
          ) : selectableWallets.length > 0 ? (
            <>
              <div className="space-y-2">
                <Label htmlFor="receivingWallet">
                  {sl ? "Izberi denarnico" : "Choose a wallet"}
                </Label>
                <Select value={chosenWallet?.walletId || ""} onValueChange={setChosenWalletId}>
                  <SelectTrigger id="receivingWallet">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {selectableWallets.map((w) => (
                      <SelectItem key={w.walletId} value={w.walletId}>
                        <span className="flex flex-col items-start">
                          <span className="text-sm">
                            {w.walletType}
                            {w.walletId === mainWallet?.walletId
                              ? sl ? " · privzeta" : " · default"
                              : ""}
                            {w.note ? ` — ${w.note}` : ""}
                          </span>
                          <span className="font-mono text-xs text-muted-foreground">
                            {w.walletId}
                          </span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="rounded-lg border bg-muted/40 p-3">
                <p className="font-mono text-sm break-all">{receivingWallet}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {sl
                    ? "Prejeta sredstva bodo prišla na to denarnico. Po odprtju financiranja je ni več mogoče zamenjati."
                    : "Contributions will arrive here. Once funding opens, this can no longer be changed."}
                </p>
              </div>

              {frozenWallets.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {sl
                    ? `Zamrznjene denarnice niso na voljo (${frozenWallets.length}) — na njih financiranja ni mogoče pravilno prejeti.`
                    : `Frozen wallets are not offered (${frozenWallets.length}) — financing cannot be properly received on them.`}
                </p>
              )}
            </>
          ) : (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                {eligibleWallets.length > 0
                  ? sl
                    ? "Vse tvoje denarnice, primerne za prejem, so zamrznjene. Objava je onemogočena."
                    : "Every wallet that could receive the financing is frozen. Publishing is disabled."
                  : sl
                    ? "Za prejem financiranja potrebuješ denarnico vrste Main Wallet, Wallet ali Lana.Discount."
                    : "To receive financing you need a Main Wallet, Wallet or Lana.Discount wallet."}
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
          : isEdit
          ? sl
            ? "Shrani spremembe"
            : "Save changes"
          : sl
          ? "Objavi zahtevek"
          : "Publish request"}
      </Button>
    </form>
  );
}
