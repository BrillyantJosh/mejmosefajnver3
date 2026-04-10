export interface ProjectTypeConfig {
  enabled: boolean;
  maxAmount: number;
}

export interface ProjectTypeSettings {
  Inspiration: ProjectTypeConfig;
  Enhancement: ProjectTypeConfig;
  Agreement: ProjectTypeConfig;
  Awareness: ProjectTypeConfig;
  OnlineEvent: ProjectTypeConfig;
  Event: ProjectTypeConfig;
}

export interface ProjectOverride {
  hidden?: boolean;
  completed?: boolean;
  completionComment?: string;
  approved?: boolean;
  funded?: boolean;
}

export interface ProjectOverrides {
  [dTag: string]: ProjectOverride;
}

export interface AuthorizedCreator {
  nostrHexId: string;
  maxAmount: number;
}

export interface AppSettings {
  app_name: string;
  theme_colors: ThemeColors;
  default_rooms: string[];
  new_projects_100millionideas: boolean;
  warning_before_split?: number; // Max LANA balance across Wallet + Main Wallet + Lana.Discount before SPLIT warning
  project_type_settings?: ProjectTypeSettings;
  millionideas_admins?: string[];
  authorized_creators?: AuthorizedCreator[];
  project_overrides?: ProjectOverrides;
  // Lana Discount settings
  discount_commission_lanapays?: number;  // Commission % for LanaPays.Us wallets (default 30)
  discount_commission_other?: number;     // Commission % for other wallets (default 21)
  discount_min_sell_eur?: number;         // Min sell amount in EUR
  discount_min_sell_usd?: number;         // Min sell amount in USD
  discount_min_sell_gbp?: number;         // Min sell amount in GBP
  discount_buyback_wallet?: string;       // Wallet address to send LANA to
  discount_api_url?: string;              // Lana.Discount API URL
  discount_api_key?: string;              // Lana.Discount API key
}

export interface ThemeColors {
  primary: string;
  primary_foreground: string;
  secondary: string;
  secondary_foreground: string;
  accent: string;
  accent_foreground: string;
  background: string;
  foreground: string;
}

export interface AdminUser {
  id: string;
  nostr_hex_id: string;
  created_at: string;
}
