import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { AppSettings, ThemeColors, ProjectTypeSettings, ProjectOverrides } from "@/types/admin";
import { toast } from "@/hooks/use-toast";
import { useTheme } from "@/hooks/useTheme";
import { useAuth } from "@/contexts/AuthContext";

const API_URL = import.meta.env.VITE_API_URL ?? '';

interface AdminContextType {
  isAdmin: boolean;
  is100MAdmin: boolean;
  loading: boolean;
  appSettings: AppSettings | null;
  updateAppName: (name: string) => Promise<void>;
  updateThemeColors: (colors: ThemeColors) => Promise<void>;
  updateDefaultRooms: (rooms: string[]) => Promise<void>;
  updateNewProjects100M: (enabled: boolean) => Promise<void>;
  updateWarningBeforeSplit: (amount: number | null) => Promise<void>;
  updateProjectTypeSettings: (settings: ProjectTypeSettings) => Promise<void>;
  update100MAdmins: (admins: string[]) => Promise<void>;
  updateAuthorizedCreators: (creators: any[]) => Promise<void>;
  updateProjectOverrides: (overrides: ProjectOverrides) => Promise<void>;
  updateDiscountSettings: (settings: Partial<Pick<AppSettings, 'discount_commission_lanapays' | 'discount_commission_other' | 'discount_min_sell_eur' | 'discount_min_sell_usd' | 'discount_min_sell_gbp' | 'discount_buyback_wallet' | 'discount_api_url' | 'discount_api_key'>>) => Promise<void>;
  loadAppSettings: () => Promise<void>;
}

const AdminContext = createContext<AdminContextType | undefined>(undefined);

export function AdminProvider({ children }: { children: ReactNode }) {
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
  const { session, isLoading: authLoading } = useAuth();

  // Apply theme whenever settings change
  useTheme(appSettings?.theme_colors || null);

  const checkAdminStatus = async (nostrHexId: string) => {
    try {
      const res = await fetch(`${API_URL}/api/db/admin_users?nostr_hex_id=eq.${nostrHexId}&select=nostr_hex_id`);
      if (!res.ok) return false;
      const data = await res.json();
      return Array.isArray(data) && data.length > 0;
    } catch (error) {
      console.error('Error in checkAdminStatus:', error);
      return false;
    }
  };

  const loadAppSettings = async () => {
    try {
      const res = await fetch(`${API_URL}/api/db/app_settings?select=key,value`);
      const rows: { key: string; value: string }[] = res.ok ? await res.json() : [];

      const getValue = (key: string) => {
        const row = rows.find(r => r.key === key);
        if (!row) return undefined;
        try { return JSON.parse(row.value); } catch { return row.value; }
      };

      const rawSplitWarning = getValue('warning_before_split');
      const warningBeforeSplit = typeof rawSplitWarning === 'number' && rawSplitWarning > 0
        ? rawSplitWarning
        : undefined;

      const defaultProjectTypeSettings: ProjectTypeSettings = {
        Inspiration: { enabled: true, maxAmount: 200 },
        OnlineEvent: { enabled: true, maxAmount: 200 },
        Event: { enabled: true, maxAmount: 200 },
      };

      setAppSettings({
        app_name: (getValue('app_name') as string) || "Nostr App",
        theme_colors: (getValue('theme_colors') as ThemeColors) || {
          primary: "263 70% 50%",
          primary_foreground: "0 0% 100%",
          secondary: "240 5% 96%",
          secondary_foreground: "240 10% 15%",
          accent: "263 70% 50%",
          accent_foreground: "0 0% 100%",
          background: "0 0% 100%",
          foreground: "240 10% 15%",
        },
        default_rooms: (getValue('default_rooms') as string[]) || ["general"],
        new_projects_100millionideas: getValue('100millionideas_new_projects_enabled') !== false,
        warning_before_split: warningBeforeSplit,
        project_type_settings: (getValue('project_type_settings') as ProjectTypeSettings) || defaultProjectTypeSettings,
        millionideas_admins: (getValue('100millionideas_admins') as string[]) || [],
        authorized_creators: (getValue('100millionideas_authorized_creators') as any[]) || [],
        project_overrides: (getValue('100millionideas_project_overrides') as ProjectOverrides) || {},
        discount_commission_lanapays: (getValue('discount_commission_lanapays') as number) ?? 30,
        discount_commission_other: (getValue('discount_commission_other') as number) ?? 21,
        discount_min_sell_eur: (getValue('discount_min_sell_eur') as number) ?? 2,
        discount_min_sell_usd: (getValue('discount_min_sell_usd') as number) ?? 2,
        discount_min_sell_gbp: (getValue('discount_min_sell_gbp') as number) ?? 2,
        discount_buyback_wallet: (getValue('discount_buyback_wallet') as string) || 'Lg7iw2aQp8qazNsZVZFhf4rP7bikSrLRxB',
        discount_api_url: (getValue('discount_api_url') as string) || 'https://www.lana.discount',
        discount_api_key: (getValue('discount_api_key') as string) || '',
      });
    } catch (error) {
      console.error('Error loading app settings:', error);
    }
  };

  const invokeSettingsUpdate = async (key: string, value: unknown) => {
    const res = await fetch(`${API_URL}/api/functions/update-app-settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: [{ key, value }] }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(err.error || 'Failed to update settings');
    }
    return res.json();
  };

  const updateAppName = async (name: string) => {
    if (!session?.nostrHexId) {
      toast({ 
        title: "Error", 
        description: "Not authenticated",
        variant: "destructive" 
      });
      return;
    }

    try {
      await invokeSettingsUpdate('app_name', name);
      setAppSettings(prev => prev ? { ...prev, app_name: name } : null);
      toast({ title: "Success", description: "App name updated successfully" });
    } catch (error) {
      console.error('Error updating app name:', error);
      toast({ 
        title: "Error", 
        description: "Failed to update app name",
        variant: "destructive" 
      });
    }
  };

  const updateThemeColors = async (colors: ThemeColors) => {
    if (!session?.nostrHexId) {
      toast({ 
        title: "Error", 
        description: "Not authenticated",
        variant: "destructive" 
      });
      return;
    }

    try {
      await invokeSettingsUpdate('theme_colors', colors);
      setAppSettings(prev => prev ? { ...prev, theme_colors: colors } : null);
      toast({ title: "Success", description: "Theme colors updated successfully" });
    } catch (error) {
      console.error('Error updating theme colors:', error);
      toast({ 
        title: "Error", 
        description: "Failed to update theme colors",
        variant: "destructive" 
      });
    }
  };

  const updateDefaultRooms = async (rooms: string[]) => {
    if (!session?.nostrHexId) {
      toast({ 
        title: "Error", 
        description: "Not authenticated",
        variant: "destructive" 
      });
      return;
    }

    try {
      await invokeSettingsUpdate('default_rooms', rooms);
      setAppSettings(prev => prev ? { ...prev, default_rooms: rooms } : null);
      toast({ title: "Success", description: "Default rooms updated successfully" });
    } catch (error) {
      console.error('Error updating default rooms:', error);
      toast({ 
        title: "Error", 
        description: "Failed to update default rooms",
        variant: "destructive" 
      });
    }
  };

  const updateNewProjects100M = async (enabled: boolean) => {
    if (!session?.nostrHexId) {
      toast({
        title: "Error",
        description: "Not authenticated",
        variant: "destructive"
      });
      return;
    }

    try {
      await invokeSettingsUpdate('100millionideas_new_projects_enabled', enabled);
      setAppSettings(prev => prev ? { ...prev, new_projects_100millionideas: enabled } : null);
      toast({ title: "Success", description: enabled ? "New project creation enabled" : "New project creation disabled" });
    } catch (error) {
      console.error('Error updating 100M Ideas setting:', error);
      toast({
        title: "Error",
        description: "Failed to update setting",
        variant: "destructive"
      });
    }
  };

  const updateWarningBeforeSplit = async (amount: number | null) => {
    if (!session?.nostrHexId) {
      toast({
        title: "Error",
        description: "Not authenticated",
        variant: "destructive"
      });
      return;
    }

    try {
      // Store 0 to effectively disable, or the actual number
      await invokeSettingsUpdate('warning_before_split', amount ?? 0);
      setAppSettings(prev => prev ? {
        ...prev,
        warning_before_split: (amount && amount > 0) ? amount : undefined
      } : null);
      toast({
        title: "Success",
        description: amount && amount > 0
          ? `Warning before SPLIT set to ${amount} LANA`
          : "Warning before SPLIT cleared"
      });
    } catch (error) {
      console.error('Error updating warning before split:', error);
      toast({
        title: "Error",
        description: "Failed to update setting",
        variant: "destructive"
      });
    }
  };

  const updateProjectTypeSettings = async (settings: ProjectTypeSettings) => {
    if (!session?.nostrHexId) {
      toast({
        title: "Error",
        description: "Not authenticated",
        variant: "destructive"
      });
      return;
    }

    try {
      await invokeSettingsUpdate('project_type_settings', settings);
      setAppSettings(prev => prev ? { ...prev, project_type_settings: settings } : null);
      toast({ title: "Success", description: "Project type settings updated" });
    } catch (error) {
      console.error('Error updating project type settings:', error);
      toast({
        title: "Error",
        description: "Failed to update project type settings",
        variant: "destructive"
      });
    }
  };

  const update100MAdmins = async (admins: string[]) => {
    if (!session?.nostrHexId) {
      toast({ title: "Error", description: "Not authenticated", variant: "destructive" });
      return;
    }
    try {
      await invokeSettingsUpdate('100millionideas_admins', admins);
      setAppSettings(prev => prev ? { ...prev, millionideas_admins: admins } : null);
      toast({ title: "Success", description: "100M Ideas admins updated" });
    } catch (error) {
      console.error('Error updating 100M admins:', error);
      toast({ title: "Error", description: "Failed to update admins", variant: "destructive" });
    }
  };

  const updateAuthorizedCreators = async (creators: any[]) => {
    if (!session?.nostrHexId) {
      toast({ title: "Error", description: "Not authenticated", variant: "destructive" });
      return;
    }
    try {
      await invokeSettingsUpdate('100millionideas_authorized_creators', creators);
      setAppSettings(prev => prev ? { ...prev, authorized_creators: creators } : null);
      toast({ title: "Success", description: "Authorized creators updated" });
    } catch (error) {
      console.error('Error updating authorized creators:', error);
      toast({ title: "Error", description: "Failed to update authorized creators", variant: "destructive" });
    }
  };

  const updateProjectOverrides = async (overrides: ProjectOverrides) => {
    if (!session?.nostrHexId) {
      toast({ title: "Error", description: "Not authenticated", variant: "destructive" });
      return;
    }
    try {
      await invokeSettingsUpdate('100millionideas_project_overrides', overrides);
      setAppSettings(prev => prev ? { ...prev, project_overrides: overrides } : null);
    } catch (error) {
      console.error('Error updating project overrides:', error);
      toast({ title: "Error", description: "Failed to update project", variant: "destructive" });
    }
  };

  const updateDiscountSettings = async (settings: Partial<Pick<AppSettings, 'discount_commission_lanapays' | 'discount_commission_other' | 'discount_min_sell_eur' | 'discount_min_sell_usd' | 'discount_min_sell_gbp' | 'discount_buyback_wallet' | 'discount_api_url' | 'discount_api_key'>>) => {
    if (!session?.nostrHexId) {
      toast({ title: "Error", description: "Not authenticated", variant: "destructive" });
      return;
    }
    try {
      for (const [key, value] of Object.entries(settings)) {
        await invokeSettingsUpdate(key, value);
      }
      setAppSettings(prev => prev ? { ...prev, ...settings } : null);
      toast({ title: "Success", description: "Lana Discount settings saved" });
    } catch (error) {
      console.error('Error updating discount settings:', error);
      toast({ title: "Error", description: "Failed to save discount settings", variant: "destructive" });
    }
  };

  // Compute 100M Ideas admin status
  const is100MAdmin = Boolean(
    session?.nostrHexId && (
      isAdmin || // Global admin is always 100M admin too
      (appSettings?.millionideas_admins || []).includes(session.nostrHexId)
    )
  );

  useEffect(() => {
    // Don't run admin check until auth has finished loading
    if (authLoading) return;

    const initAdmin = async () => {
      setLoading(true);

      // Load app settings first (public data)
      await loadAppSettings();

      // Check admin status based on Nostr hex ID
      if (session?.nostrHexId) {
        const adminStatus = await checkAdminStatus(session.nostrHexId);
        setIsAdmin(adminStatus);
      } else {
        setIsAdmin(false);
      }

      setLoading(false);
    };

    initAdmin();
  }, [session, authLoading]);

  return (
    <AdminContext.Provider
      value={{
        isAdmin,
        is100MAdmin,
        loading,
        appSettings,
        updateAppName,
        updateThemeColors,
        updateDefaultRooms,
        updateNewProjects100M,
        updateWarningBeforeSplit,
        updateProjectTypeSettings,
        update100MAdmins,
        updateAuthorizedCreators,
        updateProjectOverrides,
        updateDiscountSettings,
        loadAppSettings,
      }}
    >
      {children}
    </AdminContext.Provider>
  );
}

export function useAdmin() {
  const context = useContext(AdminContext);
  if (context === undefined) {
    throw new Error("useAdmin must be used within an AdminProvider");
  }
  return context;
}
