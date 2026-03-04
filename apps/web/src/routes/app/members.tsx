import {
  RiMoreFill,
  RiShieldUserLine,
  RiUserUnfollowLine,
} from "@remixicon/react";
import { api } from "@mvp-template/backend/convex/_generated/api";
import { createFileRoute, Link, useRouterState } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/app/members")({
  component: MembersRoute,
});

type MemberRole = "owner" | "admin" | "member";

const memberRoleOptions: Array<{ value: MemberRole; label: string }> = [
  { value: "member", label: "Member" },
  { value: "admin", label: "Admin" },
  { value: "owner", label: "Owner" },
];
const memberRoleSortOrder: Record<MemberRole, number> = {
  owner: 0,
  admin: 1,
  member: 2,
};

function isMemberRole(value: string | null): value is MemberRole {
  if (!value) {
    return false;
  }

  return memberRoleOptions.some((roleOption) => roleOption.value === value);
}

function getRoleLabel(role: string | string[]) {
  if (Array.isArray(role)) {
    return role.join(", ");
  }

  const matchedRole = memberRoleOptions.find((roleOption) => roleOption.value === role);
  return matchedRole?.label ?? role;
}

function getRoleSortOrder(role: string | string[]) {
  const normalizedRole = Array.isArray(role) ? role[0] ?? null : role;
  if (!isMemberRole(normalizedRole)) {
    return Number.MAX_SAFE_INTEGER;
  }

  return memberRoleSortOrder[normalizedRole];
}

function MembersRoute() {
  const { data: activeOrganization, isPending } = authClient.useActiveOrganization();
  const liveMembersPage = useQuery(
    api.members.getLiveMembersPage,
    activeOrganization?.id
      ? {
          organizationId: activeOrganization.id,
        }
      : "skip",
  );
  const locationSearch = useRouterState({
    select: (state) => state.location.search,
  });
  const membersSearchQuery = useMemo(() => {
    const value = new URLSearchParams(locationSearch).get("search");
    return value?.trim().toLowerCase() ?? "";
  }, [locationSearch]);
  const [isEditRoleDialogOpen, setIsEditRoleDialogOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<{
    id: string;
    role: string;
    user: {
      name: string;
      email: string;
      image?: string | null;
    };
  } | null>(null);
  const [nextMemberRole, setNextMemberRole] = useState<MemberRole>("member");
  const [isUpdatingMemberRole, setIsUpdatingMemberRole] = useState(false);
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null);
  const [revokingInvitationId, setRevokingInvitationId] = useState<string | null>(
    null,
  );
  const [memberPendingRemoval, setMemberPendingRemoval] = useState<{
    id: string;
    name: string;
    email: string;
  } | null>(null);
  const currentMemberId = liveMembersPage?.currentMember.id ?? null;

  if (isPending || (activeOrganization && liveMembersPage === undefined)) {
    return (
      <div className="space-y-5">
        <section className="space-y-2">
          <ul className="space-y-2">
            <li className="rounded-md border p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <Skeleton className="size-9 rounded-full" />
                  <div className="min-w-0 space-y-1.5">
                    <Skeleton className="h-4 w-36" />
                    <Skeleton className="h-3 w-48" />
                  </div>
                </div>
                <div className="flex items-center gap-2 self-start">
                  <Skeleton className="h-5 w-16 rounded-full" />
                  <Skeleton className="size-7" />
                </div>
              </div>
            </li>
          </ul>
        </section>
      </div>
    );
  }

  if (!activeOrganization) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">
          No active organization selected.
        </p>
        <Link to="/organization" className="text-sm underline">
          Go to organization settings
        </Link>
      </div>
    );
  }

  if (!liveMembersPage) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">
          Unable to load members for this organization.
        </p>
      </div>
    );
  }

  const filteredMembers = liveMembersPage.members
    .filter((member) => {
      if (!membersSearchQuery) {
        return true;
      }

      const searchableName = member.user.name.toLowerCase();
      const searchableEmail = member.user.email.toLowerCase();

      return (
        searchableName.includes(membersSearchQuery) ||
        searchableEmail.includes(membersSearchQuery)
      );
    })
    .sort((memberA, memberB) => {
      const roleDifference =
        getRoleSortOrder(memberA.role) - getRoleSortOrder(memberB.role);
      if (roleDifference !== 0) {
        return roleDifference;
      }

      const memberNameA = (memberA.user.name.trim() || memberA.user.email).toLowerCase();
      const memberNameB = (memberB.user.name.trim() || memberB.user.email).toLowerCase();

      return memberNameA.localeCompare(memberNameB);
    });
  const pendingInvitations = liveMembersPage.invitations
    .filter((invitation) => invitation.status === "pending")
    .sort((invitationA, invitationB) => {
      const roleDifference =
        getRoleSortOrder(invitationA.role) - getRoleSortOrder(invitationB.role);
      if (roleDifference !== 0) {
        return roleDifference;
      }

      return invitationA.email.toLowerCase().localeCompare(invitationB.email.toLowerCase());
    });

  const closeEditRoleDialog = () => {
    setEditingMember(null);
    setNextMemberRole("member");
    setIsEditRoleDialogOpen(false);
  };

  const openEditRoleDialog = (member: (typeof filteredMembers)[number]) => {
    setEditingMember({
      id: member.id,
      role: member.role,
      user: {
        name: member.user.name,
        email: member.user.email,
        image: member.user.image,
      },
    });
    setNextMemberRole(isMemberRole(member.role) ? member.role : "member");
    setIsEditRoleDialogOpen(true);
  };

  const handleUpdateMemberRole = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!editingMember || !activeOrganization.id) {
      return;
    }

    setIsUpdatingMemberRole(true);
    try {
      const { error } = await authClient.organization.updateMemberRole({
        memberId: editingMember.id,
        role: nextMemberRole,
        organizationId: activeOrganization.id,
      });

      if (error) {
        toast.error(error.message ?? "Failed to update member role");
        return;
      }

      toast.success("Member role updated");
      closeEditRoleDialog();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to update member role";
      toast.error(message);
    } finally {
      setIsUpdatingMemberRole(false);
    }
  };

  const handleRemoveMember = async (memberId: string) => {
    if (!activeOrganization.id) {
      return;
    }

    if (currentMemberId === memberId) {
      toast.error("You can't remove yourself. Use Leave Organization in settings.");
      return;
    }

    setRemovingMemberId(memberId);
    try {
      const { error } = await authClient.organization.removeMember({
        memberIdOrEmail: memberId,
        organizationId: activeOrganization.id,
      });

      if (error) {
        toast.error(error.message ?? "Failed to remove member");
        return;
      }

      toast.success("Member removed");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to remove member";
      toast.error(message);
    } finally {
      setRemovingMemberId(null);
    }
  };

  const handleRevokeInvitation = async (invitationId: string) => {
    setRevokingInvitationId(invitationId);
    try {
      const { error } = await authClient.organization.cancelInvitation({
        invitationId,
      });

      if (error) {
        toast.error(error.message ?? "Failed to revoke invitation");
        return;
      }

      toast.success("Invitation revoked");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to revoke invitation";
      toast.error(message);
    } finally {
      setRevokingInvitationId(null);
    }
  };

  return (
    <>
      <div className="space-y-5">
        <section className="space-y-2">
          {filteredMembers.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {membersSearchQuery
                ? "No members match your search."
                : "No members found."}
            </p>
          ) : (
            <ul className="space-y-2">
              {filteredMembers.map((member) => {
                const memberName = member.user.name.trim() || member.user.email;
                const memberInitial =
                  memberName.trim().charAt(0).toUpperCase() || "U";
                const isCurrentMember = currentMemberId === member.id;

                return (
                  <li key={member.id} className="rounded-md border p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-3">
                        <Avatar className="size-9">
                          <AvatarImage src={member.user.image ?? undefined} />
                          <AvatarFallback>{memberInitial}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{memberName}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {member.user.email}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 self-start">
                        <Badge
                          variant="outline"
                          className="border-border/70 bg-muted text-muted-foreground"
                        >
                          {getRoleLabel(member.role)}
                        </Badge>
                        {!isCurrentMember ? (
                          <DropdownMenu>
                            <DropdownMenuTrigger
                              render={
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon-sm"
                                  disabled={
                                    isUpdatingMemberRole || removingMemberId === member.id
                                  }
                                />
                              }
                            >
                              <RiMoreFill className="size-4" />
                              <span className="sr-only">Open member actions</span>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onClick={() => openEditRoleDialog(member)}
                                disabled={
                                  isUpdatingMemberRole || removingMemberId === member.id
                                }
                              >
                                <RiShieldUserLine />
                                <span>Edit role</span>
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                variant="destructive"
                                onClick={() =>
                                  setMemberPendingRemoval({
                                    id: member.id,
                                    name: memberName,
                                    email: member.user.email,
                                  })
                                }
                                disabled={
                                  isUpdatingMemberRole || removingMemberId === member.id
                                }
                              >
                                <RiUserUnfollowLine />
                                <span>
                                  {removingMemberId === member.id
                                    ? "Removing..."
                                    : "Remove"}
                                </span>
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        ) : null}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold tracking-tight">
            Pending Invitations
          </h2>
          {pendingInvitations.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No pending invitations.
            </p>
          ) : (
            <ul className="space-y-2">
              {pendingInvitations.map((invitation) => {
                const expiresAt = new Date(invitation.expiresAt);
                const hasValidExpiry = !Number.isNaN(expiresAt.getTime());

                return (
                  <li key={invitation.id} className="rounded-md border p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {invitation.email}
                        </p>
                        {hasValidExpiry ? (
                          <p className="text-xs text-muted-foreground">
                            Expires: {expiresAt.toLocaleDateString()}
                          </p>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-2 self-start">
                        <Badge
                          variant="outline"
                          className="border-border/70 bg-muted text-muted-foreground"
                        >
                          {getRoleLabel(invitation.role)}
                        </Badge>
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                disabled={revokingInvitationId === invitation.id}
                              />
                            }
                          >
                            <RiMoreFill className="size-4" />
                            <span className="sr-only">Open invitation actions</span>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              variant="destructive"
                              onClick={() =>
                                void handleRevokeInvitation(invitation.id)
                              }
                              disabled={revokingInvitationId === invitation.id}
                            >
                              <RiUserUnfollowLine />
                              <span>
                                {revokingInvitationId === invitation.id
                                  ? "Revoking..."
                                  : "Revoke"}
                              </span>
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      <Dialog
        open={isEditRoleDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setEditingMember(null);
            setNextMemberRole("member");
          }

          setIsEditRoleDialogOpen(open);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Member Role</DialogTitle>
            <DialogDescription>
              {editingMember
                ? `Change role for ${editingMember.user.name || editingMember.user.email}.`
                : "Select a new role for this member."}
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={handleUpdateMemberRole}>
            <div className="space-y-2">
              <Label htmlFor="edit-member-role">Role</Label>
              <Select
                value={nextMemberRole}
                onValueChange={(value) => {
                  if (isMemberRole(value)) {
                    setNextMemberRole(value);
                  }
                }}
              >
                <SelectTrigger id="edit-member-role" className="w-full">
                  <SelectValue placeholder="Select role">
                    {getRoleLabel(nextMemberRole)}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent align="start">
                  {memberRoleOptions.map((roleOption) => (
                    <SelectItem key={roleOption.value} value={roleOption.value}>
                      {roleOption.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={closeEditRoleDialog}
                disabled={isUpdatingMemberRole}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isUpdatingMemberRole || !editingMember}
              >
                {isUpdatingMemberRole ? "Saving..." : "Save role"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={memberPendingRemoval !== null}
        onOpenChange={(open) => {
          if (!open) {
            setMemberPendingRemoval(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove member?</AlertDialogTitle>
            <AlertDialogDescription>
              {memberPendingRemoval
                ? `This will remove ${memberPendingRemoval.name} (${memberPendingRemoval.email}) from the organization.`
                : "This member will be removed from the organization."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={removingMemberId === memberPendingRemoval?.id}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={
                !memberPendingRemoval ||
                removingMemberId === memberPendingRemoval.id
              }
              onClick={() => {
                if (!memberPendingRemoval) {
                  return;
                }

                void handleRemoveMember(memberPendingRemoval.id);
                setMemberPendingRemoval(null);
              }}
            >
              {memberPendingRemoval &&
              removingMemberId === memberPendingRemoval.id
                ? "Removing..."
                : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
