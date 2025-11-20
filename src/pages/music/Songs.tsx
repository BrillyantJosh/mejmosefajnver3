import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function Songs() {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>LanaKnights.eu Songs</CardTitle>
          <CardDescription>Listen to our latest tracks from Boomplay</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="w-full">
            <iframe
              src="https://www.boomplay.com/artists/115108800?srModel=COPYLINK&srList=WEB"
              className="w-full h-[600px] rounded-lg border-0"
              title="LanaKnights.eu Artist Page"
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
