import { useState, useRef, KeyboardEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Send, Loader2, ImagePlus, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import OwnAudioRecorder from '@/components/own/OwnAudioRecorder';

interface RoomChatInputProps {
  onSend: (text: string) => Promise<void>;
  disabled?: boolean;
  placeholder?: string;
  roomId?: string;
}

const MAX_IMAGES = 4;
const MAX_SIZE_MB = 5;
const MAX_WIDTH = 1200;

const resizeImage = (file: File, maxWidth: number): Promise<File> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    img.onload = () => {
      let width = img.width;
      let height = img.height;
      if (width > maxWidth) {
        height = (height * maxWidth) / width;
        width = maxWidth;
      }
      canvas.width = width;
      canvas.height = height;
      ctx?.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(new File([blob], file.name, { type: 'image/jpeg', lastModified: Date.now() }));
          } else {
            reject(new Error('Failed to resize image'));
          }
        },
        'image/jpeg',
        0.85,
      );
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });

export const RoomChatInput = ({
  onSend,
  disabled = false,
  placeholder = 'Type a message...',
  roomId,
}: RoomChatInputProps) => {
  const [text, setText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [pending, setPending] = useState<{ file: File; previewUrl: string }[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { session } = useAuth();
  const { toast } = useToast();

  const handleImageSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (pending.length + files.length > MAX_IMAGES) {
      toast({
        title: 'Too many images',
        description: `Up to ${MAX_IMAGES} images at once`,
        variant: 'destructive',
      });
      return;
    }
    const next: { file: File; previewUrl: string }[] = [];
    for (const file of files) {
      if (file.size > MAX_SIZE_MB * 1024 * 1024) {
        toast({
          title: 'File too large',
          description: `${file.name} exceeds ${MAX_SIZE_MB}MB`,
          variant: 'destructive',
        });
        continue;
      }
      try {
        const resized = await resizeImage(file, MAX_WIDTH);
        next.push({ file: resized, previewUrl: URL.createObjectURL(resized) });
      } catch (err) {
        console.error('Resize error:', err);
      }
    }
    setPending((prev) => [...prev, ...next]);
  };

  const removePending = (index: number) => {
    setPending((prev) => {
      URL.revokeObjectURL(prev[index].previewUrl);
      return prev.filter((_, i) => i !== index);
    });
  };

  const uploadImages = async (): Promise<string[]> => {
    if (!session?.nostrHexId || pending.length === 0) return [];
    const urls: string[] = [];
    for (const { file } of pending) {
      const timestamp = Date.now();
      const random = Math.random().toString(36).substring(7);
      const fileName = `${timestamp}_${random}.jpg`;
      const filePath = `rooms/${roomId || 'misc'}/${session.nostrHexId}/${fileName}`;
      const { data, error } = await supabase.storage
        .from('dm-images')
        .upload(filePath, file, { contentType: 'image/jpeg', upsert: false });
      if (error) throw error;
      const { data: { publicUrl } } = supabase.storage.from('dm-images').getPublicUrl(data.path);
      urls.push(publicUrl);
    }
    return urls;
  };

  const handleSend = async () => {
    const trimmed = text.trim();
    if ((!trimmed && pending.length === 0) || isSending || disabled) return;

    setIsSending(true);
    try {
      let imageUrls: string[] = [];
      if (pending.length > 0) {
        setIsUploading(true);
        try {
          imageUrls = await uploadImages();
        } catch (err) {
          console.error('Upload failed:', err);
          toast({
            title: 'Upload failed',
            description: 'Could not upload images',
            variant: 'destructive',
          });
          return;
        } finally {
          setIsUploading(false);
        }
      }

      const finalText = [trimmed, ...imageUrls].filter(Boolean).join('\n');
      await onSend(finalText);

      // Clean up
      pending.forEach((p) => URL.revokeObjectURL(p.previewUrl));
      setPending([]);
      setText('');
      textareaRef.current?.focus();
    } catch (error) {
      console.error('Failed to send message:', error);
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="border-t bg-background pb-safe">
      {pending.length > 0 && (
        <div className="flex gap-2 p-2 sm:p-3 overflow-x-auto">
          {pending.map((p, i) => (
            <div key={i} className="relative flex-shrink-0">
              <img
                src={p.previewUrl}
                alt={`preview ${i + 1}`}
                className="h-16 w-16 object-cover rounded-md border"
              />
              <button
                type="button"
                onClick={() => removePending(i)}
                className="absolute -top-1.5 -right-1.5 bg-destructive text-destructive-foreground rounded-full p-0.5"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-end gap-2 p-2 sm:p-3">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/jpg,image/png,image/gif,image/webp"
          multiple
          onChange={handleImageSelect}
          className="hidden"
        />
        <Button
          type="button"
          size="icon"
          variant="ghost"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled || isSending || isUploading}
          className="flex-shrink-0 h-10 w-10"
          title="Attach image"
        >
          <ImagePlus className="h-4 w-4" />
        </Button>
        {session?.nostrHexId && roomId && (
          <div className="flex-shrink-0">
            <OwnAudioRecorder
              processEventId={roomId}
              senderPubkey={session.nostrHexId}
              onSendAudio={async (audioPath: string) => {
                try {
                  await onSend(audioPath);
                  return true;
                } catch (err) {
                  console.error('Failed to send audio message:', err);
                  return false;
                }
              }}
              compact
            />
          </div>
        )}
        <Textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled || isSending}
          className="min-h-[40px] max-h-[120px] resize-none border-border/50"
          rows={1}
        />
        <Button
          size="icon"
          onClick={handleSend}
          disabled={(!text.trim() && pending.length === 0) || isSending || disabled}
          className="bg-violet-500 hover:bg-violet-600 text-white flex-shrink-0 h-10 w-10"
        >
          {isSending || isUploading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </Button>
      </div>
    </div>
  );
};
