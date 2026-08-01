/**
 * The shared registry of ACTIVE facilitators — the second arm of freeze
 * authority (KIND 87057).
 *
 * WHY IT EXISTS. The published 87057 spec honours only facilitators of the
 * process itself. The process owner widened that: any registered facilitator
 * may freeze, not just the one leading that case. The publishing surface
 * (selfresponsible.life) already applies the union, so this app must apply the
 * SAME one — honouring only the per-case roster here would mean a freeze that
 * counts on one surface and not the other, which is the exact split-brain this
 * whole family of gates keeps producing.
 *
 * WHERE IT LIVES. The registry is a table in selfresponsible.life's own
 * Supabase project — a DIFFERENT project from this app's, so it is read over
 * plain REST rather than through the app's supabase client. The key below is
 * the publishable anon key; it is already public (it ships inside
 * selfresponsible.life's JS bundle), so nothing secret is introduced here.
 * Both values are overridable so the endpoint can move or the key can be
 * rotated without a code change.
 *
 * UNKNOWN IS NOT EMPTY. A failed read returns null, never an empty set: an
 * empty allow-list honours no freeze at all, and quietly treating "I could not
 * ask" as "nobody is authorised" would silently release every frozen person.
 */

const REGISTRY_URL =
  import.meta.env.VITE_FACILITATOR_REGISTRY_URL
  || 'https://viejpwjwpcfqoumjexep.supabase.co/rest/v1/processualists?select=nostr_hex_id,is_active&is_active=eq.true';

const REGISTRY_KEY =
  import.meta.env.VITE_FACILITATOR_REGISTRY_KEY
  || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZpZWpwd2p3cGNmcW91bWpleGVwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQwNDM2NDIsImV4cCI6MjA2OTYxOTY0Mn0.4XdaTVwzTeuvSTZFvZ8XR-8vKvNvvfPfrNi_Rjm8Vio';

const TTL_MS = 5 * 60 * 1000;
const HEX64 = /^[0-9a-f]{64}$/;

let cache: { at: number; set: Set<string> } | null = null;

/** Active registered facilitators, or null when the registry cannot be read. */
export const fetchFacilitatorRegistry = async (
  { now = Date.now(), fetchImpl = fetch }: { now?: number; fetchImpl?: typeof fetch } = {},
): Promise<Set<string> | null> => {
  if (cache && now - cache.at < TTL_MS) return cache.set;
  try {
    const res = await fetchImpl(REGISTRY_URL, {
      headers: { apikey: REGISTRY_KEY, Authorization: `Bearer ${REGISTRY_KEY}` },
    });
    if (!res.ok) throw new Error(`registry ${res.status}`);
    const rows = await res.json();
    if (!Array.isArray(rows)) throw new Error('registry shape');
    const set = new Set<string>(
      rows
        .filter((r: { is_active?: boolean }) => r?.is_active === true)
        .map((r: { nostr_hex_id?: string }) => (r?.nostr_hex_id || '').toLowerCase())
        .filter((hex: string) => HEX64.test(hex)),
    );
    cache = { at: now, set };
    return set;
  } catch (error) {
    console.warn('⚠️ Facilitator registry unreadable — falling back to this case\'s roster:', error);
    return null; // UNKNOWN, never empty
  }
};
