import type { LanaPaysKey } from '@/i18n/modules/lanapays';

export interface Portal {
  id: string;
  url: string;
  /** Translation key prefix — `${prefix}.name` and `${prefix}.desc` must exist. */
  i18nPrefix: Extract<LanaPaysKey, `portal.${string}.name`> extends `portal.${infer K}.name` ? K : never;
}

export const PORTALS: ReadonlyArray<{
  id: string;
  url: string;
  // i18n key prefix (e.g. "portal.farm")
  prefix: string;
}> = [
  { id: 'farm',         url: 'https://lanaeco.farm',     prefix: 'portal.farm' },
  { id: 'shop',         url: 'https://lanaeco.shop',     prefix: 'portal.shop' },
  { id: 'restaurant',   url: 'https://lana.restaurant',  prefix: 'portal.restaurant' },
  { id: 'beauty',       url: 'https://lanabeauty.care',  prefix: 'portal.beauty' },
  { id: 'fashion',      url: 'https://lana.fashion',     prefix: 'portal.fashion' },
  { id: 'furniture',    url: 'https://lana.furniture',   prefix: 'portal.furniture' },
  { id: 'construction', url: 'https://lana.construction', prefix: 'portal.construction' },
  { id: 'kids',         url: 'https://lana.kids',        prefix: 'portal.kids' },
  { id: 'pet',          url: 'https://lana.pet',         prefix: 'portal.pet' },
  { id: 'vacations',    url: 'https://lana.vacations',   prefix: 'portal.vacations' },
  { id: 'marketplace',  url: 'https://lanamarket.place',             prefix: 'portal.marketplace' },
] as const;
