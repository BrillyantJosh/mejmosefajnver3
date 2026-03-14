export interface ProjectTypeConfig {
  enabled: boolean;
  maxAmount: number;
}

export interface ProjectTypeSettings {
  Inspiration: ProjectTypeConfig;
  OnlineEvent: ProjectTypeConfig;
  Event: ProjectTypeConfig;
}

export interface ProjectOverride {
  hidden?: boolean;
  completed?: boolean;
}

export interface ProjectOverrides {
  [dTag: string]: ProjectOverride;
}

export interface AppSettings {
  app_name: string;
  theme_colors: ThemeColors;
  default_rooms: string[];
  new_projects_100millionideas: boolean;
  warning_before_split?: number; // Max LANA balance across Wallet + Main Wallet + Lana.Discount before SPLIT warning
  project_type_settings?: ProjectTypeSettings;
  millionideas_admins?: string[];
  project_overrides?: ProjectOverrides;
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
