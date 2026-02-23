import { LucideIcon } from "lucide-react";

export type ModuleType = 'aiadvisor' | 'social' | 'chat' | 'encryptedrooms' | 'wallet' | 'unconditionalpayment' | 'selllana' | 'buylana' | 'marketplace' | 'lanapaper' | 'offlinelana' | 'relays' | 'lana8wonder' | 'lanapays' | 'lanapay' | 'lash' | 'lanamusic' | 'lanatransparency' | 'own' | 'rock' | 'unregisteredwallets' | '100millionideas' | 'lanaknights' | 'lanaevents' | 'lanaalignsworld' | 'registrar' | 'tax' | 'lanaexchange' | 'being';

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
