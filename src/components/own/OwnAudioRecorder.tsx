import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Mic, Square, Send, X, Play, Pause, RotateCcw, Loader2, Download } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { toast } from "sonner";
import { ownSupabase } from "@/lib/ownSupabaseClient";
import { saveRecording, loadPendingRecording, deletePendingRecording, downloadBlob } from "@/lib/ownRecordingStore";

const API_URL = import.meta.env.VITE_API_URL ?? '';

/** Sent alongside the `audio:…|dur:…|transcript:…` string. `consent` is set only
 *  after the person acknowledged the notice that a being will read the audio —
 *  the beings read audio ONLY when the encrypted payload carries this value. */
export interface OwnAudioSendMeta {
  consent?: 'voice-notice-v2';
  durationSeconds: number;
}

interface OwnAudioRecorderProps {
  processEventId: string;
  senderPubkey: string;
  onSendAudio: (audioPath: string, meta?: OwnAudioSendMeta) => Promise<boolean>;
  compact?: boolean;
  /** Fired when the recorder becomes active (recording or showing a preview) so the
   *  parent can give it the full input row on mobile instead of cramming it next to
   *  other controls. */
  onActiveChange?: (active: boolean) => void;
  /** OWN guide step (Reflection / Change): the being invites a voice message —
   *  visible mic label, a prompt while recording, a soft "that was short" hint. */
  inviteVoice?: boolean;
  lang?: 'sl' | 'en';
  /** A being will read the audio (OWN only, never the encrypted rooms): show the
   *  AI-Act notice once before the first recording and stamp consent on send. */
  beingListens?: boolean;
}

const MAX_RECORDING_SECONDS = 300; // 5 minutes
const WARNING_SECONDS = 240; // warn at 4 minutes (1 min left)
const SOFT_MIN_SECONDS = 20;  // below this the invite hints "take more time" — never blocks Send
// Per PERSON, not per browser: on a shared device the second participant
// must read the notice themselves. v2 names the third-party processing.
const voiceNoticeKey = (pk: string) => `own.voiceNotice.v2:${pk}`;

const VOICE_TXT = {
  sl: {
    micTitle: 'Posnemi glasovno sporočilo',
    micLabel: 'Povej z glasom',
    promptCard: 'Pojdi vase. Ni treba biti popoln. Govori, dokler ne poveš vsega.',
    noticeTitle: 'Preden prvič spregovoriš',
    notice: 'Bitje posluša ritem in premore tvojega govora, ne presoja resnice tvojih čustev. Posnetek za prepis in merjenje ritma obdela zunanji AI-ponudnik (Google Gemini); bitje shrani le številke, ne besed. Posnetek in prepis ostaneta v tem procesu. Snemaj tam, kjer si sam.',
    noticeDecline: 'Snemaj brez poslušanja bitja',
    noticeOk: 'Razumem, snemaj',
    noticeMore: 'Kaj bitje sliši?',
    softMin: 'Kratko je bilo (pod 20 s). Lahko pošlješ — ali pa posnameš znova in si vzameš več časa.',
  },
  en: {
    micTitle: 'Record a voice message',
    micLabel: 'Say it by voice',
    promptCard: 'Go inward. It does not have to be perfect. Speak until everything is said.',
    noticeTitle: 'Before you speak for the first time',
    notice: 'The being listens to the rhythm and pauses of your speech; it does not judge the truth of your feelings. An external AI provider (Google Gemini) processes the recording for the transcript and the rhythm measures; the being keeps only numbers, never words. The recording and its transcript stay inside this process. Record where you are alone.',
    noticeDecline: 'Record without the being listening',
    noticeOk: 'I understand, record',
    noticeMore: 'What does the being hear?',
    softMin: 'That was short (under 20 s). You can send it — or record again and take more time.',
  },
} as const;

// localStorage is absent/throwing in private mode and some webviews — the
// notice then simply shows again, which is the safe direction.
const hasVoiceNotice = (pk: string): boolean => {
  try { return localStorage.getItem(voiceNoticeKey(pk)) === '1'; } catch { return false; }
};
const markVoiceNotice = (pk: string) => {
  try { localStorage.setItem(voiceNoticeKey(pk), '1'); } catch { /* ignore */ }
};

/** Duration of a blob via a throw-away <audio>. MediaRecorder webm reports
 *  Infinity until seeked past the end, hence the huge currentTime. 0 = unknown. */
const probeBlobDuration = (blob: Blob): Promise<number> =>
  new Promise((resolve) => {
    let settled = false;
    const url = URL.createObjectURL(blob);
    const el = document.createElement('audio');
    const done = (n: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      resolve(n);
    };
    const tryResolve = () => {
      if (isFinite(el.duration) && el.duration > 0) done(Math.round(el.duration));
    };
    const timer = setTimeout(() => done(0), 4000);
    el.onloadedmetadata = () => {
      tryResolve();
      if (!settled) el.currentTime = 1e101;
    };
    el.ondurationchange = tryResolve;
    el.onerror = () => done(0);
    el.preload = 'metadata';
    el.src = url;
  });

export default function OwnAudioRecorder({
  processEventId,
  senderPubkey,
  onSendAudio,
  compact = false,
  onActiveChange,
  inviteVoice = false,
  lang = 'en',
  beingListens = false,
}: OwnAudioRecorderProps) {
  const txt = VOICE_TXT[lang] ?? VOICE_TXT.en;
  const [isRecording, setIsRecording] = useState(false);
  const [noticeOpen, setNoticeOpen] = useState(false);       // one-time notice card before the first recording
  const [noticeExpanded, setNoticeExpanded] = useState(false); // ⓘ toggle while recording / previewing
  const [isStarting, setIsStarting] = useState(false); // mic tapped, awaiting permission/setup — instant button feedback
  const [isUploading, setIsUploading] = useState(false);
  const [audioPreview, setAudioPreview] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [recordingTime, setRecordingTime] = useState(0);
  const [uploadFailed, setUploadFailed] = useState(false);
  const [failReason, setFailReason] = useState<string>(''); // specific cause shown in the banner (which step failed)
  const [retryCount, setRetryCount] = useState(0);
  const [showTimeWarning, setShowTimeWarning] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const audioBlobRef = useRef<Blob | null>(null);
  const uploadingRef = useRef(false); // guards against duplicate / rapid Send taps
  const startingRef = useRef(false);  // guards against rapid repeat taps before recording starts
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingTimeRef = useRef(0);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const wentBackgroundRef = useRef(false);
  const isRecordingRef = useRef(false);
  const cancelRef = useRef(false); // set by Cancel so the async onstop skips persist/preview

  // Report "active" (recording or previewing) to the parent so it can give the recorder
  // the full input row on mobile (otherwise the wide recording/preview UI overflows next
  // to the image + Exit buttons and breaks the layout).
  // The notice card is as wide as the recording UI, so it counts as active too.
  useEffect(() => {
    onActiveChange?.(isRecording || !!audioPreview || noticeOpen);
  }, [isRecording, audioPreview, noticeOpen, onActiveChange]);

  // Restore a pending (un-sent) recording after a reload / navigation, so a recording is
  // never lost even if the upload failed or the page was reloaded mid-send.
  useEffect(() => {
    if (!senderPubkey || !processEventId) return;
    let alive = true;
    loadPendingRecording(senderPubkey, processEventId).then((rec) => {
      // Don't clobber a live recording or a freshly-recorded blob.
      if (!alive || !rec || audioBlobRef.current || isRecordingRef.current) return;
      audioBlobRef.current = rec.blob;
      if (rec.durationSec && rec.durationSec > 0) {
        recordingTimeRef.current = rec.durationSec;
        setRecordingTime(rec.durationSec);
      }
      setAudioPreview(URL.createObjectURL(rec.blob)); // fresh URL — stored URL strings die on reload
      toast.info("Restored your unsent recording — tap Send to try again.");
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [senderPubkey, processEventId]);

  // Cleanup on unmount
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
      releaseWakeLock();
    };
  }, [audioPreview]);

  // Detect app going to background during recording (Android tab throttling)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden && isRecordingRef.current) {
        wentBackgroundRef.current = true;
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  // Request WakeLock to prevent Android Doze mode during recording
  const requestWakeLock = async () => {
    try {
      if ('wakeLock' in navigator) {
        wakeLockRef.current = await navigator.wakeLock.request('screen');
        wakeLockRef.current.addEventListener('release', () => {
          wakeLockRef.current = null;
        });
      }
    } catch {
      // WakeLock not supported or denied — continue without it
    }
  };

  const releaseWakeLock = () => {
    if (wakeLockRef.current) {
      wakeLockRef.current.release().catch(() => {});
      wakeLockRef.current = null;
    }
  };

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

  // Gate: the first time a being will listen, the person reads the notice
  // before the microphone is even asked for. Typed-only participants never
  // see it, and the encrypted rooms (beingListens=false) never do either.
  // The acknowledgement of THIS session is honoured even where localStorage
  // throws (private mode); a decline is remembered for the session only and
  // records WITHOUT the consent stamp — the being then never reads it.
  const acknowledgedRef = useRef(false);
  const declinedRef = useRef(false);
  const noticeAcknowledged = () => acknowledgedRef.current || hasVoiceNotice(senderPubkey);
  const startRecording = async () => {
    if (beingListens && !noticeAcknowledged() && !declinedRef.current) {
      setNoticeOpen(true);
      return;
    }
    await beginRecording();
  };

  const confirmNotice = async () => {
    acknowledgedRef.current = true;
    markVoiceNotice(senderPubkey);
    setNoticeOpen(false);
    await beginRecording();
  };

  const declineNotice = async () => {
    declinedRef.current = true;
    setNoticeOpen(false);
    await beginRecording();
  };

  const beginRecording = async () => {
    // Absorb rapid repeat taps and show instant feedback before the (slow) permission prompt.
    if (startingRef.current || isRecording) return;
    startingRef.current = true;
    setIsStarting(true);
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
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: { ideal: true },
          autoGainControl: { ideal: true },
          sampleRate: { ideal: 48000 },
        },
      });
      streamRef.current = stream;

      // Prevent Android Doze mode from pausing audio
      await requestWakeLock();

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
        // Cancelled → discard the take entirely (no persist, no preview).
        if (cancelRef.current) {
          cancelRef.current = false;
          audioChunksRef.current = [];
          if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
          }
          releaseWakeLock();
          return;
        }
        const audioBlob = new Blob(audioChunksRef.current, { type: actualMimeType });
        audioBlobRef.current = audioBlob;
        const audioUrl = URL.createObjectURL(audioBlob);
        setAudioPreview(audioUrl);
        // Persist immediately so the recording survives a failed upload / reload / navigation.
        void saveRecording(senderPubkey, processEventId, audioBlob, { durationSec: recordingTimeRef.current });

        if (streamRef.current) {
          streamRef.current.getTracks().forEach(track => track.stop());
        }

        releaseWakeLock();

        // Warn if app went to background during recording
        if (wentBackgroundRef.current) {
          toast.warning("Recording may contain gaps — the app was in the background during recording. Keep the app open for best results.");
        }
      };

      // Record continuously — no timeslice to avoid lost chunks on Android
      // when JS is throttled by Doze mode or tab backgrounding.
      // For 5-min max recordings (~2-5MB webm/opus) this is fine.
      mediaRecorder.start();
      setIsRecording(true);
      isRecordingRef.current = true;
      wentBackgroundRef.current = false;
      setRecordingTime(0);
      recordingTimeRef.current = 0;
      setShowTimeWarning(false);
      recordingTimerRef.current = setInterval(() => {
        setRecordingTime(prev => {
          const next = prev + 1;
          recordingTimeRef.current = next;
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
                isRecordingRef.current = false;
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
      releaseWakeLock();
      if (error?.name === 'NotAllowedError' || error?.name === 'PermissionDeniedError') {
        toast.error("Microphone access denied. Please allow microphone in browser settings.");
      } else if (error?.name === 'NotFoundError' || error?.name === 'DevicesNotFoundError') {
        toast.error("No microphone found on this device.");
      } else if (error?.name === 'NotReadableError' || error?.name === 'TrackStartError') {
        toast.error("Microphone is in use by another app. Close it and try again.");
      } else {
        toast.error("Could not start recording. Please try a different browser.");
      }
    } finally {
      // Start finished — recording UI now showing, or it failed. Clear the "preparing" state.
      startingRef.current = false;
      setIsStarting(false);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      isRecordingRef.current = false;
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
    }
  };

  const uploadAudio = async () => {
    if (uploadingRef.current) return; // ignore rapid repeat taps while a send is in flight
    uploadingRef.current = true;
    setIsUploading(true);             // instant "Sending…" feedback the moment Send is tapped
    setUploadFailed(false);
    setFailReason('');

    if (!audioBlobRef.current) {
      toast.error("No recording to upload");
      setIsUploading(false);
      uploadingRef.current = false;
      return;
    }

    const maxSize = 50 * 1024 * 1024; // 50MB
    if (audioBlobRef.current.size > maxSize) {
      toast.error("Recording too large (max 50MB / ~15 min)");
      setIsUploading(false);
      uploadingRef.current = false;
      return;
    }
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

      console.log('🎵 Uploading OWN audio + transcribing:', {
        filePath,
        size: audioBlobRef.current.size,
        type: mimeType,
        attempt: retryCount + 1,
      });

      const audioBlob = audioBlobRef.current;

      // 1) Upload to storage FIRST, alone. ownSupabase.upload uses XHR + retry + a stall
      //    watchdog, so only ~5MB crosses the wire once — no concurrent STT upload (that
      //    second ~5MB POST is what overloaded weak mobile links → "Load failed").
      const uploadRes = await ownSupabase.storage
        .from("dm-audio")
        .upload(filePath, audioBlob, { contentType: mimeType, cacheControl: "3600", upsert: false });

      if (uploadRes.error) {
        console.error("Upload error:", uploadRes.error);
        const errMsg = uploadRes.error?.message || uploadRes.error?.error || "Upload failed";
        setUploadFailed(true);
        setFailReason(`Upload: ${errMsg}`);
        setRetryCount(prev => prev + 1);
        toast.error(`${errMsg} — tap retry`);
        return; // recording preserved (audioBlobRef + IndexedDB) → Retry / Download
      }

      // 2) Transcribe from the ALREADY-uploaded file (server reads it from disk — NO second
      //    upload). Optional: empty transcript on any failure/timeout so it never blocks the send.
      let transcript = '';
      try {
        const sttController = new AbortController();
        // 45 s, not 25: the server now tries Gemini first (~20 s on a long
        // recording) because its Slovenian transcripts are the ones a being
        // can actually judge — a garbled transcript once cost a week of
        // silence. Groq stays as the fast fallback on the server side.
        const sttTimeout = setTimeout(() => sttController.abort(), 45_000);
        try {
          const res = await fetch(`${API_URL}/api/voice/stt-path`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ bucket: 'dm-audio', path: filePath, language: 'sl' }),
            signal: sttController.signal,
          });
          if (res.ok) {
            const data = await res.json();
            transcript = data.text?.trim() || '';
          }
        } finally {
          clearTimeout(sttTimeout);
        }
      } catch (err) {
        console.warn('🔇 STT (by path) failed/timed out — sending without transcript:', err);
      }
      if (transcript) {
        console.log('📝 Transcript:', transcript.substring(0, 100) + (transcript.length > 100 ? '...' : ''));
      }

      // 3) Build message: audio:path|dur:seconds|transcript:text, then publish to relays.
      //    `dur` is ALWAYS present — the beings bucket spoken length from it. The
      //    tick counter is 0 for a restored recording without a stored duration,
      //    so decode the blob then; 1 s is the floor when even that fails.
      let durValue = recordingTimeRef.current > 0 ? recordingTimeRef.current : Math.round(duration);
      if (!(durValue > 0)) durValue = await probeBlobDuration(audioBlob);
      if (!(durValue > 0)) durValue = 1;
      const transcriptSuffix = transcript ? `|transcript:${transcript}` : '';
      const sent = await onSendAudio(`audio:${filePath}|dur:${durValue}${transcriptSuffix}`, {
        consent: beingListens && noticeAcknowledged() ? 'voice-notice-v2' : undefined,
        durationSeconds: durValue,
      });

      if (!sent) {
        setUploadFailed(true);
        // Upload succeeded (file is stored) but publishing the KIND 87046 event to the
        // relays returned false — distinct from an upload failure, so name it precisely.
        setFailReason('Uploaded OK — publishing to relays failed. Tap retry');
        setRetryCount(prev => prev + 1);
        toast.error("Sending failed — tap retry to try again");
        return;
      }

      // Success — clears the persisted recording (inside handleDiscardPreview) + cleanup.
      handleDiscardPreview();
      toast.success("Recording sent");
    } catch (error) {
      console.error('Error uploading audio:', error);
      setUploadFailed(true);
      setFailReason(`Error: ${(error as Error)?.message || 'unknown'} — tap retry`);
      setRetryCount(prev => prev + 1);
      toast.error("Network error — tap retry to try again");
    } finally {
      setIsUploading(false);
      uploadingRef.current = false;
    }
  };

  const handleCancel = () => {
    cancelRef.current = true; // make the async onstop skip persist/preview
    stopRecording();
    releaseWakeLock();
    setRecordingTime(0);
    setShowTimeWarning(false);
    toast.info("Recording cancelled");
  };

  const handleDiscardPreview = () => {
    // Clear the persisted copy ONLY here — this runs on confirmed send AND explicit discard,
    // never on unmount/reload, so a reload keeps the recording for restore.
    void deletePendingRecording(senderPubkey, processEventId);
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

  // Last-resort escape hatch: save the recording to the device so it's never lost even if
  // the upload keeps failing or storage (private mode) is unavailable.
  const handleDownload = () => {
    const blob = audioBlobRef.current;
    if (!blob) return;
    const mime = blob.type || 'audio/mp4';
    const ext = mime.includes('webm') ? 'webm' : mime.includes('mpeg') ? 'mp3' : mime.includes('aac') ? 'aac' : 'm4a';
    downloadBlob(blob, `voice-${Date.now()}.${ext}`);
  };

  // Audio preview playback controls
  useEffect(() => {
    if (audioPreview && audioElementRef.current) {
      const audio = audioElementRef.current;

      const setAudioDuration = () => {
        if (isFinite(audio.duration) && audio.duration > 0) {
          setDuration(audio.duration);
        } else if (recordingTimeRef.current > 0) {
          // WebM from MediaRecorder often reports Infinity duration.
          // Fall back to the recording time we tracked ourselves.
          setDuration(recordingTimeRef.current);
        }
      };

      const handleLoadedMetadata = () => {
        setAudioDuration();
      };

      const handleDurationChange = () => {
        // Browser may update duration after initial load (e.g. after seeking)
        setAudioDuration();
      };

      const handleTimeUpdate = () => {
        setCurrentTime(audio.currentTime);
      };

      const handleEnded = () => {
        setIsPlaying(false);
        setCurrentTime(0);
      };

      audio.addEventListener('loadedmetadata', handleLoadedMetadata);
      audio.addEventListener('durationchange', handleDurationChange);
      audio.addEventListener('timeupdate', handleTimeUpdate);
      audio.addEventListener('ended', handleEnded);

      return () => {
        audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
        audio.removeEventListener('durationchange', handleDurationChange);
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

  // "ⓘ What does the being hear?" — the notice text, re-readable at any time.
  const noticeMoreEl = (
    <div className="px-1">
      <button
        type="button"
        onClick={() => setNoticeExpanded((v) => !v)}
        className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
      >
        ⓘ {txt.noticeMore}
      </button>
      {noticeExpanded && (
        <p className="text-xs text-muted-foreground mt-1">{txt.notice}</p>
      )}
    </div>
  );

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

        {inviteVoice && (recordingTime > 0 ? recordingTime : duration) < SOFT_MIN_SECONDS && (
          <p className="text-xs text-muted-foreground px-1">{txt.softMin}</p>
        )}
        {beingListens && noticeMoreEl}

        {/* Upload failed — show retry + discard */}
        {uploadFailed && !isUploading && (
          <div className="flex items-center gap-2 px-1">
            <span className="text-xs text-destructive flex-1">
              ⚠ {failReason || 'Sending failed'}{retryCount > 1 ? ` (${retryCount}×)` : ''}
            </span>
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={handleDiscardPreview}
            disabled={isUploading}
            className="h-11 px-4 text-base"
          >
            <X className="h-4 w-4 mr-1" />
            Discard
          </Button>
          {uploadFailed && !isUploading ? (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={handleDownload}
                className="h-8 gap-1"
                title="Save the recording to your device"
              >
                <Download className="h-4 w-4" />
                Download
              </Button>
              <Button
                size="sm"
                onClick={handleRetry}
                variant="destructive"
                className="h-8 gap-1"
              >
                <RotateCcw className="h-4 w-4" />
                Retry
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              onClick={handleSendAudio}
              disabled={isUploading}
              className="h-11 px-6 text-base"
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
      <div className="flex flex-col gap-1 w-full min-w-0">
        {inviteVoice && (
          <p className="text-sm italic text-muted-foreground px-2 py-1 rounded-md bg-accent/40">
            {txt.promptCard}
          </p>
        )}
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
        {beingListens && noticeMoreEl}
      </div>
    );
  }

  // One-time notice before the first recording a being will read.
  if (noticeOpen) {
    return (
      <div className="flex flex-col gap-2 p-3 bg-accent/50 rounded-lg w-full min-w-0">
        <p className="text-sm font-semibold">{txt.noticeTitle}</p>
        <p className="text-sm text-muted-foreground">{txt.notice}</p>
        <div className="flex items-center justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={declineNotice} className="h-9">
            <X className="h-4 w-4 mr-1" />
            {txt.noticeDecline}
          </Button>
          <Button size="sm" onClick={confirmNotice} className="h-9 px-4">
            <Mic className="h-4 w-4 mr-1" />
            {txt.noticeOk}
          </Button>
        </div>
      </div>
    );
  }

  // Default recording button
  const micIcon = isStarting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mic className="h-4 w-4" />;
  if (inviteVoice) {
    return (
      <Button
        size="sm"
        variant="ghost"
        onClick={startRecording}
        disabled={isUploading || isStarting}
        title={txt.micTitle}
        aria-label={txt.micTitle}
        className="gap-1.5 px-2"
      >
        {micIcon}
        <span className="hidden md:inline text-xs">{txt.micLabel}</span>
      </Button>
    );
  }
  return (
    <Button
      size="icon"
      variant="ghost"
      onClick={startRecording}
      disabled={isUploading || isStarting}
      title={txt.micTitle}
      aria-label={txt.micTitle}
    >
      {micIcon}
    </Button>
  );
}
