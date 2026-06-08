import { useState } from 'react';
import { UserAvatar } from '@/components/ui/UserAvatar';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { AlertTriangle, Heart, FileText, ChevronDown, ChevronUp } from 'lucide-react';
import type { RoomMessage } from '@/types/encryptedRooms';
import { formatDistanceToNow } from 'date-fns';
import { AudioPlayer } from '@/components/AudioPlayer';

const API_URL = import.meta.env.VITE_API_URL ?? '';

// Parses "audio:<path>|dur:<seconds>|transcript:<text>" — same format as OWN
function parseAudioMessage(text: string): { audioUrl: string; duration?: number; transcript?: string } | null {
  if (!text.startsWith('audio:')) return null;
  const raw = text.slice('audio:'.length).trim();
  let beforeTranscript = raw;
  let transcript: string | undefined;
  const transcriptIdx = raw.indexOf('|transcript:');
  if (transcriptIdx !== -1) {
    transcript = raw.slice(transcriptIdx + '|transcript:'.length);
    beforeTranscript = raw.slice(0, transcriptIdx);
  }
  let path = beforeTranscript;
  let duration: number | undefined;
  const durMatch = beforeTranscript.match(/^(.+)\|dur:(\d+)$/);
  if (durMatch) {
    path = durMatch[1];
    duration = parseInt(durMatch[2], 10);
  }
  const audioUrl = path.startsWith('http') ? path : `${API_URL}/api/storage/dm-audio/${path}`;
  return { audioUrl, duration, transcript };
}

const TranscriptToggle = ({ text }: { text: string }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2 pt-2 border-t border-border/30">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 text-[11px] font-medium opacity-80 hover:opacity-100 w-full"
      >
        <FileText className="h-3.5 w-3.5" />
        <span>Transcription</span>
        {open ? <ChevronUp className="h-3 w-3 ml-auto" /> : <ChevronDown className="h-3 w-3 ml-auto" />}
      </button>
      {open && (
        <p className="text-sm italic whitespace-pre-wrap break-words mt-2 opacity-90">{text}</p>
      )}
    </div>
  );
};

interface Lasher {
  pubkey: string;
  amount: string;
  name?: string;
  picture?: string;
}

interface RoomMessageBubbleProps {
  message: RoomMessage;
  isOwn: boolean;
  senderName?: string;
  senderPicture?: string;
  showSender?: boolean;
  // LASH props
  lashCount?: number;
  hasLashed?: boolean;
  lashers?: Lasher[];
  onLash?: () => void;
  isLashing?: boolean;
}

// URL/YouTube detection helpers
// Matches absolute URLs (https://…) AND relative API paths (/api/storage/…)
const URL_REGEX = /(https?:\/\/[^\s]+|\/api\/storage\/[^\s]+)/g;
const IMAGE_EXT_REGEX = /\.(jpe?g|png|gif|webp|bmp|svg)(\?.*)?$/i;
const YOUTUBE_REGEX = /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{6,})/i;

const getYoutubeId = (url: string): string | null => {
  const m = url.match(YOUTUBE_REGEX);
  return m ? m[1] : null;
};

const isImageUrl = (url: string) => IMAGE_EXT_REGEX.test(url);

const RichMessageContent = ({ text, isOwn }: { text: string; isOwn: boolean }) => {
  // Audio message: render AudioPlayer + transcript toggle
  const audio = parseAudioMessage(text);
  if (audio) {
    return (
      <div className="w-full min-w-0 room-media-fit">
        <AudioPlayer audioUrl={audio.audioUrl} initialDuration={audio.duration} />
        {audio.transcript && <TranscriptToggle text={audio.transcript} />}
      </div>
    );
  }

  // Split text by URLs, render each piece
  const parts = text.split(URL_REGEX);
  const linkClass = isOwn ? 'underline text-white/95' : 'underline text-violet-600';

  return (
    <div className="space-y-2">
      {parts.map((part, i) => {
        if (!part) return null;
        const ytId = getYoutubeId(part);
        if (ytId) {
          return (
            <div key={i} className="rounded-lg overflow-hidden w-full">
              <div className="relative w-full" style={{ paddingBottom: '56.25%' }}>
                <iframe
                  className="absolute inset-0 w-full h-full"
                  src={`https://www.youtube.com/embed/${ytId}`}
                  title="YouTube video"
                  frameBorder={0}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
            </div>
          );
        }
        const isUrl = /^(https?:\/\/|\/api\/storage\/)/.test(part);
        if (isUrl && isImageUrl(part)) {
          const openImage = async (e: React.MouseEvent) => {
            e.preventDefault();
            try {
              // Fetch as blob to bypass service worker navigation interception
              const resp = await fetch(part);
              const blob = await resp.blob();
              const blobUrl = URL.createObjectURL(blob);
              const win = window.open(blobUrl, '_blank', 'noopener,noreferrer');
              // Revoke blob URL after tab opens
              setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
              if (!win) {
                // Popup blocked fallback
                URL.revokeObjectURL(blobUrl);
                window.open(part, '_blank', 'noopener,noreferrer');
              }
            } catch {
              window.open(part, '_blank', 'noopener,noreferrer');
            }
          };
          return (
            <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="block" onClick={openImage}>
              <img
                src={part}
                alt="attachment"
                className="rounded-lg max-h-[320px] max-w-full object-contain"
                loading="lazy"
              />
            </a>
          );
        }
        if (isUrl) {
          return (
            <a
              key={i}
              href={part}
              target="_blank"
              rel="noopener noreferrer"
              className={`text-sm break-all ${linkClass}`}
            >
              {part}
            </a>
          );
        }
        return (
          <p key={i} className="text-sm whitespace-pre-wrap break-words">
            {part}
          </p>
        );
      })}
    </div>
  );
};

const formatLanoshis = (amount: string) => {
  try {
    const lanoshis = parseInt(amount);
    return (lanoshis / 100000000).toFixed(8);
  } catch {
    return '0.00000000';
  }
};

export const RoomMessageBubble = ({
  message,
  isOwn,
  senderName,
  senderPicture,
  showSender = true,
  lashCount = 0,
  hasLashed = false,
  lashers = [],
  onLash,
  isLashing = false,
}: RoomMessageBubbleProps) => {
  const initials = (senderName || message.senderPubkey.slice(0, 4))
    .slice(0, 2)
    .toUpperCase();

  const timeStr = formatDistanceToNow(new Date(message.createdAt * 1000), {
    addSuffix: true,
  });

  return (
    <div className={`group flex gap-2 mb-3 w-full min-w-0 ${isOwn ? 'flex-row-reverse' : 'flex-row'}`}>
      {/* Avatar - only show for others */}
      {!isOwn && showSender && (
        <UserAvatar pubkey={message.senderPubkey} picture={senderPicture} name={senderName} className="h-8 w-8 flex-shrink-0 mt-1" />
      )}

      {/* Spacer for alignment when avatar hidden */}
      {!isOwn && !showSender && <div className="w-8 flex-shrink-0" />}

      {/* Message bubble */}
      <div
        className={`flex-1 min-w-0 max-w-[85%] sm:max-w-[75%] ${
          isOwn
            ? 'bg-violet-500 text-white rounded-2xl rounded-br-sm'
            : 'bg-muted rounded-2xl rounded-bl-sm'
        } px-3 py-2 overflow-hidden`}
      >
        {/* Sender name */}
        {!isOwn && showSender && senderName && (
          <p className="text-xs font-medium text-violet-600 mb-0.5">{senderName}</p>
        )}

        {/* Message content */}
        {message.decryptionFailed ? (
          <div className="flex items-center gap-1.5 text-amber-500">
            <AlertTriangle className="h-3.5 w-3.5" />
            <span className="text-xs">{message.text}</span>
          </div>
        ) : (
          <RichMessageContent text={message.text} isOwn={isOwn} />
        )}

        {/* Timestamp */}
        <p
          className={`text-[10px] mt-1 ${
            isOwn ? 'text-white/70' : 'text-muted-foreground'
          }`}
        >
          {timeStr}
        </p>
      </div>

      {/* LASH heart button - only for received messages */}
      {!isOwn && onLash && (
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={`flex-shrink-0 h-7 w-7 relative self-center ${
                hasLashed
                  ? 'opacity-100'
                  : 'sm:opacity-0 sm:group-hover:opacity-100 transition-opacity'
              }`}
              onClick={(e) => {
                if (!hasLashed) {
                  e.preventDefault();
                  onLash();
                }
              }}
              disabled={isLashing}
            >
              <Heart
                className={`h-4 w-4 ${
                  hasLashed
                    ? 'fill-red-500 text-red-500'
                    : 'text-primary hover:fill-primary'
                }`}
              />
              {lashCount > 0 && (
                <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] rounded-full h-4 w-4 flex items-center justify-center font-bold">
                  {lashCount}
                </span>
              )}
            </Button>
          </PopoverTrigger>
          {hasLashed && lashers.length > 0 && (
            <PopoverContent className="w-[min(18rem,85vw)]">
              <div className="space-y-3">
                <p className="font-semibold text-sm">LASHed by:</p>
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {lashers.map((lasher) => (
                    <div
                      key={lasher.pubkey}
                      className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 transition-colors"
                    >
                      <UserAvatar pubkey={lasher.pubkey} picture={lasher.picture} name={lasher.name} className="h-8 w-8" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">
                          {lasher.name || `${lasher.pubkey.slice(0, 8)}...${lasher.pubkey.slice(-8)}`}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatLanoshis(lasher.amount)} LANA
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </PopoverContent>
          )}
        </Popover>
      )}
    </div>
  );
};
