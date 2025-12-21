import { Download, Info, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isIOS: boolean;
  isInAppBrowser: boolean;
  canInstall: boolean;
  onInstall?: () => void;
};

export default function InstallAppDialog({
  open,
  onOpenChange,
  isIOS,
  isInAppBrowser,
  canInstall,
  onInstall,
}: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Smartphone className="h-5 w-5" />
            Namesti aplikacijo
          </DialogTitle>
          <DialogDescription>
            Dodaj aplikacijo na začetni zaslon za hitrejši dostop in polnozaslonski način.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          {isIOS ? (
            <div className="space-y-3">
              {isInAppBrowser && (
                <div className="rounded-md border bg-muted/40 p-3">
                  <div className="flex items-start gap-2">
                    <Info className="mt-0.5 h-4 w-4" />
                    <p>
                      Videti je, da si v “in-app” brskalniku (WhatsApp/Instagram/Facebook). V tem načinu
                      “Add to Home Screen” pogosto ni na voljo.
                    </p>
                  </div>
                </div>
              )}

              <ol className="list-decimal pl-5 space-y-2">
                <li>
                  Odpri stran v <b>Safari</b> (ne v aplikacijskem brskalniku).
                </li>
                <li>
                  Pritisni <b>Share</b> (kvadratek s puščico navzgor).
                </li>
                <li>
                  Izberi <b>Add to Home Screen</b> (Dodaj na začetni zaslon).
                </li>
                <li>Potrdi z <b>Add</b>.</li>
              </ol>

              <div className="rounded-md border bg-muted/40 p-3">
                <p className="text-muted-foreground">
                  Na iOS ni gumba za “download” kot na računalniku—namestitev je vedno prek Share menija.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {canInstall ? (
                <Button onClick={onInstall} className="w-full">
                  <Download className="mr-2 h-4 w-4" />
                  Namesti zdaj
                </Button>
              ) : (
                <div className="rounded-md border bg-muted/40 p-3">
                  <p className="text-muted-foreground">
                    Če se gumb za namestitev ne prikaže: v Chromu odpri meni (⋮) → <b>Install app</b> ali
                    <b> Add to Home screen</b>.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
