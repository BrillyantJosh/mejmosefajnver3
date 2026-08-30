/**
 * Transforms lanaknows.us redirect URLs to direct Supabase storage URLs
 * Direct image URLs are returned unchanged for better performance
 * Adds cache busting parameter to prevent stale images
 */
export function getProxiedImageUrl(originalUrl: string | undefined, cacheBuster?: string | number): string | undefined {
  if (!originalUrl) return undefined;

  // Handle local server storage URLs (both absolute and relative)
  if (originalUrl.includes('/api/storage/')) {
    if (cacheBuster) {
      const separator = originalUrl.includes('?') ? '&' : '?';
      return `${originalUrl}${separator}t=${cacheBuster}`;
    }
    return originalUrl;
  }

  // lanaknows.us avatars are GONE — treat them as "no picture".
  //
  // These URLs used to be rewritten to a Supabase storage bucket, but that
  // project has been deleted (its host no longer resolves) and lanaknows.us
  // itself no longer answers either. The images exist in neither place and in
  // no local bucket, so they are unrecoverable.
  //
  // Returning undefined is what makes this a fix rather than a cosmetic
  // change: UserAvatar then falls back to the generated avatar, and finally to
  // the person's initials. Handing back a dead URL instead left a broken image
  // AND a request that hangs until it times out on every render.
  if (originalUrl.includes('lanaknows.us')) {
    return undefined;
  }

  
  // For other URLs, add cache busting parameter if provided
  if (cacheBuster) {
    const separator = originalUrl.includes('?') ? '&' : '?';
    return `${originalUrl}${separator}t=${cacheBuster}`;
  }
  
  // Return original URL for direct links
  return originalUrl;
}
