import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function Songs() {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>LanaKnights.eu Songs</CardTitle>
          <CardDescription>Listen to our latest tracks</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="aspect-video w-full">
            <iframe
              src="https://music.youtube.com/playlist?list=OLAK5uy_lVfK102WPrn-VZzJCELkzOAmFCK6qglwQ"
              className="w-full h-full rounded-lg"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              title="LanaKnights.eu Songs Playlist"
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
