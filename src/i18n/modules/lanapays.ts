import { TranslationDict } from '../types';

const lanapays = {
  // ── Layout / Navigation ──
  'nav.offers': 'Offers',
  'nav.myOffers': 'My Offers',
  'nav.sell': 'Sell',
  'nav.orderCards': 'Order Cards',

  // ── Header ──
  'header.title': 'LanaPays.Us',
  'header.subtitle': 'Discover providers accepting LanaCoins',

  // ── Offers page ──
  'offers.title': 'Portals & Marketplaces',
  'offers.subtitle': 'Browse all Lana portals — click to visit.',
  'offers.openPortal': 'Open portal',

  // ── Portal names ──
  'portal.farm.name': 'Lana Producers',
  'portal.farm.desc': 'Farms and homemade food',
  'portal.shop.name': 'Lana Stores',
  'portal.shop.desc': 'General and specialty shops with mostly local products',
  'portal.restaurant.name': 'Lana Restaurants & Cafés',
  'portal.restaurant.desc': 'Food & Drink',
  'portal.beauty.name': 'Lana Beauty & Care',
  'portal.beauty.desc': 'Cosmetics, Health, Wellness',
  'portal.fashion.name': 'Lana Fashion',
  'portal.fashion.desc': 'Clothing, Footwear & Accessories',
  'portal.furniture.name': 'Lana Furniture',
  'portal.furniture.desc': 'Home & Furnishings',
  'portal.construction.name': 'Lana Construction',
  'portal.construction.desc': 'Materials & Services',
  'portal.kids.name': 'Lana Kids',
  'portal.kids.desc': 'Child-friendly products & services',
  'portal.pet.name': 'Lana Animals',
  'portal.pet.desc': 'Animal-friendly products & services',
  'portal.vacations.name': 'Lana Vacations',
  'portal.vacations.desc': 'Accommodation & Experiences',
  'portal.marketplace.name': 'Lana Second-hand Marketplace',
  'portal.marketplace.desc': 'A little of everything for everyone',
  'portal.events.name': 'Lana Events',
  'portal.events.desc': 'Events & Experiences',

  // ── My Offers page ──
  'myOffers.title': 'My Offers',
  'myOffers.subtitle': 'Manage your Lana shop offers.',
  'myOffers.cta': 'Open shop.lanapays.us',
  'myOffers.desc': 'Create, edit and manage your shop listings.',

  // ── Sell page ──
  'sell.title': 'Sell',
  'sell.subtitle': 'Use the mobile POS to accept LanaCoin payments.',
  'sell.cta': 'Open mobile.lanapays.us',
  'sell.desc': 'Mobile point-of-sale terminal for in-person sales.',

  // ── Order Cards page ──
  'orderCards.title': 'Order Cards',
  'orderCards.subtitle': 'Order physical Lana payment cards.',
  'orderCards.cta': 'Open card.lanapays.us',
  'orderCards.desc': 'Order printed Lana cards for your shop or customers.',
} as const;

export type LanaPaysKey = keyof typeof lanapays;

const translations: TranslationDict<LanaPaysKey> = {
  en: lanapays,

  sl: {
    // ── Layout / Navigation ──
    'nav.offers': 'Ponudbe',
    'nav.myOffers': 'Moje ponudbe',
    'nav.sell': 'Prodaja',
    'nav.orderCards': 'Naroči kartice',

    // ── Header ──
    'header.title': 'LanaPays.Us',
    'header.subtitle': 'Odkrijte ponudnike, ki sprejemajo LanaCoine',

    // ── Offers page ──
    'offers.title': 'Portali in tržnice',
    'offers.subtitle': 'Pregled vseh Lana portalov — klikni za obisk.',
    'offers.openPortal': 'Odpri portal',

    // ── Portal names ──
    'portal.farm.name': 'Lana Pridelovalci',
    'portal.farm.desc': 'Kmetije in domača hrana',
    'portal.shop.name': 'Lana Trgovine',
    'portal.shop.desc': 'Splošne in specializirane trgovine s pretežno lokalno ponudbo',
    'portal.restaurant.name': 'Lana Restavracije & Kavarne',
    'portal.restaurant.desc': 'Hrana & Pijača',
    'portal.beauty.name': 'Lana Lepota & Nega',
    'portal.beauty.desc': 'Kozmetika, Zdravje, Wellness',
    'portal.fashion.name': 'Lana Moda',
    'portal.fashion.desc': 'Oblačila, Obutev & Modni dodatki',
    'portal.furniture.name': 'Lana Pohištvo',
    'portal.furniture.desc': 'Dom & Oprema',
    'portal.construction.name': 'Lana Gradnja',
    'portal.construction.desc': 'Materiali & Storitve',
    'portal.kids.name': 'Lana Otroci',
    'portal.kids.desc': 'Otrokom prijazni Izdelki & Storitve',
    'portal.pet.name': 'Lana Živali',
    'portal.pet.desc': 'Živalim prijazni Izdelki & Storitve',
    'portal.vacations.name': 'Lana Počitnice',
    'portal.vacations.desc': 'Nastanitve & Doživetja',
    'portal.marketplace.name': 'Lana Tržnica rabljenih izdelkov',
    'portal.marketplace.desc': 'Vsega po malo za vse',
    'portal.events.name': 'Lana Events',
    'portal.events.desc': 'Dogodki & Doživetja',

    // ── My Offers page ──
    'myOffers.title': 'Moje ponudbe',
    'myOffers.subtitle': 'Upravljaj svoje ponudbe v Lana trgovini.',
    'myOffers.cta': 'Odpri shop.lanapays.us',
    'myOffers.desc': 'Ustvari, uredi in upravljaj svoje trgovinske ponudbe.',

    // ── Sell page ──
    'sell.title': 'Prodaja',
    'sell.subtitle': 'Uporabljaj mobilno blagajno za sprejemanje LanaCoinov.',
    'sell.cta': 'Odpri mobile.lanapays.us',
    'sell.desc': 'Mobilna blagajna za fizično prodajo.',

    // ── Order Cards page ──
    'orderCards.title': 'Naroči kartice',
    'orderCards.subtitle': 'Naroči fizične Lana plačilne kartice.',
    'orderCards.cta': 'Odpri card.lanapays.us',
    'orderCards.desc': 'Naroči tiskane Lana kartice za svojo trgovino ali stranke.',
  },
};

export default translations;
