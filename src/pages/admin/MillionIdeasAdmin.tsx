import { useState, useEffect } from "react";
import { useAdmin } from "@/contexts/AdminContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ProjectTypeSettings, AuthorizedCreator } from "@/types/admin";
import { Lightbulb, UserPlus, UserCheck, X } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { useNostrProfilesCacheBulk } from "@/hooks/useNostrProfilesCacheBulk";

export default function MillionIdeasAdmin() {
  const { appSettings, updateNewProjects100M, updateProjectTypeSettings, update100MAdmins, updateAuthorizedCreators } = useAdmin();

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

  // --- Authorized Creators ---
  const [creators, setCreators] = useState<AuthorizedCreator[]>(appSettings?.authorized_creators || []);
  const [newCreatorHex, setNewCreatorHex] = useState("");
  const [newCreatorMaxAmount, setNewCreatorMaxAmount] = useState("");

  // Fetch profiles for authorized creators
  const creatorPubkeys = creators.map(c => c.nostrHexId);
  const { profiles: creatorProfiles } = useNostrProfilesCacheBulk(creatorPubkeys);

  useEffect(() => {
    if (appSettings) {
      setLocalPTS(appSettings.project_type_settings || defaultPTS);
      setAdmins(appSettings.millionideas_admins || []);
      setCreators(appSettings.authorized_creators || []);
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

  const handleAddCreator = async () => {
    const hex = newCreatorHex.trim().toLowerCase();
    const maxAmount = parseInt(newCreatorMaxAmount, 10);
    if (!hex) return;
    if (!/^[0-9a-f]{64}$/.test(hex)) {
      toast({ title: "Error", description: "Invalid Nostr HEX ID — must be 64 hex characters", variant: "destructive" });
      return;
    }
    if (isNaN(maxAmount) || maxAmount <= 0) {
      toast({ title: "Error", description: "Please enter a valid max amount greater than 0", variant: "destructive" });
      return;
    }
    if (creators.find(c => c.nostrHexId === hex)) {
      toast({ title: "Error", description: "This creator is already added", variant: "destructive" });
      return;
    }
    const updated = [...creators, { nostrHexId: hex, maxAmount }];
    await updateAuthorizedCreators(updated);
    setNewCreatorHex("");
    setNewCreatorMaxAmount("");
  };

  const handleRemoveCreator = async (hex: string) => {
    const updated = creators.filter(c => c.nostrHexId !== hex);
    await updateAuthorizedCreators(updated);
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

      {/* Authorized Project Creators */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserCheck className="h-5 w-5" />
            Authorized Project Creators
          </CardTitle>
          <CardDescription>
            Users who can create projects with custom higher funding limits. Their max amount overrides the global project type limits if higher.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              value={newCreatorHex}
              onChange={(e) => setNewCreatorHex(e.target.value)}
              placeholder="Nostr HEX ID (64 characters)"
              className="font-mono text-sm flex-1"
            />
            <Input
              type="number"
              value={newCreatorMaxAmount}
              onChange={(e) => setNewCreatorMaxAmount(e.target.value)}
              placeholder="Max amount (EUR)"
              className="w-full sm:w-40"
              min="1"
            />
            <Button onClick={handleAddCreator} className="shrink-0">Add</Button>
          </div>

          {creators.length === 0 ? (
            <p className="text-sm text-muted-foreground">No authorized creators added. All users use global project type limits.</p>
          ) : (
            <div className="space-y-2">
              {creators.map((creator) => {
                const profile = creatorProfiles.get(creator.nostrHexId);
                const displayName = profile?.display_name || profile?.full_name;
                return (
                  <div key={creator.nostrHexId} className="flex items-center justify-between gap-3 p-3 border rounded-lg">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        {displayName && (
                          <span className="font-medium text-sm">{displayName}</span>
                        )}
                        <span className="text-xs font-semibold text-green-600 bg-green-500/10 px-2 py-0.5 rounded">
                          Max: {creator.maxAmount} EUR
                        </span>
                      </div>
                      <p className="font-mono text-xs text-muted-foreground truncate mt-0.5">{creator.nostrHexId}</p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0 text-destructive hover:text-destructive"
                      onClick={() => handleRemoveCreator(creator.nostrHexId)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
