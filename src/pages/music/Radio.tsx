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
          <div className="w-full">
            <iframe
              src="https://player.twitch.tv/?channel=lanacoin&parent=lovable.dev&parent=lovable.app"
              frameBorder="0"
              allowFullScreen
              scrolling="no"
              height="378"
              className="w-full rounded-lg"
              title="LanaCoin Twitch Stream"
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
