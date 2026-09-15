// Copied byte for byte into mejmosefajnver3/src/lib/bef/vendor — after changing, run scripts/syncBef.ts there.
/**
 * The KIND 0 profile a person publishes when they register through BEF
 * Explorer. Shared by the browser (which builds and signs it with the person's
 * own key) and the server (which refuses anything else before forwarding it to
 * the relays), so the two can never disagree about what is published.
 *
 * Field names follow lananostr.site (Lana Extended Profile, KIND 0):
 *   name                 FULL real name — first name and surname
 *   display_name         here the same full name
 *   country              ISO 3166-1 alpha-2, upper case
 *   email                "user@example.com"
 *   phone                digits only, without the country code (and without a
 *                        national trunk 0, except where the 0 is part of the
 *                        international number — see cleanPhone)
 *   phone_country_code   "+" and 1–3 digits, e.g. "+386"
 *   currency             EUR / GBP / USD
 *   lanaWalletID         the registered LANA wallet — relays refuse a KIND 0 without it
 *   about, whoAreYou, lanoshi2lash, orgasmic_profile, statement_of_responsibility
 *                        as mobile.lanapays.us writes them when a new wallet is registered
 * Tag: ["lang", <language code>] — the only tag.
 *
 * Everything in KIND 0 is PUBLIC on the relays: name, country, phone and email
 * included. The registration form says so before the person signs.
 */

export const PROFILE_ABOUT = 'BEF Explorer co-creator';
export const PROFILE_WHO_ARE_YOU = 'Human';
export const PROFILE_LANOSHI2LASH = '10000';
export const PROFILE_ORGASMIC = 'Living life';
/** The same statement mobile.lanapays.us publishes when it registers a wallet. */
export const PROFILE_STATEMENT =
  'I accept full and unconditional self-responsibility for everything I do or do not do inside the Lana World.';

export const PROFILE_CURRENCIES = ['EUR', 'GBP', 'USD'] as const;

/** The profile currency follows the country: GBP in the UK, USD in the US, EUR elsewhere. */
export function currencyForCountry(country: string): (typeof PROFILE_CURRENCIES)[number] {
  if (country === 'GB') return 'GBP';
  if (country === 'US') return 'USD';
  return 'EUR';
}

export interface ProfileInput {
  firstName: string;
  surname: string;
  country: string;
  email: string;
  phoneCountryCode: string;
  phone: string;
  wallet: string;
}

/** Collapse inner whitespace and trim. */
export const cleanText = (value: string): string => value.replace(/\s+/g, ' ').trim();
/**
 * Calling codes whose numbers keep their leading 0 after the code: Italy
 * (+39 06 …), San Marino (+378 0549 …), Vatican City (+379) and Côte d'Ivoire
 * (+225 07 …). Everywhere else a leading 0 is the national trunk prefix, which
 * is dropped when the country code is written in front.
 */
export const PHONE_CODES_KEEPING_ZERO: readonly string[] = ['+39', '+378', '+379', '+225'];

const keepsZero = (phoneCountryCode: string): boolean => PHONE_CODES_KEEPING_ZERO.includes(phoneCountryCode.trim());

/** Phone as typed ("041 123-456") → digits only, without ONE national trunk 0:
 * with "+386" in front, "041 123 456" is "41123456" (the lananostr.site example).
 * Where the 0 belongs to the number itself ("+39", "06 1234 5678") it is kept —
 * dropping it would publish a number that does not exist. */
export const cleanPhone = (value: string, phoneCountryCode = ''): string => {
  const digits = value.replace(/\D+/g, '');
  return keepsZero(phoneCountryCode) ? digits : digits.replace(/^0/, '');
};

const EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
const PHONE = /^[1-9]\d{3,14}$/;
const PHONE_KEEPING_ZERO = /^\d{4,15}$/;
/** Every ITU country calling code has at most three digits (lananostr.site KIND 0). */
const PHONE_CODE = /^\+\d{1,3}$/;

/** The published phone, for the calling code in front of it. */
const phoneOk = (phone: string, phoneCountryCode: string): boolean =>
  (keepsZero(phoneCountryCode) ? PHONE_KEEPING_ZERO : PHONE).test(phone);
const COUNTRY = /^[A-Z]{2}$/;
const LANA_ADDRESS = /^L[1-9A-HJ-NP-Za-km-z]{25,34}$/;

export type ProfileInputError =
  | 'first_name'
  | 'surname'
  | 'country'
  | 'email'
  | 'phone_country_code'
  | 'phone'
  | 'wallet';

/** Field-level check of what the person typed; the browser shows each one. */
export function checkProfileInput(input: ProfileInput, isCountryCode: (code: string) => boolean): ProfileInputError[] {
  const errors: ProfileInputError[] = [];
  const first = cleanText(input.firstName);
  const last = cleanText(input.surname);
  if (first.length < 1 || first.length > 60) errors.push('first_name');
  if (last.length < 1 || last.length > 60) errors.push('surname');
  if (!COUNTRY.test(input.country) || !isCountryCode(input.country)) errors.push('country');
  if (!EMAIL.test(input.email.trim()) || input.email.trim().length > 254) errors.push('email');
  if (!PHONE_CODE.test(input.phoneCountryCode.trim())) errors.push('phone_country_code');
  if (!phoneOk(cleanPhone(input.phone, input.phoneCountryCode), input.phoneCountryCode)) errors.push('phone');
  if (!LANA_ADDRESS.test(input.wallet)) errors.push('wallet');
  return errors;
}

/** The exact content object, in a fixed key order. */
export function buildProfileContent(input: ProfileInput): Record<string, string> {
  const name = `${cleanText(input.firstName)} ${cleanText(input.surname)}`;
  return {
    name,
    display_name: name,
    about: PROFILE_ABOUT,
    country: input.country,
    currency: currencyForCountry(input.country),
    email: input.email.trim(),
    phone: cleanPhone(input.phone, input.phoneCountryCode),
    phone_country_code: input.phoneCountryCode.trim(),
    lanaWalletID: input.wallet,
    whoAreYou: PROFILE_WHO_ARE_YOU,
    lanoshi2lash: PROFILE_LANOSHI2LASH,
    orgasmic_profile: PROFILE_ORGASMIC,
    statement_of_responsibility: PROFILE_STATEMENT,
  };
}

export const PROFILE_KEYS = [
  'name',
  'display_name',
  'about',
  'country',
  'currency',
  'email',
  'phone',
  'phone_country_code',
  'lanaWalletID',
  'whoAreYou',
  'lanoshi2lash',
  'orgasmic_profile',
  'statement_of_responsibility',
] as const;

export type ProfileContentError =
  | 'not_json'
  | 'keys'
  | 'not_strings'
  | 'name'
  | 'display_name'
  | 'fixed_field'
  | 'country'
  | 'currency'
  | 'email'
  | 'phone'
  | 'phone_country_code'
  | 'wallet';

/**
 * Server-side check of a signed KIND 0's content before it is forwarded: exactly
 * the keys above, all strings, the fixed fields exactly as registration writes
 * them, and the wallet equal to the address the Registrar knows for this key.
 */
export function checkProfileContent(
  content: string,
  expectedWallet: string,
  isCountryCode: (code: string) => boolean,
): { ok: true; profile: Record<string, string> } | { ok: false; error: ProfileContentError } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { ok: false, error: 'not_json' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, error: 'not_json' };
  const obj = parsed as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.length !== PROFILE_KEYS.length || !PROFILE_KEYS.every((k) => keys.includes(k))) return { ok: false, error: 'keys' };
  if (!keys.every((k) => typeof obj[k] === 'string')) return { ok: false, error: 'not_strings' };
  const p = obj as Record<string, string>;
  if (p.name !== cleanText(p.name) || p.name.length < 3 || p.name.length > 121 || !p.name.includes(' ')) return { ok: false, error: 'name' };
  if (p.display_name !== p.name) return { ok: false, error: 'display_name' };
  if (
    p.about !== PROFILE_ABOUT ||
    p.whoAreYou !== PROFILE_WHO_ARE_YOU ||
    p.lanoshi2lash !== PROFILE_LANOSHI2LASH ||
    p.orgasmic_profile !== PROFILE_ORGASMIC ||
    p.statement_of_responsibility !== PROFILE_STATEMENT
  ) {
    return { ok: false, error: 'fixed_field' };
  }
  if (!COUNTRY.test(p.country) || !isCountryCode(p.country)) return { ok: false, error: 'country' };
  if (p.currency !== currencyForCountry(p.country)) return { ok: false, error: 'currency' };
  if (!EMAIL.test(p.email) || p.email.length > 254) return { ok: false, error: 'email' };
  // The code first: which phone numbers are valid depends on it.
  if (!PHONE_CODE.test(p.phone_country_code)) return { ok: false, error: 'phone_country_code' };
  if (!phoneOk(p.phone, p.phone_country_code)) return { ok: false, error: 'phone' };
  if (p.lanaWalletID !== expectedWallet) return { ok: false, error: 'wallet' };
  return { ok: true, profile: p };
}
