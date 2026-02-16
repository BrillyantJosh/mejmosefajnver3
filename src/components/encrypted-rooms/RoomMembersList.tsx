import { useState } from 'react';
import { Crown, Shield, User, Eye, UserMinus, Loader2 } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import type { RoomMember } from '@/types/encryptedRooms';

interface RoomMembersListProps {
  members: RoomMember[];
  currentUserPubkey?: string;
  isOwner?: boolean;
  onRemoveMember?: (pubkey: string, displayName: string) => Promise<void>;
  isRemoving?: boolean;
}

const roleConfig = {
  owner: { label: 'Owner', icon: Crown, color: 'text-amber-500', badgeClass: 'bg-amber-500/10 text-amber-600' },
  admin: { label: 'Admin', icon: Shield, color: 'text-blue-500', badgeClass: 'bg-blue-500/10 text-blue-600' },
  member: { label: 'Member', icon: User, color: 'text-muted-foreground', badgeClass: '' },
  readonly: { label: 'Read-only', icon: Eye, color: 'text-muted-foreground', badgeClass: 'bg-muted text-muted-foreground' },
};

export const RoomMembersList = ({
  members,
  currentUserPubkey,
  isOwner,
  onRemoveMember,
  isRemoving,
}: RoomMembersListProps) => {
  const [removingMember, setRemovingMember] = useState<{ pubkey: string; displayName: string } | null>(null);

  return (
    <>
      <div className="space-y-1">
        <h3 className="text-sm font-medium text-muted-foreground px-2 mb-2">
          Members ({members.length})
        </h3>
        {members.map((member) => {
          const config = roleConfig[member.role] || roleConfig.member;
          const RoleIcon = config.icon;
          const isCurrentUser = member.pubkey === currentUserPubkey;
          const displayName = member.displayName || member.pubkey.slice(0, 12) + '...';

          return (
            <div
              key={member.pubkey}
              className="flex items-center gap-2.5 px-2 py-1.5 rounded-md hover:bg-muted/50 transition-colors"
            >
              <Avatar className="h-8 w-8">
                {member.picture ? (
                  <AvatarImage src={member.picture} alt={displayName} />
                ) : null}
                <AvatarFallback className="text-xs">
                  {displayName.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-medium truncate">
                    {displayName}
                    {isCurrentUser && (
                      <span className="text-muted-foreground font-normal"> (you)</span>
                    )}
                  </span>
                </div>
              </div>

              {/* Role badge - only show for non-members */}
              {member.role !== 'member' && (
                <Badge variant="secondary" className={`text-[10px] px-1.5 py-0 ${config.badgeClass}`}>
                  <RoleIcon className={`h-3 w-3 mr-0.5 ${config.color}`} />
                  {config.label}
                </Badge>
              )}

              {/* Remove button - owner only, not for owner role or self */}
              {isOwner && member.role !== 'owner' && !isCurrentUser && onRemoveMember && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10 flex-shrink-0"
                  disabled={isRemoving}
                  onClick={(e) => {
                    e.stopPropagation();
                    setRemovingMember({ pubkey: member.pubkey, displayName });
                  }}
                >
                  {isRemoving ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <UserMinus className="h-3.5 w-3.5" />
                  )}
                </Button>
              )}
            </div>
          );
        })}
      </div>

      {/* Remove member confirmation dialog */}
      {removingMember && (
        <AlertDialog open={!!removingMember} onOpenChange={(open) => !open && setRemovingMember(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove member?</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to remove <strong>{removingMember.displayName}</strong> from this room?
                They will no longer be able to read or send messages.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  onRemoveMember?.(removingMember.pubkey, removingMember.displayName);
                  setRemovingMember(null);
                }}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Remove
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </>
  );
};
