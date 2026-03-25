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

  const playbackSpeeds = [1, 1.25, 1.5, 1.75, 2];

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleLoadedMetadata = () => {
      // WebM files from MediaRecorder often report Infinity duration.
      // Only update if we got a valid finite duration from the audio element.
      if (isFinite(audio.duration) && audio.duration > 0) {
        setDuration(audio.duration);
      }
      setIsLoading(false);
    };

    const handleDurationChange = () => {
      // Browser may resolve the real duration later (e.g. after seeking).
      if (isFinite(audio.duration) && audio.duration > 0) {
        setDuration(audio.duration);
      }
    };

    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
      // While playing, track highest currentTime as fallback duration
      // (some WebM files never report finite duration)
      if (audio.currentTime > 0 && (!isFinite(audio.duration) || audio.duration <= 0)) {
        setDuration(prev => Math.max(prev, audio.currentTime + 0.5));
      }
    };

    const handleEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };

    const handleError = () => {
      setIsLoading(false);
      setHasError(true);
      const err = audio.error;
      console.error('Error loading audio:', audioUrl, {
        code: err?.code,
        message: err?.message,
        // 1=MEDIA_ERR_ABORTED, 2=MEDIA_ERR_NETWORK, 3=MEDIA_ERR_DECODE, 4=MEDIA_ERR_SRC_NOT_SUPPORTED
        codeName: err?.code === 1 ? 'ABORTED' : err?.code === 2 ? 'NETWORK' : err?.code === 3 ? 'DECODE' : err?.code === 4 ? 'SRC_NOT_SUPPORTED' : 'UNKNOWN',
        networkState: audio.networkState,
        readyState: audio.readyState,
      });
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
  }, [audioUrl]);

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
        src={audioUrl}
        preload="auto"
      />
    </div>
  );
}
