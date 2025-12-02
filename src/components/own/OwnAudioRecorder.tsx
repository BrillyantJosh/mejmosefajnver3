import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Mic, Square, Send, X, Play, Pause } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface OwnAudioRecorderProps {
  processEventId: string;
  senderPubkey: string;
  onSendAudio: (audioPath: string) => Promise<boolean>;
  compact?: boolean;
}

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

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const audioBlobRef = useRef<Blob | null>(null);

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
      if (audioPreview) {
        URL.revokeObjectURL(audioPreview);
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
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;
      
      const mimeType = getSupportedMimeType();
      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
        audioBlobRef.current = audioBlob;
        const audioUrl = URL.createObjectURL(audioBlob);
        setAudioPreview(audioUrl);
        
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(track => track.stop());
        }
      };

      mediaRecorder.start();
      setIsRecording(true);
      toast.info("Snemanje zvoka...");
    } catch (error) {
      console.error('Error accessing microphone:', error);
      toast.error("Napaka pri dostopu do mikrofona");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const uploadAudio = async () => {
    if (!audioBlobRef.current) {
      toast.error("Ni posnetka za nalaganje");
      return;
    }

    const maxSize = 10 * 1024 * 1024; // 10MB
    if (audioBlobRef.current.size > maxSize) {
      toast.error("Posnetek je prevelik (max 10MB)");
      return;
    }

    setIsUploading(true);
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
      });

      const { error: uploadError } = await supabase.storage
        .from("dm-audio")
        .upload(filePath, audioBlobRef.current, {
          contentType: mimeType,
          cacheControl: "3600",
          upsert: false,
        });

      if (uploadError) {
        console.error("Upload error:", uploadError);
        toast.error(`Napaka pri nalaganju: ${uploadError.message}`);
        return;
      }

      // Send the audio path to the chat (Nostr content uses "audio:" prefix)
      await onSendAudio(`audio:${filePath}`);
      
      // Cleanup
      handleDiscardPreview();
      toast.success("Posnetek poslan");
    } catch (error) {
      console.error('Error uploading audio:', error);
      toast.error("Napaka pri pošiljanju posnetka");
    } finally {
      setIsUploading(false);
    }
  };

  const handleCancel = () => {
    stopRecording();
    toast.info("Snemanje preklicano");
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
  };

  const handleSendAudio = async () => {
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
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Audio preview UI
  if (audioPreview) {
    return (
      <div className="flex items-center gap-2 p-3 bg-accent/50 rounded-lg">
        <audio ref={audioElementRef} src={audioPreview} />
        <Button
          size="icon"
          variant="ghost"
          onClick={togglePreviewPlay}
          disabled={isUploading}
        >
          {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </Button>
        <div className="flex-1">
          <Slider
            value={[currentTime]}
            max={duration || 100}
            step={0.1}
            onValueChange={handleSeek}
            disabled={isUploading}
          />
          <div className="text-xs text-muted-foreground mt-1">
            {formatTime(currentTime)} / {formatTime(duration)}
          </div>
        </div>
        <Button
          size="icon"
          onClick={handleSendAudio}
          disabled={isUploading}
        >
          <Send className="h-4 w-4" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          onClick={handleDiscardPreview}
          disabled={isUploading}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  // Recording UI
  if (isRecording) {
    return (
      <div className="flex items-center gap-2">
        <Button
          size={compact ? "sm" : "default"}
          variant="destructive"
          onClick={stopRecording}
          className="gap-2"
        >
          <Square className="h-4 w-4 fill-current" />
          Ustavi
        </Button>
        <Button
          size={compact ? "sm" : "default"}
          variant="ghost"
          onClick={handleCancel}
        >
          Prekliči
        </Button>
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
