import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Users, RefreshCw, Video, ExternalLink } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { finalizeEvent } from "nostr-tools";

const MEET_BASE_URL = "https://meet.lanaloves.us";
const HEALTH_URL = "https://meet.lanaloves.us/health-translation";

interface RoomInfo {
  roomId: string;
  participants: number;
}

function createAuthToken(session: { nostrHexId: string; nostrPrivateKey: string; profileName?: string; profileDisplayName?: string; profileLang?: string }): string {
  const privateKeyBytes = new Uint8Array(
    session.nostrPrivateKey.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16))
  );
  const content = JSON.stringify({
    name: session.profileDisplayName || session.profileName || 'Anon',
    lang: session.profileLang || 'sl',
  });
  const eventTemplate = {
    kind: 22242,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['relay', 'meet.lanaloves.us'], ['action', 'join']],
    content,
    pubkey: session.nostrHexId,
  };
  const signedEvent = finalizeEvent(eventTemplate, privateKeyBytes);
  const json = JSON.stringify(signedEvent);
  const base64 = btoa(unescape(encodeURIComponent(json)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return base64;
}

export default function MeetActive() {
  const { session } = useAuth();
  const [rooms, setRooms] = useState<RoomInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRooms = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(MEET_BASE_URL + '/api/rooms');
      if (!res.ok) throw new Error('Failed to fetch rooms');
      const data = await res.json();
      setRooms(data.rooms || []);
    } catch (err) {
      // Fallback to health endpoint
      try {
        const res = await fetch(HEALTH_URL);
        const data = await res.json();
        if (data.rooms > 0) {
          setRooms([{ roomId: '(active)', participants: data.participants }]);
        } else {
          setRooms([]);
        }
      } catch {
        setError('Ne morem se povezati s strežnikom');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRooms();
    const interval = setInterval(fetchRooms, 15000);
    return () => clearInterval(interval);
  }, [fetchRooms]);

  const handleJoin = (roomId: string) => {
    if (!session) return;
    const token = createAuthToken(session);
    const url = `${MEET_BASE_URL}/${roomId}?lana_token=${token}`;
    window.open(url, '_blank');
  };

  return (
    <div className="space-y-3 px-3 sm:px-4 pb-24">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
          <h1 className="text-lg sm:text-2xl font-bold">Aktivne sobe</h1>
        </div>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={fetchRooms} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {loading && (
        <div className="space-y-3">
          {[1, 2].map(i => <Skeleton key={i} className="h-20 w-full" />)}
        </div>
      )}

      {error && (
        <Card>
          <CardContent className="p-6">
            <p className="text-destructive">{error}</p>
          </CardContent>
        </Card>
      )}

      {!loading && !error && rooms.length === 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Ni aktivnih sob</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Trenutno ni nobene aktivne sobe. Ustvari novo sebo v zavihku "Join".
            </p>
          </CardContent>
        </Card>
      )}

      {!loading && !error && rooms.length > 0 && (
        <div className="space-y-3">
          {rooms.map((room) => (
            <Card key={room.roomId} className="cursor-pointer hover:border-primary/30 transition-colors" onClick={() => handleJoin(room.roomId)}>
              <CardContent className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="bg-primary/10 p-2 rounded-full">
                    <Video className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium text-sm">{room.roomId}</p>
                    <p className="text-xs text-muted-foreground">{room.participants} udeležencev</p>
                  </div>
                </div>
                <Button size="sm" variant="ghost">
                  <ExternalLink className="h-4 w-4" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
