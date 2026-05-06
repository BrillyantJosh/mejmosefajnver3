import { Card, CardContent } from '@/components/ui/card';
import { ExternalLink, Store } from 'lucide-react';
import { useTranslation } from '@/i18n/I18nContext';
import lanapaysTranslations, { LanaPaysKey } from '@/i18n/modules/lanapays';
import { PORTALS } from './portals';

export default function LanaPaysDiscover() {
  const { t, lang } = useTranslation(lanapaysTranslations);

  // SL users get ?lang=sl appended; everyone else gets the bare URL.
  const localizeUrl = (url: string): string => {
    if (lang !== 'sl') return url;
    return url.includes('?') ? `${url}&lang=sl` : `${url}?lang=sl`;
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl md:text-2xl font-bold">{t('offers.title')}</h2>
        <p className="text-sm text-muted-foreground mt-1">{t('offers.subtitle')}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {PORTALS.map((p, idx) => {
          const nameKey = `${p.prefix}.name` as LanaPaysKey;
          const descKey = `${p.prefix}.desc` as LanaPaysKey;
          const hostname = p.url.replace(/^https?:\/\//, '').replace(/\/$/, '');
          return (
            <a
              key={p.id}
              href={localizeUrl(p.url)}
              target="_blank"
              rel="noopener noreferrer"
              className="block group"
            >
              <Card className="h-full transition-all hover:border-primary/40 hover:shadow-md">
                <CardContent className="p-4 flex items-start gap-3">
                  <div className="flex-shrink-0 h-10 w-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center font-bold">
                    {idx + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <Store className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                      <h3 className="font-semibold text-sm truncate">{t(nameKey)}</h3>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{t(descKey)}</p>
                    <p className="text-[11px] text-primary mt-2 truncate font-mono">
                      {hostname}
                    </p>
                  </div>
                  <ExternalLink className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors flex-shrink-0" />
                </CardContent>
              </Card>
            </a>
          );
        })}
      </div>
    </div>
  );
}
