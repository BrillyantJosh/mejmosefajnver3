import { Download, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import lanaLogo from "@/assets/lana-logo.png";

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
          <DialogTitle className="flex items-center gap-3">
            <img src={lanaLogo} alt="Lana" className="h-8 w-8 rounded" />
            Install App
          </DialogTitle>
          <DialogDescription>
            Add the app to your home screen for faster access and fullscreen mode.
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
                      It looks like you're in an in-app browser (WhatsApp/Instagram/Facebook). 
                      "Add to Home Screen" is often not available in this mode.
                    </p>
                  </div>
                </div>
              )}

              <ol className="list-decimal pl-5 space-y-2">
                <li>
                  Open this page in <b>Safari</b> (not in an in-app browser).
                </li>
                <li>
                  Tap the <b>Share</b> button (square with an arrow pointing up).
                </li>
                <li>
                  Select <b>Add to Home Screen</b>.
                </li>
                <li>Confirm by tapping <b>Add</b>.</li>
              </ol>

              <div className="rounded-md border bg-muted/40 p-3">
                <p className="text-muted-foreground">
                  On iOS there is no "download" button like on desktop—installation is always through the Share menu.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {canInstall ? (
                <Button onClick={onInstall} className="w-full">
                  <Download className="mr-2 h-4 w-4" />
                  Install Now
                </Button>
              ) : (
                <div className="rounded-md border bg-muted/40 p-3">
                  <p className="text-muted-foreground">
                    If the install button doesn't appear: in Chrome open the menu (⋮) → <b>Install app</b> or
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
