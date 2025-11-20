import { useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function Radio() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    const existingScript = document.querySelector(
      'script[src="https://player.twitch.tv/js/embed/v1.js"]',
    ) as HTMLScriptElement | null;

    const createPlayer = () => {
      const Twitch = (window as any).Twitch;
      if (!Twitch || !Twitch.Player) return;

      new Twitch.Player("twitch-embed", {
        channel: "lanacoin",
        parent: ["lovable.dev", "lovable.app"],
        width: "100%",
        height: "100%",
      });
    };

    if (existingScript) {
      if ((window as any).Twitch) {
        createPlayer();
      } else {
        existingScript.addEventListener("load", createPlayer);
      }
      return;
    }

    const script = document.createElement("script");
    script.src = "https://player.twitch.tv/js/embed/v1.js";
    script.async = true;
    script.addEventListener("load", createPlayer);
    document.body.appendChild(script);

    return () => {
      script.removeEventListener("load", createPlayer);
    };
  }, []);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>LanaCoin Radio</CardTitle>
          <CardDescription>Listen to our live Twitch stream</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="aspect-video w-full">
            <div id="twitch-embed" className="w-full h-full rounded-lg overflow-hidden" />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
