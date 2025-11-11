import { useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2 } from "lucide-react";

export default function LanaPaysRedirect() {
  useEffect(() => {
    window.location.href = "https://lanapays.us/login";
  }, []);

  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <Card>
        <CardContent className="p-8 text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4 text-primary" />
          <p className="text-muted-foreground">Redirecting to LanaPays.Us...</p>
        </CardContent>
      </Card>
    </div>
  );
}
