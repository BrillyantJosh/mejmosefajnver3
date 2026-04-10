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
import { Heart, Users, EyeOff, Eye, Trophy, Loader2, Clock, CheckCircle } from "lucide-react";
import { useNostrProfileCache } from "@/hooks/useNostrProfileCache";
import { useNostrProjectDonations } from "@/hooks/useNostrProjectDonations";
import { ProjectData } from "@/hooks/useNostrProjects";
import { useNavigate } from "react-router-dom";

interface ProjectCardProps {
  project: ProjectData;
  isModuleAdmin?: boolean;
  isHidden?: boolean;
  isCompleted?: boolean;
  isApproved?: boolean;
  completionComment?: string;
  onToggleHidden?: (dTag: string) => void;
  onToggleCompleted?: (dTag: string, comment?: string) => void;
  onToggleApproved?: (dTag: string) => void;
  actionLoading?: string | null;
}

// Map what_type enum values to readable labels
const WHAT_TYPE_LABELS: Record<string, string> = {
  'IamAllowingMyself': 'I am Allowing Myself',
  'EmbraceEnough': 'Embracing Enough',
  'DigitalBeing': 'Digital Being',
  'ProductOrService': 'Product Or Service',
};

const ProjectCard = ({
  project,
  isModuleAdmin,
  isHidden,
  isCompleted,
  isApproved = true,
  completionComment,
  onToggleHidden,
  onToggleCompleted,
  onToggleApproved,
  actionLoading,
}: ProjectCardProps) => {
  const { profile } = useNostrProfileCache(project.ownerPubkey);
  const { donations, totalRaised, isLoading } = useNostrProjectDonations(project.id);
  const navigate = useNavigate();

  const [completionDialogOpen, setCompletionDialogOpen] = useState(false);
  const [comment, setComment] = useState("");

  // Calculate funding stats from KIND 60200 donations
  const currentFunding = totalRaised;
  const goalAmount = parseFloat(project.fiatGoal) || 0;
  const backers = donations.length;
  const fundedPercentage = goalAmount > 0 ? Math.min(Math.round((currentFunding / goalAmount) * 100), 100) : 0;
  const isFullyFunded = goalAmount > 0 && currentFunding >= goalAmount * 0.99;

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
            <img
              src={project.coverImage}
              alt={project.title}
              className="w-full h-full object-cover"
            />
            {isCompleted && (
              <div className="absolute inset-0 bg-green-600/20 flex items-center justify-center">
                <Badge className="bg-green-600 text-white text-lg px-4 py-1.5 gap-2">
                  <Trophy className="h-5 w-5" />
                  Completed
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
                  Completed
                </Badge>
              )}
              {isHidden && (
                <Badge variant="outline" className="border-orange-300 text-orange-600 gap-1">
                  <EyeOff className="h-3 w-3" />
                  Hidden
                </Badge>
              )}
              {!isApproved && (
                <Badge className="bg-amber-500 text-white gap-1">
                  <Clock className="h-3 w-3" />
                  Pending Approval
                </Badge>
              )}
              {isFullyFunded && (
                <Badge className="bg-green-500 text-white">Funded ✓</Badge>
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
              <p className="text-xs text-muted-foreground">Project Initiator</p>
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
              goal: {goalAmount.toFixed(0)} {project.currency}
            </div>
          </div>

          {/* Progress Bar */}
          <Progress value={fundedPercentage} className="h-2" />

          {/* Backers and Funding Percentage */}
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <div className="flex items-center gap-1">
              <Users className="h-4 w-4" />
              <span>{backers} {backers === 1 ? 'backer' : 'backers'}</span>
            </div>
            <span>{fundedPercentage}% funded</span>
          </div>

          {/* Support Button */}
          <Button
            className="w-full bg-green-600 hover:bg-green-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={handleSupportProject}
            disabled={isFullyFunded || !isApproved}
          >
            <Heart className="h-4 w-4 mr-2" />
            {isFullyFunded ? 'Fully Funded' : !isApproved ? 'Pending Approval' : 'Support Project'}
          </Button>

          {/* Admin Controls */}
          {isModuleAdmin && (
            <div className="flex gap-2 pt-2 border-t" onClick={(e) => e.stopPropagation()}>
              <Button
                variant={isHidden ? "default" : "outline"}
                size="sm"
                className="flex-1 gap-1"
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
                {isHidden ? "Show" : "Hide"}
              </Button>
              <Button
                variant={isCompleted ? "default" : "outline"}
                size="sm"
                className={`flex-1 gap-1 ${isCompleted ? 'bg-green-600 hover:bg-green-700' : ''}`}
                disabled={isThisLoading}
                onClick={handleCompleteClick}
              >
                {isThisLoading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trophy className="h-3.5 w-3.5" />
                )}
                {isCompleted ? "Completed ✓" : "Complete"}
              </Button>
              <Button
                variant={isApproved ? "default" : "outline"}
                size="sm"
                className={`flex-1 gap-1 ${isApproved ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'border-amber-300 text-amber-600'}`}
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
                {isApproved ? "Approved ✓" : "Approve"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Completion Comment Dialog */}
      <Dialog open={completionDialogOpen} onOpenChange={setCompletionDialogOpen}>
        <DialogContent onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>Mark Project as Completed</DialogTitle>
            <DialogDescription>
              Explain why "{project.title}" is considered successfully completed. This comment will be published as a permanent Nostr record (KIND 60201).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="completion-comment">Completion Comment *</Label>
            <Textarea
              id="completion-comment"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="All milestones achieved, funds used as planned..."
              rows={4}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCompletionDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              className="bg-green-600 hover:bg-green-700 text-white gap-1"
              onClick={handleConfirmComplete}
              disabled={!comment.trim()}
            >
              <Trophy className="h-4 w-4" />
              Confirm Completion
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default ProjectCard;
