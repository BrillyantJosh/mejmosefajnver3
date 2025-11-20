import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function Radio() {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>LanaCoin Radio</CardTitle>
          <CardDescription>Listen to our live Twitch stream</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="aspect-video w-full">
            <iframe
              src="https://player.twitch.tv/?channel=lanacoin&parent=lovable.app&parent=lovable.dev"
              className="w-full h-full rounded-lg"
              allowFullScreen
              title="LanaCoin Twitch Stream"
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
