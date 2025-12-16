import { useNostrProjects, ProjectData } from "@/hooks/useNostrProjects";
import { useNostrAllProjectDonations } from "@/hooks/useNostrAllProjectDonations";
import { Target, TrendingUp, Loader2 } from "lucide-react";
import { useMemo } from "react";

const ProjectsSummaryBar = () => {
  const { projects, isLoading: projectsLoading } = useNostrProjects();
  const { summary, isLoading: donationsLoading } = useNostrAllProjectDonations();

  const totalGoal = useMemo(() => {
    return projects.reduce((sum, project) => {
      const goal = parseFloat(project.fiatGoal);
      return sum + (isNaN(goal) ? 0 : goal);
    }, 0);
  }, [projects]);

  const isLoading = projectsLoading || donationsLoading;

  const formatAmount = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(amount);
  };

  const progressPercentage = totalGoal > 0 
    ? Math.min((summary.totalRaisedFiat / totalGoal) * 100, 100) 
    : 0;

  if (isLoading) {
    return (
      <div className="bg-primary/10 rounded-lg p-4 mb-6">
        <div className="flex items-center justify-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Loading summary...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gradient-to-r from-primary/10 via-primary/5 to-accent/10 rounded-lg p-4 mb-6 border border-primary/20">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        {/* Goal */}
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-full bg-primary/20">
            <Target className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Total Goal</p>
            <p className="text-xl font-bold text-foreground">
              €{formatAmount(totalGoal)}
            </p>
          </div>
        </div>

        {/* Progress bar - visible on md+ */}
        <div className="hidden md:flex flex-1 max-w-xs mx-4">
          <div className="w-full">
            <div className="h-3 bg-muted rounded-full overflow-hidden">
              <div 
                className="h-full bg-gradient-to-r from-primary to-accent transition-all duration-500"
                style={{ width: `${progressPercentage}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground text-center mt-1">
              {progressPercentage.toFixed(1)}% reached
            </p>
          </div>
        </div>

        {/* Raised */}
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-full bg-accent/20">
            <TrendingUp className="h-5 w-5 text-accent" />
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Total Raised</p>
            <p className="text-xl font-bold text-foreground">
              €{formatAmount(summary.totalRaisedFiat)}
            </p>
          </div>
        </div>
      </div>

      {/* Mobile progress bar */}
      <div className="md:hidden mt-4">
        <div className="h-3 bg-muted rounded-full overflow-hidden">
          <div 
            className="h-full bg-gradient-to-r from-primary to-accent transition-all duration-500"
            style={{ width: `${progressPercentage}%` }}
          />
        </div>
        <p className="text-xs text-muted-foreground text-center mt-1">
          {progressPercentage.toFixed(1)}% reached
        </p>
      </div>
    </div>
  );
};

export default ProjectsSummaryBar;
