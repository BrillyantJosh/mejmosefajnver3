import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";
import { useAdmin } from "@/contexts/AdminContext";
import { useLang } from "@/i18n/I18nContext";
import { useNostrProfilesCacheBulk } from "@/hooks/useNostrProfilesCacheBulk";
import { ufTypeLabel, useUfRequests, type UfRequest } from "@/hooks/useUFData";
import { fetchUfReview, ufAdminErrorText } from "@/lib/ufAdminActions";
import UFAdminBar, { ufAmountLabel } from "./UFAdminBar";

/**
 * Unconditional Financing — the administrators' review (Jasna and Brilly, 16. 11. 2026).
 *
 * A new request is seen by nobody but its author and the administrators until an administrator
 * approves it; once approved, nothing it was approved with may change — above all not the amount
 * (server/lib/ufApproval.ts). Any request may be archived (out of every list, not fundable) and
 * restored. Every action, and reading this list, is signed with the administrator's key; the
 * server checks the signature, not this page.
 */
export default function UFReview() {
  const sl = useLang() === "sl";
  const { session } = useAuth();
  const { isUfAdmin, loading: adminLoading } = useAdmin();
  const privateKey = session?.nostrPrivateKey;

  const [pending, setPending] = useState<UfRequest[]>([]);
  const [archived, setArchived] = useState<UfRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const published = useUfRequests("all", 1, 100);
  const refetchPublished = published.refetch;

  const load = useCallback(async () => {
    if (!privateKey || !isUfAdmin) { setLoading(false); return; }
    setLoading(true);
    try {
      const data = await fetchUfReview(privateKey);
      setPending(data.pending || []);
      setArchived(data.archived || []);
      setError(null);
    } catch (err) {
      setError(ufAdminErrorText(err, sl));
    } finally {
      setLoading(false);
    }
  }, [privateKey, isUfAdmin, sl]);

  useEffect(() => { void load(); }, [load]);
  const reload = useCallback(() => { void load(); refetchPublished(); }, [load, refetchPublished]);

  const pubkeys = useMemo(
    () => [...new Set([...pending, ...archived, ...published.requests].map((r) => r.pubkey))],
    [pending, archived, published.requests],
  );
  const { profiles } = useNostrProfilesCacheBulk(pubkeys);
  const nameOf = (pk: string) => profiles.get(pk)?.display_name || profiles.get(pk)?.full_name || `${pk.slice(0, 8)}…`;

  if (adminLoading) {
    return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }
  if (!isUfAdmin || !privateKey) {
    return (
      <div className="container mx-auto p-4 sm:p-6 pb-24 max-w-2xl">
        <p className="text-center text-muted-foreground py-16">
          {sl ? "Ta stran je samo za skrbnike." : "This page is for administrators only."}
        </p>
      </div>
    );
  }

  const row = (r: UfRequest) => (
    <Card key={r.id}>
      <CardContent className="p-4 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
          <div className="min-w-0">
            <Link to={`/unconditional-financing/request/${r.id}`} className="font-semibold hover:underline break-words">
              {r.title}
            </Link>
            <p className="text-sm text-muted-foreground">
              {nameOf(r.pubkey)} · {ufTypeLabel(r.requestType, sl)} ·{" "}
              {sl ? "oddano" : "submitted"} {format(new Date((r.publishedAt || r.nostrCreatedAt) * 1000), "dd/MM/yyyy")}
            </p>
          </div>
          <Badge variant="outline" className="shrink-0 self-start text-base font-semibold">{ufAmountLabel(r)}</Badge>
        </div>
        {r.shortDesc && <p className="text-sm text-muted-foreground line-clamp-2">{r.shortDesc}</p>}
        <UFAdminBar request={r} onDone={reload} authorName={nameOf(r.pubkey)} />
      </CardContent>
    </Card>
  );

  const section = (title: string, hint: string, rows: UfRequest[], empty: string) => (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">{title} <span className="text-muted-foreground font-normal">({rows.length})</span></h2>
        <p className="text-sm text-muted-foreground">{hint}</p>
      </div>
      {rows.length === 0 ? <p className="text-sm text-muted-foreground italic">{empty}</p> : rows.map(row)}
    </section>
  );

  return (
    <div className="container mx-auto p-4 sm:p-6 pb-24 max-w-3xl space-y-8">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <ShieldCheck className="h-6 w-6 text-primary shrink-0" />
          <div>
            <h1 className="text-2xl font-bold">{sl ? "Pregled zahtevkov" : "Review requests"}</h1>
            <p className="text-sm text-muted-foreground">
              {sl
                ? "Nov zahtevek vidita samo avtor in skrbnik, dokler ga ne odobriš. Po odobritvi ga ni več mogoče spreminjati — zneska še posebej ne."
                : "A new request is seen only by its author and the administrators until you approve it. Once approved it can no longer be changed — above all not the amount."}
            </p>
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={reload} disabled={loading} aria-label={sl ? "Osveži" : "Refresh"}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : (
        <>
          {section(
            sl ? "Čaka na odobritev" : "Waiting for approval",
            sl ? "Odobri: zahtevek postane javen, znesek se zaklene. Arhiviraj: ostane skrit." : "Approve: the request becomes public and its amount is locked. Archive: it stays hidden.",
            pending,
            sl ? "Nič ne čaka." : "Nothing is waiting.",
          )}
          {section(
            sl ? "Objavljeni" : "Published",
            sl ? "Arhiviraj: zahtevek izgine s seznama in ga ni več mogoče financirati. Vračila ostanejo mogoča." : "Archive: the request leaves the list and can no longer be funded. Repayments stay possible.",
            published.requests,
            sl ? "Ni objavljenih zahtevkov." : "No published requests.",
          )}
          {section(
            sl ? "Arhiv" : "Archive",
            sl ? "Vrni iz arhiva: zahtevek se vrne tja, kjer je bil (objavljen ali čaka na odobritev)." : "Restore: the request returns to where it was (published, or waiting for approval).",
            archived,
            sl ? "Arhiv je prazen." : "The archive is empty.",
          )}
        </>
      )}
    </div>
  );
}
