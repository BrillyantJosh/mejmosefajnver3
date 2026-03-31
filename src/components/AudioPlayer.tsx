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
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(initialDuration || 0);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [activeSrc, setActiveSrc] = useState(audioUrl);
  const retriedWithBlob = useRef(false);
  const blobUrlRef = useRef<string | null>(null);

  const playbackSpeeds = [1, 1.25, 1.5, 1.75, 2];

  // Cleanup blob URL on unmount
  useEffect(() => {
    return () => {
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    };
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleLoadedMetadata = () => {
      if (isFinite(audio.duration) && audio.duration > 0) {
        setDuration(audio.duration);
      }
      setIsLoading(false);
    };

    const handleCanPlay = () => {
      // Fallback for WebM files that skip loadedmetadata
      setIsLoading(false);
    };

    const handleDurationChange = () => {
      if (isFinite(audio.duration) && audio.duration > 0) {
        setDuration(audio.duration);
      }
    };

    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
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
      const msg = err?.message || '';

      // Only retry with blob for the specific Chrome FFmpegDemuxer seek failure
      if (!retriedWithBlob.current && (msg.includes('demuxer') || msg.includes('PIPELINE') || err?.code === 2)) {
        retriedWithBlob.current = true;
        console.log('🔄 FFmpegDemuxer error — retrying with blob URL...');
        try {
          const response = await fetch(audioUrl);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const blob = await response.blob();
          const url = URL.createObjectURL(blob);
          if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
          blobUrlRef.current = url;
          setHasError(false);
          setIsLoading(true);
          setActiveSrc(url);
          return; // Don't set error — retry in progress
        } catch (fetchErr) {
          console.error('Blob retry failed:', fetchErr);
        }
      }

      console.error('Error loading audio:', activeSrc, { code: err?.code, message: msg });
      setIsLoading(false);
      setHasError(true);
    };

    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('canplay', handleCanPlay);
    audio.addEventListener('durationchange', handleDurationChange);
    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('error', handleError);

    return () => {
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('canplay', handleCanPlay);
      audio.removeEventListener('durationchange', handleDurationChange);
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('error', handleError);
    };
  }, [activeSrc, audioUrl]);

  // Retry with blob URL when playback is stuck (plays silence, no error)
  const retryWithBlob = async () => {
    const audio = audioRef.current;
    if (!audio || retriedWithBlob.current) return;
    retriedWithBlob.current = true;

    console.log('🔄 Playback stuck — retrying with blob URL...');
    try {
      const response = await fetch(audioUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = url;

      const wasPlaying = !audio.paused;
      setActiveSrc(url);

      // Wait a tick for React to update the <audio> src, then play
      setTimeout(() => {
        const a = audioRef.current;
        if (a && wasPlaying) {
          a.play().then(() => setIsPlaying(true)).catch(() => {});
        }
      }, 100);
    } catch (err) {
      console.error('Blob retry failed:', err);
    }
  };

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      audio.play().then(() => {
        setIsPlaying(true);

        // Detect stuck playback: if after 1.5s currentTime is still 0,
        // the audio loaded but isn't actually producing sound (stereo
        // Opus + Duration=0 on Chrome). Retry with blob URL.
        if (!retriedWithBlob.current) {
          setTimeout(() => {
            const a = audioRef.current;
            if (a && !a.paused && a.currentTime < 0.1) {
              a.pause();
              retryWithBlob();
            }
          }, 1500);
        }
      }).catch(err => {
        console.error('Error playing audio:', err);
      });
    }
  };

  const handleSeek = (values: number[]) => {
    const audio = audioRef.current;
    if (!audio) return;
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
          disabled={isLoading}
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

      <audio
        ref={audioRef}
        src={activeSrc}
        preload="auto"
      />
    </div>
  );
}
