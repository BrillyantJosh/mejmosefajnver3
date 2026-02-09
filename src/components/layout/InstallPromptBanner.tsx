import { X, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  show: boolean;
  isIOS: boolean;
  canInstall: boolean;
  onInstall?: () => void;
  onDismiss: () => void;
  onOpenHelp: () => void;
};

export default function InstallPromptBanner({
  show,
  isIOS,
  canInstall,
  onInstall,
  onDismiss,
  onOpenHelp,
}: Props) {
  if (!show) return null;

  return (
    <div className="bg-primary text-primary-foreground px-4 py-2 flex items-center justify-between gap-2">
      <button
        type="button"
        onClick={onOpenHelp}
        className="flex items-center gap-2 min-w-0 flex-1 text-left"
        aria-label="App installation instructions"
      >
        <Smartphone className="h-4 w-4 flex-shrink-0" />
        <span className="text-sm truncate">
          {isIOS ? "Install on iPhone: tap for instructions" : "Install app"}
        </span>
      </button>

      <div className="flex items-center gap-1 flex-shrink-0">
        {!isIOS && canInstall && onInstall && (
          <Button
            size="sm"
            variant="secondary"
            onClick={onInstall}
            className="h-7 px-2 text-xs"
          >
            Install
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          onClick={onDismiss}
          className="h-7 w-7 p-0 hover:bg-primary-foreground/20"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
