/**
 * Transforms lanaknows.us redirect URLs to direct Supabase storage URLs
 * Direct image URLs are returned unchanged for better performance
 * Adds cache busting parameter to prevent stale images
 */
export function getProxiedImageUrl(originalUrl: string | undefined, cacheBuster?: string | number): string | undefined {
  if (!originalUrl) return undefined;
  
  // Transform lanaknows.us URLs to direct Supabase storage URLs
  if (originalUrl.includes('lanaknows.us')) {
    // Extract hex ID from URL (last segment after /)
    const hexId = originalUrl.split('/').pop();
    if (hexId) {
      const baseUrl = `https://bjkejpfmnofnllknphhr.supabase.co/storage/v1/object/public/nostr-avatars/${hexId}.jpg`;
      // Add cache busting parameter if provided
      return cacheBuster ? `${baseUrl}?t=${cacheBuster}` : baseUrl;
    }
  }
  
  // For other URLs, add cache busting parameter if provided
  if (cacheBuster) {
    const separator = originalUrl.includes('?') ? '&' : '?';
    return `${originalUrl}${separator}t=${cacheBuster}`;
  }
  
  // Return original URL for direct links
  return originalUrl;
}
