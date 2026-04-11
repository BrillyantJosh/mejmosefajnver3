import { useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Video, ExternalLink, Copy, Check } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { finalizeEvent } from "nostr-tools";
import { toast } from "sonner";

const MEET_BASE_URL = "https://meet.lanaloves.us";

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
    tags: [
      ['relay', 'meet.lanaloves.us'],
      ['action', 'join'],
    ],
    content,
    pubkey: session.nostrHexId,
  };

  const signedEvent = finalizeEvent(eventTemplate, privateKeyBytes);

  // Base64url encode the signed event
  const json = JSON.stringify(signedEvent);
  const base64 = btoa(unescape(encodeURIComponent(json)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return base64;
}

export default function MeetJoin() {
  const { session } = useAuth();
  const [roomName, setRoomName] = useState('');
  const [copied, setCopied] = useState(false);

  const handleJoin = useCallback((room: string) => {
    if (!session) return;
    if (!room.trim()) {
      toast.error('Vnesi ime sobe');
      return;
    }

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
    if (!roomName.trim()) {
      toast.error('Najprej vnesi ime sobe');
      return;
    }
    const slug = roomName.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    const url = `${MEET_BASE_URL}/${slug}`;
    navigator.clipboard.writeText(url);
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
          <CardDescription>
            Ustvari novo sobo in takoj začni sestanek
          </CardDescription>
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
          <CardDescription>
            Vnesi ime sobe ali prilepi povezavo
          </CardDescription>
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
            <Button
              onClick={() => handleJoin(roomName)}
              className="flex-1"
              disabled={!roomName.trim()}
            >
              <ExternalLink className="mr-2 h-4 w-4" />
              Pridruži se
            </Button>
            <Button
              variant="outline"
              onClick={handleCopyLink}
              disabled={!roomName.trim()}
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
        </CardContent>
      </Card>

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
