import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Sparkles, HelpCircle, PlayCircle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface WhatsUpItem {
  id: string;
  title: string;
  body: string | null;
  youtube_url: string | null;
  created_at: string;
}

interface FaqItem {
  id: string;
  title: string;
  youtube_url: string | null;
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
  const [faqItems, setFaqItems] = useState<FaqItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [newsRes, faqRes] = await Promise.all([
          supabase
            .from("whats_up")
            .select("id,title,body,youtube_url,created_at")
            .eq("published", 1)
            .order("created_at", { ascending: false })
            .limit(20),
          supabase
            .from("faq")
            .select("id,title,youtube_url")
            .eq("published", 1)
            .order("display_order", { ascending: true }),
        ]);

        if (newsRes.error) throw newsRes.error;
        if (faqRes.error) throw faqRes.error;
        setItems(newsRes.data || []);
        setFaqItems(faqRes.data || []);
      } catch (err) {
        console.error("Failed to load:", err);
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
    <div className="max-w-6xl mx-auto">
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

      {!loading && (
        <div className="flex flex-col lg:flex-row gap-8">
          {/* News feed — left */}
          <div className="flex-1 min-w-0">
            {items.length === 0 ? (
              <div className="text-center py-16">
                <p className="text-muted-foreground text-lg">No news yet. Stay tuned!</p>
              </div>
            ) : (
              <div className="space-y-6">
                {items.map((item) => {
                  const ytId = item.youtube_url ? extractYouTubeId(item.youtube_url) : null;
                  return (
                    <Card key={item.id} className="overflow-hidden">
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
            )}
          </div>

          {/* FAQ sidebar — right */}
          {faqItems.length > 0 && (
            <div className="w-full lg:w-72 flex-shrink-0">
              <Card className="sticky top-20">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <HelpCircle className="h-5 w-5 text-violet-500" />
                    FAQ
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="space-y-1">
                    {faqItems.map((faq) => (
                      <Link
                        key={faq.id}
                        to={`/faq/${faq.id}`}
                        className="flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm hover:bg-secondary/50 transition-colors group"
                      >
                        <PlayCircle className="h-4 w-4 text-red-500 flex-shrink-0 group-hover:scale-110 transition-transform" />
                        <span className="line-clamp-2">{faq.title}</span>
                      </Link>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
