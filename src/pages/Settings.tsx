import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useModules } from "@/contexts/ModulesContext";
import { ArrowUp, ArrowDown, RotateCcw, Save } from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";

export default function Settings() {
  const { modules, isLoading, hasUnsavedChanges, publishResults, isPublishing, toggleModule, reorderModules, resetToDefaults, getEnabledModules, saveSettings } = useModules();
  const enabledModules = getEnabledModules();

  const moveModule = (index: number, direction: 'up' | 'down') => {
    const newOrder = [...enabledModules];
    const swapIndex = direction === 'up' ? index - 1 : index + 1;
    
    if (swapIndex < 0 || swapIndex >= newOrder.length) return;
    
    // Swap elements
    [newOrder[index], newOrder[swapIndex]] = [newOrder[swapIndex], newOrder[index]];
    
    // Reassign order values to reflect new positions
    const reorderedWithOrder = newOrder.map((mod, idx) => ({
      ...mod,
      order: idx + 1
    }));
    
    // Merge back with all modules (including disabled ones)
    const allModules = modules.map(mod => {
      const reorderedMod = reorderedWithOrder.find(m => m.id === mod.id);
      return reorderedMod || mod;
    });
    
    reorderModules(allModules);
    toast.success("Order updated");
  };

  const handleReset = () => {
    resetToDefaults();
    toast.success("Settings reset to default values");
  };

  const handleSave = async () => {
    await saveSettings();
  };

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-center p-12">
          <div className="text-center">
            <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mx-auto mb-4"></div>
            <p className="text-muted-foreground">Loading settings from Nostr...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold mb-2">Settings</h1>
          <p className="text-muted-foreground">Manage modules and their order</p>
        </div>
        
        <Button 
          onClick={handleSave}
          disabled={!hasUnsavedChanges || isPublishing}
          size="lg"
        >
          <Save className="h-4 w-4 mr-2" />
          {isPublishing ? 'Publishing...' : 'Save to Nostr'}
        </Button>
      </div>

      {hasUnsavedChanges && (
        <div className="mb-4 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
          <p className="text-sm text-yellow-600 dark:text-yellow-400">
            ⚠️ You have unsaved changes. Click "Save to Nostr" to sync your settings.
          </p>
        </div>
      )}

      {/* Publishing Results */}
      {(isPublishing || publishResults) && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Publishing Report to Nostr Relays</CardTitle>
            <CardDescription>
              {isPublishing ? 'Publishing settings to relays...' : 'Results of last publish'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isPublishing ? (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="animate-spin h-5 w-5 border-2 border-primary border-t-transparent rounded-full"></div>
                  <p className="text-sm text-muted-foreground">Sending to all relays...</p>
                </div>
              </div>
            ) : publishResults && (
              <div className="space-y-3">
                  <div className="grid gap-2">
                  {publishResults.map((result) => (
                    <div 
                      key={result.relay} 
                      className={`flex items-center justify-between p-3 rounded-lg border ${
                        result.success 
                          ? 'bg-green-500/10 border-green-500/20' 
                          : 'bg-red-500/10 border-red-500/20'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        {result.success ? (
                          <div className="h-8 w-8 rounded-full bg-green-500 flex items-center justify-center flex-shrink-0">
                            <span className="text-white text-sm font-bold">✓</span>
                          </div>
                        ) : (
                          <div className="h-8 w-8 rounded-full bg-red-500 flex items-center justify-center flex-shrink-0">
                            <span className="text-white text-sm font-bold">✗</span>
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="font-mono text-sm font-medium break-all">{result.relay}</p>
                          {result.error && (
                            <p className="text-xs text-muted-foreground mt-1 break-words">{result.error}</p>
                          )}
                        </div>
                      </div>
                      <span className={`text-xs font-semibold flex-shrink-0 whitespace-nowrap ml-2 ${
                        result.success ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
                      }`}>
                        {result.success ? 'SUCCESS' : 'FAILED'}
                      </span>
                    </div>
                  ))}
                </div>
                
                <div className="mt-4 p-3 bg-muted/50 rounded-lg">
                  <div className="flex justify-between text-sm">
                    <span className="font-semibold">Total:</span>
                    <span>{publishResults.length} relays</span>
                  </div>
                  <div className="flex justify-between text-sm mt-1">
                    <span className="text-green-600 dark:text-green-400 font-semibold">Successful:</span>
                    <span className="text-green-600 dark:text-green-400">
                      {publishResults.filter(r => r.success).length}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm mt-1">
                    <span className="text-red-600 dark:text-red-400 font-semibold">Failed:</span>
                    <span className="text-red-600 dark:text-red-400">
                      {publishResults.filter(r => !r.success).length}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="space-y-6">
        {/* Module Management */}
        <Card>
          <CardHeader>
            <CardTitle>Module Management</CardTitle>
            <CardDescription>Enable or disable modules you want to use</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {modules.map((module) => {
              const Icon = module.icon;
              return (
                <div key={module.id} className="flex items-center justify-between p-4 rounded-lg border bg-card hover:bg-accent/50 transition-colors">
                  <div className="flex items-center gap-4">
                    <div className={`p-3 rounded-lg bg-gradient-to-br ${module.gradient}`}>
                      <Icon className="h-6 w-6 text-white" />
                    </div>
                    <div>
                      <h4 className="font-semibold">{module.title}</h4>
                      <p className="text-sm text-muted-foreground">{module.description}</p>
                    </div>
                  </div>
                  <Switch
                    checked={module.enabled}
                    onCheckedChange={() => toggleModule(module.id)}
                  />
                </div>
              );
            })}
          </CardContent>
        </Card>

        {/* Module Order */}
        <Card>
          <CardHeader>
            <CardTitle>Module Order</CardTitle>
            <CardDescription>Set the display order of modules on the home page</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {enabledModules.length === 0 ? (
              <p className="text-muted-foreground text-center py-8">No active modules to reorder</p>
            ) : (
              enabledModules.map((module, index) => {
                const Icon = module.icon;
                return (
                  <div key={module.id} className="flex items-center justify-between p-4 rounded-lg border bg-card">
                    <div className="flex items-center gap-4">
                      <span className="text-lg font-bold text-muted-foreground w-8">{index + 1}.</span>
                      <div className={`p-2 rounded-lg bg-gradient-to-br ${module.gradient}`}>
                        <Icon className="h-5 w-5 text-white" />
                      </div>
                      <span className="font-semibold">{module.title}</span>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => moveModule(index, 'up')}
                        disabled={index === 0}
                      >
                        <ArrowUp className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => moveModule(index, 'down')}
                        disabled={index === enabledModules.length - 1}
                      >
                        <ArrowDown className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        {/* Actions */}
        <Card>
          <CardHeader>
            <CardTitle>Actions</CardTitle>
            <CardDescription>Reset settings to default values</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={handleReset}>
              <RotateCcw className="h-4 w-4 mr-2" />
              Reset to Default
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
