import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { getProxiedImageUrl } from '@/lib/imageProxy';
import { getDefaultAvatarUrl } from '@/lib/defaultAvatars';
import { cn } from '@/lib/utils';

interface UserAvatarProps {
  /** User's Nostr hex pubkey — used for deterministic default avatar */
  pubkey?: string;
  /** Profile picture URL (raw, will be proxied internally) */
  picture?: string;
  /** Display name for alt text and initials fallback */
  name?: string;
  /** Cache buster value (e.g., last_fetched_at timestamp) */
  cacheBuster?: string | number;
  /** Tailwind size classes, e.g. "h-12 w-12" */
  className?: string;
}

/**
 * Centralized user avatar component.
 *
 * Fallback chain:
 * 1. Profile picture (proxied via getProxiedImageUrl)
 * 2. Fun default animal avatar (deterministic per pubkey)
 * 3. Initials on gradient background
 */
export function UserAvatar({
  pubkey,
  picture,
  name,
  cacheBuster,
  className,
}: UserAvatarProps) {
  const proxiedUrl = getProxiedImageUrl(picture, cacheBuster);
  const defaultAvatar = pubkey ? getDefaultAvatarUrl(pubkey) : undefined;

  const initials = name
    ? (() => {
        const parts = name.trim().split(' ');
        if (parts.length >= 2) {
          return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
        }
        return name.slice(0, 2).toUpperCase();
      })()
    : pubkey
    ? pubkey.slice(0, 2).toUpperCase()
    : '?';

  return (
    <Avatar className={cn('h-10 w-10', className)}>
      {proxiedUrl && (
        <AvatarImage src={proxiedUrl} alt={name || 'User'} />
      )}
      {!proxiedUrl && defaultAvatar && (
        <AvatarImage src={defaultAvatar} alt={name || 'User'} />
      )}
      <AvatarFallback className="bg-gradient-to-br from-primary to-accent text-white font-bold">
        {initials}
      </AvatarFallback>
    </Avatar>
  );
}
