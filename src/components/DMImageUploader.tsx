import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { ImagePlus, X, Send, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

interface DMImageUploaderProps {
  recipientPubkey: string;
  onSendMessage: (imageUrls: string[]) => Promise<void>;
  compact?: boolean;
}

export function DMImageUploader({ recipientPubkey, onSendMessage, compact = false }: DMImageUploaderProps) {
  const [selectedImages, setSelectedImages] = useState<File[]>([]);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { session } = useAuth();
  const { toast } = useToast();

  const MAX_IMAGES = 8;
  const MAX_SIZE_MB = 5;
  const MAX_WIDTH = 1200;

  const resizeImage = (file: File, maxWidth: number): Promise<File> => {
    return new Promise((resolve, reject) => {
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
              const resizedFile = new File([blob], file.name, {
                type: 'image/jpeg',
                lastModified: Date.now(),
              });
              resolve(resizedFile);
            } else {
              reject(new Error('Failed to resize image'));
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

  const handleImageSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    
    if (selectedImages.length + files.length > MAX_IMAGES) {
      toast({
        title: "Too many images",
        description: `You can only upload up to ${MAX_IMAGES} images at once`,
        variant: "destructive"
      });
      return;
    }

    const validFiles: File[] = [];
    const newPreviews: string[] = [];

    for (const file of files) {
      if (file.size > MAX_SIZE_MB * 1024 * 1024) {
        toast({
          title: "File too large",
          description: `${file.name} is larger than ${MAX_SIZE_MB}MB`,
          variant: "destructive"
        });
        continue;
      }

      try {
        const resizedFile = await resizeImage(file, MAX_WIDTH);
        validFiles.push(resizedFile);
        newPreviews.push(URL.createObjectURL(resizedFile));
      } catch (error) {
        console.error('Error resizing image:', error);
        toast({
          title: "Error",
          description: `Failed to process ${file.name}`,
          variant: "destructive"
        });
      }
    }

    setSelectedImages(prev => [...prev, ...validFiles]);
    setPreviewUrls(prev => [...prev, ...newPreviews]);
    setIsOpen(true);
  };

  const removeImage = (index: number) => {
    URL.revokeObjectURL(previewUrls[index]);
    setSelectedImages(prev => prev.filter((_, i) => i !== index));
    setPreviewUrls(prev => prev.filter((_, i) => i !== index));
    
    if (selectedImages.length === 1) {
      setIsOpen(false);
    }
  };

  const handleDiscardAll = () => {
    previewUrls.forEach(url => URL.revokeObjectURL(url));
    setSelectedImages([]);
    setPreviewUrls([]);
    setIsOpen(false);
  };

  const handleSendImages = async () => {
    if (!session?.nostrHexId || selectedImages.length === 0) return;

    setIsUploading(true);
    try {
      const uploadedUrls: string[] = [];

      for (const file of selectedImages) {
        const timestamp = Date.now();
        const random = Math.random().toString(36).substring(7);
        const fileName = `${timestamp}_${random}.jpg`;
        const filePath = `${session.nostrHexId}/${recipientPubkey}/${fileName}`;

        const { data, error } = await supabase.storage
          .from('dm-images')
          .upload(filePath, file, {
            contentType: 'image/jpeg',
            upsert: false
          });

        if (error) {
          console.error('Upload error:', error);
          throw error;
        }

        const { data: { publicUrl } } = supabase.storage
          .from('dm-images')
          .getPublicUrl(data.path);

        uploadedUrls.push(publicUrl);
      }

      // Clean up previews
      previewUrls.forEach(url => URL.revokeObjectURL(url));
      setSelectedImages([]);
      setPreviewUrls([]);
      setIsOpen(false);

      // Auto-send the message with image URLs
      await onSendMessage(uploadedUrls);

      toast({
        title: "Success",
        description: `${uploadedUrls.length} image(s) sent successfully`
      });
    } catch (error) {
      console.error('Error uploading images:', error);
      toast({
        title: "Error",
        description: "Failed to upload images. Please try again.",
        variant: "destructive"
      });
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <>
      <input
        ref={fileInputRef}
        data-image-uploader
        type="file"
        accept="image/jpeg,image/jpg,image/png,image/gif,image/webp"
        multiple
        onChange={handleImageSelect}
        className="hidden"
      />
      
      {isOpen && selectedImages.length > 0 && (
        <div className="border rounded-lg p-3 space-y-3 bg-background">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">
              {selectedImages.length} image{selectedImages.length > 1 ? 's' : ''} selected
            </span>
            <span className="text-xs text-muted-foreground">
              Auto-deleted after 30 days
            </span>
          </div>

          <div className="grid grid-cols-4 gap-2">
            {previewUrls.map((url, index) => (
              <div key={index} className="relative group aspect-square">
                <img
                  src={url}
                  alt={`Preview ${index + 1}`}
                  className="w-full h-full object-cover rounded-lg"
                />
                <button
                  type="button"
                  onClick={() => removeImage(index)}
                  className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
            
            {selectedImages.length < MAX_IMAGES && (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="aspect-square border-2 border-dashed rounded-lg flex items-center justify-center hover:bg-muted transition-colors"
              >
                <ImagePlus className="h-6 w-6 text-muted-foreground" />
              </button>
            )}
          </div>

          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleDiscardAll}
              disabled={isUploading}
              className="flex-1"
            >
              Discard All
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleSendImages}
              disabled={isUploading}
              className="flex-1"
            >
              {isUploading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Uploading...
                </>
              ) : (
                <>
                  <Send className="h-4 w-4 mr-2" />
                  Send Images
                </>
              )}
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
