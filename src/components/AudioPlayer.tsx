import { useState, useRef, useEffect, useCallback } from 'react';
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
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(initialDuration || 0);
  const [isLoading, setIsLoading] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const loadedRef = useRef(false);

  const playbackSpeeds = [1, 1.25, 1.5, 1.75, 2];

  // Cleanup blob URL on unmount
  useEffect(() => {
    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [blobUrl]);

  // Audio event listeners — only active after blob is loaded
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !blobUrl) return;

    const handleLoadedMetadata = () => {
      if (isFinite(audio.duration) && audio.duration > 0) {
        setDuration(audio.duration);
      }
      setIsLoading(false);
      // Auto-play after loading
      audio.play().catch(() => {});
      setIsPlaying(true);
    };

    const handleDurationChange = () => {
      if (isFinite(audio.duration) && audio.duration > 0) {
        setDuration(audio.duration);
      }
    };

    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
      // Track highest currentTime as fallback duration for WebM without Duration
      if (audio.currentTime > 0 && (!isFinite(audio.duration) || audio.duration <= 0)) {
        setDuration(prev => Math.max(prev, audio.currentTime + 0.5));
      }
    };

    const handleEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };

    const handleError = () => {
      const err = audio.error;
      console.error('Error playing audio blob:', {
        code: err?.code,
        message: err?.message,
      });
      setIsLoading(false);
      setHasError(true);
    };

    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('durationchange', handleDurationChange);
    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('error', handleError);

    return () => {
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('durationchange', handleDurationChange);
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('error', handleError);
    };
  }, [blobUrl]);

  // Load audio as blob — called on first play click
  const loadAndPlay = useCallback(async () => {
    if (loadedRef.current || blobUrl) {
      // Already loaded — just toggle play
      const audio = audioRef.current;
      if (audio) {
        audio.play().catch(() => {});
        setIsPlaying(true);
      }
      return;
    }

    setIsLoading(true);
    setHasError(false);
    loadedRef.current = true;

    try {
      const response = await fetch(audioUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      setBlobUrl(url);
      // Audio element will auto-play via handleLoadedMetadata
    } catch (err) {
      console.error('Error loading audio:', audioUrl, err);
      setIsLoading(false);
      setHasError(true);
      loadedRef.current = false;
    }
  }, [audioUrl, blobUrl]);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (!blobUrl) {
      // First play — load as blob
      loadAndPlay();
      return;
    }

    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      audio.play().catch(() => {});
      setIsPlaying(true);
    }
  };

  const handleSeek = (values: number[]) => {
    const audio = audioRef.current;
    if (!audio || !blobUrl) return;

    const newTime = values[0];
    audio.currentTime = newTime;
    setCurrentTime(newTime);
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
      {/* Play/Pause Button */}
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

      {/* Waveform Icon */}
      <Volume2 className="h-5 w-5 text-muted-foreground flex-shrink-0" />

      {/* Seek Bar */}
      <div className="flex-1 min-w-[100px] px-2">
        <Slider
          value={[currentTime]}
          max={duration || 100}
          step={0.1}
          onValueChange={handleSeek}
          disabled={!blobUrl}
          className="w-full [&_[role=slider]]:h-4 [&_[role=slider]]:w-4"
        />
      </div>

      {/* Speed Control */}
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

      {/* Time Display / Error */}
      <span className="text-xs flex-shrink-0 font-mono whitespace-nowrap min-w-[70px] text-right">
        {hasError ? (
          <span className="text-destructive">Ni na voljo</span>
        ) : (
          <span className="text-muted-foreground">{formatTime(currentTime)} / {formatTime(duration)}</span>
        )}
      </span>

      {/* Hidden Audio Element — only gets src after user clicks play */}
      <audio
        ref={audioRef}
        src={blobUrl || undefined}
        preload="none"
      />
    </div>
  );
}
