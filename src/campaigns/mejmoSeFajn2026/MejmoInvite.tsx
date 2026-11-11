import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { SimplePool, finalizeEvent } from "nostr-tools";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useSystemParameters } from "@/contexts/SystemParametersContext";
import { useLang } from "@/i18n/I18nContext";
import { queryEventsViaServer } from "@/lib/relayReadViaServer";
import {
  EVENT_DTAG, FLYER_URL, IN_APP_EVENT_PATH, countdownBadge, daysUntilEvent, dueToday, ljubljanaDay, quietPage,
  timeLeftToChange, type InviteMood,
} from "./invite";

/**
 * TEMPORARY CAMPAIGN (see ./invite.ts) — the flyer for "Mejmo se f*cking fajn",
 * 21. 11. 2026, at most once a day to every signed-in user, with a countdown.
 * "Pridem!" registers exactly like "I'm Going" on the event page (KIND 53333,
 * signed with the person's own key). "Ne grem" is remembered on this device,
 * and from then on the daily note teases instead of invites. Built for a phone
 * first: the flyer fits the screen, the buttons are thumb-sized, it scrolls.
 */
const key = (hex: string, what: "shown" | "declined") => `msf-invite-2026-11-21:${hex}:${what}`;
const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string | null) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private mode */ } };

export default function MejmoInvite() {
  const { session } = useAuth();
  const { parameters } = useSystemParameters();
  const sl = useLang() === "sl";
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [mood, setMood] = useState<InviteMood>("invite");
  const [busy, setBusy] = useState(false);
  const [justJoined, setJustJoined] = useState(false);
  const checking = useRef(false);
  const hex = session?.nostrHexId;

  useEffect(() => {
    if (!hex || open || checking.current) return;
    if (quietPage(location.pathname) || !dueToday(Date.now(), read(key(hex, "shown")))) return;
    checking.current = true;
    let alive = true;
    const timer = setTimeout(async () => {
      let next: InviteMood = read(key(hex, "declined")) ? "declined" : "invite";
      try {
        const mine = await queryEventsViaServer({ kinds: [53333], authors: [hex], limit: 50 }, { label: "my event registrations (invite)" });
        const latest = mine
          .filter((e) => e.tags.some((t) => t[0] === "event" && t[1] === EVENT_DTAG))
          .sort((a, b) => b.created_at - a.created_at)[0];
        if (latest?.tags.some((t) => t[0] === "status" && t[1] === "going")) next = "going";
      } catch { /* unknown: invite as if not registered — a second "going" is harmless */ }
      if (!alive) return;
      // Re-check: the person may have moved to a quiet page while we looked.
      if (quietPage(window.location.pathname)) { checking.current = false; return; }
      write(key(hex, "shown"), ljubljanaDay(Date.now()));
      setMood(next);
      setJustJoined(false);
      setOpen(true);
    }, 2500);
    return () => { alive = false; clearTimeout(timer); checking.current = false; };
  }, [hex, location.pathname, open]);

  if (!hex) return null;
  const days = daysUntilEvent(Date.now());

  const goingNow = async () => {
    const relays = parameters?.relays || [];
    if (!session?.nostrPrivateKey || relays.length === 0) {
      setOpen(false);
      navigate(IN_APP_EVENT_PATH);
      return;
    }
    setBusy(true);
    try {
      const sk = new Uint8Array(session.nostrPrivateKey.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)));
      const registration = finalizeEvent({
        kind: 53333,
        created_at: Math.floor(Date.now() / 1000),
        tags: [["event", EVENT_DTAG], ["status", "going"], ["p", hex], ["seats", "1"], ["source", "Lana.app"]],
        content: "",
      }, sk);
      const pool = new SimplePool();
      await new Promise<void>((resolve, reject) => {
        let ok = 0;
        const t = setTimeout(() => (ok > 0 ? resolve() : reject(new Error("timeout"))), 10000);
        pool.publish(relays, registration).forEach((p) => p.then(() => { ok++; if (ok === 1) { clearTimeout(t); resolve(); } }).catch(() => {}));
      });
      write(key(hex, "declined"), null);
      setMood("going");
      setJustJoined(true);
    } catch {
      toast.error(sl ? "Prijava se ni shranila — poskusi na strani dogodka." : "Your registration did not save — please try on the event page.");
      setOpen(false);
      navigate(IN_APP_EVENT_PATH);
    } finally {
      setBusy(false);
    }
  };

  const notGoing = () => {
    write(key(hex, "declined"), "1");
    setOpen(false);
    toast(sl ? "Prav. Ampak jutri te spet vprašam 😉" : "Fine. But I'll ask again tomorrow 😉");
  };

  const title =
    mood === "going"
      ? justJoined ? (sl ? "Juhuhu, prijavljen/a si! 🎉" : "Woohoo, you're in! 🎉") : (sl ? "Prijavljen/a si! 🎉" : "You're in! 🎉")
      : mood === "declined"
        ? (sl ? "Vem, vem … 🙈" : "I know, I know … 🙈")
        : (sl ? "Pridi se imet f*cking fajn! 🎉" : "Come and have a f*cking great time! 🎉");

  const text =
    mood === "going"
      ? sl ? "Komaj čakamo, da se vidimo. Pripravi plesne copate in nasmeh 💃🕺" : "We can't wait to see you. Bring your dancing shoes and your smile 💃🕺"
      : mood === "declined"
        ? sl
          ? `Rekel/a si, da ne prideš. Ampak ${timeLeftToChange(days, true)}, da se premisliš 😉 Možni stranski učinki: nenadzorovan smeh in nova poznanstva.`
          : `You said you're not coming. But ${timeLeftToChange(days, false)} to change your mind 😉 Possible side effects: uncontrollable laughter and new friends.`
        : sl
          ? "Dobri ljudje. Nora energija. Nekaj nepričakovanega. Potrdi, da prideš — traja eno sekundo."
          : "Good people. Wild energy. Something unexpected. Confirm you're coming — it takes one second.";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        data-testid="mejmo-invite"
        className="w-[calc(100vw-1.5rem)] max-w-md max-h-[92dvh] overflow-y-auto gap-0 rounded-2xl p-0 sm:rounded-2xl [&>button]:rounded-full [&>button]:bg-white/90 [&>button]:p-1.5 [&>button]:text-black [&>button]:opacity-100 [&>button]:shadow"
      >
        <img
          src={FLYER_URL}
          alt={sl ? "Mejmo se f*cking fajn — sobota, 21. 11. 2026 ob 16.00, Dancelife, Ljubljana" : "Mejmo se f*cking fajn — Saturday 21 Nov 2026, 4 pm, Dancelife, Ljubljana"}
          className="block w-full max-h-[40dvh] rounded-t-2xl bg-black object-contain"
        />
        <div className="space-y-3 p-4 sm:p-5">
          <div className="flex justify-center">
            <span data-testid="mejmo-countdown" className="rounded-full bg-orange-500 px-4 py-1.5 text-sm font-bold text-white shadow">
              {countdownBadge(days, sl)}
            </span>
          </div>
          <DialogTitle className="text-center text-xl font-bold leading-snug">{title}</DialogTitle>
          <DialogDescription className="text-center text-sm leading-relaxed text-foreground/80">{text}</DialogDescription>
          <p className="text-center text-xs text-muted-foreground">
            {sl ? "Sobota, 21. 11. ob 16.00 · Dancelife, Šmartinska 106, Ljubljana" : "Saturday 21 Nov, 4 pm · Dancelife, Šmartinska 106, Ljubljana"}
          </p>

          <div className="flex flex-col gap-2 pt-1">
            {mood === "going" ? (
              <>
                <Button className="h-12 text-base" onClick={() => setOpen(false)}>{sl ? "Komaj čakam! 🙌" : "Can't wait! 🙌"}</Button>
                <Button variant="ghost" className="h-11" onClick={() => { setOpen(false); navigate(IN_APP_EVENT_PATH); }}>
                  {sl ? "Odpri dogodek" : "Open the event"}
                </Button>
              </>
            ) : (
              <>
                <Button className="h-12 text-base" onClick={goingNow} disabled={busy}>
                  {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {mood === "declined" ? (sl ? "Premislil/a sem se — pridem! 🙌" : "Changed my mind — I'm coming! 🙌") : (sl ? "Pridem! 🙌" : "I'm coming! 🙌")}
                </Button>
                <Button variant="outline" className="h-11" onClick={() => setOpen(false)} disabled={busy}>
                  {sl ? "Odločim se pozneje" : "I'll decide later"}
                </Button>
                {mood === "declined" ? (
                  <Button variant="ghost" className="h-10 text-sm text-muted-foreground" onClick={() => setOpen(false)} disabled={busy}>
                    {sl ? "Še vedno ne 😅" : "Still no 😅"}
                  </Button>
                ) : (
                  <Button variant="ghost" className="h-10 text-sm text-muted-foreground" onClick={notGoing} disabled={busy}>
                    {sl ? "Ne grem" : "I'm not going"}
                  </Button>
                )}
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
