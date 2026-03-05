import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Mic, Square, Send, X, Play, Pause, RotateCcw, Loader2 } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { toast } from "sonner";
import { ownSupabase } from "@/lib/ownSupabaseClient";

interface OwnAudioRecorderProps {
  processEventId: string;
  senderPubkey: string;
  onSendAudio: (audioPath: string) => Promise<boolean>;
  compact?: boolean;
}

const MAX_RECORDING_SECONDS = 300; // 5 minutes
const WARNING_SECONDS = 240; // warn at 4 minutes (1 min left)

export default function OwnAudioRecorder({
  processEventId,
  senderPubkey,
  onSendAudio,
  compact = false
}: OwnAudioRecorderProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [audioPreview, setAudioPreview] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [recordingTime, setRecordingTime] = useState(0);
  const [uploadFailed, setUploadFailed] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [showTimeWarning, setShowTimeWarning] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const audioBlobRef = useRef<Blob | null>(null);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
      if (audioPreview) {
        URL.revokeObjectURL(audioPreview);
      }
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
      }
    };
  }, [audioPreview]);

  const getSupportedMimeType = () => {
    const types = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/mp4',
    ];

    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) {
        return type;
      }
    }
    return 'audio/webm';
  };

  const startRecording = async () => {
    try {
      // Check browser support
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        toast.error("Your browser does not support audio recording. Please use a newer browser.");
        return;
      }
      if (typeof MediaRecorder === 'undefined') {
        toast.error("Audio recording is not supported on this device. Please update your browser.");
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 44100,
        },
      });
      streamRef.current = stream;

      const mimeType = getSupportedMimeType();

      // Try creating MediaRecorder with preferred mimeType, fall back to default
      let mediaRecorder: MediaRecorder;
      try {
        mediaRecorder = new MediaRecorder(stream, { mimeType });
      } catch {
        // Fallback for old browsers that don't support the mimeType option
        mediaRecorder = new MediaRecorder(stream);
      }
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      const actualMimeType = mediaRecorder.mimeType || mimeType;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: actualMimeType });
        audioBlobRef.current = audioBlob;
        const audioUrl = URL.createObjectURL(audioBlob);
        setAudioPreview(audioUrl);

        if (streamRef.current) {
          streamRef.current.getTracks().forEach(track => track.stop());
        }
      };

      // Record in 5-second chunks for better memory management on older devices
      mediaRecorder.start(5000);
      setIsRecording(true);
      setRecordingTime(0);
      setShowTimeWarning(false);
      recordingTimerRef.current = setInterval(() => {
        setRecordingTime(prev => {
          const next = prev + 1;
          // Warning at 4 minutes
          if (next === WARNING_SECONDS) {
            setShowTimeWarning(true);
            toast.warning("1 minute left — recording will stop at 5:00");
          }
          // Auto-stop at 5 minutes
          if (next >= MAX_RECORDING_SECONDS) {
            // Use setTimeout to avoid calling stopRecording inside setRecordingTime
            setTimeout(() => {
              if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
                mediaRecorderRef.current.stop();
                setIsRecording(false);
                if (recordingTimerRef.current) {
                  clearInterval(recordingTimerRef.current);
                  recordingTimerRef.current = null;
                }
                toast.info("Maximum recording time reached (5:00)");
              }
            }, 0);
          }
          return next;
        });
      }, 1000);
      toast.info("Recording... (max 5 min)");
    } catch (error: any) {
      console.error('Error accessing microphone:', error);
      if (error?.name === 'NotAllowedError' || error?.name === 'PermissionDeniedError') {
        toast.error("Microphone access denied. Please allow microphone in browser settings.");
      } else if (error?.name === 'NotFoundError' || error?.name === 'DevicesNotFoundError') {
        toast.error("No microphone found on this device.");
      } else if (error?.name === 'NotReadableError' || error?.name === 'TrackStartError') {
        toast.error("Microphone is in use by another app. Close it and try again.");
      } else {
        toast.error("Could not start recording. Please try a different browser.");
      }
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
    }
  };

  const uploadAudio = async () => {
    if (!audioBlobRef.current) {
      toast.error("No recording to upload");
      return;
    }

    const maxSize = 50 * 1024 * 1024; // 50MB
    if (audioBlobRef.current.size > maxSize) {
      toast.error("Recording too large (max 50MB / ~15 min)");
      return;
    }

    setIsUploading(true);
    setUploadFailed(false);
    try {
      const timestamp = Date.now();
      const randomStr = Math.random().toString(36).substring(7);
      const mimeType = audioBlobRef.current.type || 'audio/webm';
      const extension = mimeType.includes('webm')
        ? 'webm'
        : mimeType.includes('mp4')
          ? 'mp4'
          : mimeType.includes('aac')
            ? 'aac'
            : mimeType.includes('mpeg')
              ? 'mp3'
              : 'webm';
      const fileName = `${timestamp}_${randomStr}.${extension}`;
      const filePath = `${senderPubkey}-${processEventId}/${fileName}`;

      console.log('🎵 Uploading OWN audio:', {
        filePath,
        size: audioBlobRef.current.size,
        type: mimeType,
        attempt: retryCount + 1,
      });

      const { error: uploadError } = await ownSupabase.storage
        .from("dm-audio")
        .upload(filePath, audioBlobRef.current, {
          contentType: mimeType,
          cacheControl: "3600",
          upsert: false,
        });

      if (uploadError) {
        console.error("Upload error:", uploadError);
        setUploadFailed(true);
        setRetryCount(prev => prev + 1);
        toast.error("Upload failed — tap retry to try again");
        return;
      }

      // Send the audio path to the chat (Nostr content uses "audio:" prefix)
      // Include duration metadata so it shows immediately in chat
      const durSuffix = recordingTime > 0 ? `|dur:${recordingTime}` : '';
      const sent = await onSendAudio(`audio:${filePath}${durSuffix}`);

      if (!sent) {
        setUploadFailed(true);
        setRetryCount(prev => prev + 1);
        toast.error("Sending failed — tap retry to try again");
        return;
      }

      // Success — cleanup
      handleDiscardPreview();
      toast.success("Recording sent");
    } catch (error) {
      console.error('Error uploading audio:', error);
      setUploadFailed(true);
      setRetryCount(prev => prev + 1);
      toast.error("Network error — tap retry to try again");
    } finally {
      setIsUploading(false);
    }
  };

  const handleCancel = () => {
    stopRecording();
    setRecordingTime(0);
    setShowTimeWarning(false);
    toast.info("Recording cancelled");
  };

  const handleDiscardPreview = () => {
    if (audioPreview) {
      URL.revokeObjectURL(audioPreview);
    }
    setAudioPreview(null);
    audioBlobRef.current = null;
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setRecordingTime(0);
    setUploadFailed(false);
    setRetryCount(0);
    setShowTimeWarning(false);
  };

  const handleSendAudio = async () => {
    await uploadAudio();
  };

  const handleRetry = async () => {
    await uploadAudio();
  };

  // Audio preview playback controls
  useEffect(() => {
    if (audioPreview && audioElementRef.current) {
      const audio = audioElementRef.current;

      const handleLoadedMetadata = () => {
        setDuration(audio.duration);
      };

      const handleTimeUpdate = () => {
        setCurrentTime(audio.currentTime);
      };

      const handleEnded = () => {
        setIsPlaying(false);
        setCurrentTime(0);
      };

      audio.addEventListener('loadedmetadata', handleLoadedMetadata);
      audio.addEventListener('timeupdate', handleTimeUpdate);
      audio.addEventListener('ended', handleEnded);

      return () => {
        audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
        audio.removeEventListener('timeupdate', handleTimeUpdate);
        audio.removeEventListener('ended', handleEnded);
      };
    }
  }, [audioPreview]);

  const togglePreviewPlay = () => {
    if (audioElementRef.current) {
      if (isPlaying) {
        audioElementRef.current.pause();
      } else {
        audioElementRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  const handleSeek = (value: number[]) => {
    if (audioElementRef.current) {
      audioElementRef.current.currentTime = value[0];
      setCurrentTime(value[0]);
    }
  };

  const formatTime = (seconds: number) => {
    if (!isFinite(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Audio preview UI - mobile optimized
  if (audioPreview) {
    return (
      <div className="flex flex-col gap-2 p-2 bg-accent/50 rounded-lg w-full min-w-0">
        <audio ref={audioElementRef} src={audioPreview} />
        <div className="flex items-center gap-2 min-w-0">
          <Button
            size="icon"
            variant="ghost"
            onClick={togglePreviewPlay}
            disabled={isUploading}
            className="shrink-0 h-8 w-8"
          >
            {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </Button>
          <div className="flex-1 min-w-0">
            <Slider
              value={[currentTime]}
              max={duration || 100}
              step={0.1}
              onValueChange={handleSeek}
              disabled={isUploading}
            />
          </div>
          <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>
        </div>

        {/* Upload failed — show retry + discard */}
        {uploadFailed && !isUploading && (
          <div className="flex items-center gap-2 px-1">
            <span className="text-xs text-destructive flex-1">
              ⚠ Sending failed{retryCount > 1 ? ` (${retryCount}×)` : ''}
            </span>
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={handleDiscardPreview}
            disabled={isUploading}
            className="h-8"
          >
            <X className="h-4 w-4 mr-1" />
            Discard
          </Button>
          {uploadFailed && !isUploading ? (
            <Button
              size="sm"
              onClick={handleRetry}
              variant="destructive"
              className="h-8 gap-1"
            >
              <RotateCcw className="h-4 w-4" />
              Retry
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={handleSendAudio}
              disabled={isUploading}
              className="h-8"
            >
              {isUploading ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Send className="h-4 w-4 mr-1" />
              )}
              {isUploading ? 'Sending...' : 'Send'}
            </Button>
          )}
        </div>
      </div>
    );
  }

  // Recording UI
  if (isRecording) {
    const remainingSeconds = MAX_RECORDING_SECONDS - recordingTime;
    const isNearLimit = recordingTime >= WARNING_SECONDS;
    return (
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-2">
            <span className={`h-2.5 w-2.5 rounded-full ${isNearLimit ? 'bg-orange-500' : 'bg-red-500'} animate-pulse`} />
            <span className={`text-sm font-mono font-medium min-w-[40px] ${isNearLimit ? 'text-orange-500' : 'text-red-500'}`}>
              {formatTime(recordingTime)}
            </span>
            <span className="text-xs text-muted-foreground">/ {formatTime(MAX_RECORDING_SECONDS)}</span>
          </div>
          <Button
            size={compact ? "sm" : "default"}
            variant="destructive"
            onClick={stopRecording}
            className="gap-2"
          >
            <Square className="h-4 w-4 fill-current" />
            Stop
          </Button>
          <Button
            size={compact ? "sm" : "default"}
            variant="ghost"
            onClick={handleCancel}
          >
            Cancel
          </Button>
        </div>
        {isNearLimit && (
          <p className="text-xs text-orange-500 px-2 animate-pulse">
            ⏱ {formatTime(remainingSeconds)} remaining
          </p>
        )}
      </div>
    );
  }

  // Default recording button
  return (
    <Button
      size="icon"
      variant="ghost"
      onClick={startRecording}
      disabled={isUploading}
    >
      <Mic className="h-4 w-4" />
    </Button>
  );
}
