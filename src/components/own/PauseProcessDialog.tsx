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
  onConfirm: (until: number, note: string) => Promise<void>;
  en: boolean;
}

/**
 * Facilitator dialog to pause the OWN process until a chosen date+time.
 * Picks a future moment (native datetime-local) + optional note, and hands the
 * parent a unix-seconds `until` timestamp to publish on the KIND 87056 event.
 */
export default function PauseProcessDialog({ open, onOpenChange, onConfirm, en }: Props) {
  const [until, setUntil] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const minLocal = toLocalInput(new Date(Date.now() + 60_000)); // at least a minute out
  const untilTs = until ? Math.floor(new Date(until).getTime() / 1000) : 0;
  const valid = untilTs > Math.floor(Date.now() / 1000);

  const handleConfirm = async () => {
    if (!valid) return;
    setSubmitting(true);
    try {
      await onConfirm(untilTs, note);
      onOpenChange(false);
      setUntil("");
      setNote("");
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
          <div className="space-y-1.5">
            <Label htmlFor="pause-until">{en ? "Reopen at *" : "Znova odpri ob *"}</Label>
            <Input
              id="pause-until"
              type="datetime-local"
              min={minLocal}
              value={until}
              onChange={(e) => setUntil(e.target.value)}
            />
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
