import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { Users, MessageSquare, Wallet as WalletIcon, Coins, ShoppingCart, Store, FileText, FileKey, Radio, Sparkles, CreditCard, Shield, Heart, Music, Search, HandHeart, CheckCircle, Lightbulb } from 'lucide-react';
import { ModuleConfig, ModuleType } from '@/types/modules';
import { SimplePool, Event, finalizeEvent } from 'nostr-tools';
import { nip19 } from 'nostr-tools';
import { useSystemParameters } from './SystemParametersContext';
import { useAuth } from './AuthContext';
import { toast } from 'sonner';
import sellLanaImage from '@/assets/selllana-module.png';
import buyLanaImage from '@/assets/buylana-module.png';
import marketplaceImage from '@/assets/marketplace-hero.png';
import lana8wonderImage from '@/assets/lana8wonder-icon.png';
import lanapaysImage from '@/assets/lanapays-module.png';
import chatImage from '@/assets/chat-module.png';
import socialImage from '@/assets/social-module.png';
import walletImage from '@/assets/wallet-module.png';
import lashImage from '@/assets/lash-module.png';
import relaysImage from '@/assets/relays-module.png';
import lanapaperImage from '@/assets/lanapaper-module.png';
import offlinelanaImage from '@/assets/offlinelana-module.png';
import lanapayImage from '@/assets/lanapay-module.png';
import transparencyImage from '@/assets/transparency-module.png';

const DEFAULT_MODULES: ModuleConfig[] = [
  {
    id: 'lanapays',
    title: 'LanaPays.Us',
    description: 'Discover merchants accepting LanaCoins payments',
    icon: CreditCard,
    path: '/lanapays',
    gradient: 'from-emerald-500 to-teal-500',
    image: lanapaysImage,
    enabled: true,
    order: 0
  },
  {
    id: 'social',
    title: 'Social',
    description: 'Connect with the Nostr community, post and communicate',
    icon: Users,
    path: '/social',
    gradient: 'from-blue-500 to-cyan-500',
    image: socialImage,
    enabled: true,
    order: 1
  },
  {
    id: 'chat',
    title: 'Chat',
    description: 'Private conversations via Nostr DM protocol',
    icon: MessageSquare,
    path: '/chat',
    gradient: 'from-green-500 to-emerald-500',
    image: chatImage,
    enabled: true,
    order: 2
  },
  {
    id: 'wallet',
    title: 'Wallet',
    description: 'Manage your Lightning wallet and transactions',
    icon: WalletIcon,
    path: '/wallet',
    gradient: 'from-orange-500 to-red-500',
    image: walletImage,
    enabled: true,
    order: 3
  },
  {
    id: 'unconditionalpayment',
    title: 'Unconditional Payment',
    description: 'Send unconditional payments to projects and initiatives in the Lana ecosystem',
    icon: HandHeart,
    path: '/unconditional-payment',
    gradient: 'from-rose-500 to-pink-500',
    enabled: true,
    order: 4
  },
  {
    id: 'selllana',
    title: 'SellLana',
    description: 'Here you can see and Sell Your Lanas for FIAT (Peer2Peer)',
    icon: Coins,
    path: '/sell-lana',
    gradient: 'from-yellow-500 to-amber-500',
    image: sellLanaImage,
    enabled: false,
    order: 5
  },
  {
    id: 'buylana',
    title: 'BuyLana',
    description: 'Here you can BUY Lana for FIAT (peer2peer)',
    icon: ShoppingCart,
    path: '/buy-lana',
    gradient: 'from-purple-500 to-pink-500',
    image: buyLanaImage,
    enabled: true,
    order: 6
  },
  {
    id: 'marketplace',
    title: 'Marketplace',
    description: 'Buy and sell goods and services with LanaCoins',
    icon: Store,
    path: '/marketplace',
    gradient: 'from-indigo-500 to-violet-500',
    image: marketplaceImage,
    imagePosition: 'object-[70%_20%]',
    enabled: false,
    order: 7
  },
  {
    id: 'lanapaper',
    title: 'Lana Paper',
    description: 'Create a paper wallet from your existing wallets, including your NOSTR ID.',
    icon: FileText,
    path: '/lana-paper',
    gradient: 'from-teal-500 to-cyan-500',
    image: lanapaperImage,
    externalUrl: 'https://www.LanaPaper.online',
    enabled: false,
    order: 8
  },
  {
    id: 'offlinelana',
    title: 'Generate New Wallets',
    description: 'You can generate a new single-account wallet offline.',
    icon: FileKey,
    path: '/offline-lana',
    gradient: 'from-slate-500 to-zinc-500',
    image: offlinelanaImage,
    externalUrl: 'https://offlinelana.org',
    enabled: false,
    order: 9
  },
  {
    id: 'relays',
    title: 'Relays',
    description: 'Manage Nostr relays and view your events',
    icon: Radio,
    path: '/relays',
    gradient: 'from-rose-500 to-pink-500',
    image: relaysImage,
    enabled: false,
    order: 10
  },
  {
    id: 'lana8wonder',
    title: 'Lana8Wonder',
    description: 'View your annuity plan and eligibility status',
    icon: Sparkles,
    path: '/lana8wonder',
    gradient: 'from-violet-500 to-purple-500',
    image: lana8wonderImage,
    enabled: true,
    order: 11
  },
  {
    id: 'lanapay',
    title: 'Lana Pay',
    description: 'Transfer <strong>registered</strong> or unregistered LanaCoins',
    icon: Shield,
    path: '/lanapay',
    gradient: 'from-cyan-500 to-blue-500',
    image: lanapayImage,
    externalUrl: 'https://lanapay.online',
    enabled: false,
    order: 12
  },
  {
    id: 'lash',
    title: 'LASH',
    description: 'Send and receive LANA payments',
    icon: Heart,
    path: '/lash/pay',
    gradient: 'from-red-500 to-rose-500',
    image: lashImage,
    enabled: true,
    order: 13
  },
  {
    id: 'lanamusic',
    title: 'Lana Music',
    description: 'Listen to LanaKnights.eu radio, songs, and albums',
    icon: Music,
    path: '/music',
    gradient: 'from-pink-500 to-purple-500',
    enabled: false,
    order: 14
  },
  {
    id: 'lanatransparency',
    title: 'Lana Transparency',
    description: 'View Nostr profiles and wallet transparency information',
    icon: Search,
    path: '/transparency',
    gradient: 'from-sky-500 to-blue-500',
    image: transparencyImage,
    enabled: true,
    order: 15
  },
  {
    id: 'own',
    title: 'OWN',
    description: 'Unconditional Self Responsibility - manage your cases and responsibilities',
    icon: Shield,
    path: '/own',
    gradient: 'from-indigo-500 to-purple-500',
    enabled: true,
    order: 16
  },
  {
    id: 'rock',
    title: 'ROCK',
    description: 'I know this person - Give and receive endorsements to build a web of trust',
    icon: CheckCircle,
    path: '/rock',
    gradient: 'from-green-500 to-emerald-500',
    enabled: true,
    order: 17
  },
  {
    id: 'unregisteredwallets',
    title: 'Unregistered Wallets',
    description: 'View self-declared lists of unregistered LanaCoin wallets',
    icon: WalletIcon,
    path: '/unregistered-wallets',
    gradient: 'from-amber-500 to-orange-500',
    enabled: false,
    order: 18
  },
  {
    id: '100millionideas',
    title: '100 Million Ideas',
    description: 'Browse innovative projects and track your donations',
    icon: Lightbulb,
    path: '/100millionideas/projects',
    gradient: 'from-yellow-500 to-orange-500',
    enabled: true,
    order: 19
  }
];

interface RelayPublishResult {
  relay: string;
  success: boolean;
  error?: string;
}

interface ModulesContextType {
  modules: ModuleConfig[];
  isLoading: boolean;
  hasUnsavedChanges: boolean;
  publishResults: RelayPublishResult[] | null;
  isPublishing: boolean;
  toggleModule: (moduleId: ModuleType) => void;
  reorderModules: (newOrder: ModuleConfig[]) => void;
  resetToDefaults: () => void;
  getEnabledModules: () => ModuleConfig[];
  saveSettings: () => Promise<void>;
  loadSettingsFromNostr: () => Promise<void>;
}

const ModulesContext = createContext<ModulesContextType | undefined>(undefined);

const STORAGE_KEY = 'nostr_user_modules';
const SETTINGS_D_TAG = 'app:settings:global:v1';

// Map lowercase IDs to capitalized for Nostr
const mapToNostrId = (id: ModuleType): string => {
  const mapping: Record<ModuleType, string> = {
    'social': 'Social',
    'chat': 'Chat',
    'wallet': 'Wallet',
    'unconditionalpayment': 'Unconditional Payment',
    'selllana': 'SellLana',
    'buylana': 'BuyLana',
    'marketplace': 'Marketplace',
    'lanapaper': 'LanaPaper',
    'offlinelana': 'OfflineLana',
    'relays': 'Relays',
    'lana8wonder': 'Lana8Wonder',
    'lanapays': 'LanaPays',
    'lanapay': 'Lana Pay',
    'lash': 'LASH',
    'lanamusic': 'Lana Music',
    'lanatransparency': 'Lana Transparency',
    'own': 'OWN',
    'rock': 'ROCK',
    'unregisteredwallets': 'Unregistered Wallets',
    '100millionideas': '100 Million Ideas'
  };
  return mapping[id] || id;
};

// Map capitalized Nostr IDs back to lowercase
const mapFromNostrId = (id: string): ModuleType | null => {
  const mapping: Record<string, ModuleType> = {
    'Social': 'social',
    'Chat': 'chat',
    'Wallet': 'wallet',
    'Unconditional Payment': 'unconditionalpayment',
    'SellLana': 'selllana',
    'BuyLana': 'buylana',
    'Marketplace': 'marketplace',
    'LanaPaper': 'lanapaper',
    'OfflineLana': 'offlinelana',
    'Relays': 'relays',
    'Lana8Wonder': 'lana8wonder',
    'LanaPays': 'lanapays',
    'Lana Pay': 'lanapay',
    'LASH': 'lash',
    'Lana Music': 'lanamusic',
    'Lana Transparency': 'lanatransparency',
    'OWN': 'own',
    'ROCK': 'rock',
    'Unregistered Wallets': 'unregisteredwallets',
    '100 Million Ideas': '100millionideas'
  };
  return mapping[id] || null;
};

export function ModulesProvider({ children }: { children: ReactNode }) {
  const { parameters } = useSystemParameters();
  const { session } = useAuth();
  const [modules, setModules] = useState<ModuleConfig[]>(DEFAULT_MODULES);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [publishResults, setPublishResults] = useState<RelayPublishResult[] | null>(null);
  const [isPublishing, setIsPublishing] = useState(false);

  // Get private key in hex format
  const getPrivateKeyBytes = (): Uint8Array | null => {
    if (!session?.nostrPrivateKey) return null;
    try {
      // Session already stores hex format, convert directly to Uint8Array
      const hexKey = session.nostrPrivateKey;
      return new Uint8Array(hexKey.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
    } catch (error) {
      console.error('Failed to convert private key:', error);
      return null;
    }
  };

  const publicKey = session?.nostrHexId;
  const privateKeyBytes = getPrivateKeyBytes();

  // Load settings from Nostr
  const loadSettingsFromNostr = async () => {
    if (!publicKey || !parameters?.relays) {
      console.warn('⚠️ Cannot load settings: missing publicKey or relays');
      return;
    }

    const pool = new SimplePool();
    try {
      console.log('📥 Fetching KIND 37334 settings from relays...');

      const event = await Promise.race([
        pool.get(parameters.relays, {
          kinds: [37334],
          authors: [publicKey],
          '#d': [SETTINGS_D_TAG],
          limit: 1
        }),
        new Promise<Event | null>((_, reject) => 
          setTimeout(() => reject(new Error('Timeout')), 5000)
        )
      ]) as Event | null;

      if (event) {
        console.log('✅ KIND 37334 event received:', event);
        
        const content = JSON.parse(event.content);
        const nostrModules = content.modules;

        // Merge with DEFAULT_MODULES to restore icon components
        const updatedModules = DEFAULT_MODULES.map(defaultMod => {
          const nostrId = mapToNostrId(defaultMod.id);
          const nostrMod = nostrModules.find((m: any) => m.id === nostrId);
          
          if (nostrMod) {
            return {
              ...defaultMod,
              enabled: nostrMod.enabled,
              order: nostrMod.order
            };
          }
          return defaultMod;
        });

        setModules(updatedModules);
        console.log('✅ Settings loaded from Nostr');
      } else {
        console.log('ℹ️ No existing settings found, using defaults');
      }
    } catch (error) {
      console.warn('⚠️ Failed to fetch settings from Nostr:', error);
    } finally {
      pool.close(parameters.relays);
    }
  };

  // Fetch settings from Nostr on mount
  useEffect(() => {
    if (!publicKey || !parameters?.relays || isInitialized) return;

    const fetchSettings = async () => {
      setIsLoading(true);
      await loadSettingsFromNostr();
      setIsInitialized(true);
      setIsLoading(false);
    };

    fetchSettings();
  }, [publicKey, parameters?.relays, isInitialized]);

  // Load settings when user logs in
  useEffect(() => {
    if (!session || !isInitialized) return;
    
    // When session changes (user logs in), reload settings from Nostr
    console.log('🔄 Session detected, loading settings from Nostr...');
    loadSettingsFromNostr();
  }, [session?.nostrHexId]);

  const saveSettings = async () => {
    if (!privateKeyBytes || !publicKey || !parameters?.relays) {
      toast.error('Cannot save: missing authentication or relays');
      return;
    }

    setIsPublishing(true);
    setPublishResults(null);

    const pool = new SimplePool();
    const results: RelayPublishResult[] = [];
    
    try {
      console.log('📤 Publishing settings to Nostr...');

      const nostrModules = modules.map(mod => ({
        id: mapToNostrId(mod.id),
        enabled: mod.enabled,
        order: mod.order,
        config: {}
      }));

      const content = JSON.stringify({
        modules: nostrModules,
        layout: {
          style: 'tabs',
          show_labels: true,
          compact: false
        }
      });

      const eventTemplate = {
        kind: 37334,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['d', SETTINGS_D_TAG],
          ['scope', 'global'],
          ['schema', 'app.settings', '1'],
          ['app', 'lana.app']
        ],
        content,
        pubkey: publicKey
      };

      const signedEvent = finalizeEvent(eventTemplate, privateKeyBytes);
      
      console.log('📤 Event signed:', {
        id: signedEvent.id,
        kind: signedEvent.kind,
        pubkey: signedEvent.pubkey
      });

      // Publish to each relay with timeout handling
      const publishPromises = parameters.relays.map(async (relay: string) => {
        console.log(`🔄 Connecting to ${relay}...`);
        
        return new Promise<void>((resolve) => {
          // Outer timeout: 10s - guards against relay never responding
          const timeout = setTimeout(() => {
            results.push({ 
              relay, 
              success: false, 
              error: 'Connection timeout (10s)' 
            });
            console.error(`❌ ${relay}: Timeout`);
            resolve();
          }, 10000);

          try {
            // Publish to single relay
            const pubs = pool.publish([relay], signedEvent);
            
            // Inner timeout: 8s - guards against publish promise hanging
            Promise.race([
              Promise.all(pubs), // Wait for relay confirmation
              new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Publish timeout')), 8000)
              )
            ]).then(() => {
              clearTimeout(timeout);
              results.push({ relay, success: true });
              console.log(`✅ ${relay}: Successfully published`);
              resolve();
            }).catch((error) => {
              clearTimeout(timeout);
              const errorMsg = error instanceof Error ? error.message : 'Unknown error';
              results.push({ relay, success: false, error: errorMsg });
              console.error(`❌ ${relay}: ${errorMsg}`);
              resolve();
            });
          } catch (error) {
            clearTimeout(timeout);
            const errorMsg = error instanceof Error ? error.message : 'Unknown error';
            results.push({ relay, success: false, error: errorMsg });
            console.error(`❌ ${relay}: ${errorMsg}`);
            resolve();
          }
        });
      });
      
      // Wait for all relays to complete or timeout
      await Promise.all(publishPromises);
      
      // Summary
      const successCount = results.filter(r => r.success).length;
      const failedCount = results.filter(r => !r.success).length;
      
      console.log('📊 Publishing summary:', {
        eventId: signedEvent.id,
        total: results.length,
        successful: successCount,
        failed: failedCount,
        details: results
      });

      setPublishResults(results);

      if (successCount > 0) {
        setHasUnsavedChanges(false);
      }

      if (successCount === 0) {
        toast.error('Failed to publish to any relay');
      }
    } catch (error) {
      console.error('❌ Failed to publish settings:', error);
      toast.error('Failed to publish settings');
    } finally {
      pool.close(parameters.relays);
      setIsPublishing(false);
    }
  };

  const toggleModule = (moduleId: ModuleType) => {
    setModules(prev => 
      prev.map(mod => 
        mod.id === moduleId ? { ...mod, enabled: !mod.enabled } : mod
      )
    );
    setHasUnsavedChanges(true);
  };

  const reorderModules = (newOrder: ModuleConfig[]) => {
    setModules(newOrder);
    setHasUnsavedChanges(true);
  };

  const resetToDefaults = () => {
    setModules(DEFAULT_MODULES);
  };

  const getEnabledModules = () => {
    return modules
      .filter(mod => mod.enabled)
      .sort((a, b) => a.order - b.order);
  };

  return (
    <ModulesContext.Provider value={{ 
      modules,
      isLoading,
      hasUnsavedChanges,
      publishResults,
      isPublishing,
      toggleModule, 
      reorderModules, 
      resetToDefaults, 
      getEnabledModules,
      saveSettings,
      loadSettingsFromNostr
    }}>
      {children}
    </ModulesContext.Provider>
  );
}

export function useModules() {
  const context = useContext(ModulesContext);
  if (!context) {
    throw new Error('useModules must be used within ModulesProvider');
  }
  return context;
}
