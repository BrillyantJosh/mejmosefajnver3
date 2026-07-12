import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { UserAvatar } from '@/components/ui/UserAvatar';
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Heart, Users, EyeOff, Eye, Trophy, Loader2, Clock, CheckCircle, Calendar } from "lucide-react";
import { format } from "date-fns";
import { useNostrProfileCache } from "@/hooks/useNostrProfileCache";
import { LanacrowdProject } from "@/hooks/useLanacrowdProjects";
import { useNavigate } from "react-router-dom";
import millionideasTranslations from "@/i18n/modules/millionideas";
import { useTranslation } from "@/i18n/I18nContext";

interface ProjectCardProps {
  project: LanacrowdProject;
  isModuleAdmin?: boolean;
  isHidden?: boolean;
  isCompleted?: boolean;
  isApproved?: boolean;
  isFunded?: boolean;
  completionComment?: string;
  onToggleHidden?: (dTag: string) => void;
  onToggleCompleted?: (dTag: string, comment?: string) => void;
  onToggleApproved?: (dTag: string) => void;
  actionLoading?: string | null;
}

const ProjectCard = ({
  project,
  isModuleAdmin,
  isHidden,
  isCompleted,
  isApproved = true,
  isFunded = false,
  completionComment,
  onToggleHidden,
  onToggleCompleted,
  onToggleApproved,
  actionLoading,
}: ProjectCardProps) => {
  const { t } = useTranslation(millionideasTranslations);
  // Map what_type enum values to readable (translated) labels
  const WHAT_TYPE_LABELS: Record<string, string> = {
    'IamAllowingMyself': t('card.whatTypeAllowing'),
    'EmbraceEnough': t('card.whatTypeEnough'),
    'DigitalBeing': t('card.whatTypeDigitalBeing'),
    'ProductOrService': t('card.whatTypeProduct'),
  };
  const { profile } = useNostrProfileCache(project.ownerPubkey);
  // Donation stats come directly from the SQLite-backed project (no extra relay query needed)
  const totalRaised = project.totalRaised ?? 0;
  const isLoading = false;
  const navigate = useNavigate();

  const [completionDialogOpen, setCompletionDialogOpen] = useState(false);
  const [comment, setComment] = useState("");
  // Graceful fallback when a cover image fails to load (e.g. legacy relative
  // /api/storage paths whose files no longer exist on this server).
  const [coverError, setCoverError] = useState(false);

  // Calculate funding stats from KIND 60200 donations
  const currentFunding = totalRaised;
  const goalAmount = project.fiatGoal || 0;
  const backers = project.donationCount ?? 0;
  const fundedPercentage = goalAmount > 0 ? Math.min(Math.round((currentFunding / goalAmount) * 100), 100) : 0;
  // Use DB-cached funded status (from heartbeat) instead of local calculation
  const isFullyFunded = isFunded;

  const handleSupportProject = () => {
    navigate(`/100millionideas/project/${project.id}`);
  };

  const handleCompleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isCompleted) {
      // Uncomplete — no dialog needed
      onToggleCompleted?.(project.id);
    } else {
      // Open dialog for comment
      setComment("");
      setCompletionDialogOpen(true);
    }
  };

  const handleConfirmComplete = () => {
    if (!comment.trim()) return;
    onToggleCompleted?.(project.id, comment.trim());
    setCompletionDialogOpen(false);
    setComment("");
  };

  const isThisLoading = actionLoading === project.id;

  return (
    <>
      <Card
        className={`overflow-hidden hover:shadow-lg transition-shadow cursor-pointer ${isHidden ? 'opacity-50 border-dashed' : ''}`}
        onClick={handleSupportProject}
      >
        {/* Cover Image */}
        {project.coverImage && (
          <div className="aspect-video w-full overflow-hidden relative">
            {coverError ? (
              <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-green-500/15 to-emerald-500/10">
                <span className="text-6xl font-bold text-green-600/50 select-none">
                  {project.title?.trim()?.charAt(0)?.toUpperCase() || "?"}
                </span>
              </div>
            ) : (
              <img
                src={project.coverImage}
                alt={project.title}
                className="w-full h-full object-cover"
                onError={() => setCoverError(true)}
              />
            )}
            {isCompleted && (
              <div className="absolute inset-0 bg-green-600/20 flex items-center justify-center">
                <Badge className="bg-green-600 text-white text-lg px-4 py-1.5 gap-2">
                  <Trophy className="h-5 w-5" />
                  {t('card.completed')}
                </Badge>
              </div>
            )}
          </div>
        )}

        <CardContent className="p-6 space-y-4">
          {/* Title + Badges */}
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-2xl font-bold text-green-600 flex-1">
              {project.title}
            </h3>
            <div className="flex gap-1 flex-shrink-0">
              {isCompleted && !project.coverImage && (
                <Badge className="bg-green-600 text-white gap-1">
                  <Trophy className="h-3 w-3" />
                  {t('card.completed')}
                </Badge>
              )}
              {isHidden && (
                <Badge variant="outline" className="border-orange-300 text-orange-600 gap-1">
                  <EyeOff className="h-3 w-3" />
                  {t('card.hidden')}
                </Badge>
              )}
              {!isApproved && (
                <Badge className="bg-amber-500 text-white gap-1">
                  <Clock className="h-3 w-3" />
                  {t('card.pendingApproval')}
                </Badge>
              )}
              {isFullyFunded && (
                <Badge className="bg-green-500 text-white">{t('card.fundedBadge')}</Badge>
              )}
            </div>
          </div>

          {/* Completion Comment */}
          {isCompleted && completionComment && (
            <div className="bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-lg p-3">
              <p className="text-sm text-green-700 dark:text-green-300 italic">
                "{completionComment}"
              </p>
            </div>
          )}

          {/* What Type Badge */}
          {project.whatType && WHAT_TYPE_LABELS[project.whatType] && (
            <Badge variant="outline" className="text-xs font-medium border-indigo-300 text-indigo-600 bg-indigo-50 dark:bg-indigo-950 dark:text-indigo-300">
              {WHAT_TYPE_LABELS[project.whatType]}
            </Badge>
          )}

          {/* Short Description */}
          <p className="text-muted-foreground">
            {project.shortDesc}
          </p>

          {/* Project Initiator */}
          <div className="flex items-center gap-3 pt-2">
            <UserAvatar pubkey={project.ownerPubkey} picture={profile?.picture} name={profile?.display_name || profile?.full_name} className="h-10 w-10" />
            <div>
              <p className="text-xs text-muted-foreground">{t('card.projectInitiator')}</p>
              <p className="font-medium">
                {profile?.display_name || profile?.full_name || `${project.ownerPubkey.slice(0, 8)}...`}
              </p>
            </div>
          </div>

          {/* Funding Stats */}
          <div className="flex items-baseline justify-between pt-4">
            <div>
              <span className="text-3xl font-bold">{currentFunding.toFixed(2)}</span>
              <span className="text-lg text-muted-foreground ml-1">{project.currency}</span>
            </div>
            <div className="text-right text-sm text-muted-foreground">
              {t('card.goalLabel')} {goalAmount.toFixed(0)} {project.currency}
            </div>
          </div>

          {/* Progress Bar */}
          <Progress value={fundedPercentage} className="h-2" />

          {/* Backers, Funding Percentage and Published Date */}
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1">
                <Users className="h-4 w-4" />
                <span>{backers} {t(backers === 1 ? 'card.backerOne' : 'card.backerMany')}</span>
              </div>
              <span>{t('card.percentFunded', { percent: fundedPercentage })}</span>
            </div>
            {project.nostrCreatedAt > 0 && (
              <div className="flex items-center gap-1">
                <Calendar className="h-3.5 w-3.5" />
                <span className="text-xs">{format(new Date(project.nostrCreatedAt * 1000), 'dd MMM yyyy')}</span>
              </div>
            )}
          </div>

          {/* Support Button */}
          <Button
            className="w-full bg-green-600 hover:bg-green-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={handleSupportProject}
            disabled={isFullyFunded || !isApproved}
          >
            <Heart className="h-4 w-4 mr-2" />
            {isFullyFunded ? t('card.fullyFunded') : !isApproved ? t('card.pendingApproval') : t('card.supportBtn')}
          </Button>

          {/* Admin Controls */}
          {isModuleAdmin && (
            <div className="flex flex-wrap gap-1.5 pt-2 border-t" onClick={(e) => e.stopPropagation()}>
              <Button
                variant={isHidden ? "default" : "outline"}
                size="sm"
                className="flex-1 min-w-[88px] gap-1 whitespace-nowrap text-xs px-2"
                disabled={isThisLoading}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleHidden?.(project.id);
                }}
              >
                {isThisLoading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : isHidden ? (
                  <Eye className="h-3.5 w-3.5" />
                ) : (
                  <EyeOff className="h-3.5 w-3.5" />
                )}
                {isHidden ? t('card.show') : t('card.hide')}
              </Button>
              <Button
                variant={isCompleted ? "default" : "outline"}
                size="sm"
                className={`flex-1 min-w-[88px] gap-1 whitespace-nowrap text-xs px-2 ${isCompleted ? 'bg-green-600 hover:bg-green-700' : ''}`}
                disabled={isThisLoading}
                onClick={handleCompleteClick}
              >
                {isThisLoading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trophy className="h-3.5 w-3.5" />
                )}
                {isCompleted ? t('card.completedCheck') : t('card.complete')}
              </Button>
              <Button
                variant={isApproved ? "default" : "outline"}
                size="sm"
                className={`flex-1 min-w-[88px] gap-1 whitespace-nowrap text-xs px-2 ${isApproved ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'border-amber-300 text-amber-600'}`}
                disabled={isThisLoading}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleApproved?.(project.id);
                }}
              >
                {isThisLoading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : isApproved ? (
                  <CheckCircle className="h-3.5 w-3.5" />
                ) : (
                  <Clock className="h-3.5 w-3.5" />
                )}
                {isApproved ? t('card.approvedCheck') : t('card.approve')}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Completion Comment Dialog */}
      <Dialog open={completionDialogOpen} onOpenChange={setCompletionDialogOpen}>
        <DialogContent onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>{t('card.dialogTitle')}</DialogTitle>
            <DialogDescription>
              {t('card.dialogDesc', { title: project.title })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="completion-comment">{t('card.commentLabel')}</Label>
            <Textarea
              id="completion-comment"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={t('card.commentPlaceholder')}
              rows={4}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCompletionDialogOpen(false)}>
              {t('card.cancel')}
            </Button>
            <Button
              className="bg-green-600 hover:bg-green-700 text-white gap-1"
              onClick={handleConfirmComplete}
              disabled={!comment.trim()}
            >
              <Trophy className="h-4 w-4" />
              {t('card.confirmCompletion')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default ProjectCard;
