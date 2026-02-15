import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { AlertTriangle, Heart } from 'lucide-react';
import type { RoomMessage } from '@/types/encryptedRooms';
import { formatDistanceToNow } from 'date-fns';

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
    <div className={`group flex gap-2 mb-3 ${isOwn ? 'flex-row-reverse' : 'flex-row'}`}>
      {/* Avatar - only show for others */}
      {!isOwn && showSender && (
        <Avatar className="h-8 w-8 flex-shrink-0 mt-1">
          {senderPicture ? (
            <AvatarImage src={senderPicture} alt={senderName} />
          ) : null}
          <AvatarFallback className="text-xs bg-muted">{initials}</AvatarFallback>
        </Avatar>
      )}

      {/* Spacer for alignment when avatar hidden */}
      {!isOwn && !showSender && <div className="w-8 flex-shrink-0" />}

      {/* Message bubble */}
      <div
        className={`max-w-[75%] ${
          isOwn
            ? 'bg-violet-500 text-white rounded-2xl rounded-br-sm'
            : 'bg-muted rounded-2xl rounded-bl-sm'
        } px-3.5 py-2`}
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
          <p className="text-sm whitespace-pre-wrap break-words">{message.text}</p>
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
                  : 'opacity-0 group-hover:opacity-100 transition-opacity'
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
            <PopoverContent className="w-72">
              <div className="space-y-3">
                <p className="font-semibold text-sm">LASHed by:</p>
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {lashers.map((lasher) => (
                    <div
                      key={lasher.pubkey}
                      className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 transition-colors"
                    >
                      <Avatar className="h-8 w-8">
                        {lasher.picture ? (
                          <AvatarImage src={lasher.picture} alt={lasher.name} />
                        ) : null}
                        <AvatarFallback className="bg-gradient-to-br from-primary to-accent text-white text-xs">
                          {(lasher.name || lasher.pubkey).slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
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
