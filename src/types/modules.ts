import { LucideIcon } from "lucide-react";

export type ModuleType = 'social' | 'chat' | 'wallet' | 'selllana' | 'buylana' | 'marketplace' | 'lanapaper' | 'offlinelana' | 'relays' | 'lana8wonder' | 'lanapays' | 'lanapay' | 'lash' | 'lanamusic' | 'lanatransparency';

export interface ModuleConfig {
  id: ModuleType;
  title: string;
  description: string;
  icon: LucideIcon;
  path: string;
  gradient: string;
  image?: string; // Optional image for modules that use photos instead of gradients
  imagePosition?: string; // Optional CSS class for image positioning (e.g., 'object-[70%_20%]')
  externalUrl?: string; // Optional external URL to open in new tab instead of routing
  enabled: boolean;
  order: number;
}

export interface UserModuleSettings {
  modules: ModuleConfig[];
}
