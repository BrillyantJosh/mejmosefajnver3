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

interface AudioPlayerProps {
  audioUrl: string;
  initialDuration?: number;
}

export function AudioPlayer({ audioUrl, initialDuration }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const blobUrlRef = useRef<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(initialDuration || 0);
  const [isLoading, setIsLoading] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [ready, setReady] = useState(false);

  const playbackSpeeds = [1, 1.25, 1.5, 1.75, 2];

  // Setup audio element events
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
      setIsLoading(false);
      setHasError(true);
    };

    audio.addEventListener('durationchange', onDurationChange);
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);

    return () => {
      audio.removeEventListener('durationchange', onDurationChange);
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onError);
    };
  }, []);

  // Cleanup blob on unmount
  useEffect(() => {
    return () => {
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    };
  }, []);

  const loadAndPlay = async () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (ready) {
      audio.play().then(() => setIsPlaying(true)).catch(() => {});
      return;
    }

    setIsLoading(true);
    setHasError(false);

    try {
      // Fetch as blob — works on both Chrome and Safari
      // Chrome needs blob URL for stereo Opus + Duration=0 WebM files
      // Safari also handles blob URLs fine
      const response = await fetch(audioUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();

      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
      const url = URL.createObjectURL(blob);
      blobUrlRef.current = url;

      // Set src and immediately try to play
      audio.src = url;

      // play() returns a promise — resolves when playback starts
      await audio.play();

      if (isFinite(audio.duration) && audio.duration > 0) {
        setDuration(audio.duration);
      }

      setReady(true);
      setIsLoading(false);
      setIsPlaying(true);
    } catch (err: any) {
      // play() rejected — might be autoplay policy or decode error
      console.error('Error loading/playing audio:', err?.message || err);

      // If we got the blob loaded but play failed (autoplay policy),
      // mark as ready so user can click play again
      if (audio.src && audio.readyState >= 2) {
        setReady(true);
        setIsLoading(false);
        setIsPlaying(false);
      } else {
        setIsLoading(false);
        setHasError(true);
      }
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
      audio.play().then(() => setIsPlaying(true)).catch(() => {});
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
      <div className="flex items-center gap-2 p-3 bg-muted/50 rounded-lg my-1 w-full max-w-full min-w-[280px]">
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
    <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg my-1 w-full max-w-full min-w-[280px]">
      <Button
        size="sm"
        variant="ghost"
        onClick={togglePlay}
        disabled={isLoading}
        className="flex-shrink-0 h-9 w-9 p-0"
      >
        {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
      </Button>

      <Volume2 className="h-5 w-5 text-muted-foreground flex-shrink-0" />

      <div className="flex-1 min-w-[100px] px-2">
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
          <Button variant="ghost" size="sm" className="flex-shrink-0 h-8 px-2 text-xs font-medium min-w-[45px]">
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

      <span className="text-xs flex-shrink-0 font-mono whitespace-nowrap min-w-[70px] text-right">
        <span className="text-muted-foreground">{formatTime(currentTime)} / {formatTime(duration)}</span>
      </span>

      <audio ref={audioRef} preload="none" />
    </div>
  );
}
