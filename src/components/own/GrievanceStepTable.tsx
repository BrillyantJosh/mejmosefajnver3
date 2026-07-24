import { useState, useEffect } from "react";
import { Check, ChevronDown, Quote, Loader2, ExternalLink, Copy } from "lucide-react";
import type { Grievance } from "@/hooks/useOwnGrievances";
import type { SourceRecord, PairMsgIdMap, OriginalMessage } from "@/hooks/useOwnGrievanceSources";
import TranslateButton from "@/components/own/TranslateButton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AudioPlayer } from "@/components/AudioPlayer";

// The four-step grievance table — one row per grievance, one column per
// milestone. Shared so the /own/matrix Matrica and a participant's own
// detail view read identically (the same being sees the same picture).
//
// COLOUR BY PARTICIPANT (Brilly, 2026-07-24): each person gets one stable
// colour. Every step belongs to ONE person — respond / accept / apologize are
// the RECEIVER's work, owning the delusion is the GIVER's. The colour is kept
// on BOTH states so the trace never disappears (Brilly, 2026-07-24 v2):
//   · open  = a hollow RING in that person's colour — still to do
//   · done  = a FILLED disc with a white check in the same colour — done, but
//             you can still see whose step it was.
// Shape (ring vs filled) carries done/open; colour always carries WHO.
export interface GrievanceStepLabels {
  grievances: string;
  responded: string;
  accepted: string;
  apologized: string;
  owned: string;
  /** One-line explanation of the colour scheme, shown above the table. */
  colorHint?: string;
  /** "opravljeno" — used only in the accessible title of a done cell. */
  doneWord?: string;
  /** "še ne" — used only in the accessible title of an open cell. */
  openWord?: string;
  /** "Vir" / "Source" — the per-row source disclosure toggle. */
  sourceWord?: string;
  /** "iz sporočila" / "from message" — precedes the short msg-id anchor. */
  fromMessageWord?: string;
  /** "sporočilo" / "message" — label prefix for the short msg-id anchor. */
  messageWord?: string;
  /** "kopirano" / "copied" — toast-less inline confirmation after copy. */
  copiedWord?: string;
  /** "Odpri izvirno sporočilo" / "Open original message" — the dialog opener. */
  openOriginalWord?: string;
  /** "Izvirno sporočilo" / "Original message" — the dialog title. */
  originalTitleWord?: string;
  /** "Sporočila ni bilo mogoče naložiti." / "Could not load the message." */
  originalErrorWord?: string;
  /** "Kopiraj ID" / "Copy id". */
  copyIdWord?: string;
  /** "vir ni najden" / "no source found" — being located no message voicing this. */
  unsourcedWord?: string;
  /** "vir ne potrjuje, da gre za to osebo" / "source does not confirm the target". */
  sourceNotTargetWord?: string;
  /** "vir le delno podpira očitek" / "source only partly supports the claim". */
  sourcePartialWord?: string;
  /** "dajalec očitek zanika" / "the giver disputes this claim". */
  disputedWord?: string;
  /** "ta vir navaja samo to bitje" / "only this being cites this source". */
  onlyThisBeingWord?: string;
}

// Full static class strings (Tailwind cannot see interpolated names). Six
// hues, all clearly distinct from the green "done" check and from each other.
const PALETTE = [
  { name: "text-sky-600 dark:text-sky-400", ring: "border-sky-500", fill: "bg-sky-500/15", dot: "bg-sky-500" },
  { name: "text-violet-600 dark:text-violet-400", ring: "border-violet-500", fill: "bg-violet-500/15", dot: "bg-violet-500" },
  { name: "text-amber-600 dark:text-amber-400", ring: "border-amber-500", fill: "bg-amber-500/15", dot: "bg-amber-500" },
  { name: "text-fuchsia-600 dark:text-fuchsia-400", ring: "border-fuchsia-500", fill: "bg-fuchsia-500/15", dot: "bg-fuchsia-500" },
  { name: "text-cyan-600 dark:text-cyan-400", ring: "border-cyan-500", fill: "bg-cyan-500/15", dot: "bg-cyan-500" },
  { name: "text-orange-600 dark:text-orange-400", ring: "border-orange-500", fill: "bg-orange-500/15", dot: "bg-orange-500" },
] as const;

function hashIndex(pubkey: string) {
  const s = (pubkey || "").toLowerCase();
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % PALETTE.length;
}

// Opens the ORIGINAL 87046 message a source points to: decrypts it on demand
// (participant-only, same group key) and shows the full transcript + audio.
function OriginalMessageDialog({ msgId, fetchOriginal, nameOf, labels, onClose }: {
  msgId: string;
  fetchOriginal: (msgId: string) => Promise<OriginalMessage | null>;
  nameOf: (pk: string) => string;
  labels: GrievanceStepLabels;
  onClose: () => void;
}) {
  const [msg, setMsg] = useState<OriginalMessage | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setErr(false);
    fetchOriginal(msgId).then((m) => {
      if (cancelled) return;
      if (m) setMsg(m); else setErr(true);
      setLoading(false);
    }).catch(() => { if (!cancelled) { setErr(true); setLoading(false); } });
    return () => { cancelled = true; };
  }, [msgId, fetchOriginal]);
  const copyId = () => {
    try { navigator.clipboard?.writeText(msgId); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* id still visible */ }
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-base">{labels.originalTitleWord || "Original message"}</DialogTitle>
        </DialogHeader>
        {loading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> …</div>
        ) : err || !msg ? (
          <p className="py-4 text-sm text-muted-foreground">{labels.originalErrorWord || "Could not load the message."}</p>
        ) : (
          <div className="space-y-3">
            <div className="text-xs text-muted-foreground">
              {nameOf(msg.senderPubkey)}{msg.createdAt > 0 && <> · {new Date(msg.createdAt * 1000).toLocaleString()}</>}
            </div>
            {msg.audioUrl && <AudioPlayer audioUrl={msg.audioUrl} initialDuration={msg.audioDuration} />}
            {msg.transcript && (
              <p className="whitespace-pre-wrap break-words text-sm leading-snug text-foreground/90 border-l-2 border-primary/40 pl-2.5">
                {msg.transcript}
              </p>
            )}
            {/* The quote in the source is capped; the transcript here is the full text. */}
            {msg.transcript && <TranslateButton text={msg.transcript} />}
            <button
              type="button"
              onClick={copyId}
              title={msgId}
              className="inline-flex items-center gap-1 font-mono text-[10px] text-muted-foreground hover:text-foreground"
            >
              <Copy className="h-3 w-3" /> {labels.copyIdWord || "Copy id"} {msgId.slice(0, 12)}…
              {copied && <span className="text-green-600">✓ {labels.copiedWord || "copied"}</span>}
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function GrievanceStepTable({
  grievances, nameOf, labels, highlightPubkey, roster, sources, beingPubkey, corroboration, beingsWithSources, fetchOriginal,
}: {
  grievances: Grievance[];
  nameOf: (pk: string) => string;
  labels: GrievanceStepLabels;
  /** When set, this person's name is emphasized in every from → to pair. */
  highlightPubkey?: string;
  /** The full participant roster — colours are assigned BY POSITION here, so
   *  ≤6 people always get DISTINCT hues (a plain hash collides). Sorted for a
   *  canonical order identical across every being's sub-table and every app. */
  roster?: string[];
  /** PARTICIPANT-ONLY source records for THE ONE BEING whose ledger this table
   *  renders — grievance_id -> record (see useOwnGrievanceSources). Ids are
   *  per-being sequential, so the caller must pass
   *  sourcesByBeing.get(beingPubkey), never a cross-being merge. Only viewers
   *  with the group key ever receive data — that is the privacy gate. */
  sources?: Map<string, SourceRecord>;
  /** The being whose ledger this table renders (same key as in `sources`). */
  beingPubkey?: string;
  /** Cross-being pair→msg_ids map (buildPairMsgIdMap) for the corroboration
   *  chip. Rendered only when beingsWithSources ≥ 2. */
  corroboration?: PairMsgIdMap;
  /** How many beings' 37050 the viewer could decrypt (corroboration gate). */
  beingsWithSources?: number;
  /** Opens the ORIGINAL 87046 message a source points to (decrypted transcript
   *  + audio). From the same hook as `sources`; when omitted, the source shows
   *  a copyable id only, no "open original" button. */
  fetchOriginal?: (msgId: string) => Promise<OriginalMessage | null>;
}) {
  const me = (highlightPubkey || "").toLowerCase();

  // Canonical colour order: the roster if given, else the distinct people in
  // this table — sorted, so the same person is the same colour everywhere.
  const order = (() => {
    const src = roster && roster.length
      ? roster
      : grievances.flatMap((g) => [g.fromPubkey, g.toPubkey]);
    return Array.from(new Set(src.map((p) => (p || "").toLowerCase()))).sort();
  })();
  // Distinct by position; fall back to a hash only for a pk not in the order.
  const colorFor = (pk: string) => {
    const i = order.indexOf((pk || "").toLowerCase());
    return PALETTE[(i >= 0 ? i : hashIndex(pk)) % PALETTE.length];
  };

  const party = (pk: string) => {
    const c = colorFor(pk);
    const isMe = pk.toLowerCase() === me;
    return <span className={`${c.name} ${isMe ? "font-semibold underline decoration-dotted underline-offset-2" : "font-medium"}`}>{nameOf(pk)}</span>;
  };

  // owner = whose step this is; the open mark is drawn in THEIR colour.
  const StepCell = ({ done, ownerPubkey, label }: { done: boolean; ownerPubkey: string; label: string }) => {
    const c = colorFor(ownerPubkey);
    const title = `${nameOf(ownerPubkey)} · ${label} — ${done ? (labels.doneWord || "✓") : (labels.openWord || "…")}`;
    return (
      <td className="p-2 text-center">
        <span title={title} role="img" aria-label={title} className="inline-flex items-center justify-center">
          {done ? (
            // done: a FILLED disc in the person's colour with a white check —
            // the colour trace stays, so you still see whose step it was.
            <span className={`inline-flex h-4 w-4 items-center justify-center rounded-full ${c.dot}`}>
              <Check className="h-3 w-3 text-white" strokeWidth={3} />
            </span>
          ) : (
            // open: a hollow ring in that person's colour — still to do.
            <span className={`inline-block h-3.5 w-3.5 rounded-full border-2 ${c.ring} ${c.fill}`} />
          )}
        </span>
      </td>
    );
  };

  // This grievance's source record + the entries safe to show: HARD FILTER —
  // an entry whose sender is not the grievance's giver is never rendered
  // (defense in depth against cross-person/cross-being leakage).
  const recordFor = (g: Grievance) => sources?.get(g.id);
  const entriesFor = (g: Grievance) =>
    (recordFor(g)?.entries || []).filter((s) => s.senderPubkey === (g.fromPubkey || "").toLowerCase());

  // ── Honesty badges (37050 v2 verdicts + 37046 dispute) + corroboration chip.
  // Rendered only when the data is actually present — never guessed.
  const SourceBadges = ({ g }: { g: Grievance }) => {
    const rec = recordFor(g);
    const list = entriesFor(g);
    // Corroboration (participant-only): does any OTHER being record the same
    // (from,to) grievance citing ≥1 of the same messages? Only meaningful when
    // the viewer decrypted sources for ≥2 beings.
    let onlyThisBeing = false;
    if (rec && list.length > 0 && beingPubkey && corroboration && (beingsWithSources || 0) >= 2) {
      const self = beingPubkey.toLowerCase();
      const pairKey = `${g.fromPubkey}|${g.toPubkey}`;
      let others = 0;
      for (const [b2, pairMap] of corroboration) {
        if (b2 === self) continue;
        const set = pairMap.get(pairKey);
        if (set && list.some((s) => set.has(s.msgId))) others++;
      }
      onlyThisBeing = others === 0;   // count including this being === 1
    }
    const badges: { key: string; text: string; red?: boolean }[] = [];
    if (rec?.unsourced === true)
      badges.push({ key: "unsourced", text: labels.unsourcedWord || "no source found" });
    if (rec?.support && rec.support.target === false)
      badges.push({ key: "not-target", text: labels.sourceNotTargetWord || "source does not confirm the target", red: true });
    if (rec?.support && rec.support.target === true && rec.support.deed === false)
      badges.push({ key: "partial", text: labels.sourcePartialWord || "source only partly supports the claim" });
    if (g.disputedByGiver === true)
      badges.push({ key: "disputed", text: labels.disputedWord || "the giver disputes this claim", red: true });
    if (badges.length === 0 && !onlyThisBeing) return null;
    return (
      <>
        <div className="mt-1 flex flex-wrap items-center gap-1">
          {badges.map((b) => (
            <span
              key={b.key}
              className={`inline-flex items-center rounded-full border px-1.5 py-0 text-[10px] ${b.red
                ? "border-red-500/40 bg-red-500/10 text-red-600"
                : "border-amber-500/40 bg-amber-500/10 text-amber-600"}`}
            >
              {b.text}
            </span>
          ))}
          {onlyThisBeing && (
            <span className="inline-flex items-center rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0 text-[10px] text-amber-600">
              ⚠ {labels.onlyThisBeingWord || "only this being cites this source"}
            </span>
          )}
        </div>
        {g.disputedByGiver && g.disputeEvidence && (
          <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">{g.disputeEvidence}</p>
        )}
      </>
    );
  };

  // ── PARTICIPANT-ONLY "Vir" disclosure ──
  // A compact per-row toggle that reveals the verbatim message excerpts a being
  // sourced this grievance from. Rendered only when this grievance actually has
  // sources; a grievance with none shows nothing at all (no empty toggle).
  const SourceDisclosure = ({ g }: { g: Grievance }) => {
    const list = entriesFor(g);
    const [open, setOpen] = useState(false);
    const [copied, setCopied] = useState<string | null>(null);
    const [openMsg, setOpenMsg] = useState<string | null>(null);
    if (list.length === 0) return null;
    const copy = (id: string) => {
      try {
        navigator.clipboard?.writeText(id);
        setCopied(id);
        setTimeout(() => setCopied((c) => (c === id ? null : c)), 1500);
      } catch { /* clipboard unavailable — the id is still visible to copy by hand */ }
    };
    return (
      <div className="mt-1.5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-1 text-[10px] text-muted-foreground/80 hover:text-foreground transition-colors"
          aria-expanded={open}
        >
          <Quote className="h-3 w-3" />
          {labels.sourceWord || "Source"}
          <span className="opacity-70">({list.length})</span>
          <ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
        {open && (
          <div className="mt-1.5 space-y-2 border-l-2 border-border/60 pl-2.5">
            {list.map((s) => (
              <div key={s.msgId} className="space-y-0.5">
                <blockquote className="text-[11px] italic leading-snug text-foreground/90">
                  “{s.quote}{s.truncated ? "…" : ""}”
                </blockquote>
                {/* Same OWN translate control as /own/todo — the quote is in the
                    conversation's language, so a non-Slovene participant can read it. */}
                <TranslateButton text={s.quote} className="!mt-0.5" />
                <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px] text-muted-foreground">
                  <span>{nameOf(s.senderPubkey)}</span>
                  {s.createdAt > 0 && <span>· {new Date(s.createdAt * 1000).toLocaleString()}</span>}
                  <span>·</span>
                  {fetchOriginal ? (
                    // Primary action: open the ORIGINAL message (transcript + audio).
                    <button
                      type="button"
                      onClick={() => setOpenMsg(s.msgId)}
                      className="inline-flex items-center gap-1 font-medium text-sky-600 hover:underline dark:text-sky-400"
                    >
                      <ExternalLink className="h-3 w-3" />
                      {labels.openOriginalWord || "Open original message"}
                    </button>
                  ) : (
                    // No decrypt fn wired → fall back to a copyable id.
                    <button
                      type="button"
                      onClick={() => copy(s.msgId)}
                      title={s.msgId}
                      className="font-mono text-[10px] text-sky-600 hover:underline dark:text-sky-400"
                    >
                      {labels.messageWord || "message"} {s.msgId.slice(0, 8)}…
                    </button>
                  )}
                  {copied === s.msgId && <span className="text-green-600">✓ {labels.copiedWord || "copied"}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
        {fetchOriginal && openMsg && (
          <OriginalMessageDialog
            msgId={openMsg}
            fetchOriginal={fetchOriginal}
            nameOf={nameOf}
            labels={labels}
            onClose={() => setOpenMsg(null)}
          />
        )}
      </div>
    );
  };

  // The distinct people who actually appear in this table, in a stable order,
  // for the legend chips.
  const parties: string[] = [];
  for (const g of grievances) for (const pk of [g.fromPubkey, g.toPubkey]) {
    if (pk && !parties.some((p) => p.toLowerCase() === pk.toLowerCase())) parties.push(pk);
  }

  return (
    <div className="overflow-x-auto">
      {parties.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-2">
          {parties.map((pk) => {
            const c = colorFor(pk);
            return (
              <span key={pk} className="inline-flex items-center gap-1.5 text-[11px]">
                <span className={`inline-block h-2.5 w-2.5 rounded-full ${c.dot}`} />
                <span className={c.name}>{nameOf(pk)}</span>
              </span>
            );
          })}
        </div>
      )}
      {labels.colorHint && (
        <p className="text-[10px] leading-snug text-muted-foreground/80 mb-2">{labels.colorHint}</p>
      )}
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-b border-border/60 text-[10px] uppercase tracking-wide text-muted-foreground">
            <th className="text-left p-2 font-medium">{labels.grievances}</th>
            <th className="p-2 font-medium text-center whitespace-nowrap">{labels.responded}</th>
            <th className="p-2 font-medium text-center whitespace-nowrap">{labels.accepted}</th>
            <th className="p-2 font-medium text-center whitespace-nowrap">{labels.apologized}</th>
            <th className="p-2 font-medium text-center whitespace-nowrap">{labels.owned}</th>
          </tr>
        </thead>
        <tbody>
          {grievances.map((g) => (
            <tr key={g.id} className="border-b border-border/40 align-top">
              <td className="p-2 min-w-[12rem]">
                <div>{party(g.fromPubkey)} → {party(g.toPubkey)}</div>
                {g.summary && <div className="text-muted-foreground leading-snug mt-0.5">{g.summary}</div>}
                <SourceBadges g={g} />
                <SourceDisclosure g={g} />
              </td>
              {/* respond / accept / apologize = the RECEIVER's (toPubkey) work */}
              <StepCell done={g.respondedByTarget} ownerPubkey={g.toPubkey} label={labels.responded} />
              <StepCell done={g.status === "accepted"} ownerPubkey={g.toPubkey} label={labels.accepted} />
              <StepCell done={g.apologyNoted} ownerPubkey={g.toPubkey} label={labels.apologized} />
              {/* owning the delusion = the GIVER's (fromPubkey) work */}
              <StepCell done={g.acceptedByGiver} ownerPubkey={g.fromPubkey} label={labels.owned} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
