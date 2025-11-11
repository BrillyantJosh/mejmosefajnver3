import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ExternalLink } from 'lucide-react';

interface LinkPreviewProps {
  url: string;
}

interface OpenGraphData {
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
}

export function LinkPreview({ url }: LinkPreviewProps) {
  const [ogData, setOgData] = useState<OpenGraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // Check if URL is a YouTube link
  const getYouTubeId = (url: string): string | null => {
    const patterns = [
      /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/,
      /youtube\.com\/watch\?.*v=([^&\n?#]+)/
    ];
    
    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match && match[1]) return match[1];
    }
    return null;
  };

  // Check if URL is an image
  const isImageUrl = (url: string): boolean => {
    return /\.(jpg|jpeg|png|gif|webp|svg)(\?.*)?$/i.test(url);
  };

  // Check if URL is an audio file
  const isAudioUrl = (url: string): boolean => {
    return /\.(mp3|wav|ogg|webm|m4a|aac|flac)(\?.*)?$/i.test(url);
  };

  // Check if URL is a Supabase storage URL (these require signed access)
  const isSupabaseStorageUrl = (url: string): boolean => {
    return url.includes('supabase.co/storage/v1/object');
  };

  const youtubeId = getYouTubeId(url);
  const isImage = isImageUrl(url);
  const isAudio = isAudioUrl(url);
  const isStorageUrl = isSupabaseStorageUrl(url);

  useEffect(() => {
    // For YouTube, images, audio files, and Supabase storage URLs, just stop loading immediately
    if (youtubeId || isImage || isAudio || isStorageUrl) {
      setLoading(false);
      return;
    }
    
    // Fetch metadata for regular URLs
    const fetchMetadata = async () => {
      try {
        const response = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/fetch-url-metadata`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
            },
            body: JSON.stringify({ url }),
          }
        );

        if (!response.ok) {
          throw new Error('Failed to fetch metadata');
        }

        const data = await response.json();
        setOgData(data);
      } catch (err) {
        console.error('Error fetching metadata:', err);
        setError(true);
      } finally {
        setLoading(false);
      }
    };

    fetchMetadata();
  }, [url, youtubeId, isImage, isAudio, isStorageUrl]);

  // Render YouTube embed
  if (youtubeId) {
    return (
      <div className="my-3 rounded-lg overflow-hidden border">
        <div className="relative w-full" style={{ paddingBottom: '56.25%' }}>
          <iframe
            className="absolute top-0 left-0 w-full h-full"
            src={`https://www.youtube.com/embed/${youtubeId}`}
            title="YouTube video player"
            frameBorder="0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>
      </div>
    );
  }

  // Render image
  if (isImage) {
    return (
      <div className="my-3 rounded-lg overflow-hidden border">
        <img 
          src={url} 
          alt="Shared image" 
          className="w-full h-auto object-cover max-h-[500px]"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = 'none';
          }}
        />
      </div>
    );
  }

  // Don't render preview for audio files or Supabase storage URLs
  if (isAudio || isStorageUrl) {
    return null;
  }

  // Show loading state
  if (loading) {
    return (
      <Card className="my-3 p-4">
        <Skeleton className="h-4 w-3/4 mb-2" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-2/3 mt-1" />
      </Card>
    );
  }

  // Show error or simple link
  if (error || !ogData) {
    return (
      <a 
        href={url} 
        target="_blank" 
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-primary hover:underline my-2 break-all"
      >
        <ExternalLink className="h-3 w-3 flex-shrink-0" />
        <span className="text-sm">{new URL(url).hostname}</span>
      </a>
    );
  }

  // Show rich preview with metadata
  return (
    <a 
      href={url} 
      target="_blank" 
      rel="noopener noreferrer"
      className="block my-3 no-underline"
    >
      <Card className="overflow-hidden hover:bg-accent/50 transition-colors">
        {ogData.image && (
          <div className="relative w-full h-48">
            <img 
              src={ogData.image} 
              alt={ogData.title || 'Preview'} 
              className="w-full h-full object-cover"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
          </div>
        )}
        <div className="p-4">
          <div className="flex items-start gap-2 mb-2">
            <ExternalLink className="h-4 w-4 flex-shrink-0 mt-1 text-muted-foreground" />
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-foreground line-clamp-2 mb-1">
                {ogData.title}
              </h3>
              {ogData.description && (
                <p className="text-sm text-muted-foreground line-clamp-2">
                  {ogData.description}
                </p>
              )}
              <p className="text-xs text-muted-foreground mt-2">
                {ogData.siteName}
              </p>
            </div>
          </div>
        </div>
      </Card>
    </a>
  );
}
