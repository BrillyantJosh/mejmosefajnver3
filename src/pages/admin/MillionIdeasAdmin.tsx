import { useState, useEffect } from "react";
import { useAdmin } from "@/contexts/AdminContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ProjectTypeSettings } from "@/types/admin";
import { Lightbulb, UserPlus, X } from "lucide-react";
import { toast } from "@/hooks/use-toast";

export default function MillionIdeasAdmin() {
  const { appSettings, updateNewProjects100M, updateProjectTypeSettings, update100MAdmins } = useAdmin();

  // --- Project Type Settings ---
  const defaultPTS: ProjectTypeSettings = {
    Inspiration: { enabled: true, maxAmount: 200 },
    OnlineEvent: { enabled: true, maxAmount: 200 },
    Event: { enabled: true, maxAmount: 200 },
  };
  const [localPTS, setLocalPTS] = useState<ProjectTypeSettings>(
    appSettings?.project_type_settings || defaultPTS
  );

  // --- Module Admins ---
  const [admins, setAdmins] = useState<string[]>(appSettings?.millionideas_admins || []);
  const [newAdminHex, setNewAdminHex] = useState("");

  useEffect(() => {
    if (appSettings) {
      setLocalPTS(appSettings.project_type_settings || defaultPTS);
      setAdmins(appSettings.millionideas_admins || []);
    }
  }, [appSettings]);

  const handlePTSToggle = (type: keyof ProjectTypeSettings) => {
    setLocalPTS(prev => ({
      ...prev,
      [type]: { ...prev[type], enabled: !prev[type].enabled }
    }));
  };

  const handlePTSMaxAmount = (type: keyof ProjectTypeSettings, value: string) => {
    const num = parseInt(value, 10);
    setLocalPTS(prev => ({
      ...prev,
      [type]: { ...prev[type], maxAmount: isNaN(num) ? 0 : num }
    }));
  };

  const handleSavePTS = async () => {
    await updateProjectTypeSettings(localPTS);
  };

  const handleAddAdmin = async () => {
    const hex = newAdminHex.trim().toLowerCase();
    if (!hex) return;
    if (!/^[0-9a-f]{64}$/.test(hex)) {
      toast({ title: "Error", description: "Invalid Nostr HEX ID — must be 64 hex characters", variant: "destructive" });
      return;
    }
    if (admins.includes(hex)) {
      toast({ title: "Error", description: "This admin is already added", variant: "destructive" });
      return;
    }
    const updated = [...admins, hex];
    await update100MAdmins(updated);
    setNewAdminHex("");
  };

  const handleRemoveAdmin = async (hex: string) => {
    const updated = admins.filter(a => a !== hex);
    await update100MAdmins(updated);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Lightbulb className="h-6 w-6 text-primary" />
        <div>
          <h2 className="text-xl font-semibold">100 Million Ideas</h2>
          <p className="text-sm text-muted-foreground">Settings for the 100 Million Ideas module</p>
        </div>
      </div>

      {/* Feature Toggle */}
      <Card>
        <CardHeader>
          <CardTitle>New Projects</CardTitle>
          <CardDescription>Control whether users can create new projects</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between p-3 border rounded-lg">
            <div className="space-y-0.5">
              <Label htmlFor="toggle-100m" className="font-medium">Allow New Projects</Label>
              <p className="text-xs text-muted-foreground">
                When disabled, users can browse and edit existing projects but cannot create new ones
              </p>
            </div>
            <Switch
              id="toggle-100m"
              checked={appSettings?.new_projects_100millionideas ?? true}
              onCheckedChange={(checked) => updateNewProjects100M(checked)}
            />
          </div>
        </CardContent>
      </Card>

      {/* Project Types Configuration */}
      <Card>
        <CardHeader>
          <CardTitle>Project Types</CardTitle>
          <CardDescription>Enable or disable project types and set maximum funding amounts for each</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {(["Inspiration", "OnlineEvent", "Event"] as const).map((type) => {
            const label = type === "OnlineEvent" ? "Online Event" : type;
            return (
              <div key={type} className="p-3 border rounded-lg space-y-3">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label htmlFor={`toggle-pt-${type}`} className="font-medium">{label}</Label>
                    <p className="text-xs text-muted-foreground">
                      {localPTS[type].enabled ? "Users can create this type of project" : "Disabled — not available for new projects"}
                    </p>
                  </div>
                  <Switch
                    id={`toggle-pt-${type}`}
                    checked={localPTS[type].enabled}
                    onCheckedChange={() => handlePTSToggle(type)}
                  />
                </div>
                {localPTS[type].enabled && (
                  <div className="space-y-1">
                    <Label htmlFor={`max-${type}`} className="text-sm">Max funding amount</Label>
                    <Input
                      id={`max-${type}`}
                      type="number"
                      min="1"
                      value={localPTS[type].maxAmount}
                      onChange={(e) => handlePTSMaxAmount(type, e.target.value)}
                      className="max-w-[200px]"
                    />
                  </div>
                )}
              </div>
            );
          })}
          <Button onClick={handleSavePTS}>Save Project Types</Button>
        </CardContent>
      </Card>

      {/* Module Administrators */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5" />
            Module Administrators
          </CardTitle>
          <CardDescription>
            Users with these Nostr HEX IDs can hide projects and mark them as completed on the projects page
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input
              value={newAdminHex}
              onChange={(e) => setNewAdminHex(e.target.value)}
              placeholder="Nostr HEX ID (64 characters)"
              className="font-mono text-sm"
            />
            <Button onClick={handleAddAdmin}>Add</Button>
          </div>

          {admins.length === 0 ? (
            <p className="text-sm text-muted-foreground">No module administrators added yet. Global admins always have access.</p>
          ) : (
            <div className="space-y-2">
              {admins.map((hex) => (
                <div key={hex} className="flex items-center justify-between p-3 border rounded-lg">
                  <span className="font-mono text-sm break-all">{hex}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 text-destructive hover:text-destructive"
                    onClick={() => handleRemoveAdmin(hex)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
