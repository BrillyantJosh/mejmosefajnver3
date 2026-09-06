import { useMemo, useState } from 'react';

/**
 * The picture at the top of an alignment.
 *
 * All ten live proposals carry an `img` pointing at
 * axkkangrezixqryowxbk.supabase.co, the Supabase project that published them.
 * That project has been deleted — the host answers NXDOMAIN — so not one of
 * those uploads can ever load again, and every stored version of every
 * proposal points at the same dead host. The same server took the profile
 * avatars with it (see src/lib/imageProxy.ts).
 *
 * But each of those ten alignments also carries a YouTube video, and a video
 * keeps its own still image on a server that is very much alive. So the cover
 * falls through a list: the uploaded picture where it still loads, then the
 * video's own frame, and only then something drawn from the proposal's slug.
 * Nothing here is invented — the fallbacks are the proposal's own material.
 *
 * The drawn cover is the BACKGROUND, always painted, with whichever picture
 * wins laid over it once it has actually loaded. Waiting on a dead host used
 * to leave a white hole on the card for seven seconds on a phone.
 */

/** Hosts that no longer exist. Asking them anything only costs time. */
const DEAD_IMAGE_HOSTS = [
  'axkkangrezixqryowxbk.supabase.co', // deleted Supabase project (NXDOMAIN)
  'lanaknows.us',                     // avatar redirector, gone with it
];

function isReachable(src: string | null | undefined): src is string {
  if (!src) return false;
  return !DEAD_IMAGE_HOSTS.some((host) => src.includes(host));
}

/**
 * YouTube does not answer 404 for a still it does not have: it hands back a
 * grey 120x90 placeholder with a 200, so `onError` never fires and the card
 * would proudly display a grey blob. Anything that small from that host is
 * that placeholder — measured, not assumed: a real still is 1280x720.
 */
function isPlaceholderImage(src: string, width: number, height: number): boolean {
  if (!src.includes('img.youtube.com')) return false;
  return width <= 160 || height <= 120;
}

function hueFromSeed(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) % 360;
  }
  return hash;
}

/** Up to two letters, so a drawn cover still says which alignment it is. */
function initialsOf(title: string): string {
  const words = (title || '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '—';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

interface AlignmentCoverProps {
  /** Candidate pictures, best first. Unreachable hosts are dropped. */
  sources?: (string | null | undefined)[];
  title: string;
  /** Colours the drawn cover; the same seed always gives the same cover. */
  seed: string;
  className?: string;
  /** Zoom the picture a touch when the card is hovered. */
  zoomOnHover?: boolean;
}

export default function AlignmentCover({
  sources,
  title,
  seed,
  className,
  zoomOnHover,
}: AlignmentCoverProps) {
  const candidates = useMemo(() => (sources || []).filter(isReachable), [sources]);
  const [failedCount, setFailedCount] = useState(0);
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const hue = hueFromSeed(seed || title);
  const current = candidates[failedCount];

  return (
    <div
      className={`relative overflow-hidden flex items-center justify-center ${className || ''}`}
      style={{
        backgroundImage: `linear-gradient(135deg, hsl(${hue} 62% 52%), hsl(${(hue + 48) % 360} 58% 38%))`,
      }}
    >
      {/* A soft ring, so the drawn cover reads as a made thing, not a fill */}
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

      {current && (
        <img
          key={current}
          src={current}
          alt={title}
          loading="lazy"
          onLoad={(event) => {
            const el = event.currentTarget;
            if (isPlaceholderImage(current, el.naturalWidth, el.naturalHeight)) {
              setFailedCount((n) => n + 1);
              return;
            }
            setLoadedSrc(current);
          }}
          onError={() => setFailedCount((n) => n + 1)}
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${
            loadedSrc === current ? 'opacity-100' : 'opacity-0'
          } ${zoomOnHover ? 'transition-transform duration-300 group-hover:scale-[1.03]' : ''}`}
        />
      )}
    </div>
  );
}
