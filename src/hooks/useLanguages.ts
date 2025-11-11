import { useState, useEffect } from 'react';

export interface Language {
  code: string;
  name: string;
  nativeName: string;
}

export const useLanguages = () => {
  const [languages, setLanguages] = useState<Language[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchLanguages = async () => {
      try {
        // For now, use a static list. Replace with actual API call when endpoint is available
        const staticLanguages: Language[] = [
          { code: "en", name: "English", nativeName: "English" },
          { code: "sl", name: "Slovenian", nativeName: "Slovenščina" },
          { code: "es-419", name: "Spanish (LatAm)", nativeName: "Español (LatAm)" },
          { code: "de", name: "German", nativeName: "Deutsch" },
          { code: "fr", name: "French", nativeName: "Français" },
          { code: "it", name: "Italian", nativeName: "Italiano" },
          { code: "pt", name: "Portuguese", nativeName: "Português" },
          { code: "ru", name: "Russian", nativeName: "Русский" },
          { code: "ja", name: "Japanese", nativeName: "日本語" },
          { code: "zh", name: "Chinese", nativeName: "中文" },
        ];
        
        setLanguages(staticLanguages);
        setIsLoading(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch languages');
        setIsLoading(false);
      }
    };

    fetchLanguages();
  }, []);

  return { languages, isLoading, error };
};
