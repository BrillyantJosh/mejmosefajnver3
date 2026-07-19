import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Play, Pause, Volume2, Loader2, RotateCcw, Download } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

// Touch devices (phones/tablets) block audio.play() unless it's called synchronously
// inside the tap gesture. So on touch we start playback via native streaming FIRST
// (play() invoked before any await), and only fall back to blob-fetch. On desktop we
// keep blob-first (works reliably there and gives the best seeking for Duration=0 WebM).
const IS_TOUCH =
  typeof window !== 'undefined' && (navigator.maxTouchPoints > 0 || 'ontouchstart' in window);

interface AudioPlayerProps {
  audioUrl: string;
  initialDuration?: number;
}

export function AudioPlayer({ audioUrl, initialDuration }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const blobUrlRef = useRef<string | null>(null);
  const loadedRef = useRef(false);
  const loadingAttemptRef = useRef(false); // true while loadAndPlay is trying src/blob — suppress the <audio> error event during fallbacks
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(initialDuration || 0);
  const [isLoading, setIsLoading] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [ready, setReady] = useState(false);

  const playbackSpeeds = [1, 1.25, 1.5, 1.75, 2];

  // Setup audio element events + cleanup
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onDurationChange = () => {
      if (isFinite(audio.duration) && audio.duration > 0) {
        setDuration(audio.duration);
      }
    };
    const onTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
      if (audio.currentTime > 0 && (!isFinite(audio.duration) || audio.duration <= 0)) {
        setDuration(prev => Math.max(prev, audio.currentTime + 0.5));
      }
    };
    const onEnded = () => { setIsPlaying(false); setCurrentTime(0); };
    const onError = () => {
      console.error('Audio error:', audio.error?.code, audio.error?.message);
      // Ignore errors while loadAndPlay is running — it handles its own fallbacks
      // (a failed native attempt must not flip the UI to "Retry" before the blob try).
      if (loadingAttemptRef.current) return;
      setIsLoading(false);
      setHasError(true);
    };

    audio.addEventListener('durationchange', onDurationChange);
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);

    return () => {
      // Stop playback and release resources on unmount
      audio.pause();
      audio.src = '';
      audio.removeEventListener('durationchange', onDurationChange);
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onError);
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, []);

  const loadAndPlay = async () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (ready) {
      audio.play().then(() => {
        audio.playbackRate = playbackRate;
        setIsPlaying(true);
      }).catch(() => {});
      return;
    }

    setIsLoading(true);
    setHasError(false);
    loadingAttemptRef.current = true;

    // Native streaming: set the direct URL and call play() SYNCHRONOUSLY (no await before
    // it) so a touch device keeps the tap gesture and doesn't block playback. Plays
    // progressively — no full download first.
    const tryNative = async () => {
      if (blobUrlRef.current) { URL.revokeObjectURL(blobUrlRef.current); blobUrlRef.current = null; }
      audio.src = audioUrl;
      audio.playbackRate = playbackRate;
      await audio.play();
      if (isFinite(audio.duration) && audio.duration > 0) setDuration(audio.duration);
      setReady(true);
      setIsPlaying(true);
    };

    // Blob download then play — reliable seeking for Duration=0 WebM (desktop Chrome).
    // Bounded by a 15s timeout so a slow file can't hang.
    const tryBlob = async () => {
      const controller = new AbortController();
      const fetchTimeout = setTimeout(() => controller.abort(), 15000);
      const response = await fetch(audioUrl, { signal: controller.signal });
      clearTimeout(fetchTimeout);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
      const url = URL.createObjectURL(blob);
      blobUrlRef.current = url;
      audio.src = url;
      setReady(true);
      try {
        await audio.play();
        audio.playbackRate = playbackRate;
        if (isFinite(audio.duration) && audio.duration > 0) setDuration(audio.duration);
        setIsPlaying(true);
      } catch {
        // Blob loaded but play() blocked (gesture gone after the fetch) — the next tap
        // plays it via the ready fast-path. NOT an error.
        setIsPlaying(false);
      }
    };

    // Touch → native first (gesture-safe); desktop → blob first (best seeking).
    const attempts = IS_TOUCH ? [tryNative, tryBlob] : [tryBlob, tryNative];
    try {
      try {
        await attempts[0]();
      } catch (primaryErr: any) {
        console.warn('Primary audio attempt failed, trying fallback:', primaryErr?.message || primaryErr);
        await attempts[1]();
      }
    } catch (err: any) {
      // Both attempts failed (e.g. 404 / genuinely unplayable) → show Retry.
      console.error('Audio load/play failed:', err?.message || err);
      setHasError(true);
    } finally {
      setIsLoading(false);
      loadingAttemptRef.current = false;
    }
  };

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (!ready) {
      loadAndPlay();
      return;
    }

    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      audio.play().then(() => {
        audio.playbackRate = playbackRate;
        setIsPlaying(true);
      }).catch(() => {});
    }
  };

  const handleSeek = (values: number[]) => {
    const audio = audioRef.current;
    if (!audio || !ready) return;
    audio.currentTime = values[0];
    setCurrentTime(values[0]);
  };

  const handleSpeedChange = (speed: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.playbackRate = speed;
    setPlaybackRate(speed);
  };

  const handleRetry = () => {
    setHasError(false);
    setReady(false);
    loadedRef.current = false;
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
    // Small delay then auto-play
    setTimeout(() => loadAndPlay(), 100);
  };

  const handleDownload = async () => {
    try {
      const response = await fetch(audioUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = audioUrl.split('/').pop() || 'audio.webm';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      // Fallback: open in new tab
      window.open(audioUrl, '_blank');
    }
  };

  const formatTime = (t: number): string => {
    if (!isFinite(t)) return '0:00';
    return `${Math.floor(t / 60)}:${Math.floor(t % 60).toString().padStart(2, '0')}`;
  };

  // Error state — show retry + download buttons
  if (hasError) {
    return (
      <div className="flex items-center gap-2 p-2 sm:p-3 bg-muted/50 rounded-lg my-1 w-full max-w-full min-w-0">
        <span className="text-xs text-destructive flex-shrink-0">Ni na voljo</span>
        <div className="flex-1" />
        <Button size="sm" variant="ghost" onClick={handleRetry} className="h-7 gap-1 text-xs">
          <RotateCcw className="h-3.5 w-3.5" />
          Retry
        </Button>
        <Button size="sm" variant="ghost" onClick={handleDownload} className="h-7 gap-1 text-xs">
          <Download className="h-3.5 w-3.5" />
          Download
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 sm:gap-3 p-2 sm:p-3 bg-muted/50 rounded-lg my-1 w-full max-w-full min-w-0 overflow-hidden">
      <Button
        size="sm"
        variant="ghost"
        onClick={togglePlay}
        disabled={isLoading}
        className="flex-shrink-0 h-9 w-9 p-0"
      >
        {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
      </Button>

      <Volume2 className="hidden sm:block h-5 w-5 text-muted-foreground flex-shrink-0" />

      <div className="flex-1 min-w-[48px] px-1 sm:px-2">
        <Slider
          value={[currentTime]}
          max={duration || 100}
          step={0.1}
          onValueChange={handleSeek}
          disabled={!ready}
          className="w-full [&_[role=slider]]:h-4 [&_[role=slider]]:w-4"
        />
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="flex-shrink-0 h-8 px-1.5 sm:px-2 text-[11px] sm:text-xs font-medium min-w-0">
            {playbackRate}x
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[60px]">
          {playbackSpeeds.map(s => (
            <DropdownMenuItem key={s} onClick={() => handleSpeedChange(s)} className={playbackRate === s ? 'bg-accent' : ''}>
              {s}x
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <span className="text-[11px] sm:text-xs flex-shrink-0 font-mono whitespace-nowrap text-right tabular-nums">
        <span className="text-muted-foreground">{formatTime(currentTime)} / {formatTime(duration)}</span>
      </span>

      <audio ref={audioRef} preload="none" />
    </div>
  );
}
