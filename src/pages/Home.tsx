import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Sparkles, HelpCircle, PlayCircle, Video, Calendar, Globe, MapPin, Share2, ChevronLeft, ChevronRight, MessageSquare, Vote, ArrowRight, CheckCircle, Shield, LogIn, Receipt } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatDistanceToNow, format, startOfWeek, endOfWeek } from "date-fns";
import { useNostrEvents, LanaEvent } from "@/hooks/useNostrEvents";
import { useNostrDMs } from "@/hooks/useNostrDMs";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

const API_URL = import.meta.env.VITE_API_URL ?? '';

interface ActiveVotingProposal {
  id: string;
  dTag: string;
  title: string;
  shortPerspective: string;
  level: string;
  start: number;
  end: number;
  img: string | null;
  youtube: string | null;
}

function getVotingTimeRemaining(endTimestamp: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = endTimestamp - now;
  if (diff <= 0) return 'Ended';
  const days = Math.floor(diff / 86400);
  const hours = Math.floor((diff % 86400) / 3600);
  const minutes = Math.floor((diff % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h remaining`;
  if (hours > 0) return `${hours}h ${minutes}m remaining`;
  return `${minutes}m remaining`;
}

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

const ITEMS_PER_PAGE = 3;

export default function Home() {
  const [items, setItems] = useState<WhatsUpItem[]>([]);
  const [faqItems, setFaqItems] = useState<FaqItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);

  // Fetch events for sidebar
  const { events: onlineEvents, loading: loadingOnline } = useNostrEvents('online');
  const { events: liveEvents, loading: loadingLive } = useNostrEvents('live');

  // Fetch active voting proposals from server
  const [activeVoting, setActiveVoting] = useState<ActiveVotingProposal[]>([]);
  useEffect(() => {
    fetch(`${API_URL}/api/functions/active-voting`)
      .then(r => r.json())
      .then(data => {
        if (data?.success && data.proposals?.length > 0) {
          setActiveVoting(data.proposals);
        }
      })
      .catch(err => console.error('Failed to fetch active voting:', err));
  }, []);

  // Voting eligibility check
  const { session } = useAuth();
  const [votingEligibility, setVotingEligibility] = useState<'loading' | 'eligible' | 'resist' | 'not-eligible' | null>(null);
  useEffect(() => {
    if (activeVoting.length === 0) return;
    if (!session?.nostrHexId) {
      setVotingEligibility('not-eligible');
      return;
    }
    setVotingEligibility('loading');
    fetch(`${API_URL}/api/functions/check-voting-eligibility`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userPubkey: session.nostrHexId }),
    })
      .then(r => r.json())
      .then(data => {
        if (data?.canResist) setVotingEligibility('resist');
        else if (data?.eligible) setVotingEligibility('eligible');
        else setVotingEligibility('not-eligible');
      })
      .catch(() => setVotingEligibility('not-eligible'));
  }, [activeVoting, session?.nostrHexId]);

  // Fetch DMs for sidebar
  const { conversations, profiles: dmProfiles, loading: dmsLoading } = useNostrDMs();

  // Filter DM conversations: last 14 days, max 3
  const fourteenDaysAgo = Math.floor(Date.now() / 1000) - 14 * 24 * 60 * 60;
  const recentConversations = conversations
    .filter(c => c.lastMessage && c.lastMessage.created_at >= fourteenDaysAgo)
    .slice(0, 3);

  // Fetch pending invoices to pay (KIND 70100 targeted at user, or public)
  const [pendingInvoices, setPendingInvoices] = useState<Array<{
    id: string;
    pubkey: string;
    amountLana: number;
    amountFiat: number;
    currency: string;
    description: string;
    deadline: number | null;
  }>>([]);

  useEffect(() => {
    if (!session?.nostrHexId) return;

    supabase.functions
      .invoke("query-nostr-events", {
        body: {
          filter: { kinds: [70100], limit: 100 },
          timeout: 10000,
        },
      })
      .then(({ data, error }) => {
        if (error || !data?.events) return;
        const nowUnix = Math.floor(Date.now() / 1000);
        const parsed = data.events
          .map((evt: any) => {
            const tags = evt.tags || [];
            const getTag = (n: string) =>
              tags.find((t: string[]) => t[0] === n)?.[1];
            const status = getTag("status") || "open";
            if (status !== "open") return null;
            // Not own invoices
            if (evt.pubkey === session?.nostrHexId) return null;
            // Not expired
            const deadlineStr = getTag("deadline");
            const deadline = deadlineStr ? parseInt(deadlineStr, 10) : null;
            if (deadline && deadline < nowUnix) return null;
            // If targeted, only show if it's for us
            const targetBuyer = tags.find((t: string[]) => t[0] === "p")?.[1];
            if (targetBuyer && targetBuyer !== session?.nostrHexId) return null;
            const amountLana = parseFloat(getTag("amount_lana") || "0");
            if (amountLana <= 0) return null;
            return {
              id: evt.id,
              pubkey: evt.pubkey,
              amountLana,
              amountFiat: parseFloat(getTag("amount_fiat") || "0"),
              currency: getTag("currency") || "EUR",
              description: getTag("description") || evt.content || "",
              deadline,
            };
          })
          .filter(Boolean);
        setPendingInvoices(parsed);
      })
      .catch(() => {});
  }, [session?.nostrHexId]);

  // Filter online events: this week only, upcoming/active
  const now = new Date();
  const weekEnd = endOfWeek(now, { weekStartsOn: 1 });
  const onlineThisWeek = onlineEvents
    .filter(e => e.status === 'active' && e.start <= weekEnd && (e.end ? e.end >= now : e.start >= new Date(now.getTime() - 2 * 60 * 60 * 1000)))
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  // Filter live events: upcoming/active only
  const liveUpcoming = liveEvents
    .filter(e => e.status === 'active' && (e.end ? e.end >= now : e.start >= new Date(now.getTime() - 2 * 60 * 60 * 1000)))
    .sort((a, b) => a.start.getTime() - b.start.getTime());

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

  // Pagination
  const totalPages = Math.ceil(items.length / ITEMS_PER_PAGE);
  const paginatedItems = items.slice(page * ITEMS_PER_PAGE, (page + 1) * ITEMS_PER_PAGE);

  const handleShare = async (item: WhatsUpItem) => {
    const publicUrl = `${window.location.origin}/video/${item.id}`;

    if (navigator.share) {
      try {
        await navigator.share({ title: item.title, text: item.body || item.title, url: publicUrl });
      } catch {
        // User cancelled
      }
    } else {
      try {
        await navigator.clipboard.writeText(publicUrl);
        toast.success("Link copied!");
      } catch {
        toast.error("Failed to copy link");
      }
    }
  };

  const formatTime = (dateStr: string) => {
    try {
      return formatDistanceToNow(new Date(dateStr + "Z"), { addSuffix: true });
    } catch {
      return "";
    }
  };

  return (
    <div className="max-w-6xl mx-auto">
      {/* Active Voting Banner */}
      {activeVoting.length > 0 && (
        <div className="mb-6 space-y-3">
          {activeVoting.map((proposal) => {
            const coverImg = proposal.img || (proposal.youtube ? `https://img.youtube.com/vi/${extractYouTubeId(proposal.youtube)}/hqdefault.jpg` : null);
            return (
              <Link
                key={proposal.id}
                to="/lana-aligns-world/align"
                className="block group"
              >
                <Card className="overflow-hidden border-2 border-violet-500/30 bg-gradient-to-r from-violet-500/5 via-indigo-500/5 to-blue-500/5 hover:border-violet-500/50 hover:shadow-lg transition-all">
                  {coverImg && (
                    <div className="relative w-full h-36 sm:h-44 overflow-hidden">
                      <img
                        src={coverImg}
                        alt={proposal.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
                      <Badge variant="default" className="absolute top-3 left-3 bg-violet-500 text-[10px] px-1.5 animate-pulse">
                        Active Voting
                      </Badge>
                    </div>
                  )}
                  <CardContent className="p-4 sm:p-5">
                    <div className="flex items-start gap-4">
                      <div className="flex-shrink-0 h-10 w-10 sm:h-12 sm:w-12 rounded-full bg-gradient-to-br from-violet-500 to-indigo-500 flex items-center justify-center">
                        <Vote className="h-5 w-5 sm:h-6 sm:w-6 text-white" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          {!coverImg && (
                            <Badge variant="default" className="bg-violet-500 text-[10px] px-1.5 animate-pulse">
                              Active Voting
                            </Badge>
                          )}
                          <Badge variant="outline" className="text-[10px] px-1.5">
                            {proposal.level === 'global' ? (
                              <><Globe className="h-2.5 w-2.5 mr-0.5" /> Global</>
                            ) : (
                              <><MapPin className="h-2.5 w-2.5 mr-0.5" /> Local</>
                            )}
                          </Badge>
                          <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                            <Calendar className="h-2.5 w-2.5" />
                            {getVotingTimeRemaining(proposal.end)}
                          </span>
                        </div>
                        <h3 className="text-base sm:text-lg font-bold leading-tight group-hover:text-violet-600 dark:group-hover:text-violet-400 transition-colors">
                          {proposal.title}
                        </h3>
                        {proposal.shortPerspective && (
                          <p className="text-xs sm:text-sm text-muted-foreground mt-1 line-clamp-2">
                            {proposal.shortPerspective}
                          </p>
                        )}
                        <div className="flex items-center gap-1 mt-2 text-xs font-medium text-violet-600 dark:text-violet-400">
                          Cast your vote
                          <ArrowRight className="h-3 w-3 group-hover:translate-x-1 transition-transform" />
                        </div>
                      </div>
                      {/* Voting eligibility indicator */}
                      <div className="flex-shrink-0 flex flex-col items-center gap-1 min-w-[48px]">
                        {votingEligibility === 'loading' && (
                          <Loader2 className="h-6 w-6 animate-spin text-violet-500" />
                        )}
                        {votingEligibility === 'eligible' && (
                          <CheckCircle className="h-6 w-6 text-green-500" />
                        )}
                        {votingEligibility === 'resist' && (
                          <Shield className="h-6 w-6 text-green-500" />
                        )}
                        {votingEligibility === 'not-eligible' && (
                          <LogIn className="h-6 w-6 text-muted-foreground" />
                        )}
                        <span className="text-[9px] text-muted-foreground text-center leading-tight whitespace-nowrap">
                          {votingEligibility === 'loading' ? 'Checking...' :
                           votingEligibility === 'resist' ? 'Vote & Resist' :
                           votingEligibility === 'eligible' ? 'Can Vote' :
                           'Log in'}
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}

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
              <>
                <div className="space-y-6">
                  {paginatedItems.map((item) => {
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
                          <div className="flex items-center justify-between mt-3">
                            <p className="text-xs text-muted-foreground">
                              {formatTime(item.created_at)}
                            </p>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="gap-1.5 text-muted-foreground hover:text-foreground"
                              onClick={() => handleShare(item)}
                            >
                              <Share2 className="h-4 w-4" />
                              <span className="text-xs">Share</span>
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-center gap-2 mt-8">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage(p => Math.max(0, p - 1))}
                      disabled={page === 0}
                      className="gap-1"
                    >
                      <ChevronLeft className="h-4 w-4" />
                      Previous
                    </Button>
                    <span className="text-sm text-muted-foreground px-3">
                      {page + 1} / {totalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                      disabled={page >= totalPages - 1}
                      className="gap-1"
                    >
                      Next
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Sidebar — right */}
          <div className="w-full lg:w-72 flex-shrink-0 space-y-4">
            {/* Pending Invoices Card */}
            {session && pendingInvoices.length > 0 && (
              <Link to="/shop/pay" className="block">
                <Card className="border-orange-300 dark:border-orange-700 hover:shadow-md transition-shadow">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Receipt className="h-5 w-5 text-orange-500" />
                      Invoices to Pay
                      <Badge variant="destructive" className="ml-auto h-5 min-w-5 flex items-center justify-center px-1.5 text-[10px] font-bold">
                        {pendingInvoices.length}
                      </Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="space-y-1.5">
                      {pendingInvoices.slice(0, 3).map((inv) => (
                        <div
                          key={inv.id}
                          className="flex items-center justify-between px-2 py-1.5 rounded-lg bg-muted/50"
                        >
                          <span className="text-sm truncate flex-1 min-w-0">
                            {inv.description || "Invoice"}
                          </span>
                          <span className="text-sm font-bold text-orange-600 ml-2 whitespace-nowrap">
                            {inv.amountLana.toFixed(2)} LANA
                          </span>
                        </div>
                      ))}
                      {pendingInvoices.length > 3 && (
                        <p className="text-xs text-muted-foreground text-center">
                          +{pendingInvoices.length - 3} more
                        </p>
                      )}
                    </div>
                    <div className="flex items-center justify-center px-3 py-2 mt-2 rounded-lg text-xs font-medium text-orange-600 hover:bg-orange-50 dark:hover:bg-orange-950/30 transition-colors">
                      Go to Pay →
                    </div>
                  </CardContent>
                </Card>
              </Link>
            )}

            {/* Events Card — most time-sensitive */}
            {!loadingOnline && !loadingLive && (onlineThisWeek.length > 0 || liveUpcoming.length > 0) && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Calendar className="h-5 w-5 text-indigo-500" />
                    Events
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0 space-y-4">
                  {/* Online Events — this week */}
                  {onlineThisWeek.length > 0 && (
                    <div>
                      <div className="flex items-center gap-1.5 mb-2">
                        <Globe className="h-3.5 w-3.5 text-blue-500" />
                        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Online this week</span>
                      </div>
                      <div className="space-y-1">
                        {onlineThisWeek.slice(0, 5).map((ev) => (
                          <Link
                            key={ev.id}
                            to={`/events/detail/${encodeURIComponent(ev.dTag)}`}
                            className="flex items-center gap-2 px-2 py-2 rounded-lg text-sm hover:bg-secondary/50 transition-colors"
                          >
                            <span className="text-xs text-muted-foreground whitespace-nowrap">{format(ev.start, 'EEE HH:mm')}</span>
                            <span className="truncate">{ev.title}</span>
                          </Link>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Live Events */}
                  {liveUpcoming.length > 0 && (
                    <div>
                      <div className="flex items-center gap-1.5 mb-2">
                        <MapPin className="h-3.5 w-3.5 text-red-500" />
                        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Live</span>
                      </div>
                      <div className="space-y-1">
                        {liveUpcoming.slice(0, 5).map((ev) => (
                          <Link
                            key={ev.id}
                            to={`/events/detail/${encodeURIComponent(ev.dTag)}`}
                            className="flex items-center gap-2 px-2 py-2 rounded-lg text-sm hover:bg-secondary/50 transition-colors"
                          >
                            <span className="text-xs text-muted-foreground whitespace-nowrap">{format(ev.start, 'dd.MM.')}</span>
                            <span className="truncate">{ev.title}</span>
                          </Link>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Link to all events */}
                  <Link
                    to="/events"
                    className="flex items-center justify-center px-3 py-2 rounded-lg text-xs font-medium text-primary hover:bg-primary/5 transition-colors"
                  >
                    View all events →
                  </Link>
                </CardContent>
              </Card>
            )}

            {/* Recent Messages Card */}
            {session && !dmsLoading && recentConversations.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <MessageSquare className="h-5 w-5 text-green-500" />
                    Messages
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="space-y-1">
                    {recentConversations.map((conv) => {
                      const profile = dmProfiles.get(conv.pubkey);
                      const displayName = profile?.display_name || profile?.name || conv.pubkey.slice(0, 12) + '...';
                      const lastMsg = conv.lastMessage;
                      let preview = '';
                      if (lastMsg?.decryptedContent) {
                        const isOwn = lastMsg.isOwn;
                        const raw = lastMsg.decryptedContent;
                        // Detect audio/image messages
                        if (raw.startsWith('audio:') || raw.includes('dm-audio')) {
                          preview = isOwn ? 'You: 🎵 Audio' : '🎵 Audio';
                        } else if (raw.startsWith('image:') || raw.includes('dm-images')) {
                          preview = isOwn ? 'You: 📷 Image' : '📷 Image';
                        } else {
                          const text = raw.length > 50 ? raw.slice(0, 47) + '...' : raw;
                          preview = isOwn ? `You: ${text}` : text;
                        }
                      }
                      const timeAgo = lastMsg ? formatDistanceToNow(new Date(lastMsg.created_at * 1000), { addSuffix: true }) : '';

                      return (
                        <Link
                          key={conv.pubkey}
                          to="/chat"
                          className="flex items-center gap-3 px-2 py-2.5 rounded-lg hover:bg-secondary/50 transition-colors"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-sm font-medium truncate">{displayName}</span>
                              {conv.unreadCount > 0 && (
                                <Badge variant="destructive" className="h-5 min-w-5 flex items-center justify-center px-1.5 text-[10px] font-bold flex-shrink-0">
                                  {conv.unreadCount}
                                </Badge>
                              )}
                            </div>
                            {preview && (
                              <p className="text-xs text-muted-foreground truncate mt-0.5">{preview}</p>
                            )}
                            {timeAgo && (
                              <p className="text-[10px] text-muted-foreground/70 mt-0.5">{timeAgo}</p>
                            )}
                          </div>
                        </Link>
                      );
                    })}
                  </div>

                  <Link
                    to="/chat"
                    className="flex items-center justify-center px-3 py-2 mt-2 rounded-lg text-xs font-medium text-primary hover:bg-primary/5 transition-colors"
                  >
                    View all chats →
                  </Link>
                </CardContent>
              </Card>
            )}

            {/* FAQ Card — last, static content */}
            {faqItems.length > 0 && (
              <Card>
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

                  {/* Video Instructions link */}
                  <Link
                    to="/video-instructions"
                    className="flex items-center gap-2 px-3 py-2.5 mt-3 rounded-lg text-sm font-medium border border-dashed border-violet-500/30 hover:bg-violet-500/5 transition-colors group"
                  >
                    <Video className="h-4 w-4 text-violet-500 flex-shrink-0 group-hover:scale-110 transition-transform" />
                    <span>Video Instructions</span>
                  </Link>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
