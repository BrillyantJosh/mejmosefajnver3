import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, LogIn, Share2, Copy, Check, ArrowLeft } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import logoImage from "@/assets/lana-logo.png";
import { toast } from "sonner";
import { Toaster as Sonner } from "@/components/ui/sonner";

interface WhatsUpItem {
  id: string;
  title: string;
  body: string | null;
  youtube_url: string | null;
  created_at: string;
}

function extractYouTubeId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/v\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

export default function PublicVideo() {
  const { id: rawId } = useParams<{ id: string }>();
  // Extract just the 32-char hex ID in case extra text was pasted into the URL
  const id = rawId?.match(/^[a-f0-9]{32}/i)?.[0] || rawId;
  const [item, setItem] = useState<WhatsUpItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [appName, setAppName] = useState("Lana");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const [itemRes, settingsRes] = await Promise.all([
          supabase
            .from("whats_up")
            .select("id,title,body,youtube_url,created_at")
            .eq("id", id)
            .eq("published", 1)
            .single(),
          supabase
            .from("app_settings")
            .select("value")
            .eq("key", "app_name")
            .single(),
        ]);

        if (itemRes.error) throw itemRes.error;
        setItem(itemRes.data);

        if (settingsRes.data?.value) {
          setAppName(settingsRes.data.value);
        }
      } catch (err) {
        console.error("Failed to load video:", err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id]);

  const formatTime = (dateStr: string) => {
    try {
      return formatDistanceToNow(new Date(dateStr + "Z"), { addSuffix: true });
    } catch {
      return "";
    }
  };

  // Always use clean URL (not window.location.href which might have extra text)
  const shareUrl = `${window.location.origin}/video/${id}`;

  const handleShare = async () => {
    if (!item) return;

    if (navigator.share) {
      try {
        await navigator.share({ title: item.title, text: item.body || item.title, url: shareUrl });
      } catch {
        // User cancelled or share failed - ignore
      }
    } else {
      await handleCopy();
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      toast.success("Link copied!");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Failed to copy link");
    }
  };

  const ytId = item?.youtube_url ? extractYouTubeId(item.youtube_url) : null;

  return (
    <div className="min-h-screen bg-background">
      <Sonner />

      {/* Header */}
      <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 pt-[env(safe-area-inset-top)]">
        <div className="container flex h-16 items-center justify-between px-4 max-w-4xl mx-auto">
          <Link to="/public" className="flex items-center gap-3">
            <img src={logoImage} alt="Lana Logo" className="h-10 w-10 object-contain" />
            <span className="text-xl font-bold bg-gradient-to-r from-lana-blue-deep via-lana-mid to-lana-orange-vibrant bg-clip-text text-transparent">
              {appName}
            </span>
          </Link>
          <Link to="/login">
            <Button className="gap-2">
              <LogIn className="h-4 w-4" />
              Log In
            </Button>
          </Link>
        </div>
      </header>

      {/* Main content */}
      <main className="container px-4 py-6 max-w-4xl mx-auto">
        <Link
          to="/public"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to news
        </Link>

        {loading && (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        )}

        {!loading && !item && (
          <div className="text-center py-16">
            <p className="text-muted-foreground text-lg">Video not found or no longer available.</p>
          </div>
        )}

        {!loading && item && (
          <Card className="overflow-hidden">
            {ytId && (
              <div className="relative w-full" style={{ paddingBottom: "56.25%" }}>
                <iframe
                  className="absolute top-0 left-0 w-full h-full"
                  src={`https://www.youtube.com/embed/${ytId}`}
                  title={item.title}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
            )}
            <CardContent className={ytId ? "pt-4" : "pt-6"}>
              <h1 className="text-2xl font-bold">{item.title}</h1>
              {item.body && (
                <p className="text-sm text-muted-foreground mt-3 whitespace-pre-wrap">
                  {item.body}
                </p>
              )}
              <div className="flex items-center justify-between mt-4 pt-4 border-t">
                <p className="text-xs text-muted-foreground">
                  {formatTime(item.created_at)}
                </p>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" className="gap-2" onClick={handleShare}>
                    <Share2 className="h-4 w-4" />
                    Share
                  </Button>
                  <Button variant="ghost" size="sm" className="gap-2" onClick={handleCopy}>
                    {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                    {copied ? "Copied!" : "Copy link"}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
