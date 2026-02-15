import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { AlertTriangle } from 'lucide-react';
import type { RoomMessage } from '@/types/encryptedRooms';
import { formatDistanceToNow } from 'date-fns';

interface RoomMessageBubbleProps {
  message: RoomMessage;
  isOwn: boolean;
  senderName?: string;
  senderPicture?: string;
  showSender?: boolean;
}

export const RoomMessageBubble = ({
  message,
  isOwn,
  senderName,
  senderPicture,
  showSender = true,
}: RoomMessageBubbleProps) => {
  const initials = (senderName || message.senderPubkey.slice(0, 4))
    .slice(0, 2)
    .toUpperCase();

  const timeStr = formatDistanceToNow(new Date(message.createdAt * 1000), {
    addSuffix: true,
  });

  return (
    <div className={`flex gap-2 mb-3 ${isOwn ? 'flex-row-reverse' : 'flex-row'}`}>
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
    </div>
  );
};
