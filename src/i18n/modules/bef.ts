import { TranslationDict } from '../types';

// MejmoSefajn's own words for the BEF module — only where BEF Explorer's own
// texts (./befVendor.ts, generated) would not fit a person who is already
// logged in here: the tabs and the Sell page, signing in without typing a key,
// and refusals that BEF words as "type your key" or "go to another site".
// English is the required base (fallback); Slovenian, German, Hungarian and
// Italian mirror every key, in the same voice as BEF's own translations (the
// Hungarian as ./befVendorHu.ts words BEF's texts).
const bef = {

  // ── layout ──
  "layout.subtitle": "Balanced Exchange Framework",
  "nav.circle": "My Circle",
  "nav.explorer": "Explorer",
  "nav.interest": "Interest",
  "nav.sell": "Sell",

  // ── sell: /bef/sell typed or shared as a link ──
  "sell.body": "Lana.discount buys LANA for its own treasury, with its own capital, and reviews every proposal on its own merits. An offer is therefore submitted and accepted there, not inside this app.",
  "sell.cta": "Submit an offer on lana.discount",
  "sell.title": "Selling happens on Lana.discount",

  // ── door: signing in to BEF Explorer with the MejmoSefajn key ──
  "door.accountChanged": "Your MejmoSefajn account changed. Press Try again to sign in to BEF Explorer as the account you are logged in with now.",
  "door.behind": "MejmoSefajn is behind BEF Explorer. Use befexplorer.com until MejmoSefajn is updated.",
  "door.generic": "Something is wrong in MejmoSefajn. Please report it (code: {code}).",
  "door.keyUnreadable": "MejmoSefajn cannot read your key for BEF Explorer. Log out and log in again.",
  "door.note": "MejmoSefajn signs you in to BEF Explorer with the key you are logged in with, so you do not type it again. Your key stays in this browser; only a signed message is sent. BEF Explorer checks with the Lana Registrar that the wallet belongs to your key, reads your public profile (KIND 0), and keeps a copy of your name, country, e-mail and phone from it. The sign-in lasts up to 8 hours and ends when you log out.",
  "door.noteTitle": "How signing in works",
  "door.notRegistered": "BEF Explorer says this wallet is not registered with the Lana Registrar yet. Press Try again to open the registration.",
  "door.openBef": "Open befexplorer.com",
  "door.openProfile": "Open my profile",
  "door.profileIncomplete": "Your public profile has no name, so BEF Explorer cannot sign you in. Add your name in your profile, then press Try again.",
  "door.signedInAs": "Signed in to BEF Explorer as {name} · {wallet}",
  "door.signingIn": "Signing in to BEF Explorer…",
  "door.tryAgain": "Try again",
  "door.unreachable": "BEF Explorer could not be reached. Check your connection and try again. If it keeps happening, BEF Explorer may not be accepting requests from this app right now: you can use befexplorer.com directly.",
  "door.wrongKey": "The Lana Registrar lists this wallet under another account, so BEF Explorer cannot sign you in with it.",

  // ── registration ──
  "reg.replacesProfile": "When you logged in, MejmoSefajn found a public profile for this key. Publishing this form replaces that whole profile on the relays: anything else it holds, such as your language or picture, is removed.",
  "reg.signedWithSession": "You do not need to type your key: MejmoSefajn signs with the key you are logged in with.",

  // ── interest ──
  "interest.outcomeUnknown": "No answer came back in time, so it may have gone through. Check your interest below before sending again.",
} as const;

export type BefKey = keyof typeof bef;

const translations: TranslationDict<BefKey> = {
  en: bef,
  sl: {
    // ── layout ──
    "layout.subtitle": "Balanced Exchange Framework",
    "nav.circle": "Moj krog",
    "nav.explorer": "Razišči",
    "nav.interest": "Interes",
    "nav.sell": "Prodaj",

    // ── sell ──
    "sell.body": "Lana.discount kupuje LANA za svojo zakladnico, s svojim kapitalom, in vsako ponudbo presodi posebej. Ponudba se zato odda in sprejme tam, ne v tej aplikaciji.",
    "sell.cta": "Oddaj ponudbo na lana.discount",
    "sell.title": "Prodaja poteka na Lana.discount",

    // ── door ──
    "door.accountChanged": "Tvoj račun v MejmoSefajn se je zamenjal. Pritisni Poskusi znova, da se v BEF Explorer prijaviš z računom, s katerim si zdaj prijavljen.",
    "door.behind": "MejmoSefajn zaostaja za BEF Explorerjem. Dokler MejmoSefajn ni posodobljen, uporabi befexplorer.com.",
    "door.generic": "V MejmoSefajn je nekaj narobe. Prosimo, sporoči to (koda: {code}).",
    "door.keyUnreadable": "MejmoSefajn ne more prebrati tvojega ključa za BEF Explorer. Odjavi se in se znova prijavi.",
    "door.note": "MejmoSefajn te v BEF Explorer prijavi s ključem, s katerim si prijavljen, zato ga ne vpisuješ znova. Ključ ostane v tem brskalniku; pošlje se samo podpisano sporočilo. BEF Explorer pri Lana Registrarju preveri, da denarnica pripada tvojemu ključu, prebere tvoj javni profil (KIND 0) in iz njega shrani kopijo tvojega imena, države, e-pošte in telefona. Prijava velja največ 8 ur in se konča, ko se odjaviš.",
    "door.noteTitle": "Kako poteka prijava",
    "door.notRegistered": "BEF Explorer sporoča, da ta denarnica pri Lana Registrarju še ni registrirana. Pritisni Poskusi znova, da se odpre registracija.",
    "door.openBef": "Odpri befexplorer.com",
    "door.openProfile": "Odpri moj profil",
    "door.profileIncomplete": "Tvoj javni profil nima imena, zato te BEF Explorer ne more prijaviti. Dodaj ime v svoj profil in pritisni Poskusi znova.",
    "door.signedInAs": "Prijavljen v BEF Explorer kot {name} · {wallet}",
    "door.signingIn": "Prijavljam te v BEF Explorer…",
    "door.tryAgain": "Poskusi znova",
    "door.unreachable": "BEF Explorerja ni bilo mogoče doseči. Preveri povezavo in poskusi znova. Če se to ponavlja, BEF Explorer morda trenutno ne sprejema zahtev iz te aplikacije: befexplorer.com lahko uporabiš neposredno.",
    "door.wrongKey": "Lana Registrar vodi to denarnico pod drugim računom, zato te BEF Explorer z njo ne more prijaviti.",

    // ── registration ──
    "reg.replacesProfile": "Ko si se prijavil, je MejmoSefajn za ta ključ našel javni profil. Objava tega obrazca ta profil na relejih v celoti zamenja: vse ostalo, kar je v njem, na primer jezik ali slika, se odstrani.",
    "reg.signedWithSession": "Ključa ti ni treba vpisati: MejmoSefajn podpiše s ključem, s katerim si prijavljen.",

    // ── interest ──
    "interest.outcomeUnknown": "Odgovor ni prišel pravočasno, zato je morda šlo skozi. Preden pošlješ znova, preveri svoj interes spodaj.",
  },
  de: {
    // ── layout ──
    "layout.subtitle": "Balanced Exchange Framework",
    "nav.circle": "Mein Kreis",
    "nav.explorer": "Entdecken",
    "nav.interest": "Interesse",
    "nav.sell": "Verkaufen",

    // ── sell ──
    "sell.body": "Lana.discount kauft LANA für die eigene Treasury, mit eigenem Kapital, und prüft jedes Angebot einzeln. Ein Angebot wird deshalb dort abgegeben und angenommen, nicht in dieser App.",
    "sell.cta": "Angebot auf lana.discount abgeben",
    "sell.title": "Verkauft wird auf Lana.discount",

    // ── door ──
    "door.accountChanged": "Ihr MejmoSefajn-Konto hat gewechselt. Drücken Sie Erneut versuchen, um sich bei BEF Explorer mit dem Konto anzumelden, mit dem Sie jetzt angemeldet sind.",
    "door.behind": "MejmoSefajn ist hinter BEF Explorer zurück. Verwenden Sie befexplorer.com, bis MejmoSefajn aktualisiert ist.",
    "door.generic": "In MejmoSefajn stimmt etwas nicht. Bitte melden Sie es (Code: {code}).",
    "door.keyUnreadable": "MejmoSefajn kann Ihren Schlüssel für BEF Explorer nicht lesen. Melden Sie sich ab und wieder an.",
    "door.note": "MejmoSefajn meldet Sie bei BEF Explorer mit dem Schlüssel an, mit dem Sie angemeldet sind, damit Sie ihn nicht erneut eingeben. Ihr Schlüssel bleibt in diesem Browser; gesendet wird nur eine signierte Nachricht. BEF Explorer prüft beim Lana Registrar, dass die Wallet zu Ihrem Schlüssel gehört, liest Ihr öffentliches Profil (KIND 0) und speichert daraus eine Kopie Ihres Namens, Landes, Ihrer E-Mail und Telefonnummer. Die Anmeldung gilt höchstens 8 Stunden und endet, wenn Sie sich abmelden.",
    "door.noteTitle": "So funktioniert die Anmeldung",
    "door.notRegistered": "BEF Explorer meldet, dass diese Wallet beim Lana Registrar noch nicht registriert ist. Drücken Sie Erneut versuchen, um die Registrierung zu öffnen.",
    "door.openBef": "befexplorer.com öffnen",
    "door.openProfile": "Mein Profil öffnen",
    "door.profileIncomplete": "Ihr öffentliches Profil hat keinen Namen, daher kann BEF Explorer Sie nicht anmelden. Tragen Sie Ihren Namen in Ihr Profil ein und drücken Sie dann Erneut versuchen.",
    "door.signedInAs": "Bei BEF Explorer angemeldet als {name} · {wallet}",
    "door.signingIn": "Anmeldung bei BEF Explorer…",
    "door.tryAgain": "Erneut versuchen",
    "door.unreachable": "BEF Explorer war nicht erreichbar. Prüfen Sie Ihre Verbindung und versuchen Sie es erneut. Wenn das immer wieder passiert, nimmt BEF Explorer gerade vielleicht keine Anfragen von dieser App an: Sie können befexplorer.com direkt verwenden.",
    "door.wrongKey": "Der Lana Registrar führt diese Wallet unter einem anderen Konto, daher kann BEF Explorer Sie damit nicht anmelden.",

    // ── registration ──
    "reg.replacesProfile": "Bei Ihrer Anmeldung hat MejmoSefajn für diesen Schlüssel ein öffentliches Profil gefunden. Wenn Sie dieses Formular veröffentlichen, ersetzt es dieses Profil auf den Relays vollständig: alles andere darin, etwa Ihre Sprache oder Ihr Bild, wird entfernt.",
    "reg.signedWithSession": "Sie müssen Ihren Schlüssel nicht eingeben: MejmoSefajn signiert mit dem Schlüssel, mit dem Sie angemeldet sind.",

    // ── interest ──
    "interest.outcomeUnknown": "Es kam keine Antwort rechtzeitig zurück, daher ist es vielleicht durchgegangen. Prüfen Sie Ihr Interesse unten, bevor Sie erneut senden.",
  },
  hu: {
    // ── layout ──
    "layout.subtitle": "Balanced Exchange Framework",
    "nav.circle": "Saját kör",
    "nav.explorer": "Felfedezés",
    "nav.interest": "Érdeklődés",
    "nav.sell": "Eladás",

    // ── sell ──
    "sell.body": "A Lana.discount a saját kincstárába, saját tőkéjéből vásárol LANA-t, és minden ajánlatot külön mérlegel. Ezért az ajánlatot ott adod be, és ott döntenek róla, nem ebben az alkalmazásban.",
    "sell.cta": "Ajánlat beadása a lana.discount oldalon",
    "sell.title": "Az eladás a Lana.discount oldalon történik",

    // ── door ──
    "door.accountChanged": "A MejmoSefajn-fiókod megváltozott. Nyomd meg a Próbáld újra gombot, hogy azzal a fiókkal jelentkezz be a BEF Explorerbe, amellyel most be vagy jelentkezve.",
    "door.behind": "A MejmoSefajn le van maradva a BEF Explorerhez képest. Amíg a MejmoSefajnt nem frissítik, használd a befexplorer.com oldalt.",
    "door.generic": "Valami nincs rendben a MejmoSefajnban. Kérjük, jelezd (kód: {code}).",
    "door.keyUnreadable": "A MejmoSefajn nem tudja kiolvasni a kulcsodat a BEF Explorer számára. Jelentkezz ki, majd jelentkezz be újra.",
    "door.note": "A MejmoSefajn azzal a kulccsal jelentkeztet be a BEF Explorerbe, amellyel be vagy jelentkezve, így nem kell újra megadnod. A kulcsod ebben a böngészőben marad; csak egy aláírt üzenet megy el. A BEF Explorer a Lana Registrarnál ellenőrzi, hogy a pénztárca a kulcsodhoz tartozik-e, beolvassa a nyilvános profilodat (KIND 0), és megőrzi belőle a neved, az országod, az e-mail-címed és a telefonszámod másolatát. A bejelentkezés legfeljebb 8 óráig tart, és véget ér, amikor kijelentkezel.",
    "door.noteTitle": "Hogyan működik a bejelentkezés",
    "door.notRegistered": "A BEF Explorer szerint ez a pénztárca még nincs regisztrálva a Lana Registrarnál. Nyomd meg a Próbáld újra gombot, és megnyílik a regisztráció.",
    "door.openBef": "A befexplorer.com megnyitása",
    "door.openProfile": "A profilom megnyitása",
    "door.profileIncomplete": "A nyilvános profilodban nincs név, ezért a BEF Explorer nem tud bejelentkeztetni. Add meg a neved a profilodban, aztán nyomd meg a Próbáld újra gombot.",
    "door.signedInAs": "Bejelentkezve a BEF Explorerbe: {name} · {wallet}",
    "door.signingIn": "Bejelentkezés a BEF Explorerbe…",
    "door.tryAgain": "Próbáld újra",
    "door.unreachable": "A BEF Explorer nem érhető el. Ellenőrizd a kapcsolatot, és próbáld újra. Ha ez ismétlődik, lehet, hogy a BEF Explorer most nem fogad kéréseket ettől az alkalmazástól: a befexplorer.com oldalt közvetlenül is használhatod.",
    "door.wrongKey": "A Lana Registrar ezt a pénztárcát egy másik fiókhoz tartja nyilván, ezért a BEF Explorer nem tud vele bejelentkeztetni.",

    // ── registration ──
    "reg.replacesProfile": "Amikor bejelentkeztél, a MejmoSefajn talált egy nyilvános profilt ehhez a kulcshoz. Ha közzéteszed ezt az űrlapot, az a teljes profilt lecseréli a reléken: minden más, ami benne van, például a nyelved vagy a képed, eltűnik belőle.",
    "reg.signedWithSession": "Nem kell megadnod a kulcsodat: a MejmoSefajn azzal a kulccsal ír alá, amellyel be vagy jelentkezve.",

    // ── interest ──
    "interest.outcomeUnknown": "Nem érkezett időben válasz, így lehet, hogy elment. Mielőtt újra elküldöd, nézd meg lent az érdeklődésedet.",
  },
  it: {
    // ── layout ──
    "layout.subtitle": "Balanced Exchange Framework",
    "nav.circle": "La mia cerchia",
    "nav.explorer": "Esplora",
    "nav.interest": "Interesse",
    "nav.sell": "Vendi",

    // ── sell ──
    "sell.body": "Lana.discount acquista LANA per la propria tesoreria, con il proprio capitale, e valuta ogni proposta singolarmente. Un’offerta si presenta e si accetta quindi lì, non in questa app.",
    "sell.cta": "Presenta un’offerta su lana.discount",
    "sell.title": "La vendita avviene su Lana.discount",

    // ── door ──
    "door.accountChanged": "Il tuo account MejmoSefajn è cambiato. Premi Riprova per accedere a BEF Explorer con l’account con cui sei connesso ora.",
    "door.behind": "MejmoSefajn è rimasto indietro rispetto a BEF Explorer. Usa befexplorer.com finché MejmoSefajn non viene aggiornato.",
    "door.generic": "Qualcosa non va in MejmoSefajn. Per favore segnalalo (codice: {code}).",
    "door.keyUnreadable": "MejmoSefajn non riesce a leggere la tua chiave per BEF Explorer. Esci e accedi di nuovo.",
    "door.note": "MejmoSefajn ti fa accedere a BEF Explorer con la chiave con cui sei connesso, così non devi inserirla di nuovo. La chiave resta in questo browser; viene inviato solo un messaggio firmato. BEF Explorer verifica presso il Lana Registrar che il portafoglio appartenga alla tua chiave, legge il tuo profilo pubblico (KIND 0) e ne conserva una copia di nome, paese, e-mail e telefono. L’accesso dura al massimo 8 ore e termina quando esci.",
    "door.noteTitle": "Come funziona l’accesso",
    "door.notRegistered": "BEF Explorer indica che questo portafoglio non è ancora registrato presso il Lana Registrar. Premi Riprova per aprire la registrazione.",
    "door.openBef": "Apri befexplorer.com",
    "door.openProfile": "Apri il mio profilo",
    "door.profileIncomplete": "Il tuo profilo pubblico non ha un nome, quindi BEF Explorer non può farti accedere. Aggiungi il tuo nome al profilo, poi premi Riprova.",
    "door.signedInAs": "Connesso a BEF Explorer come {name} · {wallet}",
    "door.signingIn": "Accesso a BEF Explorer…",
    "door.tryAgain": "Riprova",
    "door.unreachable": "BEF Explorer non è raggiungibile. Controlla la connessione e riprova. Se succede ancora, forse BEF Explorer al momento non accetta richieste da questa app: puoi usare direttamente befexplorer.com.",
    "door.wrongKey": "Il Lana Registrar registra questo portafoglio sotto un altro account, quindi BEF Explorer non può farti accedere con esso.",

    // ── registration ──
    "reg.replacesProfile": "Quando hai effettuato l’accesso, MejmoSefajn ha trovato un profilo pubblico per questa chiave. Pubblicare questo modulo sostituisce per intero quel profilo sui relay: tutto il resto che contiene, come la lingua o l’immagine, viene rimosso.",
    "reg.signedWithSession": "Non devi inserire la chiave: MejmoSefajn firma con la chiave con cui sei connesso.",

    // ── interest ──
    "interest.outcomeUnknown": "Nessuna risposta è arrivata in tempo, quindi potrebbe essere andato a buon fine. Controlla il tuo interesse qui sotto prima di inviare di nuovo.",
  },
};

export default translations;
