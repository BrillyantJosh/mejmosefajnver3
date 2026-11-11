/**
 * Back to the page you signed in from.
 *
 * Brilly, 11. 11. 2026: on a public event page (/event/…) someone who is not signed
 * in clicks the sign-in button, signs in — and lands on the app's home page instead
 * of the event they came to register for. The page now sends them to
 * /login?next=<its own path>, and sign-in returns them there.
 *
 * Only a path inside this app is honoured: one leading "/", never "//host" or
 * "/\host" (a browser reads both as another site), never back to /login itself.
 * Anything else is the home page — a link someone crafted must not turn the
 * sign-in page into a door to somewhere else.
 */
export function loginReturningTo(path: string): string {
  return `/login?next=${encodeURIComponent(path)}`;
}

export function safeReturnPath(next: string | null | undefined): string {
  if (typeof next !== 'string' || next.length === 0 || next.length > 2048) return '/';
  if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return '/';
  if (/[\u0000-\u001f\u007f]/.test(next)) return '/';
  const pathOnly = next.split(/[?#]/)[0];
  if (pathOnly === '/login' || pathOnly.startsWith('/login/')) return '/';
  return next;
}
