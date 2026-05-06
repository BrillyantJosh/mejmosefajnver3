import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Store, Tag, Smartphone, CreditCard } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/i18n/I18nContext';
import lanapaysTranslations from '@/i18n/modules/lanapays';

type InternalNav = { kind: 'internal'; path: string; icon: LucideIcon; label: string };
type ExternalNav = { kind: 'external'; url: string; icon: LucideIcon; label: string };
type NavItem = InternalNav | ExternalNav;

export default function LanaPaysLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { t, lang } = useTranslation(lanapaysTranslations);

  // SL users land on the localized version of each Lana subdomain.
  const localizeUrl = (url: string): string => {
    if (lang !== 'sl') return url;
    return url.includes('?') ? `${url}&lang=sl` : `${url}?lang=sl`;
  };

  const navItems: NavItem[] = [
    { kind: 'internal', path: '/lanapays',                       icon: Store,      label: t('nav.offers') },
    { kind: 'external', url:  'https://shop.lanapays.us',        icon: Tag,        label: t('nav.myOffers') },
    { kind: 'external', url:  'https://mobile.lanapays.us',      icon: Smartphone, label: t('nav.sell') },
    { kind: 'external', url:  'https://card.lanapays.us',        icon: CreditCard, label: t('nav.orderCards') },
  ];

  return (
    <div className="flex flex-col min-h-screen bg-background">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b">
        <div className="container px-3 md:px-4 py-3 md:py-4">
          <h1 className="text-2xl md:text-3xl font-bold">{t('header.title')}</h1>
          <p className="text-sm md:text-base text-muted-foreground mt-1">
            {t('header.subtitle')}
          </p>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 container px-3 md:px-4 py-4 md:py-6 pb-24">
        <Outlet />
      </div>

      {/* Bottom Navigation */}
      <div className="border-t bg-background sticky bottom-0">
        <div className="flex justify-around items-center h-16 max-w-screen-xl mx-auto px-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = item.kind === 'internal' && location.pathname === item.path;
            const key = item.kind === 'internal' ? item.path : item.url;
            return (
              <Button
                key={key}
                variant="ghost"
                onClick={() => {
                  if (item.kind === 'internal') {
                    navigate(item.path);
                  } else {
                    // External Lana subdomain — open in a new tab without an intermediate landing page
                    window.open(localizeUrl(item.url), '_blank', 'noopener,noreferrer');
                  }
                }}
                className={`flex flex-col items-center gap-1 h-auto py-2 px-2 sm:px-4 ${
                  isActive ? 'text-primary' : 'text-muted-foreground'
                }`}
              >
                <Icon className="h-5 w-5" />
                <span className="text-[10px] sm:text-xs">{item.label}</span>
              </Button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
