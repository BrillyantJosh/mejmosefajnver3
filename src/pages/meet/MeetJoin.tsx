import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Zap, Video, ExternalLink, Users, Globe, Lock, Eye, EyeOff } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { finalizeEvent } from "nostr-tools";
import { toast } from "sonner";

const MEET_BASE_URL = "https://meet.lanaloves.us";

interface ActiveRoom {
  roomId: string;
  participants: number;
  visibility?: 'public' | 'private';
  title?: string;
  createdByName?: string;
}

function generateRoomName(): string {
  const adjectives = ['lana', 'zeleni', 'modri', 'hitri', 'tihi', 'jasni', 'topli', 'svetli', 'mirni', 'zlati'];
  const nouns = ['svet', 'gozd', 'potok', 'veter', 'ogenj', 'kamen', 'zvon', 'oblak', 'luna', 'reka'];
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  const num = Math.floor(Math.random() * 100);
  return `${adj}-${noun}-${num}`;
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
  return btoa(unescape(encodeURIComponent(json)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export default function MeetJoin() {
  const { session } = useAuth();
  const [isPrivate, setIsPrivate] = useState(false);
  const [publicRooms, setPublicRooms] = useState<ActiveRoom[]>([]);
  const [loading, setLoading] = useState(true);

  // Fetch active public rooms
  useEffect(() => {
    if (!session) return;
    const fetchRooms = async () => {
      try {
        const token = createAuthToken(session);
        const [roomsRes, meetingsRes] = await Promise.allSettled([
          fetch(`${MEET_BASE_URL}/api/rooms`),
          fetch(`${MEET_BASE_URL}/api/meetings?auth=${token}`),
        ]);

        const activeRooms: ActiveRoom[] = [];

        // Get all active rooms from translation server
        if (roomsRes.status === 'fulfilled' && roomsRes.value.ok) {
          const data = await roomsRes.value.json();
          for (const r of data.rooms || []) {
            activeRooms.push({
              roomId: r.roomId,
              participants: r.participants,
              visibility: 'public', // default — will be overridden by meeting data
            });
          }
        }

        // Merge meeting metadata (visibility, title, creator)
        if (meetingsRes.status === 'fulfilled' && meetingsRes.value.ok) {
          const data = await meetingsRes.value.json();
          for (const m of data.meetings || []) {
            const existing = activeRooms.find(r => r.roomId === m.roomId);
            if (existing) {
              existing.visibility = m.visibility || 'public';
              existing.title = m.title;
              existing.createdByName = m.createdByName;
            }
          }
        }

        // Only show public rooms (filter out private ones)
        setPublicRooms(activeRooms.filter(r => r.visibility !== 'private'));
      } catch { /* silent */ }
      setLoading(false);
    };

    fetchRooms();
    const interval = setInterval(fetchRooms, 15000);
    return () => clearInterval(interval);
  }, [session]);

  const handleInstantMeet = useCallback(async () => {
    if (!session) return;
    const room = generateRoomName();
    const token = createAuthToken(session);
    const slug = room.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

    // Create meeting record with visibility
    try {
      await fetch(`${MEET_BASE_URL}/api/meetings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: room,
          roomId: slug,
          authToken: token,
          visibility: isPrivate ? 'private' : 'public',
          invitees: [],
        }),
      });
    } catch {
      // Meeting record creation is optional — room still works
    }

    const url = `${MEET_BASE_URL}/${slug}?lana_token=${token}`;
    window.open(url, '_blank');
    toast.success(isPrivate ? 'Zasebni sestanek ustvarjen' : 'Javni sestanek ustvarjen');
  }, [session, isPrivate]);

  const handleJoinRoom = useCallback((roomId: string) => {
    if (!session) return;
    const token = createAuthToken(session);
    const url = `${MEET_BASE_URL}/${roomId}?lana_token=${token}`;
    window.open(url, '_blank');
  }, [session]);

  return (
    <div className="space-y-4 px-3 sm:px-4 pb-24">
      <div className="flex items-center gap-2 mb-4">
        <Zap className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
        <h1 className="text-lg sm:text-2xl font-bold">Lana Meet</h1>
      </div>

      {/* Instant Meeting */}
      <Card className="border-primary/20 overflow-hidden">
        <CardContent className="p-4 space-y-3">
          {/* Visibility Toggle */}
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-muted-foreground">Vrsta sestanka</span>
            <button
              onClick={() => setIsPrivate(!isPrivate)}
              className={`
                flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-all
                ${isPrivate
                  ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/30'
                  : 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/30'
                }
              `}
            >
              {isPrivate ? (
                <>
                  <EyeOff className="h-3.5 w-3.5" />
                  Zasebni
                </>
              ) : (
                <>
                  <Eye className="h-3.5 w-3.5" />
                  Javni
                </>
              )}
            </button>
          </div>

          <p className="text-xs text-muted-foreground">
            {isPrivate
              ? 'Zasebni sestanek — ne prikazuje se na seznamu aktivnih sob. Samo osebe s povezavo se lahko pridružijo.'
              : 'Javni sestanek — viden na seznamu aktivnih sob. Kdorkoli se lahko pridruži.'
            }
          </p>

          {/* Start Button */}
          <Button onClick={handleInstantMeet} className="w-full" size="lg">
            <Zap className="mr-2 h-5 w-5" />
            Začni sestanek
          </Button>
        </CardContent>
      </Card>

      {/* Active Public Rooms */}
      <div className="space-y-2">
        <div className="flex items-center gap-1.5 px-1">
          <Globe className="h-3.5 w-3.5 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-muted-foreground">Aktivni javni pogovori</h2>
        </div>

        {loading && (
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <div className="h-4 w-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                Nalagam...
              </div>
            </CardContent>
          </Card>
        )}

        {!loading && publicRooms.length === 0 && (
          <Card>
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground text-center py-2">
                Ni aktivnih javnih pogovorov. Začni prvega! 🚀
              </p>
            </CardContent>
          </Card>
        )}

        {!loading && publicRooms.map((room) => (
          <Card
            key={room.roomId}
            className="cursor-pointer hover:border-primary/30 transition-colors border-green-500/40 bg-green-500/5"
            onClick={() => handleJoinRoom(room.roomId)}
          >
            <CardContent className="p-3 flex items-center justify-between">
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className="bg-green-500/10 p-1.5 rounded-full flex-shrink-0">
                  <Video className="h-3.5 w-3.5 text-green-500" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <p className="font-medium text-sm truncate">{room.title || room.roomId}</p>
                    <span className="text-[10px] font-bold text-green-600 bg-green-100 dark:bg-green-900/30 dark:text-green-400 px-1.5 py-0.5 rounded-full flex-shrink-0">
                      V ŽIVO
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span className="flex items-center gap-0.5">
                      <Users className="h-2.5 w-2.5" />
                      {room.participants} {room.participants === 1 ? 'udeleženec' : 'udeležencev'}
                    </span>
                    {room.createdByName && <span>• {room.createdByName}</span>}
                  </div>
                </div>
              </div>
              <Button size="sm" variant="ghost" className="flex-shrink-0 text-green-600 dark:text-green-400 hover:text-green-700 hover:bg-green-500/10">
                <ExternalLink className="h-3.5 w-3.5" />
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
