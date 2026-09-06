import { useState } from 'react';

/**
 * The picture at the top of an alignment — and what stands there when the
 * picture is gone.
 *
 * All ten live proposals carry an `img` pointing at
 * axkkangrezixqryowxbk.supabase.co, the Supabase project that published them.
 * That project has been deleted — the host answers NXDOMAIN — so not one of
 * those images can ever load again. The same host took the profile avatars
 * with it (see src/lib/imageProxy.ts).
 *
 * Two things follow, and both are deliberate:
 *
 * The drawn cover is the BACKGROUND, always painted, with the photograph laid
 * over it once it actually loads. Waiting for a dead host to time out took
 * seven seconds and more on a phone, and for all of it the card was a white
 * hole. Now there is never an empty moment, and a real photograph still wins.
 *
 * A host known to be gone is not requested at all. Ten hanging requests per
 * page load is a cost paid by whoever has the slowest connection.
 */

/** Hosts that no longer exist. Asking them anything only costs time. */
const DEAD_IMAGE_HOSTS = [
  'axkkangrezixqryowxbk.supabase.co', // deleted Supabase project (NXDOMAIN)
  'lanaknows.us',                     // avatar redirector, gone with it
];

function isReachable(src: string | undefined): src is string {
  if (!src) return false;
  return !DEAD_IMAGE_HOSTS.some((host) => src.includes(host));
}

function hueFromSeed(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) % 360;
  }
  return hash;
}

/** Up to two letters, so a cover still says which alignment it belongs to. */
function initialsOf(title: string): string {
  const words = (title || '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '—';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

interface AlignmentCoverProps {
  src?: string;
  title: string;
  /** Colours the drawn cover; the same seed always gives the same cover. */
  seed: string;
  className?: string;
  /** Zoom the photograph a touch when the card is hovered. */
  zoomOnHover?: boolean;
}

export default function AlignmentCover({
  src,
  title,
  seed,
  className,
  zoomOnHover,
}: AlignmentCoverProps) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const hue = hueFromSeed(seed || title);
  const showImage = isReachable(src) && !failed;

  return (
    <div
      className={`relative overflow-hidden flex items-center justify-center ${className || ''}`}
      style={{
        backgroundImage: `linear-gradient(135deg, hsl(${hue} 62% 52%), hsl(${(hue + 48) % 360} 58% 38%))`,
      }}
    >
      {/* A soft ring, so the cover reads as a made thing rather than a fill */}
      <div
        className="absolute -right-8 -top-10 h-32 w-32 rounded-full opacity-25"
        style={{ background: `radial-gradient(circle, hsl(${(hue + 180) % 360} 90% 85%), transparent 70%)` }}
        aria-hidden="true"
      />
      <span
        className="relative text-3xl sm:text-4xl font-serif font-semibold text-white/85 tracking-wide drop-shadow"
        aria-hidden="true"
      >
        {initialsOf(title)}
      </span>

      {showImage && (
        <img
          src={src}
          alt={title}
          loading="lazy"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${
            loaded ? 'opacity-100' : 'opacity-0'
          } ${zoomOnHover ? 'transition-transform duration-300 group-hover:scale-[1.03]' : ''}`}
        />
      )}
    </div>
  );
}
