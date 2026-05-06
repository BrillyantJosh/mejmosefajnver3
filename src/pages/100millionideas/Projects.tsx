import { useState, useMemo, useEffect } from "react";
import { useLanacrowdProjects, ProjectFilter } from "@/hooks/useLanacrowdProjects";
import ProjectCard from "@/components/100millionideas/ProjectCard";
import { Loader2, Layers, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent } from "@/components/ui/card";
import { useNavigate } from "react-router-dom";
import { useAdmin } from "@/contexts/AdminContext";
import { useAuth } from "@/contexts/AuthContext";
import { finalizeEvent } from "nostr-tools";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

const hexToBytes = (hex: string): Uint8Array => {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
};

const FILTER_LABELS: Record<ProjectFilter, string> = {
  open: 'Open',
  funded: 'Funded',
  completed: 'Completed',
  all: 'All',
};

const Projects = () => {
  const navigate = useNavigate();
  const { is100MAdmin } = useAdmin();
  const { session } = useAuth();
  const [filter, setFilter] = useState<ProjectFilter>('open');
  const [page, setPage] = useState(1);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Server-side filtered + paginated — reads from SQLite cache.
  // viewerPubkey lets the API include the viewer's own pending submissions
  // (so creators can see their own pre-approval projects in the listing).
  const { projects, total, totalPages, isLoading, refetch } = useLanacrowdProjects(
    filter,
    page,
    '',
    is100MAdmin ? session?.nostrHexId : undefined,
    session?.nostrHexId,
  );

  // Totals across ALL projects in current filter (not just current page) — from /summary
  const [summary, setSummary] = useState<{
    totalProjects: number; totalGoal: number; totalRaised: number;
    remaining: number; percentFunded: number;
  } | null>(null);

  useEffect(() => {
    // Summary always shows public (approved + visible) stats, regardless of admin role.
    fetch(`/api/lanacrowd/summary?filter=${filter}`)
      .then(r => r.ok ? r.json() : null)
      .then(s => setSummary(s))
      .catch(() => setSummary(null));
  }, [filter, actionLoading]);

  const publishNostrEvent = async (eventTemplate: { kind: number; tags: string[][]; content: string }) => {
    if (!session?.nostrPrivateKey) return;
    const signed = finalizeEvent(
      { ...eventTemplate, created_at: Math.floor(Date.now() / 1000) },
      hexToBytes(session.nostrPrivateKey)
    );
    const { data, error } = await supabase.functions.invoke("publish-dm-event", {
      body: { event: signed },
    });
    if (error) console.error("Failed to publish Nostr event:", error);
    else console.log(`✅ Published KIND ${eventTemplate.kind} to ${data?.publishedTo || 0} relays`);
  };

  const patchAdmin = async (dTag: string, patch: Record<string, any>) => {
    const res = await fetch(`/api/lanacrowd/projects/${encodeURIComponent(dTag)}/admin`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminPubkey: session?.nostrHexId, ...patch }),
    });
    if (!res.ok) throw new Error(`Admin update failed: HTTP ${res.status}`);
  };

  const handleToggleApproved = async (dTag: string) => {
    if (!session?.nostrHexId) return;
    setActionLoading(dTag);
    try {
      const p = projects.find(x => x.id === dTag);
      const nowApproved = !(p?.isApproved ?? true);
      await patchAdmin(dTag, { is_approved: nowApproved });
      await refetch();
      toast({
        title: nowApproved ? "Project Approved" : "Project set to Pending",
        description: nowApproved ? "Users can now donate" : "Donations paused until approved",
      });
    } catch (err) {
      console.error(err);
      toast({ title: "Error", description: "Failed to update approval", variant: "destructive" });
    } finally {
      setActionLoading(null);
    }
  };

  const handleToggleHidden = async (dTag: string) => {
    if (!session?.nostrHexId) return;
    setActionLoading(dTag);
    try {
      const p = projects.find(x => x.id === dTag);
      const nowHidden = !p?.isHidden;

      // Publish KIND 31235 visibility event to Nostr (for decentralized record)
      if (nowHidden) {
        await publishNostrEvent({
          kind: 31235,
          tags: [
            ["d", dTag],
            ["service", "lanacrowd"],
            ["status", "blocked"],
            ["p", session.nostrHexId, "reviewer"],
          ],
          content: "",
        });
      }

      await patchAdmin(dTag, { is_hidden: nowHidden });
      await refetch();
      toast({
        title: nowHidden ? "Project Hidden" : "Project Visible",
        description: nowHidden ? "Hidden from public view" : "Visible again",
      });
    } catch (err) {
      console.error(err);
      toast({ title: "Error", description: "Failed to update visibility", variant: "destructive" });
    } finally {
      setActionLoading(null);
    }
  };

  const handleToggleCompleted = async (dTag: string, comment?: string) => {
    if (!session?.nostrHexId) return;
    const p = projects.find(x => x.id === dTag);
    const nowCompleted = !p?.isCompleted;

    if (nowCompleted) {
      const goal = p?.fiatGoal || 0;
      const raised = p?.totalRaised || 0;
      if (goal > 0 && raised < goal * 0.99) {
        toast({
          title: "Cannot complete project",
          description: `Raised €${raised.toFixed(0)} of €${goal.toFixed(0)} (${Math.round((raised / goal) * 100)}%). Project must be fully funded first.`,
          variant: "destructive",
        });
        return;
      }
    }

    setActionLoading(dTag);
    try {
      if (nowCompleted && comment) {
        await publishNostrEvent({
          kind: 60201,
          tags: [
            ["service", "lanacrowd"],
            ["project", dTag],
            ["p", session.nostrHexId, "reviewer"],
            ["status", "completed"],
            ["timestamp_completed", String(Math.floor(Date.now() / 1000))],
          ],
          content: comment,
        });
      }

      await patchAdmin(dTag, {
        is_completed: nowCompleted,
        completion_comment: nowCompleted ? (comment || null) : null,
      });
      await refetch();
      toast({
        title: nowCompleted ? "Project Completed" : "Completion Removed",
        description: nowCompleted ? "Marked completed and recorded on Nostr" : "Completion status removed",
      });
    } catch (err) {
      console.error(err);
      toast({ title: "Error", description: "Failed to update project status", variant: "destructive" });
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Projects</h1>
          <p className="text-muted-foreground mt-2">
            Browse and discover innovative projects on LanaCrowd
          </p>
          {!isLoading && (
            <p className="text-sm text-muted-foreground mt-1">
              {total} project{total !== 1 ? 's' : ''}
            </p>
          )}
        </div>
        <Button
          onClick={() => navigate('/100millionideas/batch-funding')}
          className="bg-green-600 hover:bg-green-700 text-white"
        >
          <Layers className="h-4 w-4 mr-2" />
          Batch Funding
        </Button>
      </div>

      {/* Aggregate Funding Bar */}
      {summary && summary.totalProjects > 0 && (
        <Card className="border-green-500/20 bg-green-500/5">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-baseline justify-between flex-wrap gap-2">
              <div>
                <span className="text-2xl font-bold text-green-600">
                  €{summary.totalRaised.toFixed(0)}
                </span>
                <span className="text-sm text-muted-foreground ml-2">
                  raised of €{summary.totalGoal.toFixed(0)} goal
                </span>
              </div>
              <div className="text-sm font-semibold">
                {summary.percentFunded.toFixed(1)}% funded
              </div>
            </div>
            <Progress value={Math.min(summary.percentFunded, 100)} className="h-2" />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{summary.totalProjects} {FILTER_LABELS[filter].toLowerCase()} projects</span>
              <span className="font-medium">
                Still needs: <span className="text-foreground">€{summary.remaining.toFixed(0)}</span>
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filter Tabs */}
      <div className="flex flex-wrap gap-2">
        {(Object.keys(FILTER_LABELS) as ProjectFilter[]).map(f => (
          <button
            key={f}
            onClick={() => { setFilter(f); setPage(1); }}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              filter === f
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            {FILTER_LABELS[f]}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <span className="ml-2 text-muted-foreground">Loading projects...</span>
        </div>
      ) : projects.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-muted-foreground">No projects found for this filter.</p>
          <p className="text-sm text-muted-foreground mt-2">Try selecting a different filter.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {projects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                isModuleAdmin={is100MAdmin}
                isHidden={project.isHidden}
                isCompleted={project.isCompleted}
                isApproved={project.isApproved}
                isFunded={project.isFunded}
                completionComment={project.completionComment}
                onToggleHidden={handleToggleHidden}
                onToggleCompleted={handleToggleCompleted}
                onToggleApproved={handleToggleApproved}
                actionLoading={actionLoading}
              />
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-3 pt-4">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1}
              >
                <ChevronLeft className="h-4 w-4" />
                Prev
              </Button>
              <span className="text-sm text-muted-foreground">
                Page {page} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default Projects;
