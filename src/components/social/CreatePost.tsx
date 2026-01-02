import { useState, useEffect, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, ImagePlus, X, AlertCircle, DoorOpen } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useNostrUserRoomSubscriptions } from "@/hooks/useNostrUserRoomSubscriptions";
import { useNostrRooms } from "@/hooks/useNostrRooms";
import { useNostrTinyRooms } from "@/hooks/useNostrTinyRooms";
import { useAdmin } from "@/contexts/AdminContext";
import { SimplePool, finalizeEvent } from "nostr-tools";
import { useSystemParameters } from "@/contexts/SystemParametersContext";
import { toast } from "@/hooks/use-toast";

const DEFAULT_RELAYS = [
  'wss://relay.lanavault.space',
  'wss://relay.lanacoin-eternity.com',
  'wss://relay.lanaheartvoice.com'
];

interface CreatePostProps {
  onPostCreated?: () => void;
}

export function CreatePost({ onPostCreated }: CreatePostProps) {
  const { session } = useAuth();
  const { appSettings } = useAdmin();
  const { parameters: systemParameters } = useSystemParameters();
  const { rooms, canPublish } = useNostrRooms();
  const { rooms: tinyRooms, loading: tinyRoomsLoading } = useNostrTinyRooms(session?.nostrHexId);
  const { subscriptions } = useNostrUserRoomSubscriptions({
    userPubkey: session?.nostrHexId || '',
    userPrivateKey: session?.nostrPrivateKey || ''
  });

  const [content, setContent] = useState("");
  const [selectedRoom, setSelectedRoom] = useState<string>("");
  const [publishing, setPublishing] = useState(false);
  const [selectedImages, setSelectedImages] = useState<File[]>([]);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [rulesAccepted, setRulesAccepted] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);

  const relays = systemParameters?.relays && systemParameters.relays.length > 0 
    ? systemParameters.relays 
    : DEFAULT_RELAYS;

  // Always set default room from app_settings immediately
  useEffect(() => {
    if (appSettings?.default_rooms && appSettings.default_rooms.length > 0) {
      setSelectedRoom(appSettings.default_rooms[0]);
    }
  }, [appSettings]);

  // Get subscribed rooms (loading in background)
  const subscribedRooms = rooms.filter(room => 
    subscriptions.some(sub => sub.slug === room.slug && sub.status === 'active')
  );

  // Always include default rooms PLUS all subscribed rooms (remove duplicates)
  // Filter to only show rooms where user can publish
  const allAvailableRooms = appSettings?.default_rooms 
    ? [
        ...appSettings.default_rooms.map(slug => ({
          slug,
          title: slug,
          icon: undefined,
          visibility: 'public' as const,
          status: 'active' as const,
          order: 0,
          type: 'regular' as const
        })),
        ...subscribedRooms.filter(room => !appSettings.default_rooms.includes(room.slug)).map(room => ({
          ...room,
          type: 'regular' as const
        }))
      ]
    : subscribedRooms.map(room => ({ ...room, type: 'regular' as const }));

  const availableRooms = allAvailableRooms.filter(room => 
    canPublish(session?.nostrHexId || '', room.slug)
  );

  // Add active Tiny Rooms to the available rooms
  const activeTinyRooms = tinyRooms.filter(room => room.status === 'active').map(room => ({
    slug: `tiny:${room.admin}:${room.slug}`,
    title: room.name,
    icon: undefined,
    visibility: 'private' as const,
    status: 'active' as const,
    order: 999,
    type: 'tiny' as const,
    tinyRoomData: room
  }));

  const allRooms = [...availableRooms, ...activeTinyRooms];

  // Reset rules acceptance when room changes
  useEffect(() => {
    setRulesAccepted(false);
  }, [selectedRoom]);

  // Handle paste to allow only specific HTML tags (bold, etc.)
  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    const clipboardData = e.clipboardData;
    const html = clipboardData.getData('text/html');
    const text = clipboardData.getData('text/plain');
    
    if (html) {
      // Create a temporary element to parse and sanitize HTML
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = html;
      
      // Only keep allowed tags (b, strong, i, em, br, div, p for structure)
      const sanitizeNode = (node: Node): string => {
        if (node.nodeType === Node.TEXT_NODE) {
          return node.textContent || '';
        }
        
        if (node.nodeType !== Node.ELEMENT_NODE) {
          return '';
        }
        
        const element = node as Element;
        const tagName = element.tagName.toLowerCase();
        const childContent = Array.from(element.childNodes).map(sanitizeNode).join('');
        
        switch (tagName) {
          case 'b':
          case 'strong':
            return `<b>${childContent}</b>`;
          case 'i':
          case 'em':
            return `<i>${childContent}</i>`;
          case 'br':
            return '<br>';
          case 'p':
          case 'div':
            return childContent + '<br>';
          case 'li':
            return `• ${childContent}<br>`;
          case 'ul':
          case 'ol':
            return childContent;
          default:
            return childContent;
        }
      };
      
      let sanitizedHtml = sanitizeNode(tempDiv);
      // Clean up multiple <br> tags
      sanitizedHtml = sanitizedHtml.replace(/(<br>){3,}/g, '<br><br>');
      
      document.execCommand('insertHTML', false, sanitizedHtml);
    } else if (text) {
      // Plain text - insert as text
      document.execCommand('insertText', false, text);
    }
    
    // Update content state
    if (editorRef.current) {
      setContent(editorRef.current.innerHTML);
    }
  };

  // Convert HTML to markdown for storage
  const getMarkdownContent = (): string => {
    if (!editorRef.current) return '';
    
    const html = editorRef.current.innerHTML;
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;
    
    const convertNode = (node: Node): string => {
      if (node.nodeType === Node.TEXT_NODE) {
        return node.textContent || '';
      }
      
      if (node.nodeType !== Node.ELEMENT_NODE) {
        return '';
      }
      
      const element = node as Element;
      const tagName = element.tagName.toLowerCase();
      const childContent = Array.from(element.childNodes).map(convertNode).join('');
      
      switch (tagName) {
        case 'b':
        case 'strong':
          return `**${childContent}**`;
        case 'i':
        case 'em':
          return `*${childContent}*`;
        case 'br':
          return '\n';
        case 'div':
          // Don't add extra newline if content already ends with newline
          if (childContent.endsWith('\n')) {
            return childContent;
          }
          return childContent + '\n';
        default:
          return childContent;
      }
    };
    
    let markdown = convertNode(tempDiv).trim();
    return markdown;
  };

  // Handle input changes
  const handleInput = () => {
    if (editorRef.current) {
      setContent(editorRef.current.innerHTML);
    }
  };

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    
    if (files.length === 0) return;

    // Check if adding these files would exceed the limit
    if (selectedImages.length + files.length > 3) {
      toast({
        title: "Too many images",
        description: "You can upload up to 3 images",
        variant: "destructive"
      });
      return;
    }

    // Show 60-day storage notice on first image selection
    if (selectedImages.length === 0) {
      toast({
        title: "Storage notice",
        description: "Images will be stored for 60 days on the server, then automatically deleted.",
        duration: 5000
      });
    }

    // Create preview URLs
    const newPreviews = files.map(file => URL.createObjectURL(file));
    setSelectedImages(prev => [...prev, ...files]);
    setImagePreviews(prev => [...prev, ...newPreviews]);

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const removeImage = (index: number) => {
    // Revoke the preview URL to free memory
    URL.revokeObjectURL(imagePreviews[index]);
    
    setSelectedImages(prev => prev.filter((_, i) => i !== index));
    setImagePreviews(prev => prev.filter((_, i) => i !== index));
  };

  const resizeImage = async (file: File, maxWidth: number = 1200): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        if (width > maxWidth) {
          height = (height * maxWidth) / width;
          width = maxWidth;
        }

        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Could not get canvas context'));
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob(
          (blob) => {
            if (blob) {
              resolve(blob);
            } else {
              reject(new Error('Failed to create blob'));
            }
          },
          'image/jpeg',
          0.85
        );
      };
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  };

  const uploadImages = async (): Promise<string[]> => {
    if (selectedImages.length === 0) return [];

    setUploading(true);
    const uploadedUrls: string[] = [];

    try {
      for (const file of selectedImages) {
        // Resize image
        const resizedBlob = await resizeImage(file);
        
        // Generate unique filename
        const fileExt = file.name.split('.').pop();
        const fileName = `${session?.nostrHexId}/${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;

        // Upload to Supabase Storage
        const { data, error } = await supabase.storage
          .from('post-images')
          .upload(fileName, resizedBlob, {
            contentType: 'image/jpeg',
            cacheControl: '3600',
            upsert: false
          });

        if (error) {
          console.error('Upload error:', error);
          throw error;
        }

        // Get public URL
        const { data: { publicUrl } } = supabase.storage
          .from('post-images')
          .getPublicUrl(data.path);

        uploadedUrls.push(publicUrl);
      }

      return uploadedUrls;
    } catch (error) {
      console.error('Error uploading images:', error);
      toast({
        title: "Error uploading images",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive"
      });
      return [];
    } finally {
      setUploading(false);
    }
  };

  const handlePost = async () => {
    const markdownContent = getMarkdownContent();
    if (!markdownContent || !session?.nostrPrivateKey || !selectedRoom) {
      toast({
        title: "Error",
        description: "Please enter content and select a room",
        variant: "destructive"
      });
      return;
    }

    // Check if this is a Tiny Room
    const isTinyRoom = selectedRoom.startsWith('tiny:');
    
    if (!isTinyRoom) {
      // Check publishing permissions for regular rooms
      if (!canPublish(session.nostrHexId, selectedRoom)) {
        toast({
          title: "Permission denied",
          description: `You don't have permission to publish in room "${selectedRoom}". This is a restricted room.`,
          variant: "destructive"
        });
        return;
      }

      // Check if rules need to be accepted
      const currentRoom = rooms.find(r => r.slug === selectedRoom);
      if (currentRoom?.rules && currentRoom.rules.length > 0 && !rulesAccepted) {
        toast({
          title: "Rules not accepted",
          description: "Please accept the room rules before posting",
          variant: "destructive"
        });
        return;
      }
    } else {
      // For Tiny Rooms, check membership
      const tinyRoomSlug = selectedRoom.replace('tiny:', '').split(':').slice(1).join(':');
      const tinyRoom = tinyRooms.find(r => `${r.admin}:${r.slug}` === selectedRoom.replace('tiny:', ''));
      
      if (!tinyRoom || !tinyRoom.members.includes(session.nostrHexId)) {
        toast({
          title: "Permission denied",
          description: "You are not a member of this Tiny Room",
          variant: "destructive"
        });
        return;
      }

      if (tinyRoom.status === 'archived') {
        toast({
          title: "Room archived",
          description: "This room is archived and no new messages can be posted",
          variant: "destructive"
        });
        return;
      }
    }

    try {
      setPublishing(true);

      // Upload images first if any are selected
      const imageUrls = await uploadImages();
      
      const pool = new SimplePool();

      // Create event with room tag and image tags
      const privKeyBytes = new Uint8Array(session.nostrPrivateKey.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
      
      const tags: string[][] = [];
      
      // Add appropriate tag based on room type
      if (selectedRoom.startsWith('tiny:')) {
        // Tiny Room: use NIP-33 'a' tag format: 30150:<admin_pubkey>:<d_tag>
        const [, admin, ...dTagParts] = selectedRoom.split(':');
        const dTag = dTagParts.join(':');
        tags.push(["a", `30150:${admin}:${dTag}`]);
      } else {
        // Regular room: use simple 'a' tag
        tags.push(["a", selectedRoom]);
      }
      
      // Add image URLs as NIP-92 imeta tags for compatibility with Damus and other clients
      imageUrls.forEach(url => {
        tags.push(['imeta', `url ${url}`, 'm image/jpeg']);
      });
      
      // Append image URLs to content for clients that read them from content (like Damus)
      let finalContent = markdownContent;
      if (imageUrls.length > 0) {
        finalContent = markdownContent + '\n\n' + imageUrls.join('\n');
      }
      
      const event = finalizeEvent({
        kind: 1,
        created_at: Math.floor(Date.now() / 1000),
        tags,
        content: finalContent,
      }, privKeyBytes);

      console.log('Publishing to relays:', relays);
      console.log('Event:', event);

      // Publish to relays - consider success if at least one relay accepts
      const publishPromises = pool.publish(relays, event);
      
      // Create a promise that resolves when at least one relay succeeds
      const publishArray = Array.from(publishPromises);
      let successCount = 0;
      let errorCount = 0;
      
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          if (successCount === 0) {
            reject(new Error('Publish timeout - no relays responded'));
          } else {
            resolve();
          }
        }, 10000);

        publishArray.forEach((promise) => {
          promise
            .then(() => {
              successCount++;
              if (successCount === 1) {
                clearTimeout(timeout);
                resolve();
              }
            })
            .catch(() => {
              errorCount++;
              if (errorCount === publishArray.length) {
                clearTimeout(timeout);
                reject(new Error('All relays failed to publish'));
              }
            });
        });
      });

      toast({
        title: "Published!",
        description: "Your post was successfully published"
      });

      setContent("");
      if (editorRef.current) {
        editorRef.current.innerHTML = "";
      }
      setRulesAccepted(false);
      
      // Clear images and previews
      imagePreviews.forEach(url => URL.revokeObjectURL(url));
      setSelectedImages([]);
      setImagePreviews([]);
      
      // Call callback if provided
      onPostCreated?.();
      
      // Close connections after a delay
      setTimeout(() => pool.close(relays), 1000);
    } catch (error) {
      console.error('Error publishing post:', error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to publish post",
        variant: "destructive"
      });
    } finally {
      setPublishing(false);
    }
  };

  if (!session) return null;

  return (
    <Card>
      <CardContent className="pt-6 space-y-3">
        <div
          ref={editorRef}
          contentEditable
          onInput={handleInput}
          onPaste={handlePaste}
          data-placeholder="What's on your mind?"
          className="min-h-[100px] p-3 border border-input rounded-md bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 empty:before:content-[attr(data-placeholder)] empty:before:text-muted-foreground [&_b]:font-bold [&_strong]:font-bold [&_i]:italic [&_em]:italic"
        />
        
        {imagePreviews.length > 0 && (
          <div className="flex gap-2 flex-wrap">
            {imagePreviews.map((preview, index) => (
              <div key={index} className="relative">
                <img 
                  src={preview} 
                  alt={`Preview ${index + 1}`}
                  className="h-20 w-20 object-cover rounded-md border border-border"
                />
                <Button
                  size="icon"
                  variant="destructive"
                  className="absolute -top-2 -right-2 h-6 w-6 rounded-full"
                  onClick={() => removeImage(index)}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
        )}

        {selectedRoom && rooms.find(r => r.slug === selectedRoom)?.rules && rooms.find(r => r.slug === selectedRoom)!.rules!.length > 0 && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="ml-2">
              <p className="font-medium mb-2">Room Agreement:</p>
              <ul className="text-sm space-y-1 list-disc list-inside mb-3">
                {rooms.find(r => r.slug === selectedRoom)!.rules!.map((rule, idx) => (
                  <li key={idx}>{rule}</li>
                ))}
              </ul>
              <div className="flex items-center space-x-2">
                <Checkbox 
                  id="rules-accept" 
                  checked={rulesAccepted}
                  onCheckedChange={(checked) => setRulesAccepted(checked === true)}
                />
                <label
                  htmlFor="rules-accept"
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                >
                  I accept and will follow this agreement
                </label>
              </div>
            </AlertDescription>
          </Alert>
        )}

        <div className="flex items-center gap-3">
          <Select value={selectedRoom} onValueChange={setSelectedRoom}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Select a room" />
            </SelectTrigger>
            <SelectContent>
              {allRooms.map((room) => (
                <SelectItem key={room.slug} value={room.slug}>
                  <div className="flex items-center gap-2">
                    {room.type === 'tiny' && <DoorOpen className="h-3 w-3" />}
                    {room.icon && <span>{room.icon}</span>}
                    <span>{room.title}</span>
                    {room.type === 'tiny' && <span className="text-xs text-muted-foreground">(Tiny Room)</span>}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handleImageSelect}
            className="hidden"
          />

          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => fileInputRef.current?.click()}
            disabled={selectedImages.length >= 3 || uploading || publishing}
            title="Add images (max 3)"
          >
            <ImagePlus className="h-4 w-4" />
          </Button>

          <Button 
            onClick={handlePost} 
            disabled={
              publishing || 
              uploading || 
              !content || 
              !selectedRoom || 
              (rooms.find(r => r.slug === selectedRoom)?.rules && rooms.find(r => r.slug === selectedRoom)!.rules!.length > 0 && !rulesAccepted)
            }
            className="ml-auto"
          >
            {(publishing || uploading) ? <Loader2 className="h-4 w-4 animate-spin" /> : "Publish"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
