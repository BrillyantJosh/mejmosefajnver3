import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, X } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface ImageToTextButtonProps {
  onDescription: (text: string) => void;
  language?: string;
  disabled?: boolean;
}

const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_IMAGE_DIMENSION = 1200;

export function ImageToTextButton({ onDescription, language, disabled }: ImageToTextButtonProps) {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const { toast } = useToast();

  // Resize image to max dimension (same logic as DMImageUploader)
  const resizeImage = (file: File): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);

      img.onload = () => {
        URL.revokeObjectURL(url);

        let { width, height } = img;

        // Only resize if larger than max dimension
        if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
          if (width > height) {
            height = Math.round((height * MAX_IMAGE_DIMENSION) / width);
            width = MAX_IMAGE_DIMENSION;
          } else {
            width = Math.round((width * MAX_IMAGE_DIMENSION) / height);
            height = MAX_IMAGE_DIMENSION;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Cannot get canvas context'));
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob(
          (blob) => {
            if (blob) {
              resolve(blob);
            } else {
              reject(new Error('Failed to create image blob'));
            }
          },
          'image/jpeg',
          0.85
        );
      };

      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Failed to load image'));
      };

      img.src = url;
    });
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Reset input so same file can be selected again
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }

    // Validate type
    if (!file.type.startsWith('image/')) {
      toast({
        title: "Error",
        description: "Please select an image file.",
        variant: "destructive"
      });
      return;
    }

    // Validate size
    if (file.size > MAX_IMAGE_SIZE) {
      toast({
        title: "Error",
        description: "Image is too large (max 5MB).",
        variant: "destructive"
      });
      return;
    }

    setIsAnalyzing(true);

    try {
      // Resize image
      const resizedBlob = await resizeImage(file);
      console.log(`🖼 ITT: Image resized from ${file.size} to ${resizedBlob.size} bytes`);

      // Send to API
      abortControllerRef.current = new AbortController();

      const formData = new FormData();
      const imageFile = new File([resizedBlob], 'image.jpg', { type: 'image/jpeg' });
      formData.append('file', imageFile);
      if (language) {
        formData.append('language', language);
      }

      const response = await fetch('/api/functions/image-to-text', {
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
          title: "No description",
          description: "Could not describe the image. Please try again.",
        });
        return;
      }

      onDescription(text);

    } catch (error: any) {
      if (error.name === 'AbortError') {
        return;
      }
      console.error('Image-to-text error:', error);
      toast({
        title: "Analysis failed",
        description: error.message || "Could not analyze image. Please try again.",
        variant: "destructive"
      });
    } finally {
      setIsAnalyzing(false);
      abortControllerRef.current = null;
    }
  };

  const handleCancel = () => {
    abortControllerRef.current?.abort();
    setIsAnalyzing(false);
  };

  // Analyzing state
  if (isAnalyzing) {
    return (
      <div className="flex items-center gap-2 bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800 rounded-lg p-2">
        <Loader2 className="h-5 w-5 animate-spin text-indigo-600 dark:text-indigo-400" />
        <span className="text-sm text-indigo-700 dark:text-indigo-300 font-medium">Analyzing image...</span>
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

  // Idle state — hidden file input
  return (
    <input
      ref={fileInputRef}
      data-image-to-text
      type="file"
      accept="image/*"
      className="hidden"
      onChange={handleFileSelect}
      disabled={disabled}
    />
  );
}
