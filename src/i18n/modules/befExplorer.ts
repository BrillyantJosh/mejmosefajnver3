import { TranslationDict } from '../types';

// MejmoSefajn's own words for the BEF module's Explorer (the scenario
// calculator). The calculator's own texts are BEF Explorer's
// (./befVendor.ts, generated); these are only what BEF says elsewhere on its
// site or not at all:
//   - loading and failing to load the figures from befexplorer.com,
//   - the "Express interest" note, which on BEF asks for a key to be typed,
//   - the "Source" and "Last checked" lines, which BEF writes in English only,
//   - BEF's site-wide disclaimer (its footer, which this page has no copy of);
//     scripts/testBefExplorer.ts checks it still says what BEF's footer says,
//     and scripts/testBef.ts that the Slovenian, German and Italian are BEF's
//     own words for it too. The Hungarian is MejmoSefajn's, as ./befVendorHu.ts.
// English is the required base (fallback); every language mirrors every key.
const befExplorer = {

  // ── loading the published figures ──
  "explorer.loading": "Loading the published figures from BEF Explorer…",
  "explorer.loadFailedTitle": "The figures could not be loaded",
  "explorer.loadFailed": "No numbers are shown rather than wrong ones.",
  "explorer.tryAgain": "Try again",
  "explorer.openOnBef": "Open the calculator on befexplorer.com",
  "explorer.updating": "Updating the figures…",

  // ── the calculator ──
  "explorer.infoLabel": "More about this",
  "explorer.expressInterestNote": "Non-binding: not an order and not a reservation. It opens the Interest page, where you can say how much you would co-create in this split. You do not type your key there: MejmoSefajn signs you in to BEF Explorer.",
  "explorer.source": "Source: {source}",
  "explorer.lastChecked": "Last checked: {time} UTC",

  // ── BEF Explorer's site-wide disclaimer ──
  "explorer.disclaimerTitle": "Disclaimer",
  "explorer.disclaimer": "BEF Explorer is an independent informational and scenario-modelling platform. It does not buy, sell, broker, custody, or execute LANA or other crypto-asset transactions, does not receive or transmit orders, and does not provide personalised investment recommendations. Every listed company remains independently responsible for its own offers, contracts, pricing, and settlement. Users must decide independently whether to enter into any transaction and must contract directly with the relevant company.",
} as const;

export type BefExplorerKey = keyof typeof befExplorer;

const translations: TranslationDict<BefExplorerKey> = {
  en: befExplorer,
  sl: {
    // ── loading the published figures ──
    "explorer.loading": "Nalagam objavljene številke iz BEF Explorerja…",
    "explorer.loadFailedTitle": "Številk ni bilo mogoče naložiti",
    "explorer.loadFailed": "Raje ne pokažemo nobene številke kot napačne.",
    "explorer.tryAgain": "Poskusi znova",
    "explorer.openOnBef": "Odpri kalkulator na befexplorer.com",
    "explorer.updating": "Posodabljam številke…",

    // ── the calculator ──
    "explorer.infoLabel": "Več o tem",
    "explorer.expressInterestNote": "Nezavezujoče: ni naročilo in ni rezervacija. Odpre stran Interes, kjer poveš, koliko bi ko-kreiral v tem splitu. Ključa tam ne vpisuješ: MejmoSefajn te prijavi v BEF Explorer.",
    "explorer.source": "Vir: {source}",
    "explorer.lastChecked": "Nazadnje preverjeno: {time} UTC",

    // ── BEF Explorer's site-wide disclaimer ──
    "explorer.disclaimerTitle": "Izjava o omejitvi odgovornosti",
    "explorer.disclaimer": "BEF Explorer je neodvisna informacijska in simulacijska platforma. Ne kupuje, ne prodaja, ne posreduje, ne hrani in ne izvršuje poslov z LANO ali drugimi kriptosredstvi, ne sprejema in ne posreduje naročil ter ne daje osebnih naložbenih priporočil. Vsako navedeno podjetje je samostojno odgovorno za svoje ponudbe, pogodbe, cene in poravnavo. Uporabnik se sam odloči, ali bo sklenil posel, in pogodbo sklene neposredno z zadevnim podjetjem.",
  },
  de: {
    // ── loading the published figures ──
    "explorer.loading": "Die veröffentlichten Zahlen werden von BEF Explorer geladen…",
    "explorer.loadFailedTitle": "Die Zahlen konnten nicht geladen werden",
    "explorer.loadFailed": "Lieber keine Zahlen anzeigen als falsche.",
    "explorer.tryAgain": "Erneut versuchen",
    "explorer.openOnBef": "Szenario-Rechner auf befexplorer.com öffnen",
    "explorer.updating": "Die Zahlen werden aktualisiert…",

    // ── the calculator ──
    "explorer.infoLabel": "Mehr dazu",
    "explorer.expressInterestNote": "Unverbindlich: kein Auftrag und keine Reservierung. Öffnet die Seite Interesse, wo Sie angeben können, wie viel Sie in diesem Split ko-kreieren würden. Ihren Schlüssel geben Sie dort nicht ein: MejmoSefajn meldet Sie bei BEF Explorer an.",
    "explorer.source": "Quelle: {source}",
    "explorer.lastChecked": "Zuletzt geprüft: {time} UTC",

    // ── BEF Explorer's site-wide disclaimer ──
    "explorer.disclaimerTitle": "Haftungsausschluss",
    "explorer.disclaimer": "BEF Explorer ist eine unabhängige Informations- und Szenariomodellierungsplattform. Sie kauft, verkauft, vermittelt, verwahrt und führt keine Transaktionen mit LANA oder anderen Kryptowerten aus, nimmt keine Aufträge entgegen und leitet keine weiter und gibt keine persönlichen Anlageempfehlungen. Jedes gelistete Unternehmen bleibt eigenständig verantwortlich für seine Angebote, Verträge, Preise und Abwicklung. Nutzer entscheiden selbst, ob sie eine Transaktion eingehen, und schließen den Vertrag unmittelbar mit dem betreffenden Unternehmen.",
  },
  hu: {
    // ── loading the published figures ──
    "explorer.loading": "A közzétett számok betöltése a BEF Explorerből…",
    "explorer.loadFailedTitle": "A számokat nem sikerült betölteni",
    "explorer.loadFailed": "Inkább nem mutatunk számokat, mint rossz számokat.",
    "explorer.tryAgain": "Próbáld újra",
    "explorer.openOnBef": "A kalkulátor megnyitása a befexplorer.com oldalon",
    "explorer.updating": "A számok frissítése…",

    // ── the calculator ──
    "explorer.infoLabel": "Bővebben",
    "explorer.expressInterestNote": "Nem kötelező érvényű: nem megrendelés és nem foglalás. Megnyitja az Érdeklődés oldalt, ahol megadhatod, mennyivel vennél részt a ko-kreációban ebben a Splitben. A kulcsodat ott nem kell beírnod: a MejmoSefajn bejelentkeztet a BEF Explorerbe.",
    "explorer.source": "Forrás: {source}",
    "explorer.lastChecked": "Utoljára ellenőrizve: {time} UTC",

    // ── BEF Explorer's site-wide disclaimer ──
    "explorer.disclaimerTitle": "Felelősségkizárás",
    "explorer.disclaimer": "A BEF Explorer független tájékoztató és forgatókönyv-modellező platform. Nem vásárol, nem ad el, nem közvetít, nem őriz és nem hajt végre LANA- vagy más kriptoeszköz-ügyleteket, nem fogad és nem továbbít megbízásokat, és nem ad személyre szabott befektetési ajánlást. Minden feltüntetett cég önállóan felel a saját ajánlataiért, szerződéseiért, árazásáért és elszámolásáért. A felhasználó maga dönti el, hogy belép-e bármilyen ügyletbe, és közvetlenül az érintett céggel köt szerződést.",
  },
  it: {
    // ── loading the published figures ──
    "explorer.loading": "Caricamento delle cifre pubblicate da BEF Explorer…",
    "explorer.loadFailedTitle": "Non è stato possibile caricare le cifre",
    "explorer.loadFailed": "Meglio non mostrare nessuna cifra che cifre errate.",
    "explorer.tryAgain": "Riprova",
    "explorer.openOnBef": "Apri il calcolatore di scenari su befexplorer.com",
    "explorer.updating": "Aggiornamento delle cifre…",

    // ── the calculator ──
    "explorer.infoLabel": "Maggiori informazioni",
    "explorer.expressInterestNote": "Non vincolante: non è un ordine né una prenotazione. Apre la pagina Interesse, dove puoi indicare quanto co-creeresti in questo split. Lì non devi inserire la chiave: MejmoSefajn ti fa accedere a BEF Explorer.",
    "explorer.source": "Fonte: {source}",
    "explorer.lastChecked": "Ultima verifica: {time} UTC",

    // ── BEF Explorer's site-wide disclaimer ──
    "explorer.disclaimerTitle": "Avvertenza",
    "explorer.disclaimer": "BEF Explorer è una piattaforma indipendente di informazione e modellazione di scenari. Non acquista, non vende, non intermedia, non custodisce e non esegue operazioni in LANA o altre cripto-attività, non riceve né trasmette ordini e non fornisce raccomandazioni personali di investimento. Ogni azienda elencata resta autonomamente responsabile delle proprie offerte, dei contratti, dei prezzi e del regolamento. L’utente decide autonomamente se concludere un’operazione e contratta direttamente con l’azienda interessata.",
  },
};

export default translations;
