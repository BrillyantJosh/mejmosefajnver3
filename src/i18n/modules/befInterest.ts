import { SUPPORTED_LANGS, TranslationDict } from '../types';
import befText, { type BefTextKey } from './befText';

// MejmoSefajn's own words for the BEF module's Interest page, which now only
// says where an interest is expressed: the BEF page of LetsBalance.world —
// support, sell, or sell and buy, for at most 30 days (KIND 30975, taken up by
// one firm with KIND 40971). The KIND 30970 this page signed and sent through
// BEF Explorer is replaced, and earlier interests here are closed (Brilly,
// 3. 11. 2026). The tab's name is still the module's (./bef.ts nav.interest).
// English is the required base (fallback); every language mirrors every key.
const befInterest = {
  "interest.moved.title": "Interest is now expressed on LetsBalance.world",
  "interest.moved.text": "Interest is now expressed on the BEF page of LetsBalance.world: support, sell, or sell and buy, valid up to 30 days.",
  "interest.moved.closed": "Interests expressed here earlier are closed. Nothing is signed or sent from this page any more.",
  "interest.moved.open": "Open the BEF page on LetsBalance.world",
} as const;

export type BefInterestKey = keyof typeof befInterest;

const own: TranslationDict<BefInterestKey> = {
  en: befInterest,
  sl: {
    "interest.moved.title": "Interes se zdaj izrazi na LetsBalance.world",
    "interest.moved.text": "Interes se zdaj izrazi na strani BEF na LetsBalance.world: podpora, prodaja ali prodaja in nakup, velja največ 30 dni.",
    "interest.moved.closed": "Interesi, izraženi tukaj prej, so zaprti. S te strani se nič več ne podpiše in ne pošlje.",
    "interest.moved.open": "Odpri stran BEF na LetsBalance.world",
  },
  de: {
    "interest.moved.title": "Interesse wird jetzt auf LetsBalance.world bekundet",
    "interest.moved.text": "Interesse wird jetzt auf der BEF-Seite von LetsBalance.world bekundet: unterstützen, verkaufen oder verkaufen und kaufen, gültig bis zu 30 Tage.",
    "interest.moved.closed": "Hier früher bekundete Interessen sind geschlossen. Von dieser Seite wird nichts mehr signiert oder gesendet.",
    "interest.moved.open": "BEF-Seite auf LetsBalance.world öffnen",
  },
  hu: {
    "interest.moved.title": "Az érdeklődést most a LetsBalance.world oldalon jelezheted",
    "interest.moved.text": "Az érdeklődést most a LetsBalance.world BEF oldalán jelezheted: támogatás, eladás, vagy eladás és vétel, legfeljebb 30 napig érvényes.",
    "interest.moved.closed": "Az itt korábban jelzett érdeklődések lezárultak. Ez az oldal már semmit nem ír alá és nem küld el.",
    "interest.moved.open": "A BEF oldal megnyitása a LetsBalance.world-ön",
  },
  it: {
    "interest.moved.title": "L’interesse si esprime ora su LetsBalance.world",
    "interest.moved.text": "L’interesse si esprime ora sulla pagina BEF di LetsBalance.world: sostegno, vendita, oppure vendita e acquisto, valido fino a 30 giorni.",
    "interest.moved.closed": "Gli interessi espressi qui in precedenza sono chiusi. Da questa pagina non si firma né si invia più nulla.",
    "interest.moved.open": "Apri la pagina BEF su LetsBalance.world",
  },
};

/** The Interest page reads one dictionary: the module's (BEF's and MejmoSefajn's) and these. */
export type BefInterestTextKey = BefTextKey | BefInterestKey;

const befInterestText = { en: { ...befText.en, ...own.en } } as TranslationDict<BefInterestTextKey>;

for (const lang of SUPPORTED_LANGS) {
  if (lang === 'en') continue;
  const moduleWords = befText[lang];
  const pageWords = own[lang];
  if (moduleWords || pageWords) befInterestText[lang] = { ...moduleWords, ...pageWords } as Record<BefInterestTextKey, string>;
}

export { own as befInterestTranslations };
export default befInterestText;
