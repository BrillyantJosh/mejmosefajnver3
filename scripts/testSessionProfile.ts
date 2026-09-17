/**
 * A language chosen in the profile has to reach the app without signing in
 * again (Brilly, 17. 9. 2026: "I switched my language to English and BEF still
 * shows Slovenian"). The session read its KIND 0 once, at sign-in, and kept it
 * for 30 or 90 days.
 *   npx tsx scripts/testSessionProfile.ts
 */
import { readFileSync } from 'node:fs';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools';
import {
  newestOwnProfile,
  profileLanguageChanged,
  REFRESHABLE_FIELDS,
  sessionProfileFromKind0,
  withProfile,
  type SessionProfileState,
} from '../src/lib/sessionProfile.js';

let failures = 0;
const check = (name: string, cond: boolean, detail?: unknown) => {
  console.log(`  ${cond ? '✓' : '✗'} ${name}${cond || detail === undefined ? '' : ' — ' + JSON.stringify(detail).slice(0, 300)}`);
  if (!cond) failures++;
};

const secret = generateSecretKey();
const me = getPublicKey(secret);
const someoneElse = getPublicKey(generateSecretKey());

const signed = (created_at: number, content: Record<string, unknown>, tags: string[][] = [], kind = 0) =>
  finalizeEvent({ kind, created_at, tags, content: JSON.stringify(content) }, secret);

/** What travels over the wire: plain JSON, no marks left by signing. */
const wire = <T>(value: T): T => JSON.parse(JSON.stringify(value));

// ── One reading of a KIND 0 ────────────────────────────────────────────────
console.log('— reading a profile —');
{
  // The shape this app publishes, and the one Brilly published at 16:00:16:
  // language in a tag only, country in the content.
  const f = sessionProfileFromKind0({
    content: JSON.stringify({ name: 'Ana', display_name: 'Ana N.', country: 'SI', currency: 'EUR', lanaWalletID: 'Lw1', lanoshi2lash: '300000000' }),
    tags: [['lang', 'en'], ['t', 'music']],
  });
  check('language from the tag when the content has none', f.profileLang === 'en', f);
  check('country, currency, names, wallet and LASH read', f.profileCountry === 'SI' && f.profileCurrency === 'EUR' && f.profileName === 'Ana' && f.profileDisplayName === 'Ana N.' && f.lanaWalletID === 'Lw1' && f.lanoshi2lash === '300000000', f);

  const both = sessionProfileFromKind0({ content: JSON.stringify({ lang: 'de', language: 'it' }), tags: [['lang', 'en']] });
  check('content lang wins over content language and the tag', both.profileLang === 'de', both);
  const older = sessionProfileFromKind0({ content: JSON.stringify({ language: 'hu' }), tags: [['lang', 'en']] });
  check('content language wins over the tag', older.profileLang === 'hu', older);
  const empty = sessionProfileFromKind0({ content: JSON.stringify({ lang: '', name: '' }), tags: [['lang', 'sl']] });
  check('an empty value counts as none (as at sign-in)', empty.profileLang === 'sl' && empty.profileName === undefined, empty);
  const broken = sessionProfileFromKind0({ content: 'not json', tags: [['lang', 'it']] });
  check('content that is not JSON still gives the language tag', broken.profileLang === 'it' && broken.profileName === undefined, broken);
  const nothing = sessionProfileFromKind0({ content: 'null' });
  check('no content and no tags give nothing, without throwing', Object.values(nothing).every((v) => v === undefined), nothing);
}

// The reading sign-in did before, kept verbatim, so the shared one provably
// reads every well-formed profile the same way.
function oldSignInReading(profileEvent: { content: string; tags: string[][] }) {
  const out: Record<string, string | undefined> = {};
  const profileContent = JSON.parse(profileEvent.content);
  if (profileContent.lanaWalletID) out.lanaWalletID = profileContent.lanaWalletID;
  if (profileContent.lanoshi2lash) out.lanoshi2lash = profileContent.lanoshi2lash;
  if (profileContent.name) out.profileName = profileContent.name;
  if (profileContent.display_name) out.profileDisplayName = profileContent.display_name;
  if (profileContent.lang || profileContent.language) out.profileLang = profileContent.lang || profileContent.language;
  if (!out.profileLang && profileEvent.tags) {
    const langTag = profileEvent.tags.find((tag: string[]) => tag[0] === 'lang');
    if (langTag && langTag[1]) out.profileLang = langTag[1];
  }
  if (profileContent.country) out.profileCountry = profileContent.country;
  if (profileContent.currency) out.profileCurrency = profileContent.currency;
  return out;
}
{
  const samples = [
    { content: JSON.stringify({ name: 'A', lang: 'sl', country: 'SI' }), tags: [['lang', 'en']] },
    { content: JSON.stringify({ display_name: 'B', language: 'de', currency: 'EUR' }), tags: [] },
    { content: JSON.stringify({ lanaWalletID: 'Lx', lanoshi2lash: 5 }), tags: [['lang', 'hu']] },
    { content: JSON.stringify({}), tags: [['t', 'x'], ['lang', '']] },
    { content: JSON.stringify({ name: 'C', country: 'AT', currency: 'USD', lang: '' }), tags: [['lang', 'it']] },
  ];
  const sorted = (o: Record<string, unknown>) => JSON.stringify(Object.entries(o).filter(([, v]) => v !== undefined).sort());
  const differing = samples.filter((sample) => sorted({ ...sessionProfileFromKind0(sample) }) !== sorted(oldSignInReading(sample)));
  check('sign-in reads every well-formed profile exactly as before', differing.length === 0, differing);
}

// ── Which event from the relays counts ─────────────────────────────────────
console.log('— the newest genuine profile —');
{
  const a = wire(signed(1000, { name: 'old' }, [['lang', 'sl']]));
  const b = wire(signed(2000, { name: 'new' }, [['lang', 'en']]));
  const c = wire(signed(1500, { name: 'middle' }, [['lang', 'de']]));
  check('the newest of several relay answers', newestOwnProfile([a, b, c], me)?.created_at === 2000);

  const forged = { ...wire(signed(3000, { name: 'x' }, [['lang', 'en']])), content: JSON.stringify({ name: 'x', lang: 'hu' }) };
  check('an altered event is not the newest — the genuine one is', newestOwnProfile([a, b, forged], me)?.created_at === 2000);

  // nostr-tools marks a verified object; a spread keeps the mark.
  const marked = signed(4000, { name: 'y' }, [['lang', 'en']]);
  const spreadForgery = { ...marked, tags: [['lang', 'hu']] };
  check('an altered copy of a just-verified event is refused too', newestOwnProfile([a, spreadForgery], me)?.created_at === 1000);

  const foreign = wire(finalizeEvent({ kind: 0, created_at: 5000, tags: [['lang', 'it']], content: '{}' }, generateSecretKey()));
  check("someone else's profile is ignored", newestOwnProfile([a, foreign], me)?.created_at === 1000);
  const renamed = { ...foreign, pubkey: me };
  check("someone else's profile under my key fails its signature", newestOwnProfile([a, renamed], me)?.created_at === 1000);
  check('another kind is ignored', newestOwnProfile([a, wire(signed(6000, {}, [['lang', 'it']], 1))], me)?.created_at === 1000);
  check('no events, a silent relay or garbage give null', newestOwnProfile([], me) === null && newestOwnProfile(undefined, me) === null && newestOwnProfile({ events: [a] }, me) === null && newestOwnProfile([null, 'x', 7, {}], me) === null);
  check('asking about someone else finds nothing of mine', newestOwnProfile([a, b], someoneElse) === null);
}

// ── Applying it to a running session ───────────────────────────────────────
console.log('— the session follows a newer profile —');
{
  type TestSession = SessionProfileState & { nostrPrivateKey: string; expiresAt: number; lanaPrivateKey: string };
  const legacy: TestSession = {
    nostrHexId: me,
    nostrPrivateKey: 'k',
    lanaPrivateKey: 'w',
    expiresAt: 123,
    lanaWalletID: 'LwOld',
    lanoshi2lash: '1',
    profileName: 'Brilly',
    profileLang: 'sl',
    profileCountry: 'SI',
  };
  const english = wire(signed(1726581616, { name: 'Brilly', country: 'SI', lanaWalletID: 'LwNew', lanoshi2lash: '2' }, [['lang', 'en']]));

  const next = withProfile(legacy, english);
  check('a session from before this change takes the newer language', next.profileLang === 'en' && next.profileEventAt === 1726581616, next);
  check('it is a new object (React sees the change)', next !== legacy);
  check('keys, expiry and everything else stay', next.nostrPrivateKey === 'k' && next.lanaPrivateKey === 'w' && next.expiresAt === 123);
  check('wallet and LASH value stay as read at sign-in', next.lanaWalletID === 'LwOld' && next.lanoshi2lash === '1', next);
  check('the old session object is not touched', legacy.profileLang === 'sl' && legacy.profileEventAt === undefined);

  const same = withProfile(next, english);
  check('the same event again changes nothing (same object)', same === next);
  const olderEvent = wire(signed(1726581000, { name: 'Brilly' }, [['lang', 'sl']]));
  check('an older event (a relay behind) never takes the choice back', withProfile(next, olderEvent) === next);

  const pictureOnly = wire(signed(1726590000, { name: 'Brilly', country: 'SI', picture: 'p' }, [['lang', 'en']]));
  const moved = withProfile(next, pictureOnly);
  check('a newer event that changes no field still moves the mark forward', moved !== next && moved.profileEventAt === 1726590000 && moved.profileLang === 'en');
  const inBetween = wire(signed(1726585000, { name: 'Brilly' }, [['lang', 'de']]));
  check('…so an event from in between cannot bring back an older language', withProfile(moved, inBetween) === moved);

  const noDisplay = withProfile({ ...next, profileDisplayName: 'B.' }, wire(signed(1726600000, { name: 'Brilly' }, [['lang', 'en']])));
  check('a field the newer profile no longer has is gone, as after signing in', noDisplay.profileDisplayName === undefined && noDisplay.profileCountry === undefined, noDisplay);

  const foreign = wire(finalizeEvent({ kind: 0, created_at: 1726700000, tags: [['lang', 'it']], content: '{}' }, generateSecretKey()));
  check("someone else's profile never changes my session", withProfile(next, foreign) === next);

  check('only how the app speaks to the person is refreshable', JSON.stringify([...REFRESHABLE_FIELDS].sort()) === JSON.stringify(['profileCountry', 'profileCurrency', 'profileDisplayName', 'profileLang', 'profileName']));
}

// ── When an earlier language pick in this browser gives way ────────────────
console.log('— a new profile language replaces an older local pick —');
{
  check('signing in is not a choice of language', !profileLanguageChanged({}, { hexId: me, lang: 'sl' }));
  check('signing out is not', !profileLanguageChanged({ hexId: me, lang: 'sl' }, {}));
  check('switching to another person is not', !profileLanguageChanged({ hexId: me, lang: 'sl' }, { hexId: someoneElse, lang: 'en' }));
  check('the same person, Slovenian → English, is', profileLanguageChanged({ hexId: me, lang: 'sl' }, { hexId: me, lang: 'en' }));
  check('a profile that names a language for the first time is', profileLanguageChanged({ hexId: me }, { hexId: me, lang: 'en' }));
  check('the same language in other letters is not', !profileLanguageChanged({ hexId: me, lang: 'en' }, { hexId: me, lang: ' EN ' }));
  check('a profile that stops naming one is not', !profileLanguageChanged({ hexId: me, lang: 'en' }, { hexId: me }));
}

// ── The wiring, read from the files that ship ──────────────────────────────
console.log('— wired where it has to be —');
{
  const auth = readFileSync(new URL('../src/contexts/AuthContext.tsx', import.meta.url), 'utf8');
  const profilePage = readFileSync(new URL('../src/pages/Profile.tsx', import.meta.url), 'utf8');
  const i18n = readFileSync(new URL('../src/i18n/I18nContext.tsx', import.meta.url), 'utf8');
  const hook = readFileSync(new URL('../src/hooks/useNostrProfile.ts', import.meta.url), 'utf8');

  check('sign-in reads the profile with the shared reading', /sessionProfileFromKind0\(profileEvent\)/.test(auth) && !/profileContent\.lang/.test(auth));
  check('sign-in remembers which event it read', /profileEventAt = profileEvent\.created_at/.test(auth));
  check('a running session asks the relays again and verifies', /query-nostr-events/.test(auth) && /newestOwnProfile\(body\?\.events, hexId\)/.test(auth));
  check('…when the person comes back to the tab', /visibilitychange', onVisible/.test(auth));
  check('…and only through withProfile', /withProfile\(current, event\)/.test(auth));
  check('publishing returns the signed event', /return \{ success: true, event: signedEvent \}/.test(hook));
  const upsertAt = profilePage.indexOf(".from('nostr_profiles').upsert");
  const applyAt = profilePage.indexOf('applyProfileEvent(result.event)');
  check('the Profile page hands it over after the cache write', upsertAt > 0 && applyAt > upsertAt, { upsertAt, applyAt });
  check('the interface language lets an older pick go on a new profile language', /profileLanguageChanged\(before, after\)\) setLang\(null\)/.test(i18n));
  check('the interface language still derives from the session profile', /resolveLang\(session\?\.profileLang\)/.test(i18n));
}

console.log(failures === 0 ? '\n✅ all passed' : `\n❌ ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
