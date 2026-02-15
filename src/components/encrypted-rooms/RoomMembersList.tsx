import { Crown, Shield, User, Eye, Clock, XCircle } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { formatDistanceToNow } from 'date-fns';
import type { RoomMember } from '@/types/encryptedRooms';

export interface InviteStatusDisplay {
  pubkey: string;
  displayName?: string;
  picture?: string;
  status: 'pending' | 'accepted' | 'declined';
  invitedAt: number;
  respondedAt?: number;
}

interface RoomMembersListProps {
  members: RoomMember[];
  currentUserPubkey?: string;
  inviteStatuses?: InviteStatusDisplay[];
}

const roleConfig = {
  owner: { label: 'Owner', icon: Crown, color: 'text-amber-500', badgeClass: 'bg-amber-500/10 text-amber-600' },
  admin: { label: 'Admin', icon: Shield, color: 'text-blue-500', badgeClass: 'bg-blue-500/10 text-blue-600' },
  member: { label: 'Member', icon: User, color: 'text-muted-foreground', badgeClass: '' },
  readonly: { label: 'Read-only', icon: Eye, color: 'text-muted-foreground', badgeClass: 'bg-muted text-muted-foreground' },
};

export const RoomMembersList = ({ members, currentUserPubkey, inviteStatuses }: RoomMembersListProps) => {
  // Filter invite statuses to only pending and declined (accepted are already in members list)
  const pendingDeclined = inviteStatuses?.filter((s) => s.status === 'pending' || s.status === 'declined') || [];

  return (
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
          </div>
        );
      })}

      {/* Pending & Declined invites section (owner only) */}
      {pendingDeclined.length > 0 && (
        <>
          <div className="border-t my-3" />
          <h3 className="text-sm font-medium text-muted-foreground px-2 mb-2">
            Pending & Declined Invites
          </h3>
          {pendingDeclined.map((invite) => {
            const displayName = invite.displayName || invite.pubkey.slice(0, 12) + '...';
            const isPending = invite.status === 'pending';
            const timeStr = invite.respondedAt
              ? formatDistanceToNow(new Date(invite.respondedAt * 1000), { addSuffix: true })
              : formatDistanceToNow(new Date(invite.invitedAt * 1000), { addSuffix: true });

            return (
              <div
                key={invite.pubkey}
                className="flex items-center gap-2.5 px-2 py-1.5 rounded-md opacity-60"
              >
                <Avatar className="h-8 w-8">
                  {invite.picture ? (
                    <AvatarImage src={invite.picture} alt={displayName} />
                  ) : null}
                  <AvatarFallback className="text-xs">
                    {displayName.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>

                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium truncate block">{displayName}</span>
                  <span className="text-[10px] text-muted-foreground">{timeStr}</span>
                </div>

                {isPending ? (
                  <Badge className="bg-amber-500/15 text-amber-600 border-amber-500/20 text-[10px] px-1.5 py-0.5">
                    <Clock className="h-3 w-3 mr-0.5" />
                    Pending
                  </Badge>
                ) : (
                  <Badge className="bg-red-500/15 text-red-600 border-red-500/20 text-[10px] px-1.5 py-0.5">
                    <XCircle className="h-3 w-3 mr-0.5" />
                    Declined
                  </Badge>
                )}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
};
