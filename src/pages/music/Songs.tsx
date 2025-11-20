import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const songs = [
  { id: "217615629", title: "Song 1" },
  { id: "224124456", title: "Song 2" },
  { id: "223934560", title: "Song 3" },
  { id: "223934559", title: "Song 4" },
  { id: "223933331", title: "Song 5" },
  { id: "223933330", title: "Song 6" },
  { id: "223791119", title: "Song 7" },
  { id: "223791118", title: "Song 8" },
  { id: "223784380", title: "Song 9" },
  { id: "223783151", title: "Song 10" },
];

export default function Songs() {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>LanaKnights.eu Songs</CardTitle>
          <CardDescription>Listen to our latest tracks from Boomplay</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4">
              {songs.map((song) => (
                <div key={song.id} className="w-full">
                  <iframe
                    src={`https://www.boomplay.com/embed/${song.id}/MUSIC?colType=2&colID=115108800`}
                    className="w-full h-[420px] rounded-lg border-0"
                    title={song.title}
                  />
                </div>
              ))}
            </div>
        </CardContent>
      </Card>
    </div>
  );
}
