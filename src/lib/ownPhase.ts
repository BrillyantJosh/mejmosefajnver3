// Shared OWN ▲ phase label + colour helpers, mirroring selfresponsible.life's
// ownPhases. Bilingual: pass lang ('en' | 'sl'), default English.

export const PHASE_ORDER = ['opening', 'reflection', 'alignment', 'change', 'closing', 'resolution'] as const;

// The three phases a being assesses a participant against.
export const ASSESSED_PHASES = ['reflection', 'alignment', 'change'] as const;
export type AssessedPhase = typeof ASSESSED_PHASES[number];

const PHASE_LABELS: Record<'en' | 'sl', Record<string, string>> = {
  en: {
    opening: 'Opening',
    reflection: 'Reflection',
    alignment: 'Alignment',
    change: 'Change',
    closing: 'Closing',
    resolution: 'Resolution',
  },
  sl: {
    opening: 'Odpiranje',
    reflection: 'Refleksija',
    alignment: 'Uskladitev',
    change: 'Sprememba',
    closing: 'Zaključek',
    resolution: 'Razrešitev',
  },
};

export const getPhaseLabel = (phase: string, lang: 'en' | 'sl' = 'en'): string => {
  return PHASE_LABELS[lang]?.[phase] || PHASE_LABELS.en[phase] || phase || '—';
};

export const getPhaseColor = (phase: string): string => {
  const colors: Record<string, string> = {
    opening: 'bg-gray-500/10 text-gray-500 border-gray-500/20',
    reflection: 'bg-purple-500/10 text-purple-500 border-purple-500/20',
    alignment: 'bg-green-500/10 text-green-500 border-green-500/20',
    change: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
    closing: 'bg-gray-500/10 text-gray-500 border-gray-500/20',
    resolution: 'bg-green-500/10 text-green-500 border-green-500/20',
  };
  return colors[phase] || 'bg-muted text-muted-foreground';
};
