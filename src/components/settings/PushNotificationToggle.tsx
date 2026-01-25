import { Bell, BellOff, Loader2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { toast } from "@/hooks/use-toast";

export function PushNotificationToggle() {
  const { 
    isSupported, 
    isSubscribed, 
    permission, 
    loading, 
    error,
    subscribe, 
    unsubscribe 
  } = usePushNotifications();

  if (!isSupported) {
    return (
      <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
        <div className="flex items-center gap-3">
          <BellOff className="h-5 w-5 text-muted-foreground" />
          <div>
            <Label className="text-sm font-medium">Push Notifications</Label>
            <p className="text-xs text-muted-foreground">Not supported in this browser</p>
          </div>
        </div>
      </div>
    );
  }

  const handleToggle = async () => {
    if (loading) return;

    if (isSubscribed) {
      const success = await unsubscribe();
      if (success) {
        toast({
          title: "Notifications disabled",
          description: "You won't receive push notifications for new messages.",
        });
      }
    } else {
      const success = await subscribe();
      if (success) {
        toast({
          title: "Notifications enabled",
          description: "You'll receive push notifications for new messages.",
        });
      } else if (permission === 'denied') {
        toast({
          title: "Permission denied",
          description: "Please enable notifications in your browser settings.",
          variant: "destructive",
        });
      }
    }
  };

  return (
    <div className="flex items-center justify-between p-4 bg-card border rounded-lg">
      <div className="flex items-center gap-3">
        {isSubscribed ? (
          <Bell className="h-5 w-5 text-primary" />
        ) : (
          <BellOff className="h-5 w-5 text-muted-foreground" />
        )}
        <div>
          <Label htmlFor="push-toggle" className="text-sm font-medium cursor-pointer">
            Push Notifications
          </Label>
          <p className="text-xs text-muted-foreground">
            {isSubscribed 
              ? "Receive alerts for new messages" 
              : permission === 'denied' 
                ? "Blocked in browser settings" 
                : "Get notified about new DMs"}
          </p>
          {error && <p className="text-xs text-destructive mt-1">{error}</p>}
        </div>
      </div>
      <div className="flex items-center gap-2">
        {loading && <Loader2 className="h-4 w-4 animate-spin" />}
        <Switch
          id="push-toggle"
          checked={isSubscribed}
          onCheckedChange={handleToggle}
          disabled={loading || permission === 'denied'}
        />
      </div>
    </div>
  );
}
