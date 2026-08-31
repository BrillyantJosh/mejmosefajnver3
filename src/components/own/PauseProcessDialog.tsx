import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Pause, Loader2 } from "lucide-react";

// Local "yyyy-MM-ddThh:mm" string for a Date, for <input type="datetime-local">.
function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}`;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (until: number, note: string, subject: string | null) => Promise<void>;
  en: boolean;
  /** Participants the pause may target — when set, the facilitator can pause
   *  ONE person instead of the whole process. */
  participants?: { pubkey: string; name: string }[];
}

/**
 * Facilitator dialog to pause the OWN process until a chosen date+time.
 * Picks a future moment (native datetime-local) + optional note, and hands the
 * parent a unix-seconds `until` timestamp to publish on the KIND 87056 event.
 */
// Three months is the ceiling (owner doctrine, 31.8.2026): life happens to
// people — surgery, a season abroad — and a process that cannot wait that
// long forces a facilitator to choose between the process and the person.
const MAX_PAUSE_DAYS = 92;

export default function PauseProcessDialog({ open, onOpenChange, onConfirm, en, participants = [] }: Props) {
  const [until, setUntil] = useState("");
  const [note, setNote] = useState("");
  const [subject, setSubject] = useState<string>("");   // '' = the whole process
  const [submitting, setSubmitting] = useState(false);

  const minLocal = toLocalInput(new Date(Date.now() + 60_000)); // at least a minute out
  const maxLocal = toLocalInput(new Date(Date.now() + MAX_PAUSE_DAYS * 86_400_000));
  const untilTs = until ? Math.floor(new Date(until).getTime() / 1000) : 0;
  const nowTs = Math.floor(Date.now() / 1000);
  const valid = untilTs > nowTs && untilTs <= nowTs + MAX_PAUSE_DAYS * 86_400;

  const handleConfirm = async () => {
    if (!valid) return;
    setSubmitting(true);
    try {
      await onConfirm(untilTs, note, subject || null);
      onOpenChange(false);
      setUntil("");
      setNote("");
      setSubject("");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !submitting && onOpenChange(o)}>
      <DialogContent onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pause className="h-5 w-5 text-amber-600" />
            {en ? "Pause the process" : "Daj premor procesu"}
          </DialogTitle>
          <DialogDescription>
            {en
              ? "While paused, no one can post — everyone can still read existing messages. The process reopens automatically at the time you set (you can also reopen it early)."
              : "Med premorom nihče ne more objavljati — vsi lahko še vedno berejo obstoječa sporočila. Proces se ob nastavljenem času samodejno znova odpre (lahko ga odpreš tudi predčasno)."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {participants.length > 0 && (
            <div className="space-y-1.5">
              <Label htmlFor="pause-subject">{en ? "Pause applies to" : "Premor velja za"}</Label>
              <select
                id="pause-subject"
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              >
                <option value="">{en ? "The whole process" : "Cel proces"}</option>
                {participants.map((p) => (
                  <option key={p.pubkey} value={p.pubkey}>{p.name}</option>
                ))}
              </select>
              {subject && (
                <p className="text-xs text-muted-foreground">
                  {en
                    ? "Only this person is on a break: the beings send them nothing and the break is never counted as their silence. Everyone else continues."
                    : "Na premoru je samo ta oseba: bitja ji ne pišejo ničesar in premor se nikoli ne šteje kot njen molk. Vsi ostali nadaljujejo."}
                </p>
              )}
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="pause-until">{en ? "Reopen at *" : "Znova odpri ob *"}</Label>
            <Input
              id="pause-until"
              type="datetime-local"
              min={minLocal}
              max={maxLocal}
              value={until}
              onChange={(e) => setUntil(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">{en ? "Up to 3 months." : "Največ 3 mesece."}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pause-note">{en ? "Note (optional)" : "Opomba (neobvezno)"}</Label>
            <Textarea
              id="pause-note"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={en ? "Why the break…" : "Razlog za premor…"}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            {en ? "Cancel" : "Prekliči"}
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!valid || submitting}
            className="bg-amber-600 hover:bg-amber-700 text-white gap-1"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {en ? "Pausing…" : "Ustavljam…"}
              </>
            ) : (
              <>
                <Pause className="h-4 w-4" />
                {en ? "Pause process" : "Daj premor"}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
