import { TranslationDict } from '../types';

/**
 * Shown instead of the app when a commission gross-violation decision stands.
 *
 * The words matter more than usual here: this is the only thing the person
 * sees, and it has to say what happened, why the door is closed, and exactly
 * what opens it again — without lecturing.
 */
const frozen = {
  'frozen.title': 'Your access is paused',
  'frozen.lead':
    'A commission of facilitators has recorded a gross violation, and while it stands your account and its contents are not accessible.',
  'frozen.reasonLabel': 'The stated ground',
  'frozen.noReason':
    'The reason could not be loaded right now. It is published with the decision and can be read again later.',
  'frozen.sinceLabel': 'In effect since',
  'frozen.indefinite': 'This decision has no end date.',

  'frozen.returnTitle': 'How can you come back?',
  'frozen.returnIntro':
    'Before asking to re-enter the community, we invite you to pause and answer four questions honestly for yourself:',
  'frozen.q1':
    'Why do I want to be here? What is my intention, and what do I want to co-create through my presence in the community?',
  'frozen.q2':
    'What am I creating through my behaviour? What effect do my actions, the way I communicate and my attitude towards others have on the people around me and on the community as a whole?',
  'frozen.q3':
    'Is what I am creating consistent with the reason I want to be here, and with the principles of the community?',
  'frozen.q4': 'If it is not, am I willing to change my behaviour?',

  'frozen.principlesA':
    'Lana8Wonder is a community founded on personal responsibility, freedom, respect, cooperation and conscious co-creation. Members take responsibility for their conduct, respect the freedom and boundaries of others, and act in ways consistent with the community’s principles even in situations of conflict.',
  'frozen.principlesB': 'We start from a simple principle:',
  'frozen.motto': 'Everyone is welcome. Not every behaviour is compatible with Lana8Wonder.',
  'frozen.principlesC':
    'So in Lana we do not expect perfection. We do expect a willingness to look at one’s own behaviour, to recognise what it creates, and to change it when it is not consistent with our intention and the principles of the community.',
  'frozen.principlesD':
    'Inner change is always voluntary. Participation in the community, however, is conditional on respecting its principles.',
  'frozen.principlesE':
    'If, after honest introspection, you feel that you want to be part of such a community and are ready to bring your conduct into line with these principles, you may ask to re-enter. A process of reintegration can then begin, and the next steps for restoring your participation in the community will be agreed.',

  'frozen.apply': 'Ask to re-enter',
  'frozen.applyIntro':
    'When you have answered the four questions for yourself, you can write your answers here. They are signed with your own key and encrypted so that only facilitators can read them — never the public.',
  'frozen.applyPrivacy': 'Only facilitators can read this. It is not published in the clear.',
  'frozen.applyShort': 'Write as much or as little as is true. Nothing here has a required length.',
  'frozen.submit': 'Sign and send',
  'frozen.submitting': 'Sending…',
  'frozen.sent': 'Your request has been sent.',
  'frozen.sentNote':
    'Facilitators can now read it. It does not lift the decision by itself — that takes three facilitator signatures — but it is the part that is yours to do.',
  'frozen.alreadySent': 'You sent a request on {date}. You may send another.',
  'frozen.sendFailed': 'The request could not be sent',
  'frozen.cancel': 'Not now',

  'frozen.back': 'Back to sign in',
};

export const frozenDict: TranslationDict<keyof typeof frozen> = {
  en: frozen,
  sl: {
    'frozen.title': 'Tvoj dostop je zaustavljen',
    'frozen.lead':
      'Komisija fasilitatorjev je zabeležila grobo kršitev. Dokler ta velja, tvoj račun in njegove vsebine niso dostopni.',
    'frozen.reasonLabel': 'Navedeni razlog',
    'frozen.noReason':
      'Razloga trenutno ni bilo mogoče naložiti. Objavljen je skupaj z odločitvijo in ga je mogoče prebrati pozneje.',
    'frozen.sinceLabel': 'Velja od',
    'frozen.indefinite': 'Ta odločitev nima roka.',

    'frozen.returnTitle': 'Kako lahko ponovno vstopiš?',
    'frozen.returnIntro':
      'Preden zaprosiš za ponovni vstop v skupnost, te vabimo, da se ustaviš in si iskreno odgovoriš na štiri temeljna vprašanja:',
    'frozen.q1':
      'Zakaj želim biti tukaj? Kaj je moj namen in kaj želim s svojo prisotnostjo v skupnosti soustvarjati?',
    'frozen.q2':
      'Kaj s svojim vedenjem ustvarjam? Kakšen vpliv imajo moja dejanja, način komunikacije in odnos do drugih na ljudi okoli mene in na skupnost kot celoto?',
    'frozen.q3':
      'Ali je to, kar ustvarjam, skladno z razlogom, zaradi katerega želim biti tukaj, ter z načeli skupnosti?',
    'frozen.q4': 'Če ni, ali sem pripravljen svoje vedenje spremeniti?',

    'frozen.principlesA':
      'Lana8Wonder je skupnost, ki temelji na osebni odgovornosti, svobodi, spoštovanju, sodelovanju in zavestnem soustvarjanju. Člani prevzemajo odgovornost za svoje ravnanje, spoštujejo svobodo in meje drugih ter tudi v konfliktnih situacijah ravnajo na način, ki je skladen z načeli skupnosti.',
    'frozen.principlesB': 'Pri tem izhajamo iz preprostega načela:',
    'frozen.motto': 'Vsakdo je dobrodošel. Ni pa vsako vedenje združljivo z Lano8Wonder.',
    'frozen.principlesC':
      'Zato v Lani ne pričakujemo popolnosti. Pričakujemo pa pripravljenost pogledati lastno vedenje, prepoznati, kaj z njim ustvarjamo, in ga spremeniti, kadar ni skladno z našim namenom in načeli skupnosti.',
    'frozen.principlesD':
      'Notranja sprememba je vedno prostovoljna. Sodelovanje v skupnosti pa je pogojeno s spoštovanjem njenih načel.',
    'frozen.principlesE':
      'Če po iskreni introspekciji začutiš, da želiš biti del takšne skupnosti in si pripravljen svoje ravnanje uskladiti s temi načeli, lahko zaprosiš za ponovni vstop. Takrat se lahko začne proces ponovne vključitve in določijo nadaljnji koraki za ponovno vzpostavitev sodelovanja v skupnosti.',

    'frozen.apply': 'Zaprosi za ponovni vstop',
    'frozen.applyIntro':
      'Ko si si na štiri vprašanja odgovoril zase, lahko odgovore zapišeš tukaj. Podpišeš jih s svojim ključem, šifrirani pa so tako, da jih lahko preberejo samo fasilitatorji — javnost nikoli.',
    'frozen.applyPrivacy': 'To lahko preberejo samo fasilitatorji. Ni objavljeno odprto.',
    'frozen.applyShort': 'Napiši toliko ali tako malo, kolikor je res. Nič tukaj nima predpisane dolžine.',
    'frozen.submit': 'Podpiši in pošlji',
    'frozen.submitting': 'Pošiljam…',
    'frozen.sent': 'Tvoja prošnja je poslana.',
    'frozen.sentNote':
      'Fasilitatorji jo lahko zdaj preberejo. Sama po sebi odločitve ne dvigne — za to so potrebni trije podpisi fasilitatorjev — je pa tisti del, ki je tvoj.',
    'frozen.alreadySent': 'Prošnjo si poslal {date}. Lahko pošlješ novo.',
    'frozen.sendFailed': 'Prošnje ni bilo mogoče poslati',
    'frozen.cancel': 'Ne zdaj',

    'frozen.back': 'Nazaj na prijavo',
  },
};

export default frozen;
