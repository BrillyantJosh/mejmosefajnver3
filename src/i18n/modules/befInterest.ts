import { SUPPORTED_LANGS, TranslationDict } from '../types';
import befText, { type BefTextKey } from './befText';

// MejmoSefajn's own words for the BEF module's Interest page — only the two
// answers BEF Explorer's own texts (./befVendor.ts) word for its own site: a
// late answer that did arrive, and sending switched off "on this server" (here
// that would read as MejmoSefajn's). Everything else on the page is BEF's text
// or the module's (./bef.ts), through ./befText.ts.
// English is the required base (fallback); every language mirrors every key.
const befInterest = {
  "interest.arrived": "No answer came back in time, but BEF Explorer has received it. It is shown below.",
  "interest.relayWritesOff": "Sending to the relays is switched off on BEF Explorer right now. Nothing was sent.",
} as const;

export type BefInterestKey = keyof typeof befInterest;

const own: TranslationDict<BefInterestKey> = {
  en: befInterest,
  sl: {
    "interest.arrived": "Odgovor ni prišel pravočasno, a BEF Explorer je poslano prejel. Prikazano je spodaj.",
    "interest.relayWritesOff": "Pošiljanje na releje je na BEF Explorerju trenutno izklopljeno. Nič ni bilo poslano.",
  },
  de: {
    "interest.arrived": "Es kam keine Antwort rechtzeitig zurück, aber das Gesendete ist bei BEF Explorer angekommen. Es wird unten angezeigt.",
    "interest.relayWritesOff": "Das Senden an die Relays ist bei BEF Explorer gerade abgeschaltet. Es wurde nichts gesendet.",
  },
  hu: {
    "interest.arrived": "Nem érkezett időben válasz, de amit küldtél, megérkezett a BEF Explorerhez. Lent látod.",
    "interest.relayWritesOff": "A relékre küldés a BEF Exploreren most ki van kapcsolva. Nem ment el semmi.",
  },
  it: {
    "interest.arrived": "Nessuna risposta è arrivata in tempo, ma quanto inviato è arrivato a BEF Explorer. È mostrato qui sotto.",
    "interest.relayWritesOff": "L’invio ai relay è disattivato su BEF Explorer in questo momento. Non è stato inviato nulla.",
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
