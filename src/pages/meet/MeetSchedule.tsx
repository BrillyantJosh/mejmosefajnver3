import { useState, useEffect, useCallback, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { CalendarPlus, Copy, Check, Trash2, Clock, Users, Video, RefreshCw, Globe, Lock, Search, X, UserPlus } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { finalizeEvent } from "nostr-tools";
import { toast } from "sonner";
import { useNostrKind0Profiles } from "@/hooks/useNostrKind0Profiles";

const MEET_BASE_URL = "https://meet.lanaloves.us";

interface Invitee {
  pubkey: string;
  name: string;
}

interface Meeting {
  id: string;
  title: string;
  roomId: string;
  scheduledAt: string;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  visibility: 'public' | 'private';
  invitees: Invitee[];
  isLive: boolean;
  participantCount: number;
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

function generateSlug(title: string): string {
  return title.trim().toLowerCase()
    .replace(/[čć]/g, 'c').replace(/[šś]/g, 's').replace(/[žź]/g, 'z')
    .replace(/đ/g, 'd')
    .replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
    .slice(0, 40);
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('sl-SI', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function isInPast(iso: string): boolean {
  return new Date(iso) < new Date();
}

export default function MeetSchedule() {
  const { session } = useAuth();
  const { profiles } = useNostrKind0Profiles();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [invitees, setInvitees] = useState<Invitee[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Set default date/time to tomorrow at 10:00
  useEffect(() => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    setDate(tomorrow.toISOString().split('T')[0]);
    setTime('10:00');
  }, []);

  // Filter profiles for invitee search
  const searchResults = useMemo(() => {
    if (!searchQuery.trim() || !profiles) return [];
    const words = searchQuery.toLowerCase().split(/\s+/).filter(Boolean);
    const alreadyInvited = new Set(invitees.map(i => i.pubkey));
    return profiles
      .filter(p => {
        if (p.pubkey === session?.nostrHexId) return false; // exclude self
        if (alreadyInvited.has(p.pubkey)) return false;
        const searchable = [p.name, p.display_name, p.pubkey, p.location, p.about]
          .filter(Boolean).join(' ').toLowerCase();
        return words.every(word => searchable.includes(word));
      })
      .slice(0, 8);
  }, [searchQuery, profiles, invitees, session?.nostrHexId]);

  const fetchMeetings = useCallback(async () => {
    setLoading(true);
    try {
      let url = `${MEET_BASE_URL}/api/meetings`;
      if (session) {
        const token = createAuthToken(session);
        url += `?auth=${token}`;
      }
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setMeetings(data.meetings || []);
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    fetchMeetings();
    const interval = setInterval(fetchMeetings, 30000);
    return () => clearInterval(interval);
  }, [fetchMeetings]);

  const handleCreate = async () => {
    if (!session || !title.trim() || !date || !time) {
      toast.error('Izpolni vsa polja');
      return;
    }
    if (visibility === 'private' && invitees.length === 0) {
      toast.error('Dodaj vsaj enega udeleženca za zasebni sestanek');
      return;
    }

    setCreating(true);
    try {
      const token = createAuthToken(session);
      const scheduledAt = new Date(`${date}T${time}:00`).toISOString();
      const roomId = generateSlug(title) + '-' + Math.floor(Math.random() * 100);

      const res = await fetch(`${MEET_BASE_URL}/api/meetings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          roomId,
          scheduledAt,
          authToken: token,
          visibility,
          invitees: visibility === 'private' ? invitees : [],
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Napaka pri ustvarjanju');
      }

      const meeting = await res.json();
      toast.success('Sestanek ustvarjen!');
      setTitle('');
      setInvitees([]);
      setVisibility('public');

      const link = `${MEET_BASE_URL}/${meeting.roomId}`;
      await navigator.clipboard.writeText(link);
      toast.success('Povezava kopirana v odložišče');

      fetchMeetings();
    } catch (err: any) {
      toast.error(err.message || 'Napaka');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (meetingId: string) => {
    if (!session) return;
    try {
      const token = createAuthToken(session);
      const res = await fetch(`${MEET_BASE_URL}/api/meetings/${meetingId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        toast.success('Sestanek izbrisan');
        fetchMeetings();
      }
    } catch {
      toast.error('Napaka pri brisanju');
    }
  };

  const handleJoin = (roomId: string) => {
    if (!session) return;
    const token = createAuthToken(session);
    const url = `${MEET_BASE_URL}/${roomId}?lana_token=${token}`;
    window.open(url, '_blank');
  };

  const handleCopyLink = async (roomId: string, meetingId: string) => {
    const link = `${MEET_BASE_URL}/${roomId}`;
    await navigator.clipboard.writeText(link);
    setCopiedId(meetingId);
    toast.success('Povezava kopirana');
    setTimeout(() => setCopiedId(null), 2000);
  };

  const addInvitee = (pubkey: string, name: string) => {
    if (!invitees.some(i => i.pubkey === pubkey)) {
      setInvitees(prev => [...prev, { pubkey, name }]);
    }
    setSearchQuery('');
    setShowSearch(false);
  };

  const removeInvitee = (pubkey: string) => {
    setInvitees(prev => prev.filter(i => i.pubkey !== pubkey));
  };

  return (
    <div className="space-y-4 px-3 sm:px-4 pb-24">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <CalendarPlus className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
          <h1 className="text-lg sm:text-2xl font-bold">Načrtovani sestanki</h1>
        </div>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={fetchMeetings} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {/* Create Meeting */}
      <Card className="border-primary/20">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Ustvari sestanek</CardTitle>
          <CardDescription>
            Načrtuj sestanek in deli povezavo udeležencem
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="meet-title" className="text-xs text-muted-foreground">Naziv sestanka</Label>
            <Input
              id="meet-title"
              placeholder="npr. Tedni sestanek ekipe"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="flex gap-2">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="meet-date" className="text-xs text-muted-foreground">Datum</Label>
              <Input id="meet-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="meet-time" className="text-xs text-muted-foreground">Ura</Label>
              <Input id="meet-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </div>
          </div>

          {/* Visibility Toggle */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Vidnost</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                variant={visibility === 'public' ? 'default' : 'outline'}
                size="sm"
                className="flex-1"
                onClick={() => setVisibility('public')}
              >
                <Globe className="mr-1.5 h-3.5 w-3.5" />
                Javni
              </Button>
              <Button
                type="button"
                variant={visibility === 'private' ? 'default' : 'outline'}
                size="sm"
                className="flex-1"
                onClick={() => setVisibility('private')}
              >
                <Lock className="mr-1.5 h-3.5 w-3.5" />
                Zasebni
              </Button>
            </div>
          </div>

          {/* Invitees (only for private) */}
          {visibility === 'private' && (
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Povabljeni udeleženci</Label>

              {/* Invitee chips */}
              {invitees.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {invitees.map(inv => (
                    <span key={inv.pubkey} className="inline-flex items-center gap-1 bg-primary/10 text-primary text-xs px-2 py-1 rounded-full">
                      {inv.name}
                      <button onClick={() => removeInvitee(inv.pubkey)} className="hover:text-destructive">
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              {/* Search input */}
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Išči po imenu ali Nostr HEX ID..."
                  value={searchQuery}
                  onChange={(e) => { setSearchQuery(e.target.value); setShowSearch(true); }}
                  onFocus={() => setShowSearch(true)}
                  className="pl-8 h-9 text-sm"
                />
              </div>

              {/* Search results dropdown */}
              {showSearch && searchQuery.trim() && (
                <div className="border rounded-md bg-card max-h-48 overflow-y-auto">
                  {searchResults.length === 0 ? (
                    <div className="p-3 text-xs text-muted-foreground text-center">
                      Ni rezultatov za "{searchQuery}"
                    </div>
                  ) : (
                    searchResults.map(p => (
                      <button
                        key={p.pubkey}
                        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-muted/50 text-left transition-colors"
                        onClick={() => addInvitee(p.pubkey, p.display_name || p.name || p.pubkey.slice(0, 12))}
                      >
                        <UserPlus className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">{p.display_name || p.name || 'Anon'}</p>
                          <p className="text-[10px] text-muted-foreground font-mono truncate">{p.pubkey.slice(0, 16)}...</p>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              )}

              {/* Manual hex ID entry */}
              {showSearch && searchQuery.trim().length >= 64 && !searchResults.some(r => r.pubkey === searchQuery.trim()) && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full text-xs"
                  onClick={() => addInvitee(searchQuery.trim(), searchQuery.trim().slice(0, 12) + '...')}
                >
                  <UserPlus className="mr-1.5 h-3 w-3" />
                  Dodaj {searchQuery.trim().slice(0, 12)}...
                </Button>
              )}
            </div>
          )}

          <Button
            onClick={handleCreate}
            className="w-full"
            disabled={creating || !title.trim() || !date || !time || (visibility === 'private' && invitees.length === 0)}
          >
            {creating ? (
              <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <CalendarPlus className="mr-2 h-4 w-4" />
            )}
            Ustvari in kopiraj povezavo
          </Button>
        </CardContent>
      </Card>

      {/* Meetings List */}
      {loading && (
        <div className="space-y-3">
          {[1, 2].map(i => <Skeleton key={i} className="h-24 w-full" />)}
        </div>
      )}

      {!loading && meetings.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-sm text-muted-foreground">Ni načrtovanih sestankov</p>
          </CardContent>
        </Card>
      )}

      {!loading && meetings.length > 0 && (
        <div className="space-y-3">
          {meetings.map((m) => {
            const past = isInPast(m.scheduledAt);
            const isMine = m.createdBy === session?.nostrHexId;

            return (
              <Card key={m.id} className={`transition-colors ${m.isLive ? 'border-green-500/50 bg-green-500/5' : ''}`}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-sm truncate">{m.title}</p>
                        {m.visibility === 'private' ? (
                          <Lock className="h-3 w-3 text-amber-500 flex-shrink-0" />
                        ) : (
                          <Globe className="h-3 w-3 text-blue-500 flex-shrink-0" />
                        )}
                        {m.isLive && (
                          <span className="text-[10px] font-bold text-green-600 bg-green-100 dark:bg-green-900/30 dark:text-green-400 px-1.5 py-0.5 rounded-full">V ŽIVO</span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {formatDateTime(m.scheduledAt)}
                        </span>
                        {m.participantCount > 0 && (
                          <span className="flex items-center gap-1">
                            <Users className="h-3 w-3" />
                            {m.participantCount}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {m.createdByName}
                        {m.visibility === 'private' && m.invitees?.length > 0 && (
                          <span className="ml-1">· {m.invitees.length} povabljenih</span>
                        )}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <Button size="sm" variant="ghost" onClick={() => handleCopyLink(m.roomId, m.id)} title="Kopiraj povezavo">
                        {copiedId === m.id ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                      </Button>
                      <Button size="sm" variant={m.isLive || past ? "default" : "outline"} onClick={() => handleJoin(m.roomId)}>
                        <Video className="h-3.5 w-3.5 mr-1" />
                        {m.isLive ? 'Vstopi' : past ? 'Začni' : 'Pridruži se'}
                      </Button>
                      {isMine && (
                        <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => handleDelete(m.id)} title="Izbriši">
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
