/**
 * Deterministic default avatar selection.
 * Picks one of 10 fun animal/robot SVG avatars based on a user identifier (pubkey).
 * Same identifier always returns the same avatar.
 */

const DEFAULT_AVATAR_COUNT = 10;

export function getDefaultAvatarUrl(identifier: string): string {
  // Simple hash: DJB2-style — works great with hex pubkeys (good entropy)
  let hash = 0;
  for (let i = 0; i < identifier.length; i++) {
    hash = ((hash << 5) - hash + identifier.charCodeAt(i)) | 0;
  }
  const index = (Math.abs(hash) % DEFAULT_AVATAR_COUNT) + 1;
  return `/default-avatars/avatar-${index}.svg`;
}
