import { useState, useMemo } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import SubNavigation from "@/components/layout/SubNavigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { Bot, Plus, Trash2, Mic, Globe } from "lucide-react";
import { useMyBeings } from "@/hooks/useMyBeings";
import { useNostrProfilesCacheBulk } from "@/hooks/useNostrProfilesCacheBulk";
import AddBeingDialog from "@/components/being/AddBeingDialog";

const SOZITJE_PUBKEY = '83350f1fb5124f0472a2ddc37805062e79a1262e5c3d3a837e76d07a0653abc8';

const beingNavItems = [
  { title: "Being", path: "/being", icon: Bot },
  { title: "Voice", path: "/being/voice", icon: Mic },
  { title: "World", path: "/being/world", icon: Globe },
];

export default function BeingLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { beings, addBeing, removeBeing } = useMyBeings();
  const [addDialogOpen, setAddDialogOpen] = useState(false);

  const pubkeys = useMemo(() => beings.map(b => b.nostrHexId), [beings]);
  const { profiles } = useNostrProfilesCacheBulk(pubkeys);

  // Show being list only on the root /being path
  const isRootPath = location.pathname === '/being' || location.pathname === '/being/';

  if (!isRootPath) {
    return (
      <div className="min-h-screen pb-20">
        <Outlet />
        <SubNavigation items={beingNavItems} variant="bottom" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto pb-20 px-4 sm:px-6">
      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold">Being</h1>
        <p className="text-sm sm:text-base text-muted-foreground">Chat with your digital beings</p>
      </div>

      {/* Being List */}
      <div className="space-y-3 mb-6">
        {beings.map((being) => {
          const profile = profiles.get(being.nostrHexId);
          const displayName = being.name || profile?.display_name || profile?.full_name || being.nostrHexId.slice(0, 12) + '...';
          const isSozitje = being.nostrHexId === SOZITJE_PUBKEY;

          return (
            <Card
              key={being.nostrHexId}
              className="cursor-pointer hover:border-primary/50 hover:shadow-md transition-all active:scale-[0.99]"
              onClick={() => navigate(`/being/chat/${being.nostrHexId}`)}
            >
              <CardContent className="p-4">
                <div className="flex items-center gap-4">
                  <UserAvatar
                    pubkey={being.nostrHexId}
                    picture={profile?.picture}
                    name={displayName}
                    className="h-12 w-12 flex-shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-base truncate">{displayName}</p>
                    <p className="text-xs text-muted-foreground font-mono truncate">
                      {being.nostrHexId.slice(0, 16)}...
                    </p>
                    {profile?.about && (
                      <p className="text-xs text-muted-foreground truncate mt-0.5">
                        {profile.about}
                      </p>
                    )}
                  </div>
                  {!isSozitje && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive flex-shrink-0"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeBeing(being.nostrHexId);
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Add Being Button */}
      <Button
        variant="outline"
        className="w-full gap-2 h-12"
        onClick={() => setAddDialogOpen(true)}
      >
        <Plus className="h-5 w-5" />
        Add a Being
      </Button>

      <AddBeingDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        onAdd={addBeing}
      />

      <SubNavigation items={beingNavItems} variant="bottom" />
    </div>
  );
}
