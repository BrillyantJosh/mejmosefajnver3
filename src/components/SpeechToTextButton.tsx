import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Square, Loader2, X } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface SpeechToTextButtonProps {
  onTranscription: (text: string) => void;
  language?: string;      // "sl", "en", etc.
  disabled?: boolean;
}

export function SpeechToTextButton({ onTranscription, language, disabled }: SpeechToTextButtonProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const { toast } = useToast();

  // Detect best supported MIME type (same as DMAudioRecorder)
  const getSupportedMimeType = (): string => {
    const types = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',
      'audio/aac',
      'audio/mpeg'
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
          autoGainControl: true
        }
      });

      streamRef.current = stream;
      chunksRef.current = [];

      const mimeType = getSupportedMimeType();

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType,
        audioBitsPerSecond: 128000
      });

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: mimeType });

        // Stop all tracks to release microphone
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(track => track.stop());
          streamRef.current = null;
        }

        // Validate size
        if (blob.size > 10 * 1024 * 1024) {
          toast({
            title: "Error",
            description: "Audio is too large (max 10MB). Try a shorter recording.",
            variant: "destructive"
          });
          return;
        }

        if (blob.size < 100) {
          toast({
            title: "Error",
            description: "Recording too short. Please try again.",
            variant: "destructive"
          });
          return;
        }

        // Send to STT API
        await transcribeAudio(blob, mimeType);
      };

      mediaRecorder.start();
      mediaRecorderRef.current = mediaRecorder;
      setIsRecording(true);

    } catch (error) {
      console.error('Error accessing microphone:', error);
      toast({
        title: "Error",
        description: "Cannot access microphone. Please check permissions.",
        variant: "destructive"
      });
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const transcribeAudio = async (blob: Blob, mimeType: string) => {
    setIsTranscribing(true);

    try {
      abortControllerRef.current = new AbortController();

      const formData = new FormData();
      // Determine extension for filename
      const ext = mimeType.includes('webm') ? 'webm' :
                  mimeType.includes('mp4') ? 'mp4' :
                  mimeType.includes('aac') ? 'aac' : 'mp3';
      formData.append('file', blob, `recording.${ext}`);
      if (language) {
        formData.append('language', language);
      }

      const response = await fetch('/api/functions/speech-to-text', {
        method: 'POST',
        body: formData,
        signal: abortControllerRef.current.signal
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Server error ${response.status}`);
      }

      const data = await response.json();
      const text = data.text?.trim() || '';

      if (!text) {
        toast({
          title: "No speech detected",
          description: "Could not detect speech in the recording. Please try again.",
        });
        return;
      }

      onTranscription(text);

    } catch (error: any) {
      if (error.name === 'AbortError') {
        // User cancelled — do nothing
        return;
      }
      console.error('Speech-to-text error:', error);
      toast({
        title: "Transcription failed",
        description: error.message || "Could not transcribe audio. Please try again.",
        variant: "destructive"
      });
    } finally {
      setIsTranscribing(false);
      abortControllerRef.current = null;
    }
  };

  const handleCancel = () => {
    if (isRecording) {
      // Cancel recording
      if (mediaRecorderRef.current) {
        mediaRecorderRef.current.stop();
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
      setIsRecording(false);
      chunksRef.current = [];
    }

    if (isTranscribing) {
      // Cancel transcription API call
      abortControllerRef.current?.abort();
      setIsTranscribing(false);
    }
  };

  // Transcribing state
  if (isTranscribing) {
    return (
      <div className="flex items-center gap-2 bg-violet-50 dark:bg-violet-950/30 border border-violet-200 dark:border-violet-800 rounded-lg p-2">
        <Loader2 className="h-5 w-5 animate-spin text-violet-600 dark:text-violet-400" />
        <span className="text-sm text-violet-700 dark:text-violet-300 font-medium">Transcribing...</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleCancel}
          className="ml-auto"
        >
          <X className="h-4 w-4 mr-1" />
          Cancel
        </Button>
      </div>
    );
  }

  // Recording state
  if (isRecording) {
    return (
      <div className="flex items-center gap-2 bg-background border rounded-lg p-2">
        <Button
          variant="destructive"
          size="icon"
          onClick={stopRecording}
          className="animate-pulse"
        >
          <Square className="h-5 w-5" />
        </Button>
        <span className="text-sm text-muted-foreground">Recording...</span>
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

  // Idle state — hidden trigger button
  return (
    <button
      data-speech-to-text
      type="button"
      className="hidden"
      onClick={startRecording}
      disabled={disabled}
    />
  );
}
