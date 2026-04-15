import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Film, Download, Play, Clock, HardDrive, RefreshCw, Timer, AlertTriangle, Share2, Check, Pencil } from "lucide-react";
import { useTranslation } from "@/i18n/I18nContext";
import meetTranslations from "@/i18n/modules/meet";
import { useAuth } from "@/contexts/AuthContext";
import { finalizeEvent } from "nostr-tools";

const MEET_BASE_URL = "https://meet.lanaloves.us";

interface Recording {
  id: string;
  roomName: string;
  videoFile: string;
  size: number;
  sizeFormatted: string;
  recordedAt: number;
  expiresAt: number;
  remainingDays: number;
  customTitle?: string | null;
  description?: string | null;
  creatorPubkey?: string | null;
  creatorName?: string | null;
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
    tags: [['relay', 'meet.lanaloves.us'], ['action', 'edit_recording']],
    content,
    pubkey: session.nostrHexId,
  };
  const signedEvent = finalizeEvent(eventTemplate, privateKeyBytes);
  const json = JSON.stringify(signedEvent);
  return btoa(unescape(encodeURIComponent(json)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

interface StorageInfo {
  diskTotal: number;
  diskUsed: number;
  diskAvailable: number;
  diskUsedPercent: number;
  recordingsSize: number;
  recordingsSizeFormatted: string;
  cleanupThreshold: number;
}

function formatDate(ts: number): string {
  const d = new Date(ts * 1000);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    + ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function formatBytes(bytes: number): string {
  if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(1) + ' GB';
  if (bytes >= 1048576) return (bytes / 1048576).toFixed(0) + ' MB';
  return (bytes / 1024).toFixed(0) + ' KB';
}

export default function MeetRecordings() {
  const { t } = useTranslation(meetTranslations);
  const { session } = useAuth();
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [editingRec, setEditingRec] = useState<Recording | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [saving, setSaving] = useState(false);

  const openEdit = useCallback((r: Recording) => {
    setEditingRec(r);
    setEditTitle(r.customTitle || r.roomName);
    setEditDesc(r.description || "");
  }, []);

  const saveEdit = useCallback(async () => {
    if (!editingRec || !session) return;
    setSaving(true);
    try {
      const token = createAuthToken(session);
      const res = await fetch(`${MEET_BASE_URL}/api/recordings/${editingRec.id}/meta`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customTitle: editTitle, description: editDesc, authToken: token }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Save failed' }));
        throw new Error(err.error || 'Save failed');
      }
      // Update local state
      setRecordings(prev => prev.map(r => r.id === editingRec.id
        ? { ...r, customTitle: editTitle.trim() || null, description: editDesc.trim() || null }
        : r
      ));
      setEditingRec(null);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [editingRec, editTitle, editDesc, session]);

  const shareVideo = useCallback(async (r: Recording) => {
    const videoUrl = `${MEET_BASE_URL}/api/recordings/${r.id}/video`;

    // Try native share first (mobile)
    if (navigator.share) {
      try {
        await navigator.share({
          title: `Recording: ${r.roomName}`,
          text: `Meeting recording from ${new Date(r.recordedAt * 1000).toLocaleDateString()}`,
          url: videoUrl,
        });
        return;
      } catch (e) {
        // User cancelled or share failed, fall through to clipboard
        if ((e as Error).name === 'AbortError') return;
      }
    }

    // Fallback: copy link to clipboard
    try {
      await navigator.clipboard.writeText(videoUrl);
      setCopiedId(r.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // Final fallback
      const input = document.createElement('input');
      input.value = videoUrl;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      setCopiedId(r.id);
      setTimeout(() => setCopiedId(null), 2000);
    }
  }, []);

  const fetchRecordings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${MEET_BASE_URL}/api/recordings?_t=${Date.now()}`);
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      setRecordings(data.recordings || []);
      setStorage(data.storage || null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRecordings();
  }, [fetchRecordings]);

  if (loading) {
    return (
      <div className="px-4 space-y-4">
        <Skeleton className="h-8 w-48" />
        {[1, 2, 3].map(i => <Skeleton key={i} className="h-28 rounded-lg" />)}
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-4">
        <Card>
          <CardContent className="pt-6 text-center">
            <p className="text-destructive mb-3">{error}</p>
            <Button variant="outline" size="sm" onClick={fetchRecordings}>
              <RefreshCw className="w-4 h-4 mr-2" /> {t('recordings.retry')}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const diskPercent = storage?.diskUsedPercent ?? 0;
  const isWarning = diskPercent >= 75;
  const isCritical = diskPercent >= (storage?.cleanupThreshold ?? 90);

  return (
    <div className="px-4 space-y-4 pb-24">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold flex items-center gap-2">
          <Film className="w-5 h-5 text-primary" />
          {t('recordings.title')}
        </h1>
        <Button variant="ghost" size="sm" onClick={fetchRecordings}>
          <RefreshCw className="w-4 h-4" />
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">{t('recordings.description')}</p>

      {/* Storage Usage Bar */}
      {storage && (
        <Card className={isCritical ? 'border-red-500/50' : isWarning ? 'border-yellow-500/30' : ''}>
          <CardContent className="py-3 px-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <HardDrive className="w-4 h-4" />
                Server Storage
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {isCritical && <AlertTriangle className="w-3.5 h-3.5 text-red-500" />}
                <span className={isCritical ? 'text-red-500 font-semibold' : isWarning ? 'text-yellow-500' : ''}>
                  {diskPercent}% used
                </span>
              </div>
            </div>

            {/* Progress bar */}
            <div className="w-full h-2.5 bg-muted rounded-full overflow-hidden mb-2">
              <div
                className={`h-full rounded-full transition-all ${
                  isCritical ? 'bg-red-500' :
                  isWarning ? 'bg-yellow-500' :
                  'bg-primary'
                }`}
                style={{ width: `${Math.min(diskPercent, 100)}%` }}
              />
            </div>

            <div className="flex justify-between text-[11px] text-muted-foreground">
              <span>
                Recordings: <span className="font-medium text-foreground">{storage.recordingsSizeFormatted}</span>
              </span>
              <span>
                {formatBytes(storage.diskUsed)} / {formatBytes(storage.diskTotal)}
              </span>
            </div>

            {isCritical && (
              <p className="text-[11px] text-red-500 mt-1.5">
                Auto-cleanup active: oldest recordings will be deleted to free space
              </p>
            )}
            {!isCritical && diskPercent >= 80 && (
              <p className="text-[11px] text-yellow-500 mt-1.5">
                Auto-cleanup starts at {storage.cleanupThreshold}% — oldest recordings deleted first
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Recordings list */}
      {recordings.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            <Film className="w-10 h-10 mx-auto mb-3 opacity-30" />
            {t('recordings.noRecordings')}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {recordings.map(r => (
            <Card key={r.id} className="overflow-hidden">
              <CardContent className="p-0">
                {/* Video player (if playing) */}
                {playingId === r.id && (
                  <div className="bg-black">
                    <video
                      controls
                      autoPlay
                      className="w-full max-h-[60vh]"
                      src={`${MEET_BASE_URL}/api/recordings/${r.id}/video`}
                    >
                      Your browser does not support video playback.
                    </video>
                  </div>
                )}

                <div className="p-3">
                  {/* Room name & expiry */}
                  <div className="flex items-start justify-between mb-2 gap-2">
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-medium break-words">{r.customTitle || r.roomName}</h3>
                      {r.customTitle && (
                        <div className="text-[10px] text-muted-foreground mt-0.5">{r.roomName}</div>
                      )}
                      {r.creatorName && (
                        <div className="text-xs text-primary/90 font-medium mt-1">
                          {t('recordings.startedBy')}: {r.creatorName}
                        </div>
                      )}
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {formatDate(r.recordedAt)}
                        </span>
                        <span className="flex items-center gap-1">
                          <HardDrive className="w-3 h-3" />
                          {r.sizeFormatted}
                        </span>
                      </div>
                    </div>
                    <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full flex items-center gap-1 shrink-0 ${
                      r.remainingDays <= 3 ? 'bg-red-500/10 text-red-500' :
                      r.remainingDays <= 7 ? 'bg-yellow-500/10 text-yellow-500' :
                      'bg-green-500/10 text-green-500'
                    }`}>
                      <Timer className="w-3 h-3" />
                      {t('recordings.daysLeft', { count: r.remainingDays })}
                    </span>
                  </div>

                  {/* Description (visible to everyone) */}
                  {r.description && (
                    <div className="text-xs text-foreground/80 bg-muted/40 rounded-md px-3 py-2 mb-2 whitespace-pre-wrap break-words">
                      {r.description}
                    </div>
                  )}

                  {/* Action buttons */}
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant={playingId === r.id ? "default" : "outline"}
                      className="flex-1"
                      onClick={() => setPlayingId(playingId === r.id ? null : r.id)}
                    >
                      <Play className="w-3.5 h-3.5 mr-1" />
                      {playingId === r.id ? t('recordings.close') : t('recordings.play')}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1"
                      asChild
                    >
                      <a href={`${MEET_BASE_URL}/api/recordings/${r.id}/download`} download>
                        <Download className="w-3.5 h-3.5 mr-1" />
                        {t('recordings.download')}
                      </a>
                    </Button>
                    <Button
                      size="sm"
                      variant={copiedId === r.id ? "default" : "outline"}
                      className="flex-1"
                      onClick={() => shareVideo(r)}
                    >
                      {copiedId === r.id ? (
                        <><Check className="w-3.5 h-3.5 mr-1" /> Copied!</>
                      ) : (
                        <><Share2 className="w-3.5 h-3.5 mr-1" /> Share</>
                      )}
                    </Button>
                    {session && r.creatorPubkey === session.nostrHexId && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openEdit(r)}
                        title={t('recordings.edit')}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Edit dialog (moderator only) */}
      <Dialog open={!!editingRec} onOpenChange={(open) => !open && setEditingRec(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('recordings.editTitle')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium mb-1 block">{t('recordings.nameLabel')}</label>
              <Input
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                maxLength={200}
                placeholder={t('recordings.namePlaceholder')}
              />
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block">{t('recordings.descriptionLabel')}</label>
              <Textarea
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
                maxLength={2000}
                rows={5}
                placeholder={t('recordings.descriptionPlaceholder')}
              />
              <div className="text-[10px] text-muted-foreground mt-1">{editDesc.length}/2000</div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingRec(null)} disabled={saving}>
              {t('recordings.cancel')}
            </Button>
            <Button onClick={saveEdit} disabled={saving}>
              {saving ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : null}
              {t('recordings.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
