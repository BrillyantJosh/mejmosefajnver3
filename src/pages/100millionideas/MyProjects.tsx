import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { PlusCircle, Pencil, ImageOff, Trash2, Loader2 } from "lucide-react";
import { useMyLanacrowdProjects } from "@/hooks/useMyLanacrowdProjects";
import { LanacrowdProject } from "@/hooks/useLanacrowdProjects";
import { useAuth } from "@/contexts/AuthContext";
import { useSystemParameters } from "@/contexts/SystemParametersContext";
import { SimplePool, finalizeEvent } from "nostr-tools";
import { toast } from "@/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const MyProjects = () => {
  const navigate = useNavigate();
  const { projects, isLoading, refetch } = useMyLanacrowdProjects();
  const { session } = useAuth();
  const { parameters: systemParameters } = useSystemParameters();
  const relays = systemParameters?.relays || [];

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<LanacrowdProject | null>(null);

  // ── Delete a project that has received zero donations ───────────────────
  // Server enforces ownership + zero-donations; we still publish a NIP-09
  // KIND 5 deletion request to relays so the original KIND 31234 event is
  // taken down everywhere it was indexed.
  const handleDelete = async (project: LanacrowdProject) => {
    if (!session?.nostrPrivateKey || !session.nostrHexId) return;

    if ((project.donationCount || 0) > 0 || (project.totalRaised || 0) > 0) {
      toast({
        title: "Cannot delete",
        description: "This project has donations and cannot be deleted.",
        variant: "destructive",
      });
      return;
    }

    setDeletingId(project.id);
    try {
      // 1. Server-side delete (authoritative — blocks if any donation exists)
      const res = await fetch(`/api/lanacrowd/projects/${encodeURIComponent(project.id)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requesterPubkey: session.nostrHexId }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }

      // 2. Publish NIP-09 KIND 5 deletion request to relays so the original
      //    KIND 31234 is dropped from relay indexes (best-effort, non-fatal).
      if (relays.length > 0) {
        try {
          const privKeyBytes = new Uint8Array(
            session.nostrPrivateKey.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)),
          );
          // d-tag projects use the parameterized address `kind:pubkey:d`
          const aTag = `31234:${project.pubkey || session.nostrHexId}:${project.id}`;
          const deletionEvent = finalizeEvent(
            {
              kind: 5,
              created_at: Math.floor(Date.now() / 1000),
              tags: [
                ["a", aTag],
                ["k", "31234"],
              ],
              content: "Project deleted by owner",
            },
            privKeyBytes,
          );
          const pool = new SimplePool();
          await Promise.allSettled(pool.publish(relays, deletionEvent));
        } catch (relayErr) {
          console.warn("KIND 5 publish failed (server delete already succeeded):", relayErr);
        }
      }

      toast({
        title: "Project deleted",
        description: "The project has been removed.",
      });
      await refetch();
    } catch (err: any) {
      console.error("Delete project failed:", err);
      toast({
        title: "Delete failed",
        description: err.message || "Could not delete project.",
        variant: "destructive",
      });
    } finally {
      setDeletingId(null);
      setConfirmDelete(null);
    }
  };

  if (isLoading) {
    return (
      <div className="container mx-auto p-6 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold">My Projects</h1>
        </div>
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">My Projects</h1>
          <p className="text-muted-foreground mt-1">
            {projects.length} project{projects.length !== 1 ? "s" : ""}
          </p>
        </div>
        <Button
          onClick={() => navigate("/100millionideas/create-project")}
          className="gap-2"
        >
          <PlusCircle className="h-4 w-4" />
          New Project
        </Button>
      </div>

      {projects.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center space-y-4">
            <p className="text-muted-foreground">You haven't created any projects yet.</p>
            <Button
              onClick={() => navigate("/100millionideas/create-project")}
              className="gap-2"
            >
              <PlusCircle className="h-4 w-4" />
              Create Your First Project
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {projects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              isCompleted={project.isCompleted}
              isDeleting={deletingId === project.id}
              onRequestDelete={() => setConfirmDelete(project)}
            />
          ))}
        </div>
      )}

      {/* Delete confirmation */}
      <AlertDialog
        open={!!confirmDelete}
        onOpenChange={(open) => !open && setConfirmDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this project?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDelete && (
                <>
                  <span className="font-medium">"{confirmDelete.title}"</span> will be permanently
                  removed from LanaCrowd and a deletion request will be sent to Nostr relays.
                  This cannot be undone.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={!!deletingId}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (confirmDelete) handleDelete(confirmDelete);
              }}
              disabled={!!deletingId}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deletingId ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  Deleting…
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4 mr-1" />
                  Delete
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

interface ProjectCardProps {
  project: LanacrowdProject;
  isCompleted: boolean;
  isDeleting: boolean;
  onRequestDelete: () => void;
}

const ProjectCard = ({ project, isCompleted, isDeleting, onRequestDelete }: ProjectCardProps) => {
  const navigate = useNavigate();

  const goal = project.fiatGoal || 0;
  const raised = project.totalRaised || 0;
  const progressPercent = goal > 0 ? Math.min((raised / goal) * 100, 100) : 0;
  const isFullyFunded = goal > 0 && raised >= goal * 0.99;

  // Deletion is only allowed when zero donations have arrived. Once any
  // contributor has paid in, the project is permanent — we never want to
  // erase a record that someone has financially backed.
  const hasNoDonations =
    (project.donationCount || 0) === 0 && (project.totalRaised || 0) === 0;
  const canDelete = hasNoDonations && !isCompleted;

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-0">
        <div className="flex flex-col sm:flex-row">
          {/* Cover image */}
          <div className="sm:w-40 h-32 sm:h-auto bg-muted flex-shrink-0 relative">
            {project.coverImage ? (
              <img
                src={project.coverImage}
                alt={project.title}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <ImageOff className="h-8 w-8 text-muted-foreground/50" />
              </div>
            )}
            {/* Status overlay on image */}
            {(isFullyFunded || isCompleted) && (
              <div className="absolute top-2 left-2">
                {isCompleted ? (
                  <Badge className="bg-gray-600 text-white text-xs">Completed</Badge>
                ) : isFullyFunded ? (
                  <Badge className="bg-green-500 text-white text-xs">Funded ✓</Badge>
                ) : null}
              </div>
            )}
          </div>

          {/* Content */}
          <div className="flex-1 p-4 flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <h3 className="font-semibold text-lg">{project.title}</h3>
                <Badge variant={project.status === "active" ? "default" : "secondary"}>
                  {project.status}
                </Badge>
                {isFullyFunded && !isCompleted && (
                  <Badge className="bg-green-500 text-white">Funded ✓</Badge>
                )}
                {isCompleted && (
                  <Badge variant="secondary">Completed</Badge>
                )}
                {project.isHidden && (
                  <Badge variant="destructive">Hidden</Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
                {project.shortDesc}
              </p>
            </div>

            {/* Funding progress */}
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">
                  {raised.toFixed(2)} / {goal.toFixed(2)} {project.currency}
                </span>
                <span className="font-medium">{progressPercent.toFixed(1)}%</span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <div className="flex justify-between items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  {project.donationCount} donation{project.donationCount !== 1 ? "s" : ""}
                </span>
                <div className="flex items-center gap-2">
                  {canDelete && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={onRequestDelete}
                      disabled={isDeleting}
                      className="gap-1 text-destructive hover:text-destructive border-destructive/30 hover:border-destructive/60 hover:bg-destructive/5"
                      title="Delete project (no donations yet)"
                    >
                      {isDeleting ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Trash2 className="h-3 w-3" />
                      )}
                      Delete
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => navigate(`/100millionideas/edit-project/${project.id}`)}
                    className="gap-1"
                  >
                    <Pencil className="h-3 w-3" />
                    Edit
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default MyProjects;
