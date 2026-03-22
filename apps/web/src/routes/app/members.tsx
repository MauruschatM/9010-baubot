import type { Translator } from "@mvp-template/i18n";
import {
  RiMoreFill,
  RiShieldUserLine,
  RiUserUnfollowLine,
  RiWhatsappLine,
} from "@remixicon/react";
import { api } from "@mvp-template/backend/convex/_generated/api";
import { createFileRoute, Link, useRouterState } from "@tanstack/react-router";
import { useAction, useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
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
import { Input } from "@/components/ui/input";
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
import { useCurrentOrganizationState } from "@/lib/current-organization";
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

function getRoleLabel(role: string | string[], t: Translator) {
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

type MembersPageMember = {
  id: string;
  organizationId: string;
  userId: string;
  role: string;
  createdAt: number;
  displayName: string;
  email: string | null;
  phoneNumberE164: string | null;
  image: string | null;
  memberType: "standard" | "phone_only";
  canWebSignIn: boolean;
};

type EditableMember = {
  id: string;
  role: string;
  displayName: string;
  email: string | null;
};

type MemberPendingRemoval = {
  id: string;
  name: string;
  identifier: string | null;
  memberType: "standard" | "phone_only";
};

function errorMessageFromUnknown(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return null;
}

function MembersRoute() {
  const { locale, t } = useI18n();
  const { activeOrganization, isPending } = useCurrentOrganizationState();
  const liveMembersPage = useQuery(
    api.members.getLiveMembersPage,
    activeOrganization?.id
      ? {
          organizationId: activeOrganization.id,
        }
      : "skip",
  );
  const whatsappSetupInfo = useQuery(api.whatsappData.getConnectionSetupInfo);
  const organizationAgentProfile = useQuery(
    api.organizationAgentProfiles.getForOrganization,
    activeOrganization?.id
      ? {
          organizationId: activeOrganization.id,
        }
      : "skip",
  );
  const createPhoneOnlyMember = useAction(api.members.createPhoneOnlyMember);
  const removePhoneOnlyMember = useAction(api.members.removePhoneOnlyMember);
  const saveMemberWhatsappConnection = useMutation(api.whatsappData.setMemberConnection);
  const removeMemberWhatsappConnection = useAction(
    api.whatsappData.removeMemberConnection,
  );
  const sendMemberWhatsappGuideEmail = useAction(
    api.whatsappData.sendMemberActivationGuideEmail,
  );
  const locationSearch = useRouterState({
    select: (state) => state.location.search,
  });
  const membersSearchQuery = useMemo(() => {
    const value = new URLSearchParams(locationSearch).get("search");
    return value?.trim().toLowerCase() ?? "";
  }, [locationSearch]);
  const [isEditRoleDialogOpen, setIsEditRoleDialogOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<EditableMember | null>(null);
  const [nextMemberRole, setNextMemberRole] = useState<MemberRole>("member");
  const [isUpdatingMemberRole, setIsUpdatingMemberRole] = useState(false);
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null);
  const [revokingInvitationId, setRevokingInvitationId] = useState<string | null>(
    null,
  );
  const [memberPendingRemoval, setMemberPendingRemoval] =
    useState<MemberPendingRemoval | null>(null);
  const [isAddWhatsappMemberDialogOpen, setIsAddWhatsappMemberDialogOpen] =
    useState(false);
  const [membersHeaderActionsRoot, setMembersHeaderActionsRoot] =
    useState<HTMLElement | null>(null);
  const [phoneOnlyMemberName, setPhoneOnlyMemberName] = useState("");
  const [phoneOnlyMemberPhoneNumber, setPhoneOnlyMemberPhoneNumber] = useState("");
  const [isCreatingPhoneOnlyMember, setIsCreatingPhoneOnlyMember] = useState(false);
  const [isWhatsappDialogOpen, setIsWhatsappDialogOpen] = useState(false);
  const [whatsappDialogMemberId, setWhatsappDialogMemberId] = useState<string | null>(
    null,
  );
  const [whatsappPhoneNumber, setWhatsappPhoneNumber] = useState("");
  const [isSavingWhatsappConnection, setIsSavingWhatsappConnection] = useState(false);
  const [isRemovingWhatsappConnection, setIsRemovingWhatsappConnection] =
    useState(false);
  const [isSendingWhatsappGuide, setIsSendingWhatsappGuide] = useState(false);
  const currentMemberId = liveMembersPage?.currentMember.id ?? null;
  const activeAgentName =
    organizationAgentProfile?.name ?? t("app.dialogs.aiAgent.defaultName");
  const previewInitialMessage =
    whatsappSetupInfo?.initialMessage ?? "Hi, I am your ai agent for the trades!";
  const memberById = useMemo(
    () =>
      new Map(
        (liveMembersPage?.members ?? []).map((member) => [member.id, member as MembersPageMember]),
      ),
    [liveMembersPage?.members],
  );
  const whatsappDialogMember = whatsappDialogMemberId
    ? (memberById.get(whatsappDialogMemberId) ?? null)
    : null;

  useEffect(() => {
    setMembersHeaderActionsRoot(
      document.getElementById("app-members-header-actions"),
    );
  }, []);

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

      const searchableName = member.displayName.toLowerCase();
      const searchableEmail = (member.email ?? "").toLowerCase();
      const searchablePhone = (member.phoneNumberE164 ?? "").toLowerCase();

      return (
        searchableName.includes(membersSearchQuery) ||
        searchableEmail.includes(membersSearchQuery) ||
        searchablePhone.includes(membersSearchQuery)
      );
    })
    .sort((memberA, memberB) => {
      const roleDifference =
        getRoleSortOrder(memberA.role) - getRoleSortOrder(memberB.role);
      if (roleDifference !== 0) {
        return roleDifference;
      }

      const memberNameA = (
        memberA.displayName.trim() ||
        memberA.email ||
        memberA.phoneNumberE164 ||
        ""
      ).toLowerCase();
      const memberNameB = (
        memberB.displayName.trim() ||
        memberB.email ||
        memberB.phoneNumberE164 ||
        ""
      ).toLowerCase();

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
  const canManageMemberActions =
    liveMembersPage.currentMember.role === "owner" ||
    liveMembersPage.currentMember.role === "admin";

  const closeEditRoleDialog = () => {
    setEditingMember(null);
    setNextMemberRole("member");
    setIsEditRoleDialogOpen(false);
  };

  const openEditRoleDialog = (member: MembersPageMember) => {
    setEditingMember({
      id: member.id,
      role: member.role,
      displayName: member.displayName,
      email: member.email,
    });
    setNextMemberRole(isMemberRole(member.role) ? member.role : "member");
    setIsEditRoleDialogOpen(true);
  };

  const openWhatsappDialog = (member: MembersPageMember) => {
    setWhatsappDialogMemberId(member.id);
    setWhatsappPhoneNumber(member.phoneNumberE164 ?? "");
    setIsWhatsappDialogOpen(true);
  };

  const closeWhatsappDialog = () => {
    setWhatsappDialogMemberId(null);
    setWhatsappPhoneNumber("");
    setIsWhatsappDialogOpen(false);
  };

  const handleCreateWhatsappMember = async (
    event: FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();

    if (!activeOrganization.id) {
      return;
    }

    const displayName = phoneOnlyMemberName.trim();
    const phoneNumber = phoneOnlyMemberPhoneNumber.trim();

    if (displayName.length < 2) {
      toast.error(t("app.toasts.userNameMinLength"));
      return;
    }

    if (!phoneNumber) {
      toast.error(t("app.whatsapp.toasts.enterPhoneNumber"));
      return;
    }

    setIsCreatingPhoneOnlyMember(true);
    try {
      await createPhoneOnlyMember({
        organizationId: activeOrganization.id,
        name: displayName,
        phoneNumber,
      });
      toast.success(t("app.members.toasts.phoneOnlyMemberCreated"));
      setPhoneOnlyMemberName("");
      setPhoneOnlyMemberPhoneNumber("");
      setIsAddWhatsappMemberDialogOpen(false);
    } catch (error) {
      toast.error(
        errorMessageFromUnknown(error) ?? t("app.members.toasts.failedCreatePhoneOnlyMember"),
      );
    } finally {
      setIsCreatingPhoneOnlyMember(false);
    }
  };

  const handleSaveWhatsappConnection = async () => {
    if (!activeOrganization.id || !whatsappDialogMember) {
      return;
    }

    const phoneNumber = whatsappPhoneNumber.trim();
    if (!phoneNumber) {
      toast.error(t("app.whatsapp.toasts.enterPhoneNumber"));
      return;
    }

    setIsSavingWhatsappConnection(true);
    try {
      await saveMemberWhatsappConnection({
        organizationId: activeOrganization.id,
        memberId: whatsappDialogMember.id,
        phoneNumber,
      });
      toast.success(t("app.whatsapp.toasts.connectionSaved"));
    } catch (error) {
      toast.error(
        errorMessageFromUnknown(error) ?? t("app.whatsapp.toasts.failedSaveConnection"),
      );
    } finally {
      setIsSavingWhatsappConnection(false);
    }
  };

  const handleRemoveWhatsappConnection = async () => {
    if (!activeOrganization.id || !whatsappDialogMember) {
      return;
    }

    setIsRemovingWhatsappConnection(true);
    try {
      await removeMemberWhatsappConnection({
        organizationId: activeOrganization.id,
        memberId: whatsappDialogMember.id,
      });
      setWhatsappPhoneNumber("");
      toast.success(t("app.whatsapp.toasts.connectionRemoved"));
    } catch (error) {
      toast.error(
        errorMessageFromUnknown(error) ?? t("app.whatsapp.toasts.failedRemoveConnection"),
      );
    } finally {
      setIsRemovingWhatsappConnection(false);
    }
  };

  const handleSendWhatsappGuide = async () => {
    if (
      !activeOrganization.id ||
      !whatsappDialogMember ||
      !whatsappDialogMember.canWebSignIn ||
      !whatsappDialogMember.email
    ) {
      return;
    }

    setIsSendingWhatsappGuide(true);
    try {
      const result = await sendMemberWhatsappGuideEmail({
        organizationId: activeOrganization.id,
        memberId: whatsappDialogMember.id,
      });
      toast.success(
        t("app.members.toasts.whatsappGuideSent", {
          email: result.email,
        }),
      );
    } catch (error) {
      toast.error(
        errorMessageFromUnknown(error) ?? t("app.members.toasts.failedSendWhatsappGuide"),
      );
    } finally {
      setIsSendingWhatsappGuide(false);
    }
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

  const handleRemoveMember = async (member: MemberPendingRemoval) => {
    if (!activeOrganization.id) {
      return;
    }

    if (currentMemberId === member.id) {
      toast.error(t("app.members.toasts.cannotRemoveSelf"));
      return;
    }

    setRemovingMemberId(member.id);
    try {
      if (member.memberType === "phone_only") {
        await removePhoneOnlyMember({
          organizationId: activeOrganization.id,
          memberId: member.id,
        });
      } else {
        const { error } = await authClient.organization.removeMember({
          memberIdOrEmail: member.id,
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
      }

      toast.success(t("app.members.toasts.memberRemoved"));
    } catch (error) {
      toast.error(
        errorMessageFromUnknown(error) ?? t("app.members.toasts.failedRemoveMember"),
      );
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
      {canManageMemberActions && membersHeaderActionsRoot
        ? createPortal(
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setIsAddWhatsappMemberDialogOpen(true)}
            >
              <RiWhatsappLine className="size-4" />
              <span>{t("app.members.addPhoneOnlyMemberAction")}</span>
            </Button>,
            membersHeaderActionsRoot,
          )
        : null}
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
                const memberName =
                  member.displayName.trim() ||
                  member.email ||
                  member.phoneNumberE164 ||
                  t("common.misc.unknown");
                const memberInitial =
                  memberName.trim().charAt(0).toUpperCase() || "U";
                const isCurrentMember = currentMemberId === member.id;
                const memberSecondaryText =
                  member.email ??
                  member.phoneNumberE164 ??
                  (member.memberType === "phone_only"
                    ? t("app.whatsapp.dialog.notConnected")
                    : t("common.misc.unknown"));

                return (
                  <li key={member.id} className="rounded-md border p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-3">
                        <Avatar className="size-9">
                          <AvatarImage src={member.image ?? undefined} />
                          <AvatarFallback>{memberInitial}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{memberName}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {memberSecondaryText}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 self-start">
                        {member.memberType === "phone_only" ? (
                          <Badge variant="secondary">
                            {t("app.members.phoneOnlyBadge")}
                          </Badge>
                        ) : null}
                        <Badge
                          variant="outline"
                          className="border-border/70 bg-muted text-muted-foreground"
                        >
                          {getRoleLabel(member.role, t)}
                        </Badge>
                        {!isCurrentMember && canManageMemberActions ? (
                          <DropdownMenu>
                            <DropdownMenuTrigger
                              render={
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon-sm"
                                  disabled={
                                    isUpdatingMemberRole ||
                                    removingMemberId === member.id ||
                                    isRemovingWhatsappConnection ||
                                    isSendingWhatsappGuide
                                  }
                                />
                              }
                            >
                              <RiMoreFill className="size-4" />
                              <span className="sr-only">
                                {t("app.shell.openMemberActions")}
                              </span>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-52">
                              <DropdownMenuItem onClick={() => openWhatsappDialog(member)}>
                                <RiWhatsappLine />
                                <span>{t("common.actions.whatsappConnection")}</span>
                              </DropdownMenuItem>
                              {member.memberType === "standard" ? (
                                <DropdownMenuItem
                                  onClick={() => openEditRoleDialog(member)}
                                  disabled={
                                    isUpdatingMemberRole ||
                                    removingMemberId === member.id
                                  }
                                >
                                  <RiShieldUserLine />
                                  <span>{t("common.actions.editRole")}</span>
                                </DropdownMenuItem>
                              ) : null}
                              <DropdownMenuItem
                                variant="destructive"
                                onClick={() =>
                                  setMemberPendingRemoval({
                                    id: member.id,
                                    name: memberName,
                                    identifier:
                                      member.email ?? member.phoneNumberE164 ?? null,
                                    memberType: member.memberType,
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
                        {canManageMemberActions ? (
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
                        ) : null}
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
        open={isAddWhatsappMemberDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            if (isCreatingPhoneOnlyMember) {
              return;
            }
            setPhoneOnlyMemberName("");
            setPhoneOnlyMemberPhoneNumber("");
          }

          setIsAddWhatsappMemberDialogOpen(open);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("app.members.addPhoneOnlyMemberTitle")}</DialogTitle>
            <DialogDescription>
              {t("app.members.addPhoneOnlyMemberDescription")}
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={handleCreateWhatsappMember}>
            <div className="space-y-2">
              <Label htmlFor="phone-only-member-name">{t("common.labels.name")}</Label>
              <Input
                id="phone-only-member-name"
                value={phoneOnlyMemberName}
                onChange={(event) => setPhoneOnlyMemberName(event.target.value)}
                placeholder={t("app.members.phoneOnlyNamePlaceholder")}
                disabled={isCreatingPhoneOnlyMember}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone-only-member-phone">
                {t("app.whatsapp.dialog.numberInputLabel")}
              </Label>
              <Input
                id="phone-only-member-phone"
                value={phoneOnlyMemberPhoneNumber}
                onChange={(event) => setPhoneOnlyMemberPhoneNumber(event.target.value)}
                placeholder={t("app.whatsapp.dialog.numberPlaceholder")}
                disabled={isCreatingPhoneOnlyMember}
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsAddWhatsappMemberDialogOpen(false)}
                disabled={isCreatingPhoneOnlyMember}
              >
                {t("common.actions.cancel")}
              </Button>
              <Button type="submit" disabled={isCreatingPhoneOnlyMember}>
                {isCreatingPhoneOnlyMember
                  ? t("common.state.creating")
                  : t("app.members.addPhoneOnlyMemberSubmit")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isWhatsappDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            if (
              isSavingWhatsappConnection ||
              isRemovingWhatsappConnection ||
              isSendingWhatsappGuide
            ) {
              return;
            }
            closeWhatsappDialog();
            return;
          }

          setIsWhatsappDialogOpen(open);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("app.whatsapp.dialog.title")}</DialogTitle>
            <DialogDescription>
              {whatsappDialogMember
                ? t("app.members.whatsappDialogDescriptionWithName", {
                    memberName: whatsappDialogMember.displayName,
                  })
                : t("app.whatsapp.dialog.description")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                {t("app.whatsapp.dialog.connectedNumberLabel")}
              </p>
              <p className="mt-1 text-sm font-medium">
                {whatsappDialogMember
                  ? (whatsappDialogMember.phoneNumberE164 ??
                    t("app.whatsapp.dialog.notConnected"))
                  : t("app.whatsapp.dialog.notConnected")}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="member-whatsapp-number">
                {t("app.whatsapp.dialog.numberInputLabel")}
              </Label>
              <Input
                id="member-whatsapp-number"
                value={whatsappPhoneNumber}
                onChange={(event) => setWhatsappPhoneNumber(event.target.value)}
                placeholder={t("app.whatsapp.dialog.numberPlaceholder")}
                disabled={
                  !whatsappDialogMember ||
                  isSavingWhatsappConnection ||
                  isRemovingWhatsappConnection ||
                  isSendingWhatsappGuide
                }
              />
            </div>
            {whatsappDialogMember?.memberType === "phone_only" ? (
              <p className="text-sm text-muted-foreground">
                {t("app.members.phoneOnlyDescription")}
              </p>
            ) : null}
            {whatsappDialogMember?.canWebSignIn && whatsappDialogMember.email ? (
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  {t("app.members.whatsappGuidePreviewTitle")}
                </p>
                <div className="mt-2 rounded-md border bg-card p-3">
                  <div className="rounded-md bg-muted/30 p-2.5 text-xs">
                    <p>
                      <span className="font-medium">{t("common.labels.email")}:</span>{" "}
                      {whatsappDialogMember.email}
                    </p>
                    <p className="mt-1">
                      <span className="font-medium">
                        {t("app.members.whatsappGuidePreviewSubjectLabel")}:
                      </span>{" "}
                      {t("app.members.whatsappGuidePreviewSubject", {
                        organizationName:
                          activeOrganization?.name ?? t("common.misc.untitledWorkspace"),
                      })}
                    </p>
                    <p className="mt-2 text-muted-foreground">
                      {t("app.members.whatsappGuidePreviewIntro", {
                        memberName:
                          whatsappDialogMember.displayName ?? t("common.misc.user"),
                        agentName: activeAgentName,
                      })}
                    </p>
                    <p className="mt-1 text-muted-foreground">
                      {t("app.members.whatsappGuidePreviewAgentNumber", {
                        agentNumber:
                          whatsappSetupInfo?.phoneNumberE164 ?? t("common.misc.unknown"),
                      })}
                    </p>
                    <p className="mt-1 text-muted-foreground">
                      {t("app.members.whatsappGuidePreviewInitialMessage", {
                        initialMessage: previewInitialMessage,
                      })}
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                {t("app.members.whatsappGuideUnavailablePhoneOnly")}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={closeWhatsappDialog}
              disabled={
                isSavingWhatsappConnection ||
                isRemovingWhatsappConnection ||
                isSendingWhatsappGuide
              }
            >
              {t("common.actions.cancel")}
            </Button>
            <Button
              type="button"
              onClick={() => {
                void handleSaveWhatsappConnection();
              }}
              disabled={
                !whatsappDialogMember ||
                isSavingWhatsappConnection ||
                isRemovingWhatsappConnection ||
                isSendingWhatsappGuide
              }
            >
              {isSavingWhatsappConnection
                ? t("common.state.saving")
                : t("app.whatsapp.actions.saveConnection")}
            </Button>
            {whatsappDialogMember?.canWebSignIn && whatsappDialogMember.email ? (
              <Button
                type="button"
                onClick={() => {
                  void handleSendWhatsappGuide();
                }}
                disabled={
                  !whatsappDialogMember ||
                  isSavingWhatsappConnection ||
                  isRemovingWhatsappConnection ||
                  isSendingWhatsappGuide
                }
              >
                {isSendingWhatsappGuide
                  ? t("common.state.sending")
                  : t("app.members.whatsappGuideSend")}
              </Button>
            ) : null}
            {whatsappDialogMember?.phoneNumberE164 ? (
              <Button
                type="button"
                variant="destructive"
                onClick={() => {
                  void handleRemoveWhatsappConnection();
                }}
                disabled={
                  isSavingWhatsappConnection ||
                  isRemovingWhatsappConnection ||
                  isSendingWhatsappGuide
                }
              >
                {isRemovingWhatsappConnection
                  ? t("common.state.removing")
                  : t("app.whatsapp.actions.removeConnection")}
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
                    memberName:
                      editingMember.displayName ||
                      editingMember.email ||
                      t("common.misc.user"),
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
                ? t("app.members.removeMemberDescriptionWithIdentifier", {
                    memberName: memberPendingRemoval.name,
                    memberIdentifier:
                      memberPendingRemoval.identifier ?? t("common.misc.unknown"),
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

                void handleRemoveMember(memberPendingRemoval);
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
