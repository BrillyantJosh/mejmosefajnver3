import { useEffect, useMemo, useState } from "react";
import { SimplePool, finalizeEvent, type Event } from "nostr-tools";
import { formatDistanceToNow } from "date-fns";
import { sl as slLocale } from "date-fns/locale";
import { Loader2, MessageCircle, Reply as ReplyIcon, Send, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { useAuth } from "@/contexts/AuthContext";
import { useSystemParameters } from "@/contexts/SystemParametersContext";
import { useLang } from "@/i18n/I18nContext";
import { useNostrProfilesCacheBulk } from "@/hooks/useNostrProfilesCacheBulk";
import { supabase } from "@/integrations/supabase/client";
import { UF_COMMENT_KIND } from "@/hooks/useUFData";

interface UFCommentsProps {
  requestId: string;      // d-tag: uf:<uuid>
  requestPubkey: string;  // author of the KIND 31240 request
  recipientPubkey: string; // requester hex — comments p-tag them
}

interface UfComment {
  id: string;
  pubkey: string;
  content: string;
  created_at: number;
  rootId: string | null;   // e-tag with 'root' marker
  parentId: string | null; // e-tag with 'reply' marker
}

interface CommentThread {
  root: UfComment;
  replies: UfComment[];
}

const hexToBytes = (hex: string): Uint8Array => {
  const b = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) b[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  return b;
};

const parseComment = (event: Event): UfComment => {
  let rootId: string | null = null;
  let parentId: string | null = null;
  for (const tag of event.tags) {
    if (tag[0] !== "e") continue;
    if (tag[3] === "root") rootId = tag[1];
    else if (tag[3] === "reply") parentId = tag[1];
    else if (!rootId) rootId = tag[1]; // unmarked e-tag → treat as root reference
  }
  return {
    id: event.id,
    pubkey: event.pubkey,
    content: event.content,
    created_at: event.created_at,
    rootId,
    parentId,
  };
};

/**
 * Unconditional Financing — comments & replies (KIND 60212).
 * Two-level threading: top-level comments (no e-tags) + replies grouped
 * under their root. Comments stay open through all phases.
 */
const UFComments = ({ requestId, requestPubkey, recipientPubkey }: UFCommentsProps) => {
  const sl = useLang() === "sl";
  const { session } = useAuth();
  const { parameters } = useSystemParameters();
  const relays: string[] = parameters?.relays || [];

  const [comments, setComments] = useState<UfComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [commentText, setCommentText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [replyTo, setReplyTo] = useState<{ rootId: string; parentId: string; pubkey: string } | null>(null);
  const [pool] = useState(() => new SimplePool());

  const aTag = `31240:${requestPubkey}:${requestId}`;

  // Mobile relays are slower — mirror PostReplies' timeout strategy.
  const isMobile = /Mobile|Android|iPhone/i.test(navigator.userAgent);
  const FETCH_TIMEOUT = isMobile ? 15000 : 6000;
  const PUBLISH_TIMEOUT = isMobile ? 20000 : 10000;

  const fetchComments = async (skipLoadingState = false) => {
    if (relays.length === 0) return;
    if (!skipLoadingState) setLoading(true);
    try {
      let queryFailed = false;
      const events = await Promise.race([
        pool.querySync(relays, {
          kinds: [UF_COMMENT_KIND],
          "#a": [aTag],
          limit: 500,
        }),
        new Promise<Event[]>((_, reject) =>
          setTimeout(() => reject(new Error("Comments query timeout")), FETCH_TIMEOUT)
        ),
      ]).catch((err) => {
        console.error("❌ UF comments query failed:", err);
        queryFailed = true;
        return [] as Event[];
      });

      // A failed query must never WIPE the displayed thread — keep what we have.
      if (queryFailed) return;

      // MERGE instead of replace: a background refresh right after posting must
      // not drop the optimistic just-posted comment while relays still index it.
      setComments((prev) => {
        const unique = new Map<string, UfComment>(prev.map((c) => [c.id, c]));
        (events as Event[]).forEach((e) => unique.set(e.id, parseComment(e)));
        return [...unique.values()].sort((a, b) => a.created_at - b.created_at);
      });
    } catch (error) {
      console.error("❌ Error loading UF comments:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchComments();
    return () => {
      try {
        pool.close(relays);
      } catch {
        // ignore
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestId, requestPubkey, relays.length]);

  // ── profiles ──
  const commentPubkeys = useMemo(
    () => [...new Set(comments.map((c) => c.pubkey))],
    [comments]
  );
  const { profiles } = useNostrProfilesCacheBulk(commentPubkeys);

  const displayName = (pubkey: string): string => {
    const p = profiles.get(pubkey);
    return p?.display_name || p?.full_name || pubkey.slice(0, 8) + "…";
  };

  const formatTime = (timestamp: number): string => {
    try {
      return formatDistanceToNow(new Date(timestamp * 1000), {
        addSuffix: true,
        locale: sl ? slLocale : undefined,
      });
    } catch {
      return sl ? "pred kratkim" : "recently";
    }
  };

  // ── 2-level threading ──
  const threads: CommentThread[] = useMemo(() => {
    const topLevel = comments.filter((c) => !c.rootId && !c.parentId);
    const topLevelIds = new Set(topLevel.map((c) => c.id));
    const repliesByRoot = new Map<string, UfComment[]>();
    const orphans: UfComment[] = [];

    comments
      .filter((c) => c.rootId || c.parentId)
      .forEach((c) => {
        const root = c.rootId || c.parentId!;
        if (topLevelIds.has(root)) {
          const arr = repliesByRoot.get(root) || [];
          arr.push(c);
          repliesByRoot.set(root, arr);
        } else {
          // Root not found (deleted / not yet synced) — surface as top-level
          orphans.push(c);
        }
      });

    const built: CommentThread[] = [
      ...topLevel.map((root) => ({
        root,
        replies: (repliesByRoot.get(root.id) || []).sort((a, b) => a.created_at - b.created_at),
      })),
      ...orphans.map((root) => ({ root, replies: [] as UfComment[] })),
    ];
    return built.sort((a, b) => a.root.created_at - b.root.created_at);
  }, [comments]);

  // ── publish ──
  const handleSubmitComment = async () => {
    const text = commentText.trim();
    if (!text) return;
    if (!session?.nostrPrivateKey || !session?.nostrHexId) {
      toast.error(sl ? "Za komentiranje se moraš prijaviti." : "You must be logged in to comment.");
      return;
    }

    setIsSubmitting(true);
    try {
      const tags: string[][] = [["a", aTag]];
      if (replyTo) {
        tags.push(["e", replyTo.rootId, "", "root"]);
        tags.push(["e", replyTo.parentId, "", "reply"]);
      }
      tags.push(["p", recipientPubkey]);
      tags.push(["client", "mejmosefajn"]);

      const signed = finalizeEvent(
        {
          kind: UF_COMMENT_KIND,
          created_at: Math.floor(Date.now() / 1000),
          tags,
          content: text,
        },
        hexToBytes(session.nostrPrivateKey)
      );

      // Server publish first (reliable path, esp. on mobile)
      try {
        await supabase.functions.invoke("publish-dm-event", { body: { event: signed } });
      } catch (serverErr) {
        console.warn("⚠️ Server publish failed, relying on direct relay publish:", serverErr);
      }

      // Direct relay publish with graceful timeout
      if (relays.length > 0) {
        const tracked = pool.publish(relays, signed).map((p) => p.catch(() => null));
        await Promise.race([
          Promise.allSettled(tracked),
          new Promise((resolve) => setTimeout(resolve, PUBLISH_TIMEOUT)),
        ]);
      }

      // Optimistic append
      const optimistic: UfComment = {
        id: signed.id,
        pubkey: session.nostrHexId,
        content: text,
        created_at: signed.created_at,
        rootId: replyTo?.rootId ?? null,
        parentId: replyTo?.parentId ?? null,
      };
      setComments((prev) => (prev.some((c) => c.id === optimistic.id) ? prev : [...prev, optimistic]));
      setCommentText("");
      setReplyTo(null);
      toast.success(sl ? "Komentar objavljen" : "Comment posted");

      // Background refresh after relays settle
      setTimeout(() => {
        fetchComments(true).catch((err) => console.error("❌ Background comment refresh failed:", err));
      }, 2000);
    } catch (error) {
      console.error("❌ Error posting UF comment:", error);
      toast.error(sl ? "Objava komentarja ni uspela. Poskusi znova." : "Failed to post comment. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderCommentRow = (comment: UfComment, isReply: boolean) => {
    const profile = profiles.get(comment.pubkey);
    return (
      <div key={comment.id} className={`flex gap-3 ${isReply ? "ml-10" : ""}`}>
        <UserAvatar
          pubkey={comment.pubkey}
          picture={profile?.picture}
          name={displayName(comment.pubkey)}
          className={isReply ? "h-7 w-7 flex-shrink-0" : "h-8 w-8 flex-shrink-0"}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold text-sm">{displayName(comment.pubkey)}</p>
            {comment.pubkey === recipientPubkey && (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                {sl ? "Prosilec" : "Requester"}
              </Badge>
            )}
            <p className="text-xs text-muted-foreground">{formatTime(comment.created_at)}</p>
          </div>
          <p className="text-sm mt-1 whitespace-pre-wrap break-words">{comment.content}</p>
          {!isReply && session?.nostrPrivateKey && (
            <button
              type="button"
              className="flex items-center gap-1 mt-2 text-xs text-muted-foreground hover:text-primary transition-colors"
              onClick={() => setReplyTo({ rootId: comment.id, parentId: comment.id, pubkey: comment.pubkey })}
            >
              <ReplyIcon className="h-3.5 w-3.5" />
              {sl ? "Odgovori" : "Reply"}
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="border-t mt-4 pt-6 space-y-4">
      <h2 className="text-xl font-semibold flex items-center gap-2">
        <MessageCircle className="h-5 w-5" />
        {sl ? "Komentarji" : "Comments"}
        {!loading && <span className="text-muted-foreground text-base font-normal">({comments.length})</span>}
      </h2>

      {loading ? (
        <div className="flex justify-center items-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : threads.length === 0 ? (
        <div className="text-center py-4 text-sm text-muted-foreground">
          {sl
            ? "Še ni komentarjev — postavi vprašanje ali predlagaj izboljšavo."
            : "No comments yet — ask a question or offer feedback."}
        </div>
      ) : (
        <div className="space-y-5">
          {threads.map((thread) => (
            <div key={thread.root.id} className="space-y-3">
              {renderCommentRow(thread.root, false)}
              {thread.replies.map((reply) => renderCommentRow(reply, true))}
            </div>
          ))}
        </div>
      )}

      {/* Composer */}
      {session?.nostrPrivateKey ? (
        <div className="space-y-2 pt-2">
          {replyTo && (
            <div className="flex items-center justify-between text-xs bg-muted rounded-md px-3 py-2">
              <span className="text-muted-foreground">
                {sl ? "Odgovor za" : "Replying to"}{" "}
                <span className="font-semibold text-foreground">{displayName(replyTo.pubkey)}</span>
              </span>
              <button
                type="button"
                onClick={() => setReplyTo(null)}
                className="text-muted-foreground hover:text-foreground transition-colors"
                title={sl ? "Prekliči odgovor" : "Cancel reply"}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          <Textarea
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            placeholder={
              replyTo
                ? sl ? "Napiši odgovor..." : "Write a reply..."
                : sl ? "Napiši komentar..." : "Write a comment..."
            }
            className="min-h-[80px] resize-none"
          />
          <Button
            type="button"
            onClick={handleSubmitComment}
            disabled={isSubmitting || !commentText.trim()}
            size="sm"
            className="w-full md:w-auto"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {sl ? "Objavljanje..." : "Posting..."}
              </>
            ) : (
              <>
                <Send className="h-4 w-4 mr-2" />
                {replyTo
                  ? sl ? "Objavi odgovor" : "Post reply"
                  : sl ? "Objavi komentar" : "Post comment"}
              </>
            )}
          </Button>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground pt-2">
          {sl ? "Za komentiranje se prijavi." : "Log in to join the conversation."}
        </p>
      )}
    </div>
  );
};

export default UFComments;
