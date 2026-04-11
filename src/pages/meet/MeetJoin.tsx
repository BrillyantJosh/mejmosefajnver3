import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Video, ExternalLink, Copy, Check, Clock, Users, Globe, Lock } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { finalizeEvent } from "nostr-tools";
import { toast } from "sonner";

const MEET_BASE_URL = "https://meet.lanaloves.us";

interface MeetingOrRoom {
  type: 'meeting' | 'room';
  id: string;
  title: string;
  roomId: string;
  scheduledAt?: string;
  createdByName?: string;
  visibility?: 'public' | 'private';
  invitees?: { pubkey: string; name: string }[];
  isLive: boolean;
  participantCount: number;
}

function generateRoomName(): string {
  const adjectives = ['lana', 'zeleni', 'modri', 'hitri', 'tihi', 'jasni', 'topli'];
  const nouns = ['svet', 'gozd', 'potok', 'veter', 'ogenj', 'kamen', 'zvon'];
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

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('sl-SI', {
    weekday: 'short', day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit',
  });
}

export default function MeetJoin() {
  const { session } = useAuth();
  const [roomName, setRoomName] = useState('');
  const [copied, setCopied] = useState(false);
  const [items, setItems] = useState<MeetingOrRoom[]>([]);

  // Fetch active rooms + scheduled meetings
  useEffect(() => {
    if (!session) return;
    const fetchAll = async () => {
      try {
        const token = createAuthToken(session);
        const [roomsRes, meetingsRes] = await Promise.allSettled([
          fetch(`${MEET_BASE_URL}/api/rooms`),
          fetch(`${MEET_BASE_URL}/api/meetings?auth=${token}`),
        ]);

        const combined: MeetingOrRoom[] = [];

        // Active rooms
        if (roomsRes.status === 'fulfilled' && roomsRes.value.ok) {
          const data = await roomsRes.value.json();
          for (const r of data.rooms || []) {
            combined.push({
              type: 'room',
              id: `room-${r.roomId}`,
              title: r.roomId,
              roomId: r.roomId,
              isLive: true,
              participantCount: r.participants,
            });
          }
        }

        // Scheduled meetings
        if (meetingsRes.status === 'fulfilled' && meetingsRes.value.ok) {
          const data = await meetingsRes.value.json();
          for (const m of data.meetings || []) {
            // Skip if already in rooms list as active
            if (!combined.some(c => c.roomId === m.roomId)) {
              combined.push({
                type: 'meeting',
                id: m.id,
                title: m.title,
                roomId: m.roomId,
                scheduledAt: m.scheduledAt,
                createdByName: m.createdByName,
                visibility: m.visibility,
                invitees: m.invitees,
                isLive: m.isLive,
                participantCount: m.participantCount,
              });
            } else {
              // Merge meeting info into existing room entry
              const existing = combined.find(c => c.roomId === m.roomId);
              if (existing) {
                existing.title = m.title;
                existing.scheduledAt = m.scheduledAt;
                existing.createdByName = m.createdByName;
                existing.visibility = m.visibility;
                existing.invitees = m.invitees;
              }
            }
          }
        }

        // Sort: live first, then by scheduled time
        combined.sort((a, b) => {
          if (a.isLive && !b.isLive) return -1;
          if (!a.isLive && b.isLive) return 1;
          if (a.scheduledAt && b.scheduledAt) return new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime();
          return 0;
        });

        setItems(combined);
      } catch { /* silent */ }
    };

    fetchAll();
    const interval = setInterval(fetchAll, 15000);
    return () => clearInterval(interval);
  }, [session]);

  const handleJoin = useCallback((room: string) => {
    if (!session) return;
    if (!room.trim()) { toast.error('Vnesi ime sobe'); return; }
    const token = createAuthToken(session);
    const slug = room.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    const url = `${MEET_BASE_URL}/${slug}?lana_token=${token}`;
    window.open(url, '_blank');
  }, [session]);

  const handleQuickStart = useCallback(() => {
    const room = generateRoomName();
    setRoomName(room);
    handleJoin(room);
  }, [handleJoin]);

  const handleCopyLink = useCallback(() => {
    if (!roomName.trim()) { toast.error('Najprej vnesi ime sobe'); return; }
    const slug = roomName.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    navigator.clipboard.writeText(`${MEET_BASE_URL}/${slug}`);
    setCopied(true);
    toast.success('Povezava kopirana');
    setTimeout(() => setCopied(false), 2000);
  }, [roomName]);

  const displayName = session?.profileDisplayName || session?.profileName || 'Anon';
  const displayLang = session?.profileLang || 'sl';

  return (
    <div className="space-y-4 px-3 sm:px-4 pb-24">
      <div className="flex items-center gap-2 mb-4">
        <Video className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
        <h1 className="text-lg sm:text-2xl font-bold">Lana Meet</h1>
      </div>

      {/* Quick Start */}
      <Card className="border-primary/20">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Hitri začetek</CardTitle>
          <CardDescription>Ustvari novo sobo in takoj začni sestanek</CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={handleQuickStart} className="w-full" size="lg">
            <Video className="mr-2 h-5 w-5" />
            Novi sestanek
          </Button>
        </CardContent>
      </Card>

      {/* Join Room */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Pridruži se sobi</CardTitle>
          <CardDescription>Vnesi ime sobe ali prilepi povezavo</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="room-name" className="text-xs text-muted-foreground">Ime sobe</Label>
            <Input
              id="room-name"
              placeholder="npr. moj-sestanek"
              value={roomName}
              onChange={(e) => setRoomName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleJoin(roomName)}
            />
          </div>
          <div className="flex gap-2">
            <Button onClick={() => handleJoin(roomName)} className="flex-1" disabled={!roomName.trim()}>
              <ExternalLink className="mr-2 h-4 w-4" />
              Pridruži se
            </Button>
            <Button variant="outline" onClick={handleCopyLink} disabled={!roomName.trim()}>
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Active rooms + Scheduled meetings */}
      {items.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground px-1">Aktivni in načrtovani</h2>
          {items.map((item) => (
            <Card
              key={item.id}
              className={`cursor-pointer hover:border-primary/30 transition-colors ${item.isLive ? 'border-green-500/50 bg-green-500/5' : ''}`}
              onClick={() => handleJoin(item.roomId)}
            >
              <CardContent className="p-3 flex items-center justify-between">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className={`p-1.5 rounded-full flex-shrink-0 ${item.isLive ? 'bg-green-500/10' : 'bg-primary/10'}`}>
                    <Video className={`h-3.5 w-3.5 ${item.isLive ? 'text-green-500' : 'text-primary'}`} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <p className="font-medium text-sm truncate">{item.title}</p>
                      {item.visibility === 'private' && <Lock className="h-3 w-3 text-amber-500 flex-shrink-0" />}
                      {item.visibility === 'public' && item.type === 'meeting' && <Globe className="h-3 w-3 text-blue-500 flex-shrink-0" />}
                      {item.isLive && (
                        <span className="text-[10px] font-bold text-green-600 bg-green-100 dark:bg-green-900/30 dark:text-green-400 px-1.5 py-0.5 rounded-full flex-shrink-0">V ŽIVO</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                      {item.scheduledAt && (
                        <span className="flex items-center gap-0.5">
                          <Clock className="h-2.5 w-2.5" />
                          {formatDateTime(item.scheduledAt)}
                        </span>
                      )}
                      {item.participantCount > 0 && (
                        <span className="flex items-center gap-0.5">
                          <Users className="h-2.5 w-2.5" />
                          {item.participantCount}
                        </span>
                      )}
                      {item.createdByName && <span>{item.createdByName}</span>}
                    </div>
                  </div>
                </div>
                <Button size="sm" variant="ghost" className="flex-shrink-0">
                  <ExternalLink className="h-3.5 w-3.5" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Session Info */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Prijavljen kot</span>
            <span className="font-medium">{displayName}</span>
          </div>
          <div className="flex items-center justify-between text-sm mt-1">
            <span className="text-muted-foreground">Jezik</span>
            <span className="font-medium">{displayLang.toUpperCase()}</span>
          </div>
          <p className="text-xs text-muted-foreground mt-3">
            Tvoje ime in jezik sta samodejno nastavljena iz tvojega profila. Prevod deluje v realnem času za vse udeležence.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
