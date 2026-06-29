import { useState, useEffect } from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { PlayCircle, ExternalLink, HelpCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import lana8wonderIcon from "@/assets/lana8wonder-icon.png";

interface FaqItem {
  id: string;
  title: string;
  youtube_url: string | null;
  display_order: number;
  published: number;
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

const lana8wonderVideos = [
  {
    id: "l8w-purchase",
    question: "How to Purchase LanaCoins via Lana8Wonder?",
    youtubeId: "WnrmV2SNMvg",
  },
  {
    id: "l8w-enroll",
    question: "EN: How to Enroll in Lana8Wonder?",
    youtubeId: "ZS10tAuH_4I",
  },
  {
    id: "l8w-what-now",
    question: "I have Lana8Wonder, what now?",
    youtubeId: "6JfBRu69tHs",
  },
];

const videos = [
  {
    id: "consolidate-wallet",
    question: "How to Consolidate Your Wallet?",
    youtubeId: "dWniYXwdWqk",
  },
  {
    id: "registrar",
    question: "How to use Registrar?",
    youtubeId: "kBi4MKcc4qM",
  },
  {
    id: "tax-report",
    question: "How to Get TAX report for Lana to FIAT exchange?",
    youtubeId: "ienYy-ve53E",
  },
  {
    id: "submit-bug",
    question: "How To Submit Bug?",
    youtubeId: "7KLswOwr4i0",
  },
  {
    id: "personalise",
    question: "How to personalise your Lana environment?",
    youtubeId: "An-hUIc8Irs",
  },
  {
    id: "create-events",
    question: "How to create Lana Events?",
    youtubeId: "H30egFg9L9o",
  },
  {
    id: "attend-events",
    question: "How to attend and share Lana Event?",
    youtubeId: "MojnQsCjEnM",
  },
  {
    id: "use-chat",
    question: "How to use Chat?",
    youtubeId: "pDXW3Z6lsPc",
  },
  {
    id: "use-wallets",
    question: "How to use Wallets?",
    youtubeId: "sj-S0eALwYw",
  },
  {
    id: "change-wallet-notes",
    question: "How to change the Wallet notes?",
    youtubeId: "aeBdzkhf5EA",
  },
  {
    id: "edit-profile",
    question: "How to edit My Profile?",
    youtubeId: "GBApPJM-BEE",
  },
  {
    id: "social-media",
    question: "Lana Social Media Works",
    youtubeId: "vZM7ikmlMac",
  },
  {
    id: "work-with-lashes",
    question: "How to Work with Lashes?",
    youtubeId: "OuPgH14L6Z8",
  },
  {
    id: "report-lost-wallet",
    question: "How to Report Lost Wallet?",
    youtubeId: "E9G_mQdXFCY",
  },
];

export default function VideoInstructions() {
  // Admin-managed FAQ entries (from the `faq` table, edited in /admin/faq).
  const [faqItems, setFaqItems] = useState<FaqItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase
          .from("faq")
          .select("id,title,youtube_url,display_order,published")
          .order("display_order", { ascending: true });
        if (!cancelled) setFaqItems((data || []).filter((item: FaqItem) => !!item.published));
      } catch {
        if (!cancelled) setFaqItems([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Video Instructions</h1>
        <p className="text-muted-foreground">
          Click a question to watch the video tutorial
        </p>
      </div>

      {/* Admin FAQ Card — managed in /admin/faq */}
      {faqItems.length > 0 && (
        <Card className="mb-8 border-2 border-violet-500/30 bg-gradient-to-r from-violet-500/5 to-fuchsia-500/5">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-3">
              <HelpCircle className="h-6 w-6 text-violet-500 shrink-0" />
              <span className="text-xl font-bold">FAQ</span>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <Accordion type="single" collapsible className="space-y-2">
              {faqItems.map((faq) => {
                const ytId = faq.youtube_url ? extractYouTubeId(faq.youtube_url) : null;
                return (
                  <AccordionItem key={faq.id} value={faq.id} className="border rounded-lg px-4">
                    <AccordionTrigger className="text-left">
                      <div className="flex items-center gap-3">
                        <PlayCircle className="h-5 w-5 text-red-500 shrink-0" />
                        <span>{faq.title}</span>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent>
                      {ytId ? (
                        <div className="aspect-video rounded-lg overflow-hidden">
                          <iframe
                            src={`https://www.youtube.com/embed/${ytId}`}
                            title={faq.title}
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                            allowFullScreen
                            className="w-full h-full"
                          />
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground py-2">No video available for this FAQ</p>
                      )}
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
            </Accordion>
          </CardContent>
        </Card>
      )}

      {/* Lana8Wonder Card */}
      <Card className="mb-8 border-2 border-amber-500/30 bg-gradient-to-r from-amber-500/5 to-orange-500/5">
        <CardHeader className="pb-3">
          <a
            href="https://www.Lana8Wonder.com"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 hover:opacity-80 transition-opacity"
          >
            <img src={lana8wonderIcon} alt="Lana8Wonder" className="h-10 w-10 rounded-lg" />
            <span className="text-xl font-bold">Lana8Wonder</span>
            <ExternalLink className="h-4 w-4 text-muted-foreground" />
          </a>
        </CardHeader>
        <CardContent className="pt-0">
          <Accordion type="single" collapsible className="space-y-2">
            {lana8wonderVideos.map((video) => (
              <AccordionItem
                key={video.id}
                value={video.id}
                className="border rounded-lg px-4"
              >
                <AccordionTrigger className="text-left">
                  <div className="flex items-center gap-3">
                    <PlayCircle className="h-5 w-5 text-red-500 shrink-0" />
                    <span>{video.question}</span>
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="aspect-video rounded-lg overflow-hidden">
                    <iframe
                      src={`https://www.youtube.com/embed/${video.youtubeId}`}
                      title={video.question}
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                      className="w-full h-full"
                    />
                  </div>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </CardContent>
      </Card>

      {/* Lana Hub App Card */}
      <Card className="border-2">
        <CardHeader className="pb-3">
          <span className="text-xl font-bold">How to use Lana Hub App</span>
        </CardHeader>
        <CardContent className="pt-0">
          <Accordion type="single" collapsible className="space-y-2">
            {videos.map((video) => (
              <AccordionItem
                key={video.id}
                value={video.id}
                className="border rounded-lg px-4"
              >
                <AccordionTrigger className="text-left">
                  <div className="flex items-center gap-3">
                    <PlayCircle className="h-5 w-5 text-red-500 shrink-0" />
                    <span>{video.question}</span>
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="aspect-video rounded-lg overflow-hidden">
                    <iframe
                      src={`https://www.youtube.com/embed/${video.youtubeId}`}
                      title={video.question}
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                      className="w-full h-full"
                    />
                  </div>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </CardContent>
      </Card>
    </div>
  );
}
