import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Play, Pause, Volume2 } from 'lucide-react';
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
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const retriedRef = useRef(false);

  const playbackSpeeds = [1, 1.25, 1.5, 1.75, 2];

  // Cleanup blob URL on unmount
  useEffect(() => {
    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [blobUrl]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleLoadedMetadata = () => {
      if (isFinite(audio.duration) && audio.duration > 0) {
        setDuration(audio.duration);
      }
      setIsLoading(false);
      setHasError(false);
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

    const handleError = async () => {
      const err = audio.error;
      console.error('Error loading audio:', blobUrl || audioUrl, {
        code: err?.code,
        message: err?.message,
        codeName: err?.code === 1 ? 'ABORTED' : err?.code === 2 ? 'NETWORK' : err?.code === 3 ? 'DECODE' : err?.code === 4 ? 'SRC_NOT_SUPPORTED' : 'UNKNOWN',
        retried: retriedRef.current,
      });

      // Retry with blob URL — bypasses Chrome's network-layer demuxer which fails
      // on WebM files with Duration=0 and no Cues (common from MediaRecorder).
      // Blob URLs use a different code path that handles these files correctly.
      if (!retriedRef.current && !blobUrl) {
        retriedRef.current = true;
        console.log('🔄 Retrying audio with blob URL...');
        try {
          const response = await fetch(audioUrl);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const blob = await response.blob();
          const url = URL.createObjectURL(blob);
          setBlobUrl(url);
          // The audio element will be updated via the src prop change
          return; // Don't set error state yet — retry in progress
        } catch (fetchErr) {
          console.error('❌ Blob URL retry failed:', fetchErr);
        }
      }

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
  }, [audioUrl, blobUrl]);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      audio.pause();
    } else {
      audio.play().catch(err => {
        console.error('Error playing audio:', err);
      });
    }
    setIsPlaying(!isPlaying);
  };

  const handleSeek = (values: number[]) => {
    const audio = audioRef.current;
    if (!audio) return;

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
        {isPlaying ? (
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
          disabled={isLoading}
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

      {/* Hidden Audio Element */}
      <audio
        ref={audioRef}
        src={blobUrl || audioUrl}
        preload="auto"
      />
    </div>
  );
}
