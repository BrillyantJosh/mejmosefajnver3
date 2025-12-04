import React, { useState } from 'react';
import { LinkPreview } from './LinkPreview';
import { Button } from '@/components/ui/button';
import { Languages, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface PostContentProps {
  content: string;
  tags?: string[][];
}

// Helper component to render formatted text (bold and bullets)
function FormattedText({ text }: { text: string }) {
  if (!text) return null;
  
  // Clean up orphaned ** markers (standalone ** without content between them)
  const cleanedText = text
    .replace(/^\*\*$/gm, '') // Remove lines with just **
    .replace(/\*\*\s*\*\*/g, '') // Remove empty bold markers **  **
    .replace(/\*\*(?!\S)/g, '') // Remove ** not followed by content
    .replace(/(?<!\S)\*\*/g, ''); // Remove ** not preceded by content
  
  // Split by lines to handle bullet points
  const lines = cleanedText.split('\n');
  
  // Helper to check if a line is a bullet
  const isBulletLine = (line: string) => {
    const trimmed = line.trim();
    return trimmed.startsWith('• ') || trimmed.startsWith('- ') || trimmed.startsWith('* ');
  };
  
  // Filter out empty lines that are between bullet points
  const filteredLines = lines.filter((line, index) => {
    const trimmed = line.trim();
    if (trimmed) return true; // Keep non-empty lines
    
    // Check if this empty line is between bullets
    const prevLine = lines[index - 1];
    const nextLine = lines[index + 1];
    const prevIsBullet = prevLine && isBulletLine(prevLine);
    const nextIsBullet = nextLine && isBulletLine(nextLine);
    
    // Skip empty lines between bullets
    if (prevIsBullet && nextIsBullet) return false;
    
    return true;
  });
  
  return (
    <>
      {filteredLines.map((line, lineIndex) => {
        const trimmedLine = line.trim();
        
        // Empty line - render just a line break
        if (!trimmedLine) {
          return <br key={`br-${lineIndex}`} />;
        }
        
        const isBullet = isBulletLine(line);
        const lineContent = isBullet ? trimmedLine.substring(2) : line;
        
        // Parse bold text (**text** or __text__)
        const boldRegex = /\*\*(.+?)\*\*|__(.+?)__/g;
        const parts: React.ReactNode[] = [];
        let lastIndex = 0;
        let match;
        
        while ((match = boldRegex.exec(lineContent)) !== null) {
          // Add text before the match
          if (match.index > lastIndex) {
            parts.push(lineContent.substring(lastIndex, match.index));
          }
          // Add bold text
          parts.push(
            <strong key={`bold-${lineIndex}-${match.index}`} className="font-bold">
              {match[1] || match[2]}
            </strong>
          );
          lastIndex = match.index + match[0].length;
        }
        
        // Add remaining text
        if (lastIndex < lineContent.length) {
          parts.push(lineContent.substring(lastIndex));
        }
        
        // If no bold found, just use the line content
        const content = parts.length > 0 ? parts : lineContent;
        
        if (isBullet) {
          return (
            <React.Fragment key={`line-${lineIndex}`}>
              <span className="text-muted-foreground">• </span>
              <span>{content}</span>
              {lineIndex < filteredLines.length - 1 && <br />}
            </React.Fragment>
          );
        }
        
        return (
          <React.Fragment key={`line-${lineIndex}`}>
            {content}
            {lineIndex < filteredLines.length - 1 && <br />}
          </React.Fragment>
        );
      })}
    </>
  );
}

export function PostContent({ content, tags }: PostContentProps) {
  const [translatedContent, setTranslatedContent] = useState<string | null>(null);
  const [isTranslating, setIsTranslating] = useState(false);
  const [targetLanguage, setTargetLanguage] = useState<'sl' | 'en'>('sl');

  const handleTranslate = async (language: 'sl' | 'en') => {
    setIsTranslating(true);
    setTargetLanguage(language);
    
    try {
      const { data, error } = await supabase.functions.invoke('translate-post', {
        body: { content, targetLanguage: language }
      });

      if (error) {
        console.error('Translation error:', error);
        toast.error('Translation failed. Please try again.');
        return;
      }

      if (data?.translatedText) {
        setTranslatedContent(data.translatedText);
      }
    } catch (error) {
      console.error('Translation error:', error);
      toast.error('Translation failed. Please try again.');
    } finally {
      setIsTranslating(false);
    }
  };

  const displayContent = translatedContent || content;

  try {
    // Extract image URLs from "imurl" tags
    const imageUrls: string[] = tags
      ? tags
          .filter((tag) => tag[0] === 'imurl')
          .map((tag) => tag[1])
          .filter(Boolean)
      : [];
    
    // Extract and parse iframes from content
    const iframeRegex = /<iframe[^>]*src=["']([^"']+)["'][^>]*>.*?<\/iframe>/gi;
    const iframeMatches = Array.from(displayContent.matchAll(iframeRegex));
    const iframes = iframeMatches.map(match => {
      const fullMatch = match[0];
      const src = match[1];
      
      // Only allow iframes from trusted domains
      const trustedDomains = ['boomplay.com', 'youtube.com', 'youtu.be', 'twitch.tv'];
      const isTrusted = trustedDomains.some(domain => src.includes(domain));
      
      if (!isTrusted) return null;
      
      // Extract width and height attributes
      const widthMatch = fullMatch.match(/width=["']([^"']+)["']/i);
      const heightMatch = fullMatch.match(/height=["']([^"']+)["']/i);
      
      return {
        src,
        width: widthMatch ? widthMatch[1] : '100%',
        height: heightMatch ? heightMatch[1] : '420',
        original: fullMatch
      };
    }).filter(Boolean);
    
    // Extract URLs from content (for link previews)
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const urlMatches = displayContent.match(urlRegex);
    const urls: string[] = urlMatches ? urlMatches : [];
    
    // Remove iframe HTML and split content by URLs to render text and links separately
    let contentWithoutIframes = displayContent;
    iframes.forEach(iframe => {
      if (iframe) {
        contentWithoutIframes = contentWithoutIframes.replace(iframe.original, '');
      }
    });
    const parts = contentWithoutIframes.split(urlRegex);
    
    return (
      <div>
        {/* Translation buttons */}
        <div className="flex gap-2 mb-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleTranslate('sl')}
            disabled={isTranslating}
            className="h-7 text-xs"
          >
            {isTranslating && targetLanguage === 'sl' ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Languages className="h-3 w-3" />
            )}
            <span className="ml-1">SL</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleTranslate('en')}
            disabled={isTranslating}
            className="h-7 text-xs"
          >
            {isTranslating && targetLanguage === 'en' ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Languages className="h-3 w-3" />
            )}
            <span className="ml-1">EN</span>
          </Button>
          {translatedContent && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setTranslatedContent(null)}
              className="h-7 text-xs"
            >
              Original
            </Button>
          )}
        </div>

        {/* Render text content with formatting */}
        <div className="mb-4 break-words">
          {parts.map((part, index) => {
            // Check if this part is a URL
            if (urls.includes(part)) {
              // Don't render the URL text, we'll show preview below
              return null;
            }
            // Parse bold text and bullet points
            return <FormattedText key={`text-${index}`} text={part} />;
          })}
        </div>
        
        {/* Render images from imurl tags */}
        {imageUrls.length > 0 && (
          <div className={`mb-4 ${
            imageUrls.length === 1 
              ? 'grid grid-cols-1' 
              : imageUrls.length === 2
              ? 'grid grid-cols-2 gap-1'
              : imageUrls.length === 3
              ? 'grid grid-cols-3 gap-1'
              : 'grid grid-cols-2 gap-1'
          }`}>
            {imageUrls.map((imageUrl, index) => (
              <img
                key={`image-${index}`}
                src={imageUrl}
                alt={`Post image ${index + 1}`}
                className="w-full rounded-lg object-cover"
                loading="lazy"
              />
            ))}
          </div>
        )}
        
        {/* Render iframes */}
        {iframes.length > 0 && (
          <div className="space-y-4 mb-4">
            {iframes.map((iframe, index) => (
              iframe && (
                <div key={`iframe-${index}`} className="w-full">
                  <iframe
                    src={iframe.src}
                    width={iframe.width}
                    height={iframe.height}
                    frameBorder="0"
                    className="w-full rounded-lg"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  />
                </div>
              )
            ))}
          </div>
        )}
        
        {/* Render link previews */}
        {urls.length > 0 && (
          <div className="space-y-2">
            {urls.map((url, index) => (
              <LinkPreview key={`link-${index}`} url={url} />
            ))}
          </div>
        )}
      </div>
    );
  } catch (error) {
    console.error('Error parsing post content:', error);
    // Fallback - show plain text
    return <p className="mb-4 whitespace-pre-wrap break-words">{displayContent}</p>;
  }
}
