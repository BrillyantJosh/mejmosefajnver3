import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppSettings, ThemeColors } from "@/types/admin";
import { toast } from "@/hooks/use-toast";
import { useTheme } from "@/hooks/useTheme";
import { useAuth } from "@/contexts/AuthContext";
import { createSignedAdminAuthEvent } from "@/lib/nostrSigning";

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
  const { session } = useAuth();

  // Apply theme whenever settings change
  useTheme(appSettings?.theme_colors || null);

  const checkAdminStatus = async (nostrHexId: string) => {
    try {
      const { data, error } = await supabase
        .from('admin_users')
        .select('nostr_hex_id')
        .eq('nostr_hex_id', nostrHexId)
        .maybeSingle();

      if (error) {
        console.error('Error checking admin status:', error);
        return false;
      }

      return !!data;
    } catch (error) {
      console.error('Error in checkAdminStatus:', error);
      return false;
    }
  };

  const loadAppSettings = async () => {
    try {
      const { data: nameData } = await supabase
        .from('app_settings')
        .select('value')
        .eq('key', 'app_name')
        .maybeSingle();

      const { data: colorsData } = await supabase
        .from('app_settings')
        .select('value')
        .eq('key', 'theme_colors')
        .maybeSingle();

      const { data: roomsData } = await supabase
        .from('app_settings')
        .select('value')
        .eq('key', 'default_rooms')
        .maybeSingle();

      setAppSettings({
        app_name: (nameData?.value as string) || "Nostr App",
        theme_colors: (colorsData?.value as unknown as ThemeColors) || {
          primary: "263 70% 50%",
          primary_foreground: "0 0% 100%",
          secondary: "240 5% 96%",
          secondary_foreground: "240 10% 15%",
          accent: "263 70% 50%",
          accent_foreground: "0 0% 100%",
          background: "0 0% 100%",
          foreground: "240 10% 15%",
        },
        default_rooms: (roomsData?.value as unknown as string[]) || ["general"],
      });
    } catch (error) {
      console.error('Error loading app settings:', error);
    }
  };

  const invokeSignedSettingsUpdate = async (key: string, value: unknown) => {
    if (!session?.nostrHexId || !session?.nostrPrivateKey) {
      throw new Error('Not authenticated');
    }

    // Create a signed Nostr event to prove identity
    const signedEvent = await createSignedAdminAuthEvent(
      session.nostrPrivateKey,
      session.nostrHexId,
      'update-app-settings',
      key
    );

    const { data, error } = await supabase.functions.invoke('update-app-settings', {
      body: {
        signedEvent,
        key,
        value
      }
    });

    if (error) throw error;
    return data;
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
      await invokeSignedSettingsUpdate('app_name', name);
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
      await invokeSignedSettingsUpdate('theme_colors', colors);
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
      await invokeSignedSettingsUpdate('default_rooms', rooms);
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
    const initAdmin = async () => {
      console.log('🔄 [AdminContext] initAdmin triggered');
      console.log('📦 [AdminContext] session:', session);
      
      setLoading(true);
      
      // Load app settings first (public data)
      await loadAppSettings();

      // Check admin status based on Nostr hex ID
      if (session?.nostrHexId) {
        console.log('🔍 [AdminContext] Checking admin for nostrHexId:', session.nostrHexId);
        const adminStatus = await checkAdminStatus(session.nostrHexId);
        console.log('✅ [AdminContext] Admin status result:', adminStatus);
        setIsAdmin(adminStatus);
      } else {
        console.log('❌ [AdminContext] No session, resetting admin status');
        setIsAdmin(false);
      }

      setLoading(false);
    };

    initAdmin();
  }, [session]); // Changed from [session?.nostrHexId] to [session] to trigger on re-login

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
