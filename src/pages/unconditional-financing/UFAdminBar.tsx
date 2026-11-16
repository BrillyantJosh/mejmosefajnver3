import { useState } from "react";
import { Archive, ArchiveRestore, CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/contexts/AuthContext";
import { useAdmin } from "@/contexts/AdminContext";
import { useLang } from "@/i18n/I18nContext";
import type { UfRequest } from "@/hooks/useUFData";
import { approveUfRequest, setUfRequestArchived, ufAdminErrorText } from "@/lib/ufAdminActions";

type Action = "approve" | "archive" | "restore";

export const ufAmountLabel = (r: Pick<UfRequest, "fiatGoal" | "currency">) =>
  `${Number(r.fiatGoal || 0).toLocaleString("sl-SI", { maximumFractionDigits: 2 })} ${r.currency}`;

/** Which administrator actions a request offers in its state. */
export const ufAdminActionsFor = (r: Pick<UfRequest, "approval" | "isArchived">): Action[] =>
  r.isArchived ? ["restore"] : r.approval === "pending" ? ["approve", "archive"] : ["archive"];

/**
 * Approve / Archive / Restore for one request, each confirmed first and signed with the
 * administrator's key (src/lib/ufAdminActions.ts). Renders nothing for anyone else.
 */
export default function UFAdminBar({ request, onDone, authorName }: { request: UfRequest; onDone: () => void; authorName?: string }) {
  const sl = useLang() === "sl";
  const { session } = useAuth();
  const { isUfAdmin } = useAdmin();
  const [confirm, setConfirm] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false);

  if (!isUfAdmin || !session?.nostrPrivateKey) return null;
  const privateKey = session.nostrPrivateKey;
  const actions = ufAdminActionsFor(request);

  const run = async (kind: Action) => {
    setConfirm(null);
    setBusy(true);
    try {
      if (kind === "approve") await approveUfRequest(request, privateKey);
      else await setUfRequestArchived(request.id, kind === "archive", privateKey);
      toast.success(
        kind === "approve"
          ? sl ? `Odobreno: „${request.title}“ (${ufAmountLabel(request)}) je zdaj javen.` : `Approved: "${request.title}" (${ufAmountLabel(request)}) is now public.`
          : kind === "archive"
            ? sl ? `Arhivirano: „${request.title}“.` : `Archived: "${request.title}".`
            : sl ? `Vrnjeno iz arhiva: „${request.title}“.` : `Restored: "${request.title}".`,
      );
    } catch (err) {
      toast.error(ufAdminErrorText(err, sl));
    } finally {
      setBusy(false);
      onDone();
    }
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {actions.includes("approve") && (
          <Button size="sm" className="gap-1 bg-green-600 hover:bg-green-700 text-white" disabled={busy} onClick={() => setConfirm("approve")}>
            <CheckCircle2 className="h-4 w-4" />{sl ? "Odobri" : "Approve"}
          </Button>
        )}
        {actions.includes("archive") && (
          <Button size="sm" variant="outline" className="gap-1" disabled={busy} onClick={() => setConfirm("archive")}>
            <Archive className="h-4 w-4" />{sl ? "Arhiviraj" : "Archive"}
          </Button>
        )}
        {actions.includes("restore") && (
          <Button size="sm" variant="outline" className="gap-1" disabled={busy} onClick={() => setConfirm("restore")}>
            <ArchiveRestore className="h-4 w-4" />{sl ? "Vrni iz arhiva" : "Restore"}
          </Button>
        )}
        {busy && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>

      <AlertDialog open={!!confirm} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm === "approve"
                ? sl ? "Odobriš ta zahtevek?" : "Approve this request?"
                : confirm === "archive"
                  ? sl ? "Arhiviraš ta zahtevek?" : "Archive this request?"
                  : sl ? "Vrneš ta zahtevek iz arhiva?" : "Restore this request?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              „{request.title}“{authorName ? ` · ${authorName}` : ""} · <strong>{ufAmountLabel(request)}</strong>
              <br />
              {confirm === "approve"
                ? sl
                  ? "Zahtevek postane javen in ga lahko financira kdorkoli. Znesek in valuta se zakleneta: avtor ju po odobritvi ne more več spremeniti."
                  : "The request becomes public and anyone may fund it. The amount and currency are locked: the author can no longer change them."
                : confirm === "archive"
                  ? sl
                    ? "Zahtevek izgine z javnega seznama in ga ni več mogoče financirati. Kar je že financirano, ostane zapisano, vračila so še mogoča. To lahko kadarkoli razveljaviš."
                    : "The request leaves the public list and can no longer be funded. What was funded stays recorded and repayments remain possible. You can undo this at any time."
                  : sl
                    ? "Zahtevek se vrne tja, kjer je bil (objavljen ali čaka na odobritev)."
                    : "The request returns to where it was (published, or waiting for approval)."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{sl ? "Prekliči" : "Cancel"}</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirm && void run(confirm)}>
              {confirm === "approve" ? (sl ? "Da, odobri" : "Yes, approve") : confirm === "archive" ? (sl ? "Da, arhiviraj" : "Yes, archive") : (sl ? "Da, vrni" : "Yes, restore")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
