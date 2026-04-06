import { useState, useMemo } from "react";
import { useNostrProjects, ProjectData } from "@/hooks/useNostrProjects";
import { useNostrAllProjectDonations } from "@/hooks/useNostrAllProjectDonations";
import ProjectCard from "@/components/100millionideas/ProjectCard";
import ProjectsSummaryBar from "@/components/100millionideas/ProjectsSummaryBar";
import { Loader2, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { useAdmin } from "@/contexts/AdminContext";
import { useAuth } from "@/contexts/AuthContext";
import { ProjectOverrides } from "@/types/admin";
import { finalizeEvent } from "nostr-tools";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

type ProjectFilter = 'open' | 'all' | 'completed' | 'funded';

const hexToBytes = (hex: string): Uint8Array => {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
};

const Projects = () => {
  const { projects, isLoading } = useNostrProjects();
  const navigate = useNavigate();
  const { is100MAdmin, appSettings, updateProjectOverrides } = useAdmin();
  const { session } = useAuth();
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [filter, setFilter] = useState<ProjectFilter>('open');

  const overrides: ProjectOverrides = appSettings?.project_overrides || {};

  // For non-admins, filter out hidden projects
  const visibleProjects = is100MAdmin
    ? projects
    : projects.filter(p => !overrides[p.id]?.hidden);

  // Fetch per-project donation totals for funded detection
  const projectIds = useMemo(() => visibleProjects.map(p => p.id), [visibleProjects]);
  const { summary: donationSummary } = useNostrAllProjectDonations(projectIds);

  // Check if a project is fully funded (raised >= 99% of goal)
  const isFullyFunded = (p: ProjectData): boolean => {
    const goal = parseFloat(p.fiatGoal);
    if (!goal || goal <= 0) return false;
    const raised = donationSummary.perProject.get(p.id) || 0;
    return raised >= goal * 0.99;
  };

  // Apply user filter
  // "Open" = still collecting funds (not fully funded, not completed, not blocked)
  // "Funded" = fully funded (raised >= 99% of goal)
  // "Completed" = admin marked as completed
  const filteredProjects = useMemo(() => {
    switch (filter) {
      case 'open':
        return visibleProjects.filter(p =>
          !overrides[p.id]?.completed && !p.isBlocked && !isFullyFunded(p)
        );
      case 'funded':
        return visibleProjects.filter(p => isFullyFunded(p) && !overrides[p.id]?.completed);
      case 'completed':
        return visibleProjects.filter(p => !!overrides[p.id]?.completed);
      case 'all':
      default:
        return visibleProjects;
    }
  }, [visibleProjects, filter, overrides, donationSummary.perProject]);

  const filterOptions: { value: ProjectFilter; label: string; count: number }[] = useMemo(() => {
    const openCount = visibleProjects.filter(p => !overrides[p.id]?.completed && !p.isBlocked && !isFullyFunded(p)).length;
    const fundedCount = visibleProjects.filter(p => isFullyFunded(p) && !overrides[p.id]?.completed).length;
    const completedCount = visibleProjects.filter(p => !!overrides[p.id]?.completed).length;
    return [
      { value: 'open' as ProjectFilter, label: 'Open', count: openCount },
      { value: 'funded' as ProjectFilter, label: 'Funded', count: fundedCount },
      { value: 'completed' as ProjectFilter, label: 'Completed', count: completedCount },
      { value: 'all' as ProjectFilter, label: 'All', count: visibleProjects.length },
    ];
  }, [visibleProjects, overrides, donationSummary.perProject]);

  const publishNostrEvent = async (eventTemplate: { kind: number; tags: string[][]; content: string }) => {
    if (!session?.nostrPrivateKey) return;

    const signed = finalizeEvent(
      { ...eventTemplate, created_at: Math.floor(Date.now() / 1000) },
      hexToBytes(session.nostrPrivateKey)
    );

    const { data, error } = await supabase.functions.invoke("publish-dm-event", {
      body: { event: signed },
    });

    if (error) {
      console.error("Failed to publish Nostr event:", error);
    } else {
      console.log(`✅ Published KIND ${eventTemplate.kind} to ${data?.publishedTo || 0} relays`);
    }
  };

  const handleToggleHidden = async (dTag: string) => {
    if (!session?.nostrHexId) return;
    setActionLoading(dTag);

    try {
      const current = overrides[dTag] || {};
      const nowHidden = !current.hidden;

      // Publish KIND 31235 visibility event to Nostr
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

      // Save to app_settings
      const updated: ProjectOverrides = {
        ...overrides,
        [dTag]: { ...current, hidden: nowHidden },
      };
      await updateProjectOverrides(updated);

      toast({
        title: nowHidden ? "Project Hidden" : "Project Visible",
        description: nowHidden
          ? "Project hidden from public view and recorded on Nostr"
          : "Project is now visible again",
      });
    } catch (error) {
      console.error("Error toggling project visibility:", error);
      toast({ title: "Error", description: "Failed to update project visibility", variant: "destructive" });
    } finally {
      setActionLoading(null);
    }
  };

  const handleToggleCompleted = async (dTag: string, comment?: string) => {
    if (!session?.nostrHexId) return;

    const current = overrides[dTag] || {};
    const nowCompleted = !current.completed;

    // Block completing a project that is not fully funded
    if (nowCompleted) {
      const project = visibleProjects.find(p => p.id === dTag);
      if (project) {
        const goal = parseFloat(project.fiatGoal);
        const raised = donationSummary.perProject.get(dTag) || 0;
        if (goal > 0 && raised < goal * 0.99) {
          toast({
            title: "Cannot complete project",
            description: `This project has raised €${raised.toFixed(0)} of €${goal.toFixed(0)} goal (${Math.round((raised / goal) * 100)}%). A project can only be marked as completed once it is fully funded.`,
            variant: "destructive",
          });
          return;
        }
      }
    }

    setActionLoading(dTag);

    try {

      // Publish KIND 60201 completion event to Nostr
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

      // Save to app_settings
      const updated: ProjectOverrides = {
        ...overrides,
        [dTag]: {
          ...current,
          completed: nowCompleted,
          completionComment: nowCompleted ? comment : undefined,
        },
      };
      await updateProjectOverrides(updated);

      toast({
        title: nowCompleted ? "Project Completed" : "Completion Removed",
        description: nowCompleted
          ? "Project marked as completed and recorded on Nostr (KIND 60201)"
          : "Completion status removed",
      });
    } catch (error) {
      console.error("Error toggling project completion:", error);
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
        </div>
        <Button
          onClick={() => navigate('/100millionideas/batch-funding')}
          className="bg-green-600 hover:bg-green-700 text-white"
        >
          <Layers className="h-4 w-4 mr-2" />
          Batch Funding
        </Button>
      </div>

      <ProjectsSummaryBar projects={filteredProjects} donationSummary={donationSummary} isLoading={isLoading} />

      {/* Filter Tabs */}
      <div className="flex flex-wrap gap-2">
        {filterOptions.map(opt => (
          <button
            key={opt.value}
            onClick={() => setFilter(opt.value)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              filter === opt.value
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            {opt.label}
            <span className={`ml-1.5 text-xs ${filter === opt.value ? 'text-primary-foreground/70' : 'text-muted-foreground/60'}`}>
              {opt.count}
            </span>
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <span className="ml-2 text-muted-foreground">Loading projects...</span>
        </div>
      ) : filteredProjects.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-muted-foreground">No projects found for this filter.</p>
          <p className="text-sm text-muted-foreground mt-2">
            Try selecting a different filter above.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredProjects.map((project) => (
            <ProjectCard
              key={project.eventId}
              project={project}
              isModuleAdmin={is100MAdmin}
              isHidden={!!overrides[project.id]?.hidden}
              isCompleted={!!overrides[project.id]?.completed}
              completionComment={overrides[project.id]?.completionComment}
              onToggleHidden={handleToggleHidden}
              onToggleCompleted={handleToggleCompleted}
              actionLoading={actionLoading}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default Projects;
