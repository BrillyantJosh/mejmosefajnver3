import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Pencil, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import ProjectForm, { ProjectFormInitialData } from "@/components/100millionideas/ProjectForm";

export default function EditProject() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { session } = useAuth();

  const [initialData, setInitialData] = useState<ProjectFormInitialData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId || !session?.nostrHexId) return;

    const fetchProject = async () => {
      setIsLoading(true);
      try {
        // Fetch from server SQLite — fast, consistent, no relay dependency
        const [projRes, donRes] = await Promise.all([
          fetch(`/api/lanacrowd/projects/${encodeURIComponent(projectId)}`),
          fetch(`/api/lanacrowd/donations/${encodeURIComponent(projectId)}`),
        ]);

        if (!projRes.ok) throw new Error('Project not found');
        const { project: p } = await projRes.json();

        // Permission check
        if (p.pubkey !== session.nostrHexId && p.ownerPubkey !== session.nostrHexId) {
          setError("Project not found or you don't have permission to edit it.");
          return;
        }

        const donJson = donRes.ok ? await donRes.json() : { donations: [] };
        const hasDonations = (donJson.donations?.length ?? 0) > 0;

        setInitialData({
          dTag: p.id,
          title: p.title || "",
          shortDesc: p.shortDesc || "",
          content: p.content || "",
          fiatGoal: String(p.fiatGoal || ""),
          currency: p.currency || "EUR",
          wallet: p.wallet || "",
          responsibilityStatement: p.responsibilityStatement || "",
          projectType: p.projectType || "Inspiration",
          whatType: p.whatType || "",
          status: (p.status as "draft" | "active") || "active",
          coverImage: p.coverImage,
          galleryImages: p.galleryImages || [],
          videoUrls: p.videos || [],
          fileUrls: p.files || [],
          hasDonations,
        });
      } catch (err) {
        console.error("Error fetching project:", err);
        setError(err instanceof Error ? err.message : "Failed to load project");
      } finally {
        setIsLoading(false);
      }
    };

    fetchProject();
  }, [projectId, session?.nostrHexId]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !initialData) {
    return (
      <div className="container mx-auto p-6 max-w-2xl">
        <Button variant="ghost" onClick={() => navigate("/100millionideas/my-projects")} className="mb-4">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
        <p className="text-center text-muted-foreground">{error || "Project not found"}</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 max-w-2xl pb-24">
      <div className="flex items-center gap-3 mb-6">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate("/100millionideas/my-projects")}
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <Pencil className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold">Edit Project</h1>
      </div>

      <ProjectForm
        mode="edit"
        initialData={initialData}
        onSubmitSuccess={() => navigate("/100millionideas/my-projects")}
      />
    </div>
  );
}
