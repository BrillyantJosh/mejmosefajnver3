import { useState } from "react";
import { Loader2, Pin, PinOff } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useAdmin } from "@/contexts/AdminContext";
import { useLang } from "@/i18n/I18nContext";
import type { UfRequest } from "@/hooks/useUFData";
import { setUfRequestPinned, ufAdminErrorText } from "@/lib/ufAdminActions";
import { ufIsPinned } from "@/lib/ufPinned";

/**
 * "Na vrh" / "Odstrani z vrha" for one request (Jasna asked, Brilly approved, 23. 11. 2026),
 * signed with the administrator's key. Renders nothing for anyone who is not an administrator
 * of this module — and the server refuses anyone else whatever the page shows.
 */
export default function UFPinButton({ request, onDone }: { request: Pick<UfRequest, "id" | "title" | "pinnedAt">; onDone: () => void }) {
  const sl = useLang() === "sl";
  const { session } = useAuth();
  const { isUfAdmin } = useAdmin();
  const [busy, setBusy] = useState(false);

  if (!isUfAdmin || !session?.nostrPrivateKey) return null;
  const privateKey = session.nostrPrivateKey;
  const pinned = ufIsPinned(request);

  const run = async (e: React.MouseEvent) => {
    // On a card the click would otherwise open the request.
    e.stopPropagation();
    setBusy(true);
    try {
      await setUfRequestPinned(request.id, !pinned, privateKey);
      toast.success(
        pinned
          ? sl ? `Odstranjeno z vrha: „${request.title}“.` : `Taken off the top: "${request.title}".`
          : sl ? `Na vrhu: „${request.title}“ je prvi v zavihku Odprti.` : `On top: "${request.title}" comes first in Open.`,
      );
    } catch (err) {
      toast.error(ufAdminErrorText(err, sl));
    } finally {
      setBusy(false);
      onDone();
    }
  };

  return (
    <Button size="sm" variant="outline" className="gap-1 self-start" disabled={busy} onClick={run}>
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
      {pinned ? (sl ? "Odstrani z vrha" : "Remove from top") : (sl ? "Na vrh" : "Pin to top")}
    </Button>
  );
}
