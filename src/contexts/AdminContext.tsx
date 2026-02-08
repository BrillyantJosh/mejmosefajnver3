import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { AppSettings, ThemeColors } from "@/types/admin";
import { toast } from "@/hooks/use-toast";
import { useTheme } from "@/hooks/useTheme";
import { useAuth } from "@/contexts/AuthContext";

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

interface AdminContextType {
  isAdmin: boolean;
  loading: boolean;
  appSettings: AppSettings | null;
  updateAppName: (name: string) => Promise<void>;
  updateThemeColors: (colors: ThemeColors) => Promise<void>;
  updateDefaultRooms: (rooms: string[]) => Promise<void>;
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
        loading,
        appSettings,
        updateAppName,
        updateThemeColors,
        updateDefaultRooms,
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
