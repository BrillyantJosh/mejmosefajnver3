import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Pencil, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
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
        // Fetch project event
        const { data: projectData, error: projectError } = await supabase.functions.invoke(
          "query-nostr-events",
          {
            body: {
              filter: {
                kinds: [31234],
                "#d": [projectId],
              },
              timeout: 15000,
            },
          }
        );

        if (projectError) throw new Error(projectError.message);

        const events = projectData?.events || [];

        // Find the latest event owned by the current user
        // Check both event.pubkey and owner p-tag (projects from 100million.fun have different signer)
        const userEvent = events
          .filter((e: any) => {
            if (e.pubkey === session.nostrHexId) return true;
            const ownerTag = e.tags?.find((t: string[]) => t[0] === 'p' && t[2] === 'owner');
            return ownerTag?.[1] === session.nostrHexId;
          })
          .sort((a: any, b: any) => b.created_at - a.created_at)[0];

        if (!userEvent) {
          setError("Project not found or you don't have permission to edit it.");
          return;
        }

        // Parse tags
        const getTag = (name: string): string | undefined => {
          const tag = userEvent.tags.find((t: string[]) => t[0] === name);
          return tag?.[1];
        };

        const getAllTags = (name: string): string[][] => {
          return userEvent.tags.filter((t: string[]) => t[0] === name);
        };

        // Check for donations
        const { data: donationData } = await supabase.functions.invoke(
          "query-nostr-events",
          {
            body: {
              filter: {
                kinds: [60200],
                "#p": [session.nostrHexId],
                limit: 1,
              },
              timeout: 10000,
            },
          }
        );

        const donationEvents = donationData?.events || [];
        const projectDonations = donationEvents.filter((e: any) => {
          const pt = e.tags.find((t: string[]) => t[0] === "project")?.[1];
          const ownerTag = e.tags.find(
            (t: string[]) => t[0] === "p" && t[2] === "project_owner"
          );
          return pt === projectId && ownerTag?.[1] === session.nostrHexId;
        });

        const hasDonations = projectDonations.length > 0;

        // Parse images
        const imgTags = getAllTags("img");
        const coverImage = imgTags.find((t) => t[2] === "cover")?.[1];
        const galleryImages = imgTags.filter((t) => t[2] === "gallery").map((t) => t[1]);

        // Parse videos and files
        const videoTags = getAllTags("video");
        const fileTags = getAllTags("file");

        setInitialData({
          dTag: projectId,
          title: getTag("title") || "",
          shortDesc: getTag("short_desc") || "",
          content: userEvent.content || "",
          fiatGoal: getTag("fiat_goal") || "",
          currency: getTag("currency") || "EUR",
          wallet: getTag("wallet") || "",
          responsibilityStatement: getTag("responsibility_statement") || "",
          projectType: getTag("project_type") || "Inspiration",
          status: (getTag("status") as "draft" | "active") || "active",
          coverImage,
          galleryImages,
          videoUrls: videoTags.map((t) => t[1]),
          fileUrls: fileTags.map((t) => t[1]),
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
