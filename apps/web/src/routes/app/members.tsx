import {
  RiMoreFill,
  RiShieldUserLine,
  RiUserUnfollowLine,
} from "@remixicon/react";
import { api } from "@mvp-template/backend/convex/_generated/api";
import { createFileRoute, Link, useRouterState } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { useMemo, useState, type FormEvent } from "react";
import { toast } from "@/components/ui/sonner";

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
import { getLocalizedAuthErrorMessage } from "@/lib/auth-error-i18n";
import { useI18n } from "@/lib/i18n-provider";

export const Route = createFileRoute("/app/members")({
  component: MembersRoute,
});

type MemberRole = "owner" | "admin" | "member";

const memberRoleValues: MemberRole[] = ["member", "admin", "owner"];
const memberRoleSortOrder: Record<MemberRole, number> = {
  owner: 0,
  admin: 1,
  member: 2,
};

function isMemberRole(value: string | null): value is MemberRole {
  if (!value) {
    return false;
  }

  return memberRoleValues.some((roleValue) => roleValue === value);
}

function getRoleLabel(role: string | string[], t: (key: string) => string) {
  if (Array.isArray(role)) {
    return role
      .map((singleRole) =>
        isMemberRole(singleRole) ? t(`common.roles.${singleRole}`) : singleRole,
      )
      .join(", ");
  }

  return isMemberRole(role) ? t(`common.roles.${role}`) : role;
}

function getRoleSortOrder(role: string | string[]) {
  const normalizedRole = Array.isArray(role) ? role[0] ?? null : role;
  if (!isMemberRole(normalizedRole)) {
    return Number.MAX_SAFE_INTEGER;
  }

  return memberRoleSortOrder[normalizedRole];
}

function MembersRoute() {
  const { locale, t } = useI18n();
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
          {t("app.members.noActiveOrganization")}
        </p>
        <Link to="/organization" className="text-sm underline">
          {t("app.members.goToOrganizationSettings")}
        </Link>
      </div>
    );
  }

  if (!liveMembersPage) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">
          {t("app.members.unableToLoad")}
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
        toast.error(
          getLocalizedAuthErrorMessage(
            t,
            error,
            "app.members.toasts.failedUpdateMemberRole",
          ),
        );
        return;
      }

      toast.success(t("app.members.toasts.memberRoleUpdated"));
      closeEditRoleDialog();
    } catch (error) {
      toast.error(t("app.members.toasts.failedUpdateMemberRole"));
    } finally {
      setIsUpdatingMemberRole(false);
    }
  };

  const handleRemoveMember = async (memberId: string) => {
    if (!activeOrganization.id) {
      return;
    }

    if (currentMemberId === memberId) {
      toast.error(t("app.members.toasts.cannotRemoveSelf"));
      return;
    }

    setRemovingMemberId(memberId);
    try {
      const { error } = await authClient.organization.removeMember({
        memberIdOrEmail: memberId,
        organizationId: activeOrganization.id,
      });

      if (error) {
        toast.error(
          getLocalizedAuthErrorMessage(
            t,
            error,
            "app.members.toasts.failedRemoveMember",
          ),
        );
        return;
      }

      toast.success(t("app.members.toasts.memberRemoved"));
    } catch (error) {
      toast.error(t("app.members.toasts.failedRemoveMember"));
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
        toast.error(
          getLocalizedAuthErrorMessage(
            t,
            error,
            "app.members.toasts.failedRevokeInvitation",
          ),
        );
        return;
      }

      toast.success(t("app.members.toasts.invitationRevoked"));
    } catch (error) {
      toast.error(t("app.members.toasts.failedRevokeInvitation"));
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
                ? t("app.members.noMembersMatchSearch")
                : t("app.members.noMembersFound")}
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
                          {getRoleLabel(member.role, t)}
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
                              <span className="sr-only">
                                {t("app.shell.openMemberActions")}
                              </span>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-44">
                              <DropdownMenuItem
                                onClick={() => openEditRoleDialog(member)}
                                disabled={
                                  isUpdatingMemberRole || removingMemberId === member.id
                                }
                              >
                                <RiShieldUserLine />
                                <span>{t("common.actions.editRole")}</span>
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
                                    ? t("common.state.removing")
                                    : t("common.actions.remove")}
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
            {t("app.members.pendingInvitations")}
          </h2>
          {pendingInvitations.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("app.members.noPendingInvitations")}
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
                            {t("app.members.expires", {
                              date: expiresAt.toLocaleDateString(locale),
                            })}
                          </p>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-2 self-start">
                        <Badge
                          variant="outline"
                          className="border-border/70 bg-muted text-muted-foreground"
                        >
                          {getRoleLabel(invitation.role, t)}
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
                            <span className="sr-only">
                              {t("app.shell.openInvitationActions")}
                            </span>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-44">
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
                                  ? t("common.state.revoking")
                                  : t("common.actions.revoke")}
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
            <DialogTitle>{t("app.members.editMemberRoleTitle")}</DialogTitle>
            <DialogDescription>
              {editingMember
                ? t("app.members.editMemberRoleDescriptionWithName", {
                    memberName: editingMember.user.name || editingMember.user.email,
                  })
                : t("app.members.editMemberRoleDescriptionDefault")}
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={handleUpdateMemberRole}>
            <div className="space-y-2">
              <Label htmlFor="edit-member-role">{t("common.labels.role")}</Label>
              <Select
                value={nextMemberRole}
                onValueChange={(value) => {
                  if (isMemberRole(value)) {
                    setNextMemberRole(value);
                  }
                }}
              >
                <SelectTrigger id="edit-member-role" className="w-full">
                  <SelectValue placeholder={t("app.members.selectRole")}>
                    {getRoleLabel(nextMemberRole, t)}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent align="start">
                  {memberRoleValues.map((roleOption) => (
                    <SelectItem key={roleOption} value={roleOption}>
                      {t(`common.roles.${roleOption}`)}
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
                {t("common.actions.cancel")}
              </Button>
              <Button
                type="submit"
                disabled={isUpdatingMemberRole || !editingMember}
              >
                {isUpdatingMemberRole
                  ? t("common.state.saving")
                  : t("common.actions.saveRole")}
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
            <AlertDialogTitle>{t("app.members.removeMemberTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {memberPendingRemoval
                ? t("app.members.removeMemberDescriptionWithName", {
                    memberName: memberPendingRemoval.name,
                    memberEmail: memberPendingRemoval.email,
                  })
                : t("app.members.removeMemberDescriptionDefault")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={removingMemberId === memberPendingRemoval?.id}
            >
              {t("common.actions.cancel")}
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
                ? t("common.state.removing")
                : t("common.actions.remove")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
