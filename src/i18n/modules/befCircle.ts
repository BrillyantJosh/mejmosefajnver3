import { SUPPORTED_LANGS, TranslationDict } from '../types';
import befText, { type BefTextKey } from './befText';

// MejmoSefajn's own words for the BEF module's My Circle page — only where BEF
// Explorer's own texts (./befVendor.ts) do not fit this app: the key field's
// buttons and scanner (BEF's are in its own key field), a private key typed where
// a card's public id goes, the answers that name what was added and removed, and
// BEF's lines that tell a person to sign out of BEF or claim a key is erased.
// Everything else on the page is BEF's text or the module's (./bef.ts), through
// ./befText.ts.
// English is the required base (fallback); every language mirrors every key.
const befCircle = {
  // ── adding a card ──
  "circle.add.hide": "Hide",
  "circle.add.hideLabel": "Hide what was typed",
  "circle.add.keyNote": "A typed hex id is public: it goes on your list only when a public profile (KIND 0) exists for it, and you see the name first. A card’s private key is read only in this browser, to work out the card’s public id, and the field is emptied at once. The key is not sent, not stored and signs nothing. If you pasted it, clear your clipboard; if you read it from a photo, delete the photo.",
  "circle.add.scan": "Scan QR code",
  "circle.add.show": "Show",
  "circle.add.showLabel": "Show what is typed",
  "circle.scan.description": "Hold the QR code of the card’s private key inside the frame. Only the card’s public id is used.",
  "circle.scan.title": "Scan a card",

  // ── a private key where a public id goes ──
  "circle.checkFailed": "It could not be checked right now whether this is someone’s private key, so nothing was added. Type or scan it again in a moment.",
  "circle.ownPrivateKey": "These 64 characters are your own private key, not a card’s id. They were not sent anywhere. Never share your private key: whoever has it can use your wallet.",
  "circle.privateKey": "These 64 characters are a private key, not a public id. They were not sent anywhere and do not go on your list, which is public. To add this card, scan its QR code or type the person’s public id.",

  // ── the list ──
  "circle.listedAsCard": "The key you are logged in with is itself on someone’s list as a card they brought. If you meant to add a card, log out of MejmoSefajn and log in with your own Main Wallet key.",
  "circle.pending.count": "Changes not published yet: {count}.",
  "circle.published": "Published: {accepted} of {total} relays took your list. Added: {added}. Removed: {removed}.",
  "circle.refusedIds": "Taken off your changes:",
  "circle.relayWritesOff": "Sending to the relays is switched off on BEF Explorer right now. Nothing was published; your changes are kept.",
  "circle.remove.title": "Remove cards from your list?",
} as const;

export type BefCircleKey = keyof typeof befCircle;

const own: TranslationDict<BefCircleKey> = {
  en: befCircle,
  sl: {
    // ── adding a card ──
    "circle.add.hide": "Skrij",
    "circle.add.hideLabel": "Skrij vpisano",
    "circle.add.keyNote": "Vpisan hex id je javen: na seznam gre samo, če zanj obstaja javni profil (KIND 0), ime pa vidiš že prej. Zasebni ključ kartice se prebere samo v tem brskalniku, da se izračuna javni ID kartice, polje pa se takoj izprazni. Ključ se ne pošlje, ne shrani in z njim se ničesar ne podpiše. Če si ga prilepil, izprazni odložišče; če si ga prebral s fotografije, fotografijo izbriši.",
    "circle.add.scan": "Skeniraj kodo QR",
    "circle.add.show": "Pokaži",
    "circle.add.showLabel": "Pokaži vpisano",
    "circle.scan.description": "Kodo QR zasebnega ključa kartice drži v okvirju. Uporabi se samo javni ID kartice.",
    "circle.scan.title": "Skeniraj kartico",

    // ── a private key where a public id goes ──
    "circle.checkFailed": "Trenutno ni bilo mogoče preveriti, ali je to zasebni ključ nekoga, zato ni bilo nič dodano. Čez trenutek ga znova vpiši ali skeniraj.",
    "circle.ownPrivateKey": "Teh 64 znakov je tvoj lastni zasebni ključ, ne ID kartice. Nikamor niso bili poslani. Svojega zasebnega ključa nikoli ne deli: kdor ga ima, lahko uporablja tvojo denarnico.",
    "circle.privateKey": "Teh 64 znakov je zasebni ključ, ne javni ID. Nikamor niso bili poslani in ne gredo na tvoj seznam, ki je javen. Če želiš dodati to kartico, skeniraj njeno kodo QR ali vpiši javni ID osebe.",

    // ── the list ──
    "circle.listedAsCard": "Ključ, s katerim si prijavljen, je sam na nekem seznamu kot kartica, ki jo je nekdo pripeljal. Če si hotel dodati kartico, se odjavi iz MejmoSefajn in se prijavi s ključem svoje lastne glavne denarnice.",
    "circle.pending.count": "Neobjavljene spremembe: {count}.",
    "circle.published": "Objavljeno: tvoj seznam je sprejelo {accepted} od {total} relejev. Dodanih: {added}. Odstranjenih: {removed}.",
    "circle.refusedIds": "Umaknjene iz tvojih sprememb:",
    "circle.relayWritesOff": "Pošiljanje na releje je na BEF Explorerju trenutno izklopljeno. Nič ni bilo objavljeno; tvoje spremembe so ohranjene.",
    "circle.remove.title": "Odstraniš kartice s seznama?",
  },
  de: {
    // ── adding a card ──
    "circle.add.hide": "Verbergen",
    "circle.add.hideLabel": "Eingabe verbergen",
    "circle.add.keyNote": "Eine eingegebene Hex-ID ist öffentlich: Sie kommt nur auf Ihre Liste, wenn dazu ein öffentliches Profil (KIND 0) existiert, und Sie sehen den Namen vorher. Der private Schlüssel einer Karte wird nur in diesem Browser gelesen, um die öffentliche ID der Karte zu ermitteln, und das Feld wird sofort geleert. Der Schlüssel wird nicht gesendet, nicht gespeichert und signiert nichts. Haben Sie ihn eingefügt, leeren Sie Ihre Zwischenablage; haben Sie ihn von einem Foto abgelesen, löschen Sie das Foto.",
    "circle.add.scan": "QR-Code scannen",
    "circle.add.show": "Anzeigen",
    "circle.add.showLabel": "Eingabe anzeigen",
    "circle.scan.description": "Halten Sie den QR-Code des privaten Schlüssels der Karte in den Rahmen. Verwendet wird nur die öffentliche ID der Karte.",
    "circle.scan.title": "Karte scannen",

    // ── a private key where a public id goes ──
    "circle.checkFailed": "Es konnte gerade nicht geprüft werden, ob das der private Schlüssel einer Person ist, daher wurde nichts hinzugefügt. Geben Sie es gleich noch einmal ein oder scannen Sie es erneut.",
    "circle.ownPrivateKey": "Diese 64 Zeichen sind Ihr eigener privater Schlüssel, keine Karten-ID. Sie wurden nirgendwohin gesendet. Geben Sie Ihren privaten Schlüssel nie weiter: Wer ihn hat, kann Ihre Wallet verwenden.",
    "circle.privateKey": "Diese 64 Zeichen sind ein privater Schlüssel, keine öffentliche ID. Sie wurden nirgendwohin gesendet und kommen nicht auf Ihre Liste, die öffentlich ist. Um diese Karte hinzuzufügen, scannen Sie ihren QR-Code oder geben Sie die öffentliche ID der Person ein.",

    // ── the list ──
    "circle.listedAsCard": "Der Schlüssel, mit dem Sie angemeldet sind, steht selbst als mitgebrachte Karte auf der Liste einer anderen Person. Wollten Sie eine Karte hinzufügen, melden Sie sich bei MejmoSefajn ab und mit dem Schlüssel Ihrer eigenen Haupt-Wallet wieder an.",
    "circle.pending.count": "Noch nicht veröffentlichte Änderungen: {count}.",
    "circle.published": "Veröffentlicht: {accepted} von {total} Relays haben Ihre Liste angenommen. Hinzugefügt: {added}. Entfernt: {removed}.",
    "circle.refusedIds": "Aus Ihren Änderungen entfernt:",
    "circle.relayWritesOff": "Das Senden an die Relays ist bei BEF Explorer gerade abgeschaltet. Es wurde nichts veröffentlicht; Ihre Änderungen bleiben erhalten.",
    "circle.remove.title": "Karten von Ihrer Liste entfernen?",
  },
  hu: {
    // ── adding a card ──
    "circle.add.hide": "Elrejtés",
    "circle.add.hideLabel": "A beírt szöveg elrejtése",
    "circle.add.keyNote": "A beírt hex azonosító nyilvános: csak akkor kerül a listádra, ha létezik hozzá nyilvános profil (KIND 0), és előbb látod a nevet. A kártya privát kulcsát csak ez a böngésző olvassa be, hogy kiszámolja belőle a kártya nyilvános azonosítóját, a mező pedig azonnal kiürül. A kulcs nem megy el sehova, nem tárolódik, és semmit nem ír alá. Ha bemásoltad, ürítsd ki a vágólapot; ha fényképről olvastad le, töröld a fényképet.",
    "circle.add.scan": "QR-kód beolvasása",
    "circle.add.show": "Megjelenítés",
    "circle.add.showLabel": "A beírt szöveg megjelenítése",
    "circle.scan.description": "Tartsd a kártya privát kulcsának QR-kódját a keretben. Csak a kártya nyilvános azonosítóját használjuk.",
    "circle.scan.title": "Kártya beolvasása",

    // ── a private key where a public id goes ──
    "circle.checkFailed": "Most nem sikerült ellenőrizni, hogy ez valakinek a privát kulcsa-e, ezért semmi nem került fel. Egy kis idő múlva írd be vagy olvasd be újra.",
    "circle.ownPrivateKey": "Ez a 64 karakter a saját privát kulcsod, nem egy kártya azonosítója. Nem ment el sehova. Soha ne add ki a privát kulcsodat: aki ismeri, használhatja a pénztárcádat.",
    "circle.privateKey": "Ez a 64 karakter egy privát kulcs, nem nyilvános azonosító. Nem ment el sehova, és nem kerül a listádra, amely nyilvános. A kártya hozzáadásához olvasd be a QR-kódját, vagy írd be az illető nyilvános azonosítóját.",

    // ── the list ──
    "circle.listedAsCard": "A kulcs, amellyel be vagy jelentkezve, maga is szerepel valakinek a listáján, mint általa hozott kártya. Ha kártyát akartál hozzáadni, jelentkezz ki a MejmoSefajnból, és lépj be a saját fő pénztárcád kulcsával.",
    "circle.pending.count": "Még nem közzétett változások: {count}.",
    "circle.published": "Közzétéve: {total} reléből {accepted} fogadta el a listádat. Hozzáadva: {added}. Eltávolítva: {removed}.",
    "circle.refusedIds": "Kivéve a változásaid közül:",
    "circle.relayWritesOff": "A relékre küldés a BEF Exploreren most ki van kapcsolva. Semmi nem lett közzétéve; a változásaid megmaradnak.",
    "circle.remove.title": "Eltávolítod a kártyákat a listádról?",
  },
  it: {
    // ── adding a card ──
    "circle.add.hide": "Nascondi",
    "circle.add.hideLabel": "Nascondi il testo inserito",
    "circle.add.keyNote": "Un ID esadecimale digitato è pubblico: entra nel tuo elenco solo se esiste un profilo pubblico (KIND 0) e prima ne vedi il nome. La chiave privata di una carta viene letta solo in questo browser, per ricavare l’ID pubblico della carta, e il campo viene svuotato subito. La chiave non viene inviata, non viene conservata e non firma nulla. Se l’hai incollata, svuota gli appunti; se l’hai letta da una foto, elimina la foto.",
    "circle.add.scan": "Scansiona il codice QR",
    "circle.add.show": "Mostra",
    "circle.add.showLabel": "Mostra il testo inserito",
    "circle.scan.description": "Tieni il codice QR della chiave privata della carta dentro la cornice. Si usa solo l’ID pubblico della carta.",
    "circle.scan.title": "Scansiona una carta",

    // ── a private key where a public id goes ──
    "circle.checkFailed": "Al momento non è stato possibile verificare se si tratta della chiave privata di qualcuno, quindi non è stato aggiunto nulla. Inseriscila o scansionala di nuovo tra poco.",
    "circle.ownPrivateKey": "Questi 64 caratteri sono la tua chiave privata, non l’ID di una carta. Non sono stati inviati da nessuna parte. Non condividere mai la tua chiave privata: chi la possiede può usare il tuo portafoglio.",
    "circle.privateKey": "Questi 64 caratteri sono una chiave privata, non un ID pubblico. Non sono stati inviati da nessuna parte e non entrano nel tuo elenco, che è pubblico. Per aggiungere questa carta, scansiona il suo codice QR o digita l’ID pubblico della persona.",

    // ── the list ──
    "circle.listedAsCard": "La chiave con cui sei connesso è a sua volta nell’elenco di qualcuno, come carta che ha portato. Se volevi aggiungere una carta, esci da MejmoSefajn e accedi con la chiave del tuo portafoglio principale.",
    "circle.pending.count": "Modifiche non ancora pubblicate: {count}.",
    "circle.published": "Pubblicato: {accepted} relay su {total} hanno accettato il tuo elenco. Aggiunte: {added}. Rimosse: {removed}.",
    "circle.refusedIds": "Tolte dalle tue modifiche:",
    "circle.relayWritesOff": "L’invio ai relay è disattivato su BEF Explorer in questo momento. Non è stato pubblicato nulla; le tue modifiche restano.",
    "circle.remove.title": "Rimuovere carte dal tuo elenco?",
  },
};

/** The My Circle page reads one dictionary: the module's (BEF's and MejmoSefajn's) and these. */
export type BefCircleTextKey = BefTextKey | BefCircleKey;

const befCircleText = { en: { ...befText.en, ...own.en } } as TranslationDict<BefCircleTextKey>;

for (const lang of SUPPORTED_LANGS) {
  if (lang === 'en') continue;
  const moduleWords = befText[lang];
  const pageWords = own[lang];
  if (moduleWords || pageWords) befCircleText[lang] = { ...moduleWords, ...pageWords } as Record<BefCircleTextKey, string>;
}

export { own as befCircleTranslations };
export default befCircleText;
