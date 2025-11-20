import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useState } from "react";

const albums = [
  {
    id: 1,
    title: "Album 1",
    playlistId: "OLAK5uy_msjCLfZhjDku8kFyVrZKS2PcbCjLBB1DE",
  },
  {
    id: 2,
    title: "Album 2",
    playlistId: "OLAK5uy_l3i5JTzAaWzNJPNWu5USyOSAb9mazAzxI",
  },
  {
    id: 3,
    title: "Album 3",
    playlistId: "OLAK5uy_nUfXA6ZH7NDOpmGr2SJr4CxKdifRicQcY",
  },
  {
    id: 4,
    title: "Album 4",
    playlistId: "OLAK5uy_kGROICMM9quSBalKPAl1Vr1qozhfOTqJ4",
  },
];

export default function Albums() {
  const [selectedAlbum, setSelectedAlbum] = useState<typeof albums[0] | null>(null);

  return (
    <div className="space-y-6">
      {selectedAlbum ? (
        <Card>
          <CardHeader>
            <CardTitle>{selectedAlbum.title}</CardTitle>
            <CardDescription>
              <button
                onClick={() => setSelectedAlbum(null)}
                className="text-primary hover:underline"
              >
                ← Back to albums
              </button>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="aspect-video w-full">
              <iframe
                src={`https://music.youtube.com/playlist?list=${selectedAlbum.playlistId}`}
                className="w-full h-full rounded-lg"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                title={selectedAlbum.title}
              />
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <div>
            <h2 className="text-2xl font-bold mb-2">Albums</h2>
            <p className="text-muted-foreground">Select an album to listen</p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {albums.map((album) => (
              <Card
                key={album.id}
                className="cursor-pointer hover:border-primary transition-colors"
                onClick={() => setSelectedAlbum(album)}
              >
                <CardHeader>
                  <CardTitle>{album.title}</CardTitle>
                  <CardDescription>Click to listen</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="aspect-video w-full bg-muted rounded-lg flex items-center justify-center">
                    <div className="text-center">
                      <p className="text-4xl mb-2">🎵</p>
                      <p className="text-sm text-muted-foreground">LanaKnights.eu</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
