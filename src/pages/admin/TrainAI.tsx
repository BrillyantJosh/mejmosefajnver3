import { useState, useEffect } from "react";
import { useAdmin } from "@/contexts/AdminContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Brain, Plus, Trash2, Send, Loader2, BookOpen, Eye, CheckCircle, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface KnowledgeEntry {
  id: string;
  slug: string;
  revision: number;
  status: string;
  lang: string;
  title: string;
  summary: string;
  body: string | null;
  topic: string | null;
  keywords: string[] | null;
  nostr_event_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

interface UnsupportedPrompt {
  id: string;
  prompt: string;
  ai_response: string | null;
  context_summary: string | null;
  nostr_hex_id: string;
  created_at: string;
}

const TOPICS = [
  { value: 'service', label: 'Service' },
  { value: 'concept', label: 'Concept' },
  { value: 'rule', label: 'Rule' },
  { value: 'tech', label: 'Tech' },
  { value: 'faq', label: 'FAQ' },
];

const LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'sl', label: 'Slovenščina' },
  { value: 'de', label: 'Deutsch' },
  { value: 'hr', label: 'Hrvatski' },
  { value: 'hu', label: 'Magyar' },
  { value: 'it', label: 'Italiano' },
  { value: 'es', label: 'Español' },
  { value: 'pt', label: 'Português' },
];

const STATUSES = [
  { value: 'draft', label: 'Draft' },
  { value: 'active', label: 'Active' },
  { value: 'deprecated', label: 'Deprecated' },
];

export default function TrainAI() {
  const { isAdmin } = useAdmin();
  const [knowledgeEntries, setKnowledgeEntries] = useState<KnowledgeEntry[]>([]);
  const [unsupportedPrompts, setUnsupportedPrompts] = useState<UnsupportedPrompt[]>([]);
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState<string | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [selectedPrompt, setSelectedPrompt] = useState<UnsupportedPrompt | null>(null);

  // Form state
  const [formData, setFormData] = useState({
    slug: '',
    title: '',
    summary: '',
    body: '',
    topic: '',
    lang: 'en',
    status: 'draft',
    keywords: '',
  });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      // Fetch knowledge entries
      const { data: knowledge, error: knowledgeError } = await supabase
        .from('ai_knowledge')
        .select('*')
        .order('created_at', { ascending: false });

      if (knowledgeError) throw knowledgeError;
      setKnowledgeEntries(knowledge || []);

      // Fetch unsupported prompts
      const { data: prompts, error: promptsError } = await supabase
        .from('ai_unsupported_prompts')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);

      if (promptsError) throw promptsError;
      setUnsupportedPrompts(prompts || []);

    } catch (error) {
      console.error('Error fetching data:', error);
      toast.error('Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const resetForm = () => {
    setFormData({
      slug: '',
      title: '',
      summary: '',
      body: '',
      topic: '',
      lang: 'en',
      status: 'draft',
      keywords: '',
    });
  };

  const handleAddKnowledge = async () => {
    if (!formData.slug || !formData.title || !formData.summary) {
      toast.error('Please fill in required fields (slug, title, summary)');
      return;
    }

    try {
      // Check if slug exists, get max revision
      const { data: existing } = await supabase
        .from('ai_knowledge')
        .select('revision')
        .eq('slug', formData.slug)
        .order('revision', { ascending: false })
        .limit(1);

      const newRevision = existing && existing.length > 0 ? existing[0].revision + 1 : 1;

      const keywordsArray = formData.keywords
        .split(',')
        .map(k => k.trim())
        .filter(k => k.length > 0);

      const { error } = await supabase
        .from('ai_knowledge')
        .insert({
          slug: formData.slug,
          title: formData.title,
          summary: formData.summary,
          body: formData.body || null,
          topic: formData.topic || null,
          lang: formData.lang,
          status: formData.status,
          keywords: keywordsArray.length > 0 ? keywordsArray : null,
          revision: newRevision,
        });

      if (error) throw error;

      toast.success('Knowledge entry added successfully');
      setShowAddDialog(false);
      resetForm();
      fetchData();

    } catch (error) {
      console.error('Error adding knowledge:', error);
      toast.error('Failed to add knowledge entry');
    }
  };

  const handlePublishToNostr = async (entry: KnowledgeEntry) => {
    setPublishing(entry.id);
    try {
      const { data, error } = await supabase.functions.invoke('publish-knowledge', {
        body: { knowledgeId: entry.id }
      });

      if (error) throw error;

      if (data.success) {
        toast.success(`Published to Nostr! Event ID: ${data.eventId.substring(0, 16)}...`);
        fetchData();
      } else {
        throw new Error(data.error);
      }

    } catch (error) {
      console.error('Error publishing to Nostr:', error);
      toast.error(`Failed to publish: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setPublishing(null);
    }
  };

  const handleDeleteEntry = async (id: string) => {
    if (!confirm('Are you sure you want to delete this entry?')) return;

    try {
      const { error } = await supabase
        .from('ai_knowledge')
        .delete()
        .eq('id', id);

      if (error) throw error;

      toast.success('Entry deleted');
      fetchData();
    } catch (error) {
      console.error('Error deleting entry:', error);
      toast.error('Failed to delete entry');
    }
  };

  const handleUsePromptForKnowledge = (prompt: UnsupportedPrompt) => {
    setFormData({
      slug: prompt.prompt.toLowerCase().replace(/[^a-z0-9]+/g, '-').substring(0, 50),
      title: prompt.prompt.substring(0, 100),
      summary: '',
      body: `Original question: ${prompt.prompt}\n\nAI Response: ${prompt.ai_response || 'N/A'}\n\nContext: ${prompt.context_summary || 'N/A'}`,
      topic: 'faq',
      lang: 'sl',
      status: 'draft',
      keywords: '',
    });
    setSelectedPrompt(null);
    setShowAddDialog(true);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'bg-green-500';
      case 'draft': return 'bg-yellow-500';
      case 'deprecated': return 'bg-gray-500';
      default: return 'bg-gray-400';
    }
  };

  if (loading) {
    return (
      <div className="container max-w-6xl mx-auto py-8 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="container max-w-6xl mx-auto py-8 space-y-8">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Brain className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-3xl font-bold">Train AI</h1>
            <p className="text-muted-foreground">Manage AI knowledge base and learning</p>
          </div>
        </div>

        <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
          <DialogTrigger asChild>
            <Button onClick={() => { resetForm(); setShowAddDialog(true); }}>
              <Plus className="h-4 w-4 mr-2" />
              Add Knowledge
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Add Knowledge Entry</DialogTitle>
              <DialogDescription>
                Create a new knowledge entry for AI learning. This will be published to Nostr as KIND 99991.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="slug">Slug *</Label>
                  <Input
                    id="slug"
                    value={formData.slug}
                    onChange={(e) => handleInputChange('slug', e.target.value)}
                    placeholder="e.g., lana8wonder"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lang">Language</Label>
                  <Select value={formData.lang} onValueChange={(v) => handleInputChange('lang', v)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {LANGUAGES.map(lang => (
                        <SelectItem key={lang.value} value={lang.value}>{lang.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="title">Title *</Label>
                <Input
                  id="title"
                  value={formData.title}
                  onChange={(e) => handleInputChange('title', e.target.value)}
                  placeholder="Knowledge entry title"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="summary">Summary * (2-5 sentences)</Label>
                <Textarea
                  id="summary"
                  value={formData.summary}
                  onChange={(e) => handleInputChange('summary', e.target.value)}
                  placeholder="Brief canonical explanation..."
                  rows={3}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="body">Body (Extended Description)</Label>
                <Textarea
                  id="body"
                  value={formData.body}
                  onChange={(e) => handleInputChange('body', e.target.value)}
                  placeholder="Extended description. Markdown allowed."
                  rows={6}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="topic">Topic</Label>
                  <Select value={formData.topic} onValueChange={(v) => handleInputChange('topic', v)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select topic" />
                    </SelectTrigger>
                    <SelectContent>
                      {TOPICS.map(topic => (
                        <SelectItem key={topic.value} value={topic.value}>{topic.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="status">Status</Label>
                  <Select value={formData.status} onValueChange={(v) => handleInputChange('status', v)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STATUSES.map(status => (
                        <SelectItem key={status.value} value={status.value}>{status.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="keywords">Keywords (comma separated)</Label>
                <Input
                  id="keywords"
                  value={formData.keywords}
                  onChange={(e) => handleInputChange('keywords', e.target.value)}
                  placeholder="lana, wallet, split"
                />
              </div>

              <Button onClick={handleAddKnowledge} className="w-full">
                <Plus className="h-4 w-4 mr-2" />
                Add Knowledge Entry
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Unsupported Prompts */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="h-5 w-5" />
            Unsupported Prompts ({unsupportedPrompts.length})
          </CardTitle>
          <CardDescription>
            Questions the AI couldn't answer confidently. Use these to create new knowledge entries.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {unsupportedPrompts.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No unsupported prompts yet</p>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {unsupportedPrompts.map((prompt) => (
                <div 
                  key={prompt.id}
                  className="flex items-center justify-between p-3 border rounded-lg hover:bg-accent/5 transition-colors"
                >
                  <div className="flex-1 min-w-0 mr-4">
                    <p className="text-sm font-medium truncate">{prompt.prompt}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(prompt.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Dialog>
                      <DialogTrigger asChild>
                        <Button variant="ghost" size="sm" onClick={() => setSelectedPrompt(prompt)}>
                          <Eye className="h-4 w-4" />
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>Prompt Details</DialogTitle>
                        </DialogHeader>
                        <div className="space-y-4">
                          <div>
                            <Label>Question</Label>
                            <p className="text-sm mt-1">{prompt.prompt}</p>
                          </div>
                          {prompt.ai_response && (
                            <div>
                              <Label>AI Response</Label>
                              <p className="text-sm mt-1 text-muted-foreground">{prompt.ai_response}</p>
                            </div>
                          )}
                          {prompt.context_summary && (
                            <div>
                              <Label>Context</Label>
                              <p className="text-sm mt-1 text-muted-foreground">{prompt.context_summary}</p>
                            </div>
                          )}
                          <Button onClick={() => handleUsePromptForKnowledge(prompt)} className="w-full">
                            <Plus className="h-4 w-4 mr-2" />
                            Create Knowledge from This
                          </Button>
                        </div>
                      </DialogContent>
                    </Dialog>
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => handleUsePromptForKnowledge(prompt)}
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Knowledge Entries */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5" />
            Knowledge Base ({knowledgeEntries.length})
          </CardTitle>
          <CardDescription>
            Canonical knowledge entries published to Nostr as KIND 99991
          </CardDescription>
        </CardHeader>
        <CardContent>
          {knowledgeEntries.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No knowledge entries yet</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Slug</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Rev</TableHead>
                  <TableHead>Lang</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Published</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {knowledgeEntries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="font-mono text-sm">{entry.slug}</TableCell>
                    <TableCell className="max-w-xs truncate">{entry.title}</TableCell>
                    <TableCell>{entry.revision}</TableCell>
                    <TableCell className="uppercase">{entry.lang}</TableCell>
                    <TableCell>
                      <Badge className={`${getStatusColor(entry.status)} text-white`}>
                        {entry.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {entry.nostr_event_id ? (
                        <CheckCircle className="h-4 w-4 text-green-500" />
                      ) : (
                        <XCircle className="h-4 w-4 text-gray-400" />
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handlePublishToNostr(entry)}
                          disabled={publishing === entry.id}
                        >
                          {publishing === entry.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Send className="h-4 w-4" />
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeleteEntry(entry.id)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
