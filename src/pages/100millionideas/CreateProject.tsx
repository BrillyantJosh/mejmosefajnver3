import { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowLeft, PlusCircle, Ban, Sparkles, Loader2, Copy } from "lucide-react";
import ProjectForm, { ProjectFormInitialData } from "@/components/100millionideas/ProjectForm";
import CreateProjectGate from "@/components/100millionideas/CreateProjectGate";
import { useAdmin } from "@/contexts/AdminContext";
import { useNostrLana8Wonder } from "@/hooks/useNostrLana8Wonder";
import { useLang, useTranslation } from "@/i18n/I18nContext";
import millionideasTranslations from "@/i18n/modules/millionideas";

export default function CreateProject() {
  const navigate = useNavigate();
  const location = useLocation();
  const { appSettings } = useAdmin();
  const { status: lana8WonderStatus, isLoading: lana8WonderLoading } = useNostrLana8Wonder();
  const lang = useLang();
  const { t } = useTranslation(millionideasTranslations);
  // Applicants must confirm the basis-for-participation gate before the form opens.
  const [agreed, setAgreed] = useState(false);

  // "Duplicate" flow: MyProjects navigates here with a source project id. We fetch that
  // project and pre-fill the form; ProjectForm in create mode always generates a fresh
  // id, so submitting saves a NEW project (the user just tweaks e.g. this month's costs).
  const duplicateFromId = (location.state as { duplicateFromId?: string } | null)?.duplicateFromId;
  const [dupData, setDupData] = useState<ProjectFormInitialData | null>(null);
  const [dupLoading, setDupLoading] = useState<boolean>(!!duplicateFromId);

  useEffect(() => {
    if (!duplicateFromId) return;
    let alive = true;
    setDupLoading(true);
    (async () => {
      try {
        const res = await fetch(`/api/lanacrowd/projects/${encodeURIComponent(duplicateFromId)}`);
        if (!res.ok) throw new Error("Project not found");
        const { project: p } = await res.json();
        if (!alive) return;
        setDupData({
          dTag: p.id, // ignored in create mode (a fresh id is generated); kept for type completeness
          title: p.title ? `${p.title} (Copy)` : "",
          shortDesc: p.shortDesc || "",
          content: p.content || "",
          fiatGoal: String(p.fiatGoal || ""),
          currency: p.currency || "EUR",
          wallet: p.wallet || "",
          responsibilityStatement: p.responsibilityStatement || "",
          projectType: p.projectType || "Inspiration",
          whatType: p.whatType || "",
          status: (p.status as "draft" | "active") || "draft",
          coverImage: p.coverImage,
          galleryImages: p.galleryImages || [],
          videoUrls: p.videos || [],
          fileUrls: p.files || [],
          hasDonations: false, // a duplicate starts fresh
        });
      } catch (e) {
        console.error("Duplicate load failed:", e);
      } finally {
        if (alive) setDupLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [duplicateFromId]);

  // Guard: block page when admin has disabled new project creation
  if (appSettings?.new_projects_100millionideas === false) {
    return (
      <div className="container mx-auto p-6 max-w-2xl pb-24">
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mb-4">
            <Ban className="h-8 w-8 text-muted-foreground" />
          </div>
          <h2 className="text-lg font-semibold">{t("create.disabledTitle")}</h2>
          <p className="text-sm text-muted-foreground mt-2 max-w-sm">
            {t("create.disabledDesc")}
          </p>
          <Button
            variant="outline"
            className="mt-6"
            onClick={() => navigate("/100millionideas/projects")}
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            {t("create.backToProjects")}
          </Button>
        </div>
      </div>
    );
  }

  // While we resolve the user's Lana8Wonder status, show a small loader
  // rather than flashing the form (which would let them start typing into
  // a form they may not actually be allowed to submit).
  if (lana8WonderLoading) {
    return (
      <div className="container mx-auto p-6 max-w-2xl pb-24">
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Loader2 className="h-8 w-8 text-muted-foreground animate-spin" />
        </div>
      </div>
    );
  }

  // Guard: only users who have an active Lana8Wonder annuity plan
  // (KIND 88888 with their pubkey in a #p tag) may create new projects.
  if (!lana8WonderStatus.exists) {
    return (
      <div className="container mx-auto p-6 max-w-2xl pb-24">
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="h-16 w-16 rounded-full bg-amber-500/10 flex items-center justify-center mb-4">
            <Sparkles className="h-8 w-8 text-amber-500" />
          </div>
          <h2 className="text-lg font-semibold">{t("create.planRequiredTitle")}</h2>
          <p className="text-sm text-muted-foreground mt-2 max-w-sm">
            {t("create.planRequiredDesc")}
          </p>
          <div className="flex flex-col sm:flex-row gap-2 mt-6">
            <Button onClick={() => navigate("/lana8wonder")} className="gap-2">
              <Sparkles className="h-4 w-4" />
              {t("create.openLana8Wonder")}
            </Button>
            <Button
              variant="outline"
              onClick={() => navigate("/100millionideas/projects")}
              className="gap-2"
            >
              <ArrowLeft className="h-4 w-4" />
              {t("create.backToProjects")}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // While a duplicate source loads, show a loader (so the form isn't shown blank first).
  if (duplicateFromId && dupLoading) {
    return (
      <div className="container mx-auto p-6 max-w-2xl pb-24">
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Loader2 className="h-8 w-8 text-muted-foreground animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 max-w-2xl pb-24">
      <div className="flex items-center gap-3 mb-6">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate("/100millionideas/projects")}
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        {duplicateFromId ? (
          <Copy className="h-6 w-6 text-primary" />
        ) : (
          <PlusCircle className="h-6 w-6 text-primary" />
        )}
        <h1 className="text-2xl font-bold">{duplicateFromId ? t("create.headingDuplicate") : t("create.headingCreate")}</h1>
      </div>

      {agreed ? (
        <ProjectForm
          mode="create"
          initialData={duplicateFromId ? dupData ?? undefined : undefined}
          onSubmitSuccess={() => navigate("/100millionideas/my-projects")}
        />
      ) : (
        <CreateProjectGate lang={lang} onAgree={() => setAgreed(true)} />
      )}
    </div>
  );
}
