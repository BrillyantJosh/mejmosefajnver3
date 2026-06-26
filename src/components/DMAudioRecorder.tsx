import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Mic, Square, Loader2, Send, X, Play, Pause } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { Slider } from '@/components/ui/slider';

const MAX_RECORDING_SECONDS = 300; // 5 minutes — cap so messages stay small enough to upload
const WARNING_SECONDS = 240;       // warn at 4:00 (1 min left)

interface DMAudioRecorderProps {
  recipientPubkey: string;
  onAudioUploaded?: (audioUrl: string) => void;
  onSendMessage: (audioUrl: string) => Promise<void>;
  compact?: boolean;
  /** Fires the instant the mic button is tapped (true) and when start completes or fails
   *  (false), so the parent's visible button can show immediate "preparing…" feedback
   *  during the getUserMedia permission gap. */
  onStartChange?: (starting: boolean) => void;
}

export function DMAudioRecorder({ recipientPubkey, onAudioUploaded, onSendMessage, compact = false, onStartChange }: DMAudioRecorderProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [audioPreview, setAudioPreview] = useState<{ blob: Blob; url: string; mimeType: string } | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [recordingTime, setRecordingTime] = useState(0); // elapsed seconds while recording
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const startingRef = useRef(false); // guards against rapid repeat taps before recording starts
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { toast } = useToast();
  const { session } = useAuth();

  const clearRecordingTimer = () => {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
  };

  // Cleanup on unmount: stop the timer and release the mic if still held.
  useEffect(() => {
    return () => {
      clearRecordingTimer();
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  // Detect best supported MIME type
  const getSupportedMimeType = (): string => {
    const types = [
      'audio/webm;codecs=opus',  // Best compression
      'audio/webm',              // General WebM
      'audio/mp4',               // Safari/iOS
      'audio/aac',               // Fallback
      'audio/mpeg'               // MP3 fallback
    ];
    
    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) {
        return type;
      }
    }
    
    return 'audio/webm'; // Default
  };

  const startRecording = async () => {
    // Absorb rapid repeat taps: ignore if a start is already in flight or we're recording.
    // (Each tap previously queued another getUserMedia with no visible feedback.)
    if (startingRef.current || isRecording) return;
    startingRef.current = true;
    onStartChange?.(true); // instant feedback on the parent's button during the permission gap
    try {
      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      streamRef.current = stream;
      chunksRef.current = [];

      const mimeType = getSupportedMimeType();
      console.log('Recording started with MIME type:', mimeType);

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType,
        audioBitsPerSecond: 128000  // 128 kbps - good quality
      });

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = () => {
        clearRecordingTimer();
        const blob = new Blob(chunksRef.current, { type: mimeType });
        console.log('Audio blob size:', blob.size, 'Type:', blob.type);

        // Stop all tracks to release microphone
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(track => track.stop());
          streamRef.current = null;
        }

        // Create preview URL
        const previewUrl = URL.createObjectURL(blob);
        setAudioPreview({ blob, url: previewUrl, mimeType });
      };

      mediaRecorder.start();
      mediaRecorderRef.current = mediaRecorder;
      setIsRecording(true);

      // Recording timer: warn at 4:00, auto-stop at 5:00 so messages stay uploadable.
      setRecordingTime(0);
      clearRecordingTimer();
      recordingTimerRef.current = setInterval(() => {
        setRecordingTime(prev => {
          const next = prev + 1;
          if (next === WARNING_SECONDS) {
            toast({ title: '1 minute left', description: 'Recording stops at 5:00' });
          }
          if (next >= MAX_RECORDING_SECONDS) {
            // Defer the stop so we don't mutate the recorder inside the state updater.
            setTimeout(() => {
              if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
                mediaRecorderRef.current.stop();
                setIsRecording(false);
                clearRecordingTimer();
                toast({ title: 'Maximum length reached', description: 'Recording stopped at 5:00' });
              }
            }, 0);
          }
          return next;
        });
      }, 1000);

    } catch (error) {
      console.error('Error accessing microphone:', error);
      toast({
        title: "Error",
        description: "Cannot access microphone. Please check permissions.",
        variant: "destructive"
      });
    } finally {
      // Start finished — either the recording UI is now showing, or it failed. Either way
      // clear the "preparing" feedback so the button is usable again.
      startingRef.current = false;
      onStartChange?.(false);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      clearRecordingTimer();
    }
  };

  const uploadAudio = async (blob: Blob, mimeType: string, autoSend: boolean = false) => {
    setIsUploading(true);

    try {
      // Validate size (max 10MB)
      if (blob.size > 10 * 1024 * 1024) {
        throw new Error('Audio must be smaller than 10MB');
      }

      if (!session?.nostrHexId) {
        throw new Error('User not authenticated');
      }

      // Generate unique filename
      const timestamp = Date.now();
      const randomStr = Math.random().toString(36).substring(7);
      const extension = mimeType.includes('webm') ? 'webm' : 
                       mimeType.includes('mp4') ? 'mp4' :
                       mimeType.includes('aac') ? 'aac' : 'mp3';
      const fileName = `${timestamp}_${randomStr}.${extension}`;

      // Organize by users (sender/recipient)
      const filePath = `${session.nostrHexId}/${recipientPubkey}/${fileName}`;
      
      console.log('Uploading audio to path:', filePath);

      // Upload to Supabase Storage
      const { error: uploadError } = await supabase.storage
        .from('dm-audio')
        .upload(filePath, blob, {
          contentType: mimeType,
          cacheControl: '3600',
          upsert: false
        });

      if (uploadError) {
        throw uploadError;
      }

      // Get public URL
      const { data: publicUrlData } = supabase.storage
        .from('dm-audio')
        .getPublicUrl(filePath);

      console.log('Public URL created:', publicUrlData.publicUrl);

      if (autoSend) {
        // Automatically send the message
        await onSendMessage(publicUrlData.publicUrl);
        toast({
          title: "Success",
          description: "Audio message sent! (Auto-deleted after 7 days)"
        });
      } else {
        // Just notify parent component (legacy behavior)
        onAudioUploaded(publicUrlData.publicUrl);
        toast({
          title: "Success",
          description: "Audio message ready to send. (Auto-deleted after 7 days)"
        });
      }

    } catch (error: any) {
      console.error('Audio upload error:', error);
      
      if (error.message.includes('size')) {
        toast({
          title: "Error",
          description: "Audio is too large (max 10MB)",
          variant: "destructive"
        });
      } else if (error.message.includes('network')) {
        toast({
          title: "Error",
          description: "Upload failed. Check your connection.",
          variant: "destructive"
        });
      } else {
        toast({
          title: "Error",
          description: "Failed to send audio message",
          variant: "destructive"
        });
      }
    } finally {
      setIsUploading(false);
    }
  };

  const handleCancel = () => {
    if (isRecording) {
      if (mediaRecorderRef.current) {
        mediaRecorderRef.current.stop();
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
      setIsRecording(false);
      clearRecordingTimer();
      setRecordingTime(0);
      chunksRef.current = [];

      toast({
        title: "Cancelled",
        description: "Audio recording cancelled"
      });
    }
  };

  const handleDiscardPreview = () => {
    if (audioPreview) {
      URL.revokeObjectURL(audioPreview.url);
      setAudioPreview(null);
    }
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
  };

  const handleSendAudio = async () => {
    if (!audioPreview) return;
    
    try {
      await uploadAudio(audioPreview.blob, audioPreview.mimeType, true); // autoSend = true
      handleDiscardPreview();
    } catch (error) {
      // Error already handled in uploadAudio
      setIsUploading(false);
    }
  };

  const togglePreviewPlay = () => {
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

  const formatTime = (timeInSeconds: number): string => {
    if (!isFinite(timeInSeconds)) return '0:00';
    
    const minutes = Math.floor(timeInSeconds / 60);
    const seconds = Math.floor(timeInSeconds % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  // Preview mode
  if (audioPreview) {
    return (
      <div className="flex items-center gap-2 p-3 bg-background border rounded-lg w-full">
        <Button 
          size="sm" 
          variant="ghost"
          onClick={togglePreviewPlay}
          className="flex-shrink-0"
        >
          {isPlaying ? (
            <Pause className="h-4 w-4" />
          ) : (
            <Play className="h-4 w-4" />
          )}
        </Button>

        <div className="flex-1 min-w-0">
          <Slider
            value={[currentTime]}
            max={duration || 100}
            step={0.1}
            onValueChange={handleSeek}
            className="w-full"
          />
        </div>

        <span className="text-xs text-muted-foreground flex-shrink-0 font-mono">
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>

        <Button
          size="sm"
          onClick={handleSendAudio}
          disabled={isUploading}
          className="flex-shrink-0"
        >
          {isUploading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </Button>

        <Button
          size="sm"
          variant="ghost"
          onClick={handleDiscardPreview}
          disabled={isUploading}
          className="flex-shrink-0"
        >
          <X className="h-4 w-4" />
        </Button>

        <audio
          ref={audioRef}
          src={audioPreview.url}
          preload="metadata"
          onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime || 0)}
          onLoadedMetadata={() => setDuration(audioRef.current?.duration || 0)}
          onEnded={() => setIsPlaying(false)}
        />
      </div>
    );
  }

  if (isRecording) {
    const isNearLimit = recordingTime >= WARNING_SECONDS;
    return (
      <div className="flex items-center gap-2 bg-background border rounded-lg p-2">
        <span className={`h-2.5 w-2.5 rounded-full ${isNearLimit ? 'bg-orange-500' : 'bg-red-500'} animate-pulse`} />
        <span className={`text-sm font-mono font-medium min-w-[40px] ${isNearLimit ? 'text-orange-500' : 'text-red-500'}`}>
          {formatTime(recordingTime)}
        </span>
        <span className="text-xs text-muted-foreground">/ {formatTime(MAX_RECORDING_SECONDS)}</span>
        <Button
          variant="destructive"
          size="icon"
          onClick={stopRecording}
        >
          <Square className="h-5 w-5" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleCancel}
        >
          Cancel
        </Button>
      </div>
    );
  }

  return (
    <button
      data-audio-recorder
      type="button"
      className="hidden"
      onClick={startRecording}
    />
  );
}
