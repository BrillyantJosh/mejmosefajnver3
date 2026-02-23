import { useState, useEffect, useRef, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Mic, MicOff, Loader2, Volume2, Headphones, Eye, MessageSquare, Users, Bot } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { finalizeEvent } from "nostr-tools";

// =============================================
// Types
// =============================================
type VoiceState = "idle" | "recording" | "processing" | "speaking";
type VoiceMode = "listening" | "observation" | "conversation" | "group";

interface TranscriptMessage {
  role: "user" | "sozitje";
  text: string;
  timestamp: number;
}

interface SozitjeState {
  mood?: string;
  energy?: number;
}

// =============================================
// Helpers
// =============================================
function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2) hex = "0" + hex;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

function getSupportedMimeType(): string {
  const types = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/aac", "audio/mpeg"];
  for (const type of types) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type)) return type;
  }
  return "audio/webm";
}

const MODES: { id: VoiceMode; label: string; icon: typeof Headphones; short: string }[] = [
  { id: "listening", label: "Poslušanje", icon: Headphones, short: "🎧" },
  { id: "observation", label: "Opazovanje", icon: Eye, short: "👁" },
  { id: "conversation", label: "Pogovor", icon: MessageSquare, short: "💬" },
  { id: "group", label: "Skupinski", icon: Users, short: "👥" },
];

const SILENCE_THRESHOLD = 10; // amplitude threshold for silence
const SILENCE_TIMEOUT_MS = 2500; // 2.5 seconds of silence = stop

// =============================================
// Component
// =============================================
export default function BeingVoice() {
  const { session } = useAuth();
  const { toast } = useToast();

  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [mode, setMode] = useState<VoiceMode>("conversation");
  const [transcript, setTranscript] = useState<TranscriptMessage[]>([]);
  const [sozitjeState, setSozitjeState] = useState<SozitjeState>({});
  const [statusText, setStatusText] = useState("Pritisni za govor");

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const vadIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const sessionIdRef = useRef(crypto.randomUUID());

  // Scroll transcript to bottom
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript.length]);

  // =============================================
  // Sožitje State
  // =============================================
  useEffect(() => {
    loadSozitjeState();
  }, []);

  async function loadSozitjeState() {
    try {
      const authHeader = await createNip98AuthHeader("/api/state", "GET");
      const res = await fetch("/api/voice/sozitje", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: "/api/state",
          method: "GET",
          authHeader,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setSozitjeState({ mood: data.mood, energy: data.energy });
      }
    } catch (e) {
      console.warn("[Voice] State load failed:", e);
    }
  }

  // =============================================
  // NIP-98 Auth
  // =============================================
  async function createNip98AuthHeader(urlPath: string, method: string): Promise<string | null> {
    if (!session?.nostrPrivateKey || !session?.nostrHexId) return null;
    try {
      const fullUrl = `https://being2.enlightenedai.org${urlPath}`;
      const privateKeyBytes = hexToBytes(session.nostrPrivateKey);
      const event = finalizeEvent(
        {
          kind: 27235,
          created_at: Math.floor(Date.now() / 1000),
          tags: [
            ["u", fullUrl],
            ["method", method.toUpperCase()],
          ],
          content: "",
        },
        privateKeyBytes
      );
      return "Nostr " + btoa(JSON.stringify(event));
    } catch (e) {
      console.warn("[Voice] NIP-98 signing failed:", e);
      return null;
    }
  }

  // =============================================
  // Recording
  // =============================================
  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;
      chunksRef.current = [];

      const mimeType = getSupportedMimeType();
      const mediaRecorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 128000 });

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeType });
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((t) => t.stop());
          streamRef.current = null;
        }
        if (blob.size > 100) {
          processAudio(blob, mimeType);
        } else {
          setVoiceState("idle");
          setStatusText("Pritisni za govor");
        }
      };

      mediaRecorder.start(1000);
      mediaRecorderRef.current = mediaRecorder;
      setVoiceState("recording");
      setStatusText("Poslušam...");

      // Start VAD
      startVAD(stream);
    } catch (error) {
      console.error("[Voice] Mic error:", error);
      toast({ title: "Napaka", description: "Ni mogoče dostopati do mikrofona.", variant: "destructive" });
    }
  }, [toast]);

  const stopRecording = useCallback(() => {
    stopVAD();
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
  }, []);

  // =============================================
  // VAD — Silence Detection
  // =============================================
  function startVAD(stream: MediaStream) {
    try {
      const audioCtx = new AudioContext();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);

      const data = new Uint8Array(analyser.fftSize);
      let silenceMs = 0;

      vadIntervalRef.current = setInterval(() => {
        analyser.getByteTimeDomainData(data);
        const max = Math.max(...Array.from(data).map((v) => Math.abs(v - 128)));

        if (max < SILENCE_THRESHOLD) {
          silenceMs += 100;
          if (silenceMs >= SILENCE_TIMEOUT_MS) {
            stopRecording();
          } else if (silenceMs >= 1000) {
            const remaining = ((SILENCE_TIMEOUT_MS - silenceMs) / 1000).toFixed(1);
            setStatusText(`Tišina... ${remaining}s`);
          }
        } else {
          silenceMs = 0;
          setStatusText("Poslušam...");
        }
      }, 100);
    } catch (e) {
      console.warn("[Voice] VAD init failed:", e);
    }
  }

  function stopVAD() {
    if (vadIntervalRef.current) {
      clearInterval(vadIntervalRef.current);
      vadIntervalRef.current = null;
    }
  }

  // =============================================
  // Main Flow: Audio → STT → Sožitje → TTS
  // =============================================
  async function processAudio(audioBlob: Blob, mimeType: string) {
    setVoiceState("processing");

    try {
      // 1. STT — local Whisper
      const sttLabel = mode === "listening" ? "Poslušam..." : mode === "observation" ? "Opazujem..." : "Razumem...";
      setStatusText(sttLabel);
      const ext = mimeType.includes("webm") ? "webm" : mimeType.includes("mp4") ? "mp4" : "webm";
      const cleanMime = mimeType.split(";")[0];
      const file = new File([audioBlob], `recording.${ext}`, { type: cleanMime });

      const formData = new FormData();
      formData.append("file", file);
      formData.append("language", "sl");

      const sttRes = await fetch("/api/voice/stt", { method: "POST", body: formData });
      if (!sttRes.ok) throw new Error("STT failed");

      const { text: userText } = await sttRes.json();
      if (!userText || !userText.trim()) {
        setVoiceState("idle");
        setStatusText("Pritisni za govor");
        return;
      }

      // Add user bubble
      setTranscript((prev) => [...prev, { role: "user", text: userText, timestamp: Date.now() }]);

      // 2. Send to Sožitje
      const thinkLabel = mode === "listening" ? "Pošiljam..." : mode === "observation" ? "Sožitje opazuje..." : "Sožitje razmišlja...";
      setStatusText(thinkLabel);
      const endpoint = mode === "listening" ? "/api/listen" : "/api/message";
      console.log("[Voice] Sending to Sožitje:", endpoint, "mode:", mode);
      const authHeader = await createNip98AuthHeader(endpoint, "POST");
      console.log("[Voice] Auth header:", authHeader ? "present" : "null");

      const sozitjeBody =
        mode === "listening"
          ? { chunk: userText, speaker_label: "govorec", session_id: sessionIdRef.current, silence_detected: true }
          : { content: userText, mode, speaker_label: "jaz" };

      const sozController = new AbortController();
      const sozTimeout = setTimeout(() => sozController.abort(), 60000); // 60s timeout

      const sozRes = await fetch("/api/voice/sozitje", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: endpoint, method: "POST", body: sozitjeBody, authHeader }),
        signal: sozController.signal,
      });
      clearTimeout(sozTimeout);
      console.log("[Voice] Sožitje proxy response:", sozRes.status);

      const sozData = await sozRes.json();

      // Update mood even from error responses
      if (sozData.mood) setSozitjeState({ mood: sozData.mood, energy: sozData.energy });

      // Check if Sožitje had an internal error with no response
      if (sozData._status && sozData._status >= 500 && !sozData.response) {
        setTranscript((prev) => [...prev, {
          role: "sozitje",
          text: "⚠️ Sožitje ima interno napako. Poskusi znova.",
          timestamp: Date.now()
        }]);
        setVoiceState("idle");
        setStatusText("Pritisni za govor");
        return;
      }

      // 3. Mode-specific response handling
      if (mode === "listening" && sozData.received) {
        // Listening — quiet confirmation, no TTS
        setTranscript((prev) => [...prev, { role: "sozitje", text: "✓ Slišano", timestamp: Date.now() }]);
      } else if (mode === "observation") {
        // Observation — show mood change, no TTS
        if (sozData.mood) {
          setTranscript((prev) => [...prev, { role: "sozitje", text: `👁 ${sozData.mood}`, timestamp: Date.now() }]);
        }
      } else if ((mode === "conversation" || mode === "group") && sozData.response) {
        // Conversation/Group — full response + TTS
        setTranscript((prev) => [...prev, { role: "sozitje", text: sozData.response, timestamp: Date.now() }]);
        await playTTS(sozData.response);
      }

      setVoiceState("idle");
      setStatusText("Pritisni za govor");
    } catch (error: any) {
      console.error("[Voice] Process error:", error);
      const msg = error.name === "AbortError" ? "Sožitje ni odgovorilo pravočasno." : (error.message || "Napaka pri obdelavi.");
      toast({ title: "Napaka", description: msg, variant: "destructive" });
      setVoiceState("idle");
      setStatusText("Pritisni za govor");
    }
  }

  // =============================================
  // TTS Playback
  // =============================================
  async function playTTS(text: string) {
    setVoiceState("speaking");
    setStatusText("Sožitje govori...");

    try {
      const res = await fetch("/api/voice/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voice: "shimmer", speed: 0.95 }),
      });

      if (!res.ok) throw new Error("TTS failed");

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      audioUrlRef.current = url;

      const audio = new Audio(url);
      audioRef.current = audio;

      return new Promise<void>((resolve) => {
        audio.onended = () => {
          cleanupAudio();
          resolve();
        };
        audio.onerror = () => {
          cleanupAudio();
          resolve();
        };
        audio.play().catch(() => {
          cleanupAudio();
          resolve();
        });
      });
    } catch (error) {
      console.error("[Voice] TTS error:", error);
      cleanupAudio();
    }
  }

  function cleanupAudio() {
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
    audioRef.current = null;
  }

  // =============================================
  // Interrupt — stop TTS and start recording
  // =============================================
  function interrupt() {
    if (audioRef.current) {
      audioRef.current.pause();
      cleanupAudio();
    }
    setVoiceState("idle");
    setStatusText("Pritisni za govor");
  }

  // =============================================
  // Mic Button Handler
  // =============================================
  function handleMicPress() {
    if (voiceState === "speaking") {
      // Interrupt TTS → start recording
      interrupt();
      startRecording();
    } else if (voiceState === "idle") {
      startRecording();
    } else if (voiceState === "recording") {
      stopRecording();
    }
    // Ignore press during processing
  }

  // =============================================
  // Keyboard — Spacebar push-to-talk
  // =============================================
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space" && (e.target as HTMLElement).tagName !== "INPUT" && (e.target as HTMLElement).tagName !== "TEXTAREA") {
        e.preventDefault();
        if (voiceState === "idle") startRecording();
        else if (voiceState === "speaking") {
          interrupt();
          startRecording();
        }
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space" && (e.target as HTMLElement).tagName !== "INPUT" && (e.target as HTMLElement).tagName !== "TEXTAREA") {
        e.preventDefault();
        if (voiceState === "recording") stopRecording();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [voiceState, startRecording, stopRecording]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopVAD();
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
      if (audioRef.current) {
        audioRef.current.pause();
      }
      cleanupAudio();
    };
  }, []);

  // =============================================
  // Render
  // =============================================
  if (!session) {
    return (
      <div className="max-w-xl mx-auto px-4 pt-8">
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-8">
            <Bot className="h-12 w-12 text-violet-500" />
            <p className="text-muted-foreground text-center">Prijavi se za glasovni pogovor s Sožitjem.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100dvh-5rem)]">
      {/* Mode selector */}
      <div className="flex gap-1 p-3 justify-center">
        {MODES.map((m) => (
          <button
            key={m.id}
            onClick={() => setMode(m.id)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
              mode === m.id
                ? "bg-violet-500/20 text-violet-300 border border-violet-500/50"
                : "bg-muted/50 text-muted-foreground border border-transparent hover:bg-muted"
            }`}
          >
            {m.short} {m.label}
          </button>
        ))}
      </div>

      {/* Status circle area */}
      <div className="flex flex-col items-center justify-center py-6 gap-3">
        {/* Circle */}
        <button
          onClick={handleMicPress}
          disabled={voiceState === "processing"}
          className={`w-40 h-40 rounded-full flex items-center justify-center transition-all duration-300 border-2 cursor-pointer disabled:cursor-wait ${
            voiceState === "idle"
              ? "bg-violet-500/10 border-violet-500/40 hover:bg-violet-500/20"
              : voiceState === "recording"
              ? "bg-red-500/20 border-red-500 animate-pulse"
              : voiceState === "processing"
              ? "bg-amber-500/10 border-amber-500/40"
              : "bg-emerald-500/10 border-emerald-500/40"
          }`}
        >
          {voiceState === "idle" && <Mic className="h-16 w-16 text-violet-400" />}
          {voiceState === "recording" && <MicOff className="h-16 w-16 text-red-400" />}
          {voiceState === "processing" && <Loader2 className="h-16 w-16 text-amber-400 animate-spin" />}
          {voiceState === "speaking" && <Volume2 className="h-16 w-16 text-emerald-400 animate-pulse" />}
        </button>

        {/* Status text */}
        <p className="text-sm text-muted-foreground">{statusText}</p>

        {/* Sožitje state */}
        {(sozitjeState.mood || sozitjeState.energy) && (
          <p className="text-xs text-muted-foreground/60">
            ◈ {sozitjeState.mood || "mirna"} · energija: {sozitjeState.energy?.toFixed(2) || "?"}
          </p>
        )}
      </div>

      {/* Transcript */}
      <div className="flex-1 overflow-y-auto px-4 space-y-2 min-h-0">
        {transcript.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground/40">
            <Bot className="h-8 w-8 mb-2" />
            <p className="text-sm">Pogovor bo prikazan tukaj</p>
          </div>
        )}
        {transcript.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[80%] px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed ${
                msg.role === "user"
                  ? "bg-violet-500/20 text-foreground rounded-br-sm"
                  : "bg-emerald-500/10 text-foreground rounded-bl-sm"
              }`}
            >
              {msg.text}
            </div>
          </div>
        ))}
        <div ref={transcriptEndRef} />
      </div>

      {/* Bottom mic button */}
      <div className="p-4 flex justify-center">
        <Button
          size="lg"
          onClick={handleMicPress}
          disabled={voiceState === "processing"}
          className={`rounded-full w-16 h-16 ${
            voiceState === "recording"
              ? "bg-red-500 hover:bg-red-600 animate-pulse"
              : voiceState === "speaking"
              ? "bg-emerald-600 hover:bg-emerald-700"
              : "bg-violet-600 hover:bg-violet-700"
          }`}
        >
          {voiceState === "recording" ? (
            <MicOff className="h-7 w-7" />
          ) : voiceState === "processing" ? (
            <Loader2 className="h-7 w-7 animate-spin" />
          ) : (
            <Mic className="h-7 w-7" />
          )}
        </Button>
      </div>
    </div>
  );
}
