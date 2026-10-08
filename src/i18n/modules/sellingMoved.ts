import { TranslationDict } from '../types';

// Where selling LANA went: the notice on /discount/sell and /bef/sell
// (src/components/discount/SellingMovedNotice.tsx), one dictionary for both
// pages. Lana.discount no longer buys LANA; the firms that do are read from
// the relays (GET /api/buying-dealers) and named here. Brilly, 8. 10. 2026:
// "napiši da sta odkup Lan prevzela firme Krog Menjave ali Ravena Plus (beri
// iz Relayjev in naj se uporabniki pri enem od podjetji registrirajo)", and
// for this app "naredi ta isti popravek za prodajo tudi na strani
// https://app.mejmosefajn.org/discount/sell".
//
// English is lana.discount's own wording (src/copy.ts SELLING_MOVED) word for
// word, and so is Slovenian (NOTICE_TEXT.sl in its
// src/components/SellingMovedNotice.tsx): "LAN"/"LANE" and the formal "vi" —
// "Odkup LAN sta prevzeli podjetji …", "Če želite prodati svoje LANE, se
// registrirajte …", "Prodaj LANE" — although the rest of this app says "ti"
// and "LANA" (the tab right under the notice is "Prodaj LANA"). Brilly asked
// for "ta isti popravek" and wrote "odkup Lan" himself; the app's own voice
// here would need his yes first. src/lib/sellingMoved.test.ts compares both
// languages with lana.discount whenever it is checked out next to this repo.
//
// German, Hungarian and Italian are here because the BEF module speaks them
// (its Sell page had them), so /bef/sell reads whole in all five. The Lana
// Discount module has only English and Slovenian (useTranslation() falls back
// to English), so on /discount/sell its tabs stay English for those readers.
// That is why the page's line about past sales is the notice's own
// (moved.pastSales, below) and not the module's: inside the card everything is
// in one language, the notice's, and {tab} is the Transactions tab's label
// exactly as the module shows it (English for de, hu, it), marked with that
// label's own language on the page.
//
// The heading is `lead` + the firms' names (bold, joined "A, B and C") + a
// full stop unless the last name already ends in one ("d.o.o.") — see
// src/lib/sellingMoved.ts. Slovenian agrees the verb with the count, so the
// lead has three forms; the other languages repeat one where theirs does not
// change. Not named bef*.ts: scripts/testBef.ts checks every bef*.ts it lists.
const sellingMoved = {

  // ── heading ──
  "moved.lead.one": "The purchase of LANA has been taken over by",
  "moved.lead.two": "The purchase of LANA has been taken over by",
  "moved.lead.many": "The purchase of LANA has been taken over by",
  "moved.and": "and",
  "moved.titleNone": "The purchase of LANA has been taken over by other companies.",

  // ── paragraph ──
  "moved.closed": "LANA can no longer be sold on Lana.discount.",
  "moved.register.one": "To sell your LANA, register with this company.",
  "moved.register.two": "To sell your LANA, register with one of the two companies.",
  "moved.register.many": "To sell your LANA, register with one of these companies.",
  "moved.register.none": "To sell your LANA, register with one of the companies listed on BEF Explorer.",

  // ── each firm ──
  "moved.button.register": "Register or sign in",
  "moved.button.sell": "Sell LANA",
  "moved.directory": "Companies on BEF Explorer",
  "moved.loading": "Reading the companies from the Lana relays…",
  "moved.source": "Read from each company’s own signed profile (KIND 30972) on the Lana relays.",

  // ── /discount/sell only: what was sold to lana.discount before stays in the module ──
  "moved.pastSales": "Your past sales and payouts stay here, under {tab}.",
} as const;

export type SellingMovedKey = keyof typeof sellingMoved;

const translations: TranslationDict<SellingMovedKey> = {
  en: sellingMoved,
  sl: {
    // ── heading ──
    "moved.lead.one": "Odkup LAN je prevzelo podjetje",
    "moved.lead.two": "Odkup LAN sta prevzeli podjetji",
    "moved.lead.many": "Odkup LAN so prevzela podjetja",
    "moved.and": "in",
    "moved.titleNone": "Odkup LAN so prevzela druga podjetja.",

    // ── paragraph ──
    "moved.closed": "Na Lana.discount LAN ni več mogoče prodati.",
    "moved.register.one": "Če želite prodati svoje LANE, se registrirajte pri tem podjetju.",
    "moved.register.two": "Če želite prodati svoje LANE, se registrirajte pri enem od obeh podjetij.",
    "moved.register.many": "Če želite prodati svoje LANE, se registrirajte pri enem od teh podjetij.",
    "moved.register.none": "Če želite prodati svoje LANE, se registrirajte pri enem od podjetij, navedenih na BEF Explorerju.",

    // ── each firm ──
    "moved.button.register": "Registracija in prijava",
    "moved.button.sell": "Prodaj LANE",
    "moved.directory": "Podjetja na BEF Explorerju",
    "moved.loading": "Berem podjetja z relejev Lana …",
    "moved.source": "Prebrano iz podpisanega profila vsakega podjetja (KIND 30972) na relejih Lana.",

    // The module's own line, formal like the notice above it in the same card ("Tvoje" before 8. 10.).
    "moved.pastSales": "Vaše pretekle prodaje in izplačila ostanejo tukaj, pod {tab}.",
  },
  de: {
    // ── heading ──
    "moved.lead.one": "Der Ankauf von LANA wurde übernommen von",
    "moved.lead.two": "Der Ankauf von LANA wurde übernommen von",
    "moved.lead.many": "Der Ankauf von LANA wurde übernommen von",
    "moved.and": "und",
    "moved.titleNone": "Der Ankauf von LANA wurde von anderen Unternehmen übernommen.",

    // ── paragraph ──
    "moved.closed": "Auf Lana.discount kann LANA nicht mehr verkauft werden.",
    "moved.register.one": "Um Ihre LANA zu verkaufen, registrieren Sie sich bei diesem Unternehmen.",
    "moved.register.two": "Um Ihre LANA zu verkaufen, registrieren Sie sich bei einem der beiden Unternehmen.",
    "moved.register.many": "Um Ihre LANA zu verkaufen, registrieren Sie sich bei einem dieser Unternehmen.",
    "moved.register.none": "Um Ihre LANA zu verkaufen, registrieren Sie sich bei einem der auf BEF Explorer aufgeführten Unternehmen.",

    // ── each firm ──
    "moved.button.register": "Registrieren oder anmelden",
    "moved.button.sell": "LANA verkaufen",
    "moved.directory": "Unternehmen auf BEF Explorer",
    "moved.loading": "Die Unternehmen werden von den Lana-Relays gelesen…",
    "moved.source": "Gelesen aus dem eigenen signierten Profil jedes Unternehmens (KIND 30972) auf den Lana-Relays.",

    "moved.pastSales": "Ihre bisherigen Verkäufe und Auszahlungen bleiben hier, unter {tab}.",
  },
  hu: {
    // ── heading ── (a colon before the names: the verb comes first in Hungarian)
    "moved.lead.one": "A LANA felvásárlását átvette:",
    "moved.lead.two": "A LANA felvásárlását átvették:",
    "moved.lead.many": "A LANA felvásárlását átvették:",
    "moved.and": "és",
    "moved.titleNone": "A LANA felvásárlását más cégek vették át.",

    // ── paragraph ──
    "moved.closed": "A Lana.discount oldalon már nem lehet LANA-t eladni.",
    "moved.register.one": "Ha LANA-t szeretnél eladni, regisztrálj ennél a cégnél.",
    "moved.register.two": "Ha LANA-t szeretnél eladni, regisztrálj a két cég egyikénél.",
    "moved.register.many": "Ha LANA-t szeretnél eladni, regisztrálj e cégek egyikénél.",
    "moved.register.none": "Ha LANA-t szeretnél eladni, regisztrálj a BEF Explorerben felsorolt cégek egyikénél.",

    // ── each firm ──
    "moved.button.register": "Regisztráció és bejelentkezés",
    "moved.button.sell": "LANA eladása",
    "moved.directory": "Cégek a BEF Explorerben",
    "moved.loading": "A cégek beolvasása a Lana relékről…",
    "moved.source": "Minden cég saját, aláírt profiljából (KIND 30972) olvasva a Lana reléken.",

    // "a" before the tab: its label starts with a consonant (Transactions).
    "moved.pastSales": "A korábbi eladásaid és kifizetéseid itt maradnak, a {tab} fül alatt.",
  },
  it: {
    // ── heading ──
    "moved.lead.one": "L’acquisto di LANA è stato rilevato da",
    "moved.lead.two": "L’acquisto di LANA è stato rilevato da",
    "moved.lead.many": "L’acquisto di LANA è stato rilevato da",
    "moved.and": "e",
    "moved.titleNone": "L’acquisto di LANA è stato rilevato da altre aziende.",

    // ── paragraph ──
    "moved.closed": "Su Lana.discount non è più possibile vendere LANA.",
    "moved.register.one": "Per vendere i tuoi LANA, registrati presso questa azienda.",
    "moved.register.two": "Per vendere i tuoi LANA, registrati presso una delle due aziende.",
    "moved.register.many": "Per vendere i tuoi LANA, registrati presso una di queste aziende.",
    "moved.register.none": "Per vendere i tuoi LANA, registrati presso una delle aziende elencate su BEF Explorer.",

    // ── each firm ──
    "moved.button.register": "Registrati o accedi",
    "moved.button.sell": "Vendi LANA",
    "moved.directory": "Aziende su BEF Explorer",
    "moved.loading": "Lettura delle aziende dai relay Lana…",
    "moved.source": "Letto dal profilo firmato di ciascuna azienda (KIND 30972) sui relay Lana.",

    "moved.pastSales": "Le tue vendite e i tuoi pagamenti precedenti restano qui, sotto {tab}.",
  },
};

export default translations;
