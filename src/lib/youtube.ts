/**
 * YouTube URL helpers.
 *
 * Proposals carry media URLs in several tags (youtube / link / doc) and authors
 * often paste a YouTube URL into the plain "link" field. These helpers let the
 * UI recognise a YouTube URL wherever it lands and embed it as a player instead
 * of rendering it as a bare external link.
 */

/**
 * Extract the 11-character video id from any common YouTube URL form:
 * youtu.be/ID, /watch?v=ID, /embed/ID, /shorts/ID, /live/ID, /v/ID.
 * Returns null for non-YouTube URLs.
 */
export function getYouTubeVideoId(url?: string | null): string | null {
  if (!url) return null;

  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }

  const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
  const isShortHost = host === 'youtu.be';
  const isYouTubeHost =
    host === 'youtube.com' ||
    host === 'm.youtube.com' ||
    host === 'music.youtube.com' ||
    host === 'youtube-nocookie.com';

  if (!isShortHost && !isYouTubeHost) return null;

  const idPattern = /^[A-Za-z0-9_-]{11}$/;

  // youtu.be/<id>
  if (isShortHost) {
    const id = parsed.pathname.split('/').filter(Boolean)[0];
    return id && idPattern.test(id) ? id : null;
  }

  // youtube.com/watch?v=<id>
  const v = parsed.searchParams.get('v');
  if (v && idPattern.test(v)) return v;

  // youtube.com/{embed,shorts,live,v}/<id>
  const segments = parsed.pathname.split('/').filter(Boolean);
  if (segments.length >= 2 && ['embed', 'shorts', 'live', 'v'].includes(segments[0])) {
    const id = segments[1];
    if (idPattern.test(id)) return id;
  }

  return null;
}

/** True when the URL points at a YouTube video. */
export function isYouTubeUrl(url?: string | null): boolean {
  return getYouTubeVideoId(url) !== null;
}

/**
 * Build a privacy-friendly embed URL, preserving a start time (?t= / ?start=)
 * when the original URL had one. Returns null for non-YouTube URLs.
 */
export function getYouTubeEmbedUrl(url?: string | null): string | null {
  const id = getYouTubeVideoId(url);
  if (!id) return null;

  let start = '';
  try {
    const parsed = new URL(url!.trim());
    const t = parsed.searchParams.get('start') || parsed.searchParams.get('t');
    if (t) {
      // "90", "90s", "1m30s" → seconds
      const plain = /^\d+s?$/.test(t)
        ? parseInt(t, 10)
        : (() => {
            const m = t.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
            if (!m || (!m[1] && !m[2] && !m[3])) return 0;
            return (+(m[1] || 0)) * 3600 + (+(m[2] || 0)) * 60 + (+(m[3] || 0));
          })();
      if (plain > 0) start = `?start=${plain}`;
    }
  } catch {
    // ignore — fall back to no start time
  }

  return `https://www.youtube-nocookie.com/embed/${id}${start}`;
}

/**
 * Pick the video to embed for a proposal: the dedicated youtube field first,
 * then a YouTube URL pasted into link or doc.
 *
 * Returns the embed URL plus which source field it came from, so the caller can
 * omit that field from the "Resources" list and avoid showing the same video
 * again as a bare link.
 */
export function resolveProposalVideo(proposal: {
  youtube?: string | null;
  link?: string | null;
  doc?: string | null;
}): { embedUrl: string; source: 'youtube' | 'link' | 'doc' } | null {
  const candidates: Array<'youtube' | 'link' | 'doc'> = ['youtube', 'link', 'doc'];
  for (const source of candidates) {
    const embedUrl = getYouTubeEmbedUrl(proposal[source]);
    if (embedUrl) return { embedUrl, source };
  }
  return null;
}
