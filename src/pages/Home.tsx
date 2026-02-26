import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Sparkles } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

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

export default function Home() {
  const [items, setItems] = useState<WhatsUpItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const { data, error } = await supabase
          .from("whats_up")
          .select("id,title,body,youtube_url,created_at")
          .eq("published", 1)
          .order("created_at", { ascending: false })
          .limit(20);

        if (error) throw error;
        setItems(data || []);
      } catch (err) {
        console.error("Failed to load news:", err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const formatTime = (dateStr: string) => {
    try {
      return formatDistanceToNow(new Date(dateStr + "Z"), { addSuffix: true });
    } catch {
      return "";
    }
  };

  return (
    <div className="max-w-3xl mx-auto">
      {/* Header */}
      <div className="text-center mb-8">
        <h1 className="text-3xl sm:text-4xl font-black bg-gradient-to-r from-violet-500 via-indigo-500 to-blue-500 bg-clip-text text-transparent flex items-center justify-center gap-2">
          <Sparkles className="h-7 w-7 sm:h-8 sm:w-8 text-violet-500" />
          What's up Lana?
          <Sparkles className="h-7 w-7 sm:h-8 sm:w-8 text-violet-500" />
        </h1>
        <p className="text-muted-foreground text-sm mt-2">Latest news & updates</p>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Empty state */}
      {!loading && items.length === 0 && (
        <div className="text-center py-16">
          <p className="text-muted-foreground text-lg">No news yet. Stay tuned!</p>
        </div>
      )}

      {/* News items */}
      <div className="space-y-6">
        {items.map((item) => {
          const ytId = item.youtube_url ? extractYouTubeId(item.youtube_url) : null;

          return (
            <Card key={item.id} className="overflow-hidden">
              {/* YouTube embed */}
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
                <h2 className="text-xl font-bold">{item.title}</h2>
                {item.body && (
                  <p className="text-sm text-muted-foreground mt-2 whitespace-pre-wrap">
                    {item.body}
                  </p>
                )}
                <p className="text-xs text-muted-foreground mt-3">
                  {formatTime(item.created_at)}
                </p>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
