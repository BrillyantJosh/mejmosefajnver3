import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Play, Pause, Volume2, Loader2 } from 'lucide-react';
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
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const blobUrlRef = useRef<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(initialDuration || 0);
  const [isLoading, setIsLoading] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [ready, setReady] = useState(false);

  const playbackSpeeds = [1, 1.25, 1.5, 1.75, 2];

  // Create a persistent Audio element (not managed by React rendering)
  useEffect(() => {
    const audio = new Audio();
    audio.preload = 'none';
    audioRef.current = audio;

    const onTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
      if (audio.currentTime > 0 && (!isFinite(audio.duration) || audio.duration <= 0)) {
        setDuration(prev => Math.max(prev, audio.currentTime + 0.5));
      }
    };
    const onDurationChange = () => {
      if (isFinite(audio.duration) && audio.duration > 0) {
        setDuration(audio.duration);
      }
    };
    const onEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };
    const onError = () => {
      console.error('Audio error:', audio.error?.message);
      setIsLoading(false);
      setHasError(true);
    };

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('durationchange', onDurationChange);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);

    return () => {
      audio.pause();
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('durationchange', onDurationChange);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onError);
      audio.src = '';
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, []);

  // Load audio as blob and play — called on first play click
  const loadAndPlay = async () => {
    const audio = audioRef.current;
    if (!audio) return;

    // Already loaded — just play
    if (ready) {
      audio.play().then(() => setIsPlaying(true)).catch(() => {});
      return;
    }

    setIsLoading(true);
    setHasError(false);

    try {
      const response = await fetch(audioUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);

      // Cleanup previous blob if any
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = url;

      // Set src and wait for canplay BEFORE trying to play
      audio.src = url;

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Audio load timeout')), 15000);

        const onReady = () => {
          clearTimeout(timeout);
          cleanup();
          resolve();
        };
        const onErr = () => {
          clearTimeout(timeout);
          cleanup();
          reject(new Error(audio.error?.message || 'Audio decode error'));
        };
        const cleanup = () => {
          audio.removeEventListener('canplay', onReady);
          audio.removeEventListener('loadeddata', onReady);
          audio.removeEventListener('error', onErr);
        };

        audio.addEventListener('canplay', onReady, { once: true });
        audio.addEventListener('loadeddata', onReady, { once: true });
        audio.addEventListener('error', onErr, { once: true });
        audio.load();
      });

      // Audio is ready — update duration and play
      if (isFinite(audio.duration) && audio.duration > 0) {
        setDuration(audio.duration);
      }
      setReady(true);
      setIsLoading(false);

      audio.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
    } catch (err: any) {
      console.error('Error loading audio:', audioUrl, err?.message);
      setIsLoading(false);
      setHasError(true);
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

  const formatTime = (timeInSeconds: number): string => {
    if (!isFinite(timeInSeconds)) return '0:00';
    const minutes = Math.floor(timeInSeconds / 60);
    const seconds = Math.floor(timeInSeconds % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg my-1 w-full max-w-full min-w-[280px]">
      <Button
        size="sm"
        variant="ghost"
        onClick={togglePlay}
        disabled={isLoading || hasError}
        className="flex-shrink-0 h-9 w-9 p-0"
      >
        {isLoading ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : isPlaying ? (
          <Pause className="h-5 w-5" />
        ) : (
          <Play className="h-5 w-5" />
        )}
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
          <Button
            variant="ghost"
            size="sm"
            className="flex-shrink-0 h-8 px-2 text-xs font-medium min-w-[45px]"
          >
            {playbackRate}x
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[60px]">
          {playbackSpeeds.map((speed) => (
            <DropdownMenuItem
              key={speed}
              onClick={() => handleSpeedChange(speed)}
              className={playbackRate === speed ? 'bg-accent' : ''}
            >
              {speed}x
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <span className="text-xs flex-shrink-0 font-mono whitespace-nowrap min-w-[70px] text-right">
        {hasError ? (
          <span className="text-destructive">Ni na voljo</span>
        ) : (
          <span className="text-muted-foreground">{formatTime(currentTime)} / {formatTime(duration)}</span>
        )}
      </span>
    </div>
  );
}
