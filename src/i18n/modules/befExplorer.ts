import { TranslationDict } from '../types';

// MejmoSefajn's own words for the BEF module's Explorer (the scenario
// calculator). The calculator's own texts are BEF Explorer's
// (./befVendor.ts, generated); these are only what BEF says elsewhere on its
// site or not at all:
//   - loading and failing to load the figures from befexplorer.com,
//   - the "Express interest" note, which on BEF asks for a key to be typed and
//     here says that the button opens the BEF page of LetsBalance.world,
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
  "explorer.expressInterestNote": "Non-binding: not an order and not a reservation. It opens the BEF page of LetsBalance.world in a new tab, where an interest is expressed now: support, sell, or sell and buy, valid up to 30 days.",
  "explorer.source": "Source: {source}",
  "explorer.lastChecked": "Last checked: {time} UTC",

  // ── who has already expressed interest (GET /api/interests) ──
  "expressed.title": "Interest already expressed",
  "expressed.lead": "People who have said on BEF Explorer, with their own signature, how much they would co-create — round by round. Non-binding: not an order and not a reservation.",
  "expressed.people": "People: {count}",
  "expressed.empty": "No interest in this round yet.",
  "expressed.noName": "No public name",
  "expressed.signedAt": "signed {time}",
  "expressed.beyond": "above the published limit",
  "expressed.beyondNote": "“Above the published limit” means the amount is more than the limit published for that round now — for example because the limit was lowered after it was signed. It stays exactly as it was signed.",
  "expressed.noneYet": "Nobody has expressed interest in this split yet. You could be the first.",
  "expressed.loading": "Loading the expressed interests…",
  "expressed.unavailable": "The expressed interests cannot be shown right now.",
  "expressed.source": "Source: the signed public events (KIND 30970) people expressed on BEF Explorer until 3 November 2026, kept by BEF Explorer as history. The name is from each person’s own public profile; wallet, e-mail, telephone and country are never shown.",

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
    "explorer.expressInterestNote": "Nezavezujoče: ni naročilo in ni rezervacija. V novem zavihku odpre stran BEF na LetsBalance.world, kjer se interes zdaj izrazi: podpora, prodaja ali prodaja in nakup, velja največ 30 dni.",
    "explorer.source": "Vir: {source}",
    "explorer.lastChecked": "Nazadnje preverjeno: {time} UTC",

    // ── who has already expressed interest (GET /api/interests) ──
    "expressed.title": "Že izraženi interesi",
    "expressed.lead": "Ljudje, ki so na BEF Explorerju s svojim podpisom povedali, koliko bi ko-kreirali — po rundah. Nezavezujoče: ni naročilo in ni rezervacija.",
    "expressed.people": "Število oseb: {count}",
    "expressed.empty": "V tej rundi še ni izraženih interesov.",
    "expressed.noName": "Brez javnega imena",
    "expressed.signedAt": "oddano {time}",
    "expressed.beyond": "nad objavljeno mejo",
    "expressed.beyondNote": "»Nad objavljeno mejo« pomeni, da znesek presega mejo, ki je za to rundo objavljena zdaj — na primer, ker je bila meja po oddaji znižana. Ostane točno tak, kot je bil podpisan.",
    "expressed.noneYet": "V tem splitu še nihče ni izrazil interesa. Lahko si prvi.",
    "expressed.loading": "Nalagam izražene interese…",
    "expressed.unavailable": "Izraženih interesov trenutno ni mogoče prikazati.",
    "expressed.source": "Vir: podpisani javni dogodki (KIND 30970), ki so jih ljudje do 3. 11. 2026 oddali na BEF Explorerju in jih ta hrani kot zgodovino. Ime je iz javnega profila osebe; denarnice, e-pošte, telefona in države seznam nikoli ne pokaže.",

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
    "explorer.expressInterestNote": "Unverbindlich: kein Auftrag und keine Reservierung. Öffnet in einem neuen Tab die BEF-Seite von LetsBalance.world, wo Interesse jetzt bekundet wird: unterstützen, verkaufen oder verkaufen und kaufen, gültig bis zu 30 Tage.",
    "explorer.source": "Quelle: {source}",
    "explorer.lastChecked": "Zuletzt geprüft: {time} UTC",

    // ── who has already expressed interest (GET /api/interests) ──
    "expressed.title": "Bereits bekundetes Interesse",
    "expressed.lead": "Menschen, die auf BEF Explorer mit ihrer eigenen Signatur gesagt haben, wie viel sie ko-kreieren würden — Runde für Runde. Unverbindlich: kein Auftrag und keine Reservierung.",
    "expressed.people": "Personen: {count}",
    "expressed.empty": "In dieser Runde gibt es noch keine Interessenbekundung.",
    "expressed.noName": "Kein öffentlicher Name",
    "expressed.signedAt": "signiert {time}",
    "expressed.beyond": "über der veröffentlichten Grenze",
    "expressed.beyondNote": "„Über der veröffentlichten Grenze“ heißt: Der Betrag liegt über der Grenze, die für diese Runde jetzt veröffentlicht ist — zum Beispiel, weil sie nach der Signatur gesenkt wurde. Er bleibt genau so, wie er signiert wurde.",
    "expressed.noneYet": "In diesem Split hat noch niemand Interesse bekundet. Sie könnten die erste Person sein.",
    "expressed.loading": "Die Interessenbekundungen werden geladen…",
    "expressed.unavailable": "Die Interessenbekundungen können gerade nicht angezeigt werden.",
    "expressed.source": "Quelle: die signierten öffentlichen Events (KIND 30970), die Menschen bis zum 3. November 2026 auf BEF Explorer abgegeben haben und die BEF Explorer als Verlauf aufbewahrt. Der Name stammt aus dem eigenen öffentlichen Profil; Wallet, E-Mail, Telefon und Land zeigt die Liste nie.",

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
    "explorer.expressInterestNote": "Nem kötelező érvényű: nem megrendelés és nem foglalás. Új lapon megnyitja a LetsBalance.world BEF oldalát, ahol most az érdeklődést jelezheted: támogatás, eladás, vagy eladás és vétel, legfeljebb 30 napig érvényes.",
    "explorer.source": "Forrás: {source}",
    "explorer.lastChecked": "Utoljára ellenőrizve: {time} UTC",

    // ── who has already expressed interest (GET /api/interests) ──
    "expressed.title": "Már jelzett érdeklődések",
    "expressed.lead": "Emberek, akik a BEF Exploreren saját aláírásukkal megmondták, mennyivel vennének részt a ko-kreációban — körönként. Nem kötelező érvényű: nem megrendelés és nem foglalás.",
    "expressed.people": "Személyek: {count}",
    "expressed.empty": "Ebben a körben még nincs jelzett érdeklődés.",
    "expressed.noName": "Nincs nyilvános név",
    "expressed.signedAt": "aláírva {time}",
    "expressed.beyond": "a közzétett korlát felett",
    "expressed.beyondNote": "A „közzétett korlát felett” azt jelenti, hogy az összeg több, mint a körre most közzétett korlát — például mert a korlátot az aláírás után csökkentették. Pontosan úgy marad, ahogy aláírták.",
    "expressed.noneYet": "Ebben a Splitben még senki sem jelzett érdeklődést. Te lehetsz az első.",
    "expressed.loading": "A jelzett érdeklődések betöltése…",
    "expressed.unavailable": "A jelzett érdeklődéseket most nem lehet megmutatni.",
    "expressed.source": "Forrás: a nyilvános, aláírt események (KIND 30970), amelyeket az emberek 2026. november 3-ig a BEF Exploreren adtak le, és amelyeket a BEF Explorer előzményként megőriz. A név mindenki saját nyilvános profiljából való; pénztárcát, e-mailt, telefont és országot a lista soha nem mutat.",

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
    "explorer.expressInterestNote": "Non vincolante: non è un ordine né una prenotazione. Apre in una nuova scheda la pagina BEF di LetsBalance.world, dove ora si esprime l’interesse: sostegno, vendita, oppure vendita e acquisto, valido fino a 30 giorni.",
    "explorer.source": "Fonte: {source}",
    "explorer.lastChecked": "Ultima verifica: {time} UTC",

    // ── who has already expressed interest (GET /api/interests) ──
    "expressed.title": "Interesse già manifestato",
    "expressed.lead": "Persone che su BEF Explorer hanno dichiarato, con la propria firma, quanto co-creerebbero — round per round. Non vincolante: non è un ordine né una prenotazione.",
    "expressed.people": "Persone: {count}",
    "expressed.empty": "In questo round non c’è ancora nessuna manifestazione di interesse.",
    "expressed.noName": "Nessun nome pubblico",
    "expressed.signedAt": "firmato {time}",
    "expressed.beyond": "oltre il limite pubblicato",
    "expressed.beyondNote": "«Oltre il limite pubblicato» significa che l’importo supera il limite pubblicato ora per quel round — per esempio perché è stato abbassato dopo la firma. Resta esattamente come è stato firmato.",
    "expressed.noneYet": "In questo split nessuno ha ancora manifestato interesse. Potresti essere il primo.",
    "expressed.loading": "Caricamento delle manifestazioni di interesse…",
    "expressed.unavailable": "Le manifestazioni di interesse non possono essere mostrate in questo momento.",
    "expressed.source": "Fonte: gli eventi pubblici firmati (KIND 30970) che le persone hanno inviato su BEF Explorer fino al 3 novembre 2026 e che BEF Explorer conserva come storico. Il nome proviene dal profilo pubblico di ciascuno; portafoglio, e-mail, telefono e paese non compaiono mai.",

    // ── BEF Explorer's site-wide disclaimer ──
    "explorer.disclaimerTitle": "Avvertenza",
    "explorer.disclaimer": "BEF Explorer è una piattaforma indipendente di informazione e modellazione di scenari. Non acquista, non vende, non intermedia, non custodisce e non esegue operazioni in LANA o altre cripto-attività, non riceve né trasmette ordini e non fornisce raccomandazioni personali di investimento. Ogni azienda elencata resta autonomamente responsabile delle proprie offerte, dei contratti, dei prezzi e del regolamento. L’utente decide autonomamente se concludere un’operazione e contratta direttamente con l’azienda interessata.",
  },
};

export default translations;
