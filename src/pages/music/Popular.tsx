import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const popularTracks = [
  { id: "221362633", title: "Popular Track 1" },
  { id: "217982886", title: "Popular Track 2" },
  { id: "221357958", title: "Popular Track 3" },
  { id: "223933330", title: "Popular Track 4" },
  { id: "218741759", title: "Popular Track 5" },
  { id: "217988091", title: "Popular Track 6" },
  { id: "217901791", title: "Popular Track 7" },
  { id: "217756270", title: "Popular Track 8" },
];

export default function Popular() {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Popular Tracks</CardTitle>
          <CardDescription>Most popular tracks from LanaKnights.eu</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4">
            {popularTracks.map((track) => (
              <div key={track.id} className="w-full">
                <iframe
                  src={`https://www.boomplay.com/embed/${track.id}/MUSIC?colType=${track.id === "221362633" || track.id === "217982886" || track.id === "221357958" ? "5&colID=118703033" : track.id === "223933330" || track.id === "218741759" ? "2&colID=115108800" : "&colID="}`}
                  className="w-full h-[420px] rounded-lg border-0"
                  title={track.title}
                />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
