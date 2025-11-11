import { useState, useEffect } from "react";
import { useAdmin } from "@/contexts/AdminContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ThemeColors } from "@/types/admin";
import { Shield, Users, Loader2 } from "lucide-react";
import { useNostrRooms } from "@/hooks/useNostrRooms";

export default function AdminSettings() {
  const { appSettings, updateAppName, updateThemeColors, updateDefaultRooms } = useAdmin();
  const { rooms, loading: roomsLoading } = useNostrRooms();
  
  const [localName, setLocalName] = useState(appSettings?.app_name || "");
  const [localColors, setLocalColors] = useState<ThemeColors>(
    appSettings?.theme_colors || {
      primary: "263 70% 50%",
      primary_foreground: "0 0% 100%",
      secondary: "240 5% 96%",
      secondary_foreground: "240 10% 15%",
      accent: "263 70% 50%",
      accent_foreground: "0 0% 100%",
      background: "0 0% 100%",
      foreground: "240 10% 15%",
    }
  );
  const [localDefaultRooms, setLocalDefaultRooms] = useState<string[]>(
    appSettings?.default_rooms || ["general"]
  );

  // Update local state when appSettings change
  useEffect(() => {
    if (appSettings) {
      setLocalName(appSettings.app_name);
      setLocalColors(appSettings.theme_colors);
      setLocalDefaultRooms(appSettings.default_rooms);
    }
  }, [appSettings]);

  const handleSaveName = async () => {
    await updateAppName(localName);
  };

  const handleSaveColors = async () => {
    await updateThemeColors(localColors);
  };

  const handleSaveDefaultRooms = async () => {
    await updateDefaultRooms(localDefaultRooms);
  };

  const handleColorChange = (key: keyof ThemeColors, value: string) => {
    setLocalColors(prev => ({ ...prev, [key]: value }));
  };

  const handleRoomToggle = (roomSlug: string) => {
    setLocalDefaultRooms(prev => {
      if (prev.includes(roomSlug)) {
        return prev.filter(slug => slug !== roomSlug);
      } else {
        return [...prev, roomSlug];
      }
    });
  };

  const resetToDefaults = () => {
    const defaults: ThemeColors = {
      primary: "263 70% 50%",
      primary_foreground: "0 0% 100%",
      secondary: "240 5% 96%",
      secondary_foreground: "240 10% 15%",
      accent: "263 70% 50%",
      accent_foreground: "0 0% 100%",
      background: "0 0% 100%",
      foreground: "240 10% 15%",
    };
    setLocalColors(defaults);
  };

  return (
    <div className="container max-w-4xl mx-auto py-8 space-y-8">
      <div className="flex items-center gap-3">
        <Shield className="h-8 w-8 text-destructive" />
        <div>
          <h1 className="text-3xl font-bold">Admin Settings</h1>
          <p className="text-muted-foreground">Manage application settings and appearance</p>
        </div>
      </div>

      {/* Application Name */}
      <Card>
        <CardHeader>
          <CardTitle>Application Name</CardTitle>
          <CardDescription>Update the name displayed in the header</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="app-name">App Name</Label>
            <Input
              id="app-name"
              value={localName}
              onChange={(e) => setLocalName(e.target.value)}
              placeholder="Enter application name"
            />
          </div>
          <Button onClick={handleSaveName}>Save Name</Button>
        </CardContent>
      </Card>

      {/* Default Rooms */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Default Rooms
          </CardTitle>
          <CardDescription>Select which rooms are shown by default in the app</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {roomsLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : rooms.length === 0 ? (
            <p className="text-sm text-muted-foreground">No rooms available</p>
          ) : (
            <div className="space-y-3">
              {rooms.map((room) => (
                <div key={room.slug} className="flex items-center gap-3 p-3 border rounded-lg hover:bg-accent/5 transition-colors">
                  <Checkbox
                    id={`room-${room.slug}`}
                    checked={localDefaultRooms.includes(room.slug)}
                    onCheckedChange={() => handleRoomToggle(room.slug)}
                  />
                  <Label 
                    htmlFor={`room-${room.slug}`}
                    className="flex items-center gap-2 cursor-pointer flex-1"
                  >
                    {room.icon && <span className="text-xl">{room.icon}</span>}
                    <div>
                      <div className="font-medium">{room.title}</div>
                      {room.description && (
                        <div className="text-xs text-muted-foreground">{room.description}</div>
                      )}
                    </div>
                  </Label>
                </div>
              ))}
            </div>
          )}
          <Button onClick={handleSaveDefaultRooms} disabled={roomsLoading}>
            Save Default Rooms
          </Button>
        </CardContent>
      </Card>

      {/* Theme Colors */}
      <Card>
        <CardHeader>
          <CardTitle>Theme Colors</CardTitle>
          <CardDescription>Customize the application color scheme (HSL format)</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="primary">Primary Color</Label>
              <Input
                id="primary"
                value={localColors.primary}
                onChange={(e) => handleColorChange('primary', e.target.value)}
                placeholder="263 70% 50%"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="primary-fg">Primary Foreground</Label>
              <Input
                id="primary-fg"
                value={localColors.primary_foreground}
                onChange={(e) => handleColorChange('primary_foreground', e.target.value)}
                placeholder="0 0% 100%"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="secondary">Secondary Color</Label>
              <Input
                id="secondary"
                value={localColors.secondary}
                onChange={(e) => handleColorChange('secondary', e.target.value)}
                placeholder="240 5% 96%"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="secondary-fg">Secondary Foreground</Label>
              <Input
                id="secondary-fg"
                value={localColors.secondary_foreground}
                onChange={(e) => handleColorChange('secondary_foreground', e.target.value)}
                placeholder="240 10% 15%"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="accent">Accent Color</Label>
              <Input
                id="accent"
                value={localColors.accent}
                onChange={(e) => handleColorChange('accent', e.target.value)}
                placeholder="263 70% 50%"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="accent-fg">Accent Foreground</Label>
              <Input
                id="accent-fg"
                value={localColors.accent_foreground}
                onChange={(e) => handleColorChange('accent_foreground', e.target.value)}
                placeholder="0 0% 100%"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="background">Background Color</Label>
              <Input
                id="background"
                value={localColors.background}
                onChange={(e) => handleColorChange('background', e.target.value)}
                placeholder="0 0% 100%"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="foreground">Foreground Color</Label>
              <Input
                id="foreground"
                value={localColors.foreground}
                onChange={(e) => handleColorChange('foreground', e.target.value)}
                placeholder="240 10% 15%"
              />
            </div>
          </div>

          <div className="flex gap-2">
            <Button onClick={handleSaveColors}>Save Colors</Button>
            <Button onClick={resetToDefaults} variant="outline">Reset to Defaults</Button>
          </div>
        </CardContent>
      </Card>

      {/* Preview */}
      <Card>
        <CardHeader>
          <CardTitle>Preview</CardTitle>
          <CardDescription>See how your changes will look</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="p-4 border rounded-lg space-y-4">
            <div className="flex items-center justify-between p-4 bg-background border-b">
              <span className="text-xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                {localName || "Nostr App"}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-4 p-4">
              <Button variant="default">Primary Button</Button>
              <Button variant="secondary">Secondary Button</Button>
              <Button variant="outline">Outline Button</Button>
              <Button variant="destructive">Destructive Button</Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
