import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Film, Download, Play, Clock, HardDrive, RefreshCw, Timer, AlertTriangle, Share2, Check } from "lucide-react";
import { useTranslation } from "@/i18n/I18nContext";
import meetTranslations from "@/i18n/modules/meet";

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
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

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
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <h3 className="text-sm font-medium">{r.roomName}</h3>
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
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
                    <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full flex items-center gap-1 ${
                      r.remainingDays <= 3 ? 'bg-red-500/10 text-red-500' :
                      r.remainingDays <= 7 ? 'bg-yellow-500/10 text-yellow-500' :
                      'bg-green-500/10 text-green-500'
                    }`}>
                      <Timer className="w-3 h-3" />
                      {t('recordings.daysLeft', { count: r.remainingDays })}
                    </span>
                  </div>

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
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
