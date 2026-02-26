import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Loader2, Plus, Pencil, Trash2, Youtube } from "lucide-react";

interface WhatsUpItem {
  id: string;
  title: string;
  body: string | null;
  youtube_url: string | null;
  published: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

const EMPTY_FORM = { title: "", body: "", youtube_url: "", published: true };

export default function WhatsUpAdmin() {
  const { toast } = useToast();
  const { session } = useAuth();
  const [items, setItems] = useState<WhatsUpItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const loadItems = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from("whats_up")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      setItems(data || []);
    } catch (err) {
      console.error("Failed to load:", err);
      toast({ title: "Failed to load news", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const openEdit = (item: WhatsUpItem) => {
    setEditingId(item.id);
    setForm({
      title: item.title,
      body: item.body || "",
      youtube_url: item.youtube_url || "",
      published: item.published === 1,
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.title.trim()) {
      toast({ title: "Title is required", variant: "destructive" });
      return;
    }
    setSaving(true);

    try {
      const payload = {
        title: form.title.trim(),
        body: form.body.trim() || null,
        youtube_url: form.youtube_url.trim() || null,
        published: form.published ? 1 : 0,
      };

      if (editingId) {
        // Update
        const { error } = await supabase
          .from("whats_up")
          .update(payload)
          .eq("id", editingId);
        if (error) throw error;
        toast({ title: "News updated" });
      } else {
        // Create
        const { error } = await supabase
          .from("whats_up")
          .insert({ ...payload, created_by: session?.nostrHexId || null });
        if (error) throw error;
        toast({ title: "News created" });
      }

      setDialogOpen(false);
      loadItems();
    } catch (err) {
      console.error("Save error:", err);
      toast({ title: "Failed to save", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this news item?")) return;

    try {
      const { error } = await supabase
        .from("whats_up")
        .delete()
        .eq("id", id);
      if (error) throw error;
      toast({ title: "Deleted" });
      setItems((prev) => prev.filter((i) => i.id !== id));
    } catch (err) {
      console.error("Delete error:", err);
      toast({ title: "Failed to delete", variant: "destructive" });
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr + "Z").toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header + Create */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">What's Up News</h2>
          <p className="text-sm text-muted-foreground">
            {items.length} item{items.length !== 1 ? "s" : ""}
          </p>
        </div>
        <Button onClick={openCreate} className="gap-2">
          <Plus className="h-4 w-4" /> New Post
        </Button>
      </div>

      {/* List */}
      {items.length === 0 ? (
        <p className="text-muted-foreground text-center py-8">No news items yet</p>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <Card key={item.id}>
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm">{item.title}</span>
                      {item.youtube_url && (
                        <Youtube className="h-4 w-4 text-red-500 flex-shrink-0" />
                      )}
                      <Badge
                        variant="outline"
                        className={
                          item.published === 1
                            ? "bg-green-500/10 text-green-600 border-green-500/20 text-xs"
                            : "bg-gray-500/10 text-gray-600 border-gray-500/20 text-xs"
                        }
                      >
                        {item.published === 1 ? "Published" : "Draft"}
                      </Badge>
                    </div>
                    {item.body && (
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                        {item.body}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground mt-1">
                      {formatDate(item.created_at)}
                    </p>
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => openEdit(item)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive"
                      onClick={() => handleDelete(item.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit News" : "New News Post"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div>
              <Label>Title *</Label>
              <Input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="News title..."
                className="mt-1"
              />
            </div>

            <div>
              <Label>Body</Label>
              <Textarea
                value={form.body}
                onChange={(e) => setForm({ ...form, body: e.target.value })}
                placeholder="News content..."
                className="mt-1"
                rows={5}
              />
            </div>

            <div>
              <Label>YouTube URL</Label>
              <Input
                value={form.youtube_url}
                onChange={(e) => setForm({ ...form, youtube_url: e.target.value })}
                placeholder="https://www.youtube.com/watch?v=..."
                className="mt-1"
              />
            </div>

            <div className="flex items-center gap-3">
              <Switch
                checked={form.published}
                onCheckedChange={(checked) => setForm({ ...form, published: checked })}
              />
              <Label>Published</Label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" /> Saving...
                </>
              ) : editingId ? (
                "Save Changes"
              ) : (
                "Create"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
