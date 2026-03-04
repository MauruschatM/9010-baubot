import { api } from "@mvp-template/backend/convex/_generated/api";
import {
  Link,
  Outlet,
  createFileRoute,
  useRouterState,
  useNavigate,
} from "@tanstack/react-router";
import { useQuery } from "convex/react";
import {
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import {
  RiArrowDownSLine,
  RiComputerLine,
  RiLayoutGridLine,
  RiLogoutBoxRLine,
  RiMailSendLine,
  RiMoonLine,
  RiPaletteLine,
  RiRepeatLine,
  RiSearchLine,
  RiSettings4Line,
  RiSunLine,
  RiTeamLine,
} from "@remixicon/react";

import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarSeparator,
  SidebarTrigger,
} from "@/components/ui/sidebar";
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
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { authClient } from "@/lib/auth-client";
import { useClientRouteGate } from "@/lib/client-route-gates";

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

type InviteMemberRole = "owner" | "admin" | "member";

const inviteMemberRoleOptions: Array<{
  value: InviteMemberRole;
  label: string;
}> = [
  { value: "member", label: "Member" },
  { value: "admin", label: "Admin" },
  { value: "owner", label: "Owner" },
];

function isInviteMemberRole(value: string | null): value is InviteMemberRole {
  if (!value) {
    return false;
  }

  return inviteMemberRoleOptions.some((roleOption) => roleOption.value === value);
}

const MAX_LOGO_DATA_URL_BYTES = 900 * 1024;
const MAX_LOGO_DIMENSION = 512;

function estimateDataUrlBytes(dataUrl: string) {
  const base64 = dataUrl.split(",")[1] ?? "";
  return Math.floor((base64.length * 3) / 4);
}

function loadImageFromFile(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Failed to load image"));
    };

    image.src = objectUrl;
  });
}

async function convertImageToLogoDataUrl(file: File) {
  const image = await loadImageFromFile(file);
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  const longestEdge = Math.max(width, height, 1);
  const scale = Math.min(1, MAX_LOGO_DIMENSION / longestEdge);

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Unable to process image");
  }

  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  const mimeCandidates = ["image/webp", "image/jpeg"];
  const qualityCandidates = [0.9, 0.82, 0.74, 0.66, 0.58, 0.5];

  for (const mimeType of mimeCandidates) {
    for (const quality of qualityCandidates) {
      const dataUrl = canvas.toDataURL(mimeType, quality);
      if (estimateDataUrlBytes(dataUrl) <= MAX_LOGO_DATA_URL_BYTES) {
        return dataUrl;
      }
    }
  }

  const pngDataUrl = canvas.toDataURL("image/png");
  if (estimateDataUrlBytes(pngDataUrl) <= MAX_LOGO_DATA_URL_BYTES) {
    return pngDataUrl;
  }

  throw new Error(
    "Image is still too large after optimization. Please choose a smaller image.",
  );
}

export const Route = createFileRoute("/app")({
  ssr: false,
  component: AppRoute,
});

function AppRoute() {
  const { canRender } = useClientRouteGate("app");

  if (!canRender) {
    return null;
  }

  return <AppRouteContent />;
}

function AppRouteContent() {
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate({ from: "/app" });
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const locationSearch = useRouterState({
    select: (state) => state.location.search,
  });
  const { data: activeOrganization, isPending: isOrganizationPending } =
    authClient.useActiveOrganization();
  const { data: activeMember } = authClient.useActiveMember();
  const organizationsResult = authClient.useListOrganizations();
  const organizations = (organizationsResult.data ?? []) as Array<{
    id: string;
    name: string;
  }>;

  const user = useQuery(api.auth.getCurrentUser);
  const [userName, setUserName] = useState("");
  const [userImage, setUserImage] = useState("");
  const [isUserDialogOpen, setIsUserDialogOpen] = useState(false);
  const [isUpdatingUser, setIsUpdatingUser] = useState(false);
  const [organizationName, setOrganizationName] = useState("");
  const [organizationLogo, setOrganizationLogo] = useState("");
  const [isOrganizationDialogOpen, setIsOrganizationDialogOpen] = useState(false);
  const [isOrganizationSwitchDialogOpen, setIsOrganizationSwitchDialogOpen] =
    useState(false);
  const [isCreateOrganizationDialogOpen, setIsCreateOrganizationDialogOpen] =
    useState(false);
  const [isUpdatingOrganization, setIsUpdatingOrganization] = useState(false);
  const [isLeavingOrganization, setIsLeavingOrganization] = useState(false);
  const [isDeletingOrganization, setIsDeletingOrganization] = useState(false);
  const [isLeaveOrganizationDialogOpen, setIsLeaveOrganizationDialogOpen] =
    useState(false);
  const [isDeleteOrganizationDialogOpen, setIsDeleteOrganizationDialogOpen] =
    useState(false);
  const [isCreatingOrganization, setIsCreatingOrganization] = useState(false);
  const [isInviteMemberDialogOpen, setIsInviteMemberDialogOpen] = useState(false);
  const [inviteMemberEmail, setInviteMemberEmail] = useState("");
  const [inviteMemberRole, setInviteMemberRole] =
    useState<InviteMemberRole>("member");
  const [isInvitingMember, setIsInvitingMember] = useState(false);
  const inviteMemberRoleLabel =
    inviteMemberRoleOptions.find(
      (roleOption) => roleOption.value === inviteMemberRole,
    )?.label ?? "Member";
  const [switchingOrganizationId, setSwitchingOrganizationId] = useState<
    string | null
  >(null);
  const [createOrganizationName, setCreateOrganizationName] = useState("");
  const createOrganizationSlug = useMemo(
    () => slugify(createOrganizationName),
    [createOrganizationName],
  );

  useEffect(() => {
    if (!activeOrganization) {
      return;
    }

    setOrganizationName(activeOrganization.name);
    setOrganizationLogo(activeOrganization.logo ?? "");
  }, [activeOrganization?.id, activeOrganization?.name, activeOrganization?.logo]);

  const handleUpdateOrganization = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmedName = organizationName.trim();
    const normalizedLogo = organizationLogo.trim();
    const currentLogo = activeOrganization?.logo ?? "";

    if (!activeOrganization?.id) {
      return;
    }

    if (trimmedName.length < 2) {
      toast.error("Organization name must be at least 2 characters");
      return;
    }

    if (trimmedName === activeOrganization.name && normalizedLogo === currentLogo) {
      setIsOrganizationDialogOpen(false);
      return;
    }

    setIsUpdatingOrganization(true);
    try {
      const { error } = await authClient.organization.update({
        organizationId: activeOrganization.id,
        data: {
          name: trimmedName,
          logo: normalizedLogo || undefined,
        },
      });

      if (error) {
        toast.error(error.message ?? "Failed to update organization");
        return;
      }

      toast.success("Organization updated");
      setIsOrganizationDialogOpen(false);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to update organization";
      toast.error(message);
    } finally {
      setIsUpdatingOrganization(false);
    }
  };

  const organizationDisplayName =
    activeOrganization?.name || "Untitled workspace";
  const organizationInitial =
    organizationDisplayName.trim().charAt(0).toUpperCase() || "O";
  const isOwner = activeMember?.role === "owner";
  const userDisplayName = user?.name?.trim() || "User";
  const userInitial = userDisplayName.charAt(0).toUpperCase() || "U";
  const isMembersPage = pathname.startsWith("/app/members");
  const selectedTheme =
    theme === "light" || theme === "dark" || theme === "system"
      ? theme
      : "system";
  const membersSearchQuery = useMemo(() => {
    const value = new URLSearchParams(locationSearch).get("search");
    return value ?? "";
  }, [locationSearch]);

  const handleMembersSearchChange = (value: string) => {
    void navigate({
      to: "/app/members",
      search: (previous) => {
        const nextSearch = { ...(previous as Record<string, unknown>) };
        const normalizedValue = value.trim();

        if (!normalizedValue) {
          delete nextSearch.search;
        } else {
          nextSearch.search = value;
        }

        return nextSearch;
      },
      replace: true,
    });
  };

  const handleSignOut = async () => {
    try {
      const { error } = await authClient.signOut();

      if (error) {
        return;
      }

      navigate({ to: "/login", replace: true });
    } catch {
      navigate({ to: "/login", replace: true });
    }
  };

  const openUserSettings = () => {
    setUserName(user?.name ?? "");
    setUserImage(user?.image ?? "");
    setIsUserDialogOpen(true);
  };

  const handleUpdateUser = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmedName = userName.trim();
    const normalizedImage = userImage.trim();
    const currentName = user?.name?.trim() ?? "";
    const currentImage = user?.image ?? "";

    if (trimmedName.length < 2) {
      toast.error("Name must be at least 2 characters");
      return;
    }

    if (trimmedName === currentName && normalizedImage === currentImage) {
      setIsUserDialogOpen(false);
      return;
    }

    setIsUpdatingUser(true);
    try {
      const { error } = await authClient.updateUser({
        name: trimmedName,
        image: normalizedImage || "",
      });

      if (error) {
        toast.error(error.message ?? "Failed to update profile");
        return;
      }

      toast.success("Profile updated");
      setIsUserDialogOpen(false);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to update profile";
      toast.error(message);
    } finally {
      setIsUpdatingUser(false);
    }
  };

  const handleUserImageFileChange = async (
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file");
      event.target.value = "";
      return;
    }

    const maxFileSizeBytes = 10 * 1024 * 1024;
    if (file.size > maxFileSizeBytes) {
      toast.error("Image must be 10MB or smaller");
      event.target.value = "";
      return;
    }

    try {
      const optimizedImageDataUrl = await convertImageToLogoDataUrl(file);
      setUserImage(optimizedImageDataUrl);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to process image";
      toast.error(message);
    } finally {
      event.target.value = "";
    }
  };

  const openOrganizationSettings = () => {
    if (!activeOrganization) {
      return;
    }

    setOrganizationName(activeOrganization.name);
    setOrganizationLogo(activeOrganization.logo ?? "");
    setIsOrganizationDialogOpen(true);
  };

  const handleOrganizationLogoFileChange = async (
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file");
      event.target.value = "";
      return;
    }

    const maxFileSizeBytes = 10 * 1024 * 1024;
    if (file.size > maxFileSizeBytes) {
      toast.error("Image must be 10MB or smaller");
      event.target.value = "";
      return;
    }

    try {
      const optimizedImageDataUrl = await convertImageToLogoDataUrl(file);
      setOrganizationLogo(optimizedImageDataUrl);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to process image";
      toast.error(message);
    } finally {
      event.target.value = "";
    }
  };

  const handleSwitchOrganization = async (organizationId: string) => {
    if (organizationId === activeOrganization?.id) {
      setIsOrganizationSwitchDialogOpen(false);
      return;
    }

    setSwitchingOrganizationId(organizationId);
    try {
      const { error } = await authClient.organization.setActive({
        organizationId,
      });

      if (error) {
        toast.error(error.message ?? "Failed to switch organization");
        return;
      }

      toast.success("Organization switched");
      setIsOrganizationSwitchDialogOpen(false);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to switch organization";
      toast.error(message);
    } finally {
      setSwitchingOrganizationId(null);
    }
  };

  const openCreateOrganizationDialog = () => {
    setIsOrganizationSwitchDialogOpen(false);
    setCreateOrganizationName("");
    setIsCreateOrganizationDialogOpen(true);
  };

  const handleCreateOrganization = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmedName = createOrganizationName.trim();

    if (trimmedName.length < 2) {
      toast.error("Organization name must be at least 2 characters");
      return;
    }

    if (!createOrganizationSlug) {
      toast.error("Enter a valid organization name");
      return;
    }

    setIsCreatingOrganization(true);
    try {
      const createResult = await authClient.organization.create({
        name: trimmedName,
        slug: createOrganizationSlug,
      });

      if (createResult.error) {
        toast.error(createResult.error.message ?? "Failed to create organization");
        return;
      }

      const created = createResult.data;

      if (created?.id) {
        const setActiveResult = await authClient.organization.setActive({
          organizationId: created.id,
        });

        if (setActiveResult.error) {
          toast.error(
            setActiveResult.error.message ??
              "Organization created, but switching failed",
          );
          return;
        }
      }

      toast.success("Organization created");
      setIsCreateOrganizationDialogOpen(false);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to create organization";
      toast.error(message);
    } finally {
      setIsCreatingOrganization(false);
    }
  };

  const handleLeaveOrganization = async () => {
    if (!activeOrganization?.id) {
      toast.error("No active organization selected");
      return;
    }

    if (isOwner) {
      toast.error("Owners can't leave. Delete the organization instead.");
      return;
    }

    setIsLeavingOrganization(true);
    try {
      const { error } = await authClient.organization.leave({
        organizationId: activeOrganization.id,
      });

      if (error) {
        toast.error(error.message ?? "Failed to leave organization");
        return;
      }

      toast.success("You left the organization");
      setIsLeaveOrganizationDialogOpen(false);
      setIsOrganizationDialogOpen(false);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to leave organization";
      toast.error(message);
    } finally {
      setIsLeavingOrganization(false);
    }
  };

  const handleDeleteOrganization = async () => {
    if (!activeOrganization?.id) {
      toast.error("No active organization selected");
      return;
    }

    if (!isOwner) {
      toast.error("Only organization owners can delete the organization.");
      return;
    }

    setIsDeletingOrganization(true);
    try {
      const { error } = await authClient.organization.delete({
        organizationId: activeOrganization.id,
      });

      if (error) {
        toast.error(error.message ?? "Failed to delete organization");
        return;
      }

      toast.success("Organization deleted");
      setIsDeleteOrganizationDialogOpen(false);
      setIsOrganizationDialogOpen(false);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to delete organization";
      toast.error(message);
    } finally {
      setIsDeletingOrganization(false);
    }
  };

  const closeInviteMemberDialog = () => {
    setInviteMemberEmail("");
    setInviteMemberRole("member");
    setIsInviteMemberDialogOpen(false);
  };

  const handleInviteMember = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!activeOrganization?.id) {
      toast.error("No active organization selected");
      return;
    }

    const email = inviteMemberEmail.trim().toLowerCase();

    if (!email) {
      toast.error("Enter an email address");
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast.error("Enter a valid email address");
      return;
    }

    setIsInvitingMember(true);

    try {
      const { error } = await authClient.organization.inviteMember({
        email,
        organizationId: activeOrganization.id,
        role: inviteMemberRole,
      });

      if (error) {
        toast.error(error.message ?? "Failed to send invitation");
        return;
      }

      toast.success(`Invitation sent to ${email}`);
      closeInviteMemberDialog();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to send invitation";
      toast.error(message);
    } finally {
      setIsInvitingMember(false);
    }
  };

  return (
    <SidebarProvider className="bg-gradient-to-br from-background via-background to-muted/30">
      <Sidebar>
        <SidebarContent className="pb-3">
          <div className="flex h-12 items-center border-b border-sidebar-border px-3 transition-colors hover:bg-sidebar-accent/60">
            <SidebarMenu className="w-full">
              <SidebarMenuItem>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <SidebarMenuButton
                        disabled={isOrganizationPending || !activeOrganization}
                        className="h-9 rounded-lg px-2 font-medium !bg-transparent transition-none hover:!bg-transparent focus-visible:!bg-transparent"
                      />
                    }
                  >
                    <Avatar size="sm" className="size-4 !rounded-md after:!rounded-md">
                      <AvatarImage
                        src={activeOrganization?.logo ?? undefined}
                        className="!rounded-md"
                      />
                      <AvatarFallback className="!rounded-md text-[10px]">
                        {organizationInitial}
                      </AvatarFallback>
                    </Avatar>
                    <span className="truncate">{organizationDisplayName}</span>
                    <RiArrowDownSLine className="ml-auto size-4 text-sidebar-foreground/70" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    className="rounded-xl bg-card px-1.5 pb-1.5 pt-2.5"
                    align="start"
                    side="bottom"
                    sideOffset={10}
                  >
                    <DropdownMenuGroup>
                      <DropdownMenuLabel className="px-2.5">Organization</DropdownMenuLabel>
                      <DropdownMenuItem
                        className="min-h-8 px-2"
                        onClick={openOrganizationSettings}
                        disabled={isOrganizationPending || !activeOrganization}
                      >
                        <RiSettings4Line />
                        <span>Settings</span>
                      </DropdownMenuItem>
                      <DropdownMenuSeparator className="my-1" />
                      <DropdownMenuItem
                        className="min-h-8 px-2"
                        onClick={() => setIsOrganizationSwitchDialogOpen(true)}
                      >
                        <RiRepeatLine />
                        <span>Switch</span>
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              </SidebarMenuItem>
            </SidebarMenu>
          </div>

          <SidebarMenu className="gap-1 px-3 pt-3">
            <SidebarMenuItem>
              <SidebarMenuButton
                render={<Link to="/app" />}
                isActive={pathname === "/app"}
                className="h-9 rounded-lg px-2 font-medium data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-foreground"
              >
                <RiLayoutGridLine className="size-4" />
                <span>Dashboard</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                render={<Link to="/app/members" />}
                isActive={pathname.startsWith("/app/members")}
                className="h-9 rounded-lg px-2 font-medium data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-foreground"
              >
                <RiTeamLine className="size-4" />
                <span>Members</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>

          <div className="flex-1" />
        </SidebarContent>

        <SidebarFooter className="gap-0 p-0">
          <SidebarSeparator className="mx-0" />
          <div className="flex h-12 items-center px-3 transition-colors hover:bg-sidebar-accent/60">
            <SidebarMenu className="w-full">
              <SidebarMenuItem>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <SidebarMenuButton className="h-9 rounded-lg px-2 font-medium !bg-transparent transition-none hover:!bg-transparent focus-visible:!bg-transparent" />
                    }
                  >
                    <Avatar size="sm" className="size-4 !rounded-md after:!rounded-md">
                      <AvatarImage src={user?.image || undefined} className="!rounded-md" />
                      <AvatarFallback className="!rounded-md text-[10px]">
                        {userInitial}
                      </AvatarFallback>
                    </Avatar>
                    <span className="truncate">{userDisplayName}</span>
                    <RiArrowDownSLine className="ml-auto size-4 text-sidebar-foreground/70" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    className="rounded-xl bg-card px-1.5 pb-1.5 pt-2.5"
                    align="start"
                    side="top"
                    sideOffset={10}
                  >
                    <DropdownMenuGroup>
                      <DropdownMenuLabel className="px-2.5">Account</DropdownMenuLabel>
                      <DropdownMenuItem
                        className="min-h-8 px-2"
                        onClick={openUserSettings}
                        disabled={!user}
                      >
                        <RiSettings4Line />
                        <span>Settings</span>
                      </DropdownMenuItem>
                      <DropdownMenuSub>
                        <DropdownMenuSubTrigger className="min-h-8 px-2">
                          <RiPaletteLine />
                          <span>Theme</span>
                        </DropdownMenuSubTrigger>
                        <DropdownMenuSubContent className="w-44">
                          <DropdownMenuRadioGroup
                            value={selectedTheme}
                            onValueChange={(value) => {
                              setTheme(value as "light" | "dark" | "system");
                            }}
                          >
                            <DropdownMenuRadioItem className="min-h-8 pl-2 pr-8" value="system">
                              <RiComputerLine />
                              <span>System</span>
                            </DropdownMenuRadioItem>
                            <DropdownMenuRadioItem className="min-h-8 pl-2 pr-8" value="light">
                              <RiSunLine />
                              <span>Light</span>
                            </DropdownMenuRadioItem>
                            <DropdownMenuRadioItem className="min-h-8 pl-2 pr-8" value="dark">
                              <RiMoonLine />
                              <span>Dark</span>
                            </DropdownMenuRadioItem>
                          </DropdownMenuRadioGroup>
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>
                    </DropdownMenuGroup>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      className="min-h-8 px-2"
                      onClick={() => void handleSignOut()}
                    >
                      <RiLogoutBoxRLine />
                      <span>Sign out</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </SidebarMenuItem>
            </SidebarMenu>
          </div>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset className="min-h-svh bg-gradient-to-b from-background to-muted/20">
        <header className="sticky top-0 z-20 bg-background/90 backdrop-blur">
          <div className="flex h-12 items-center justify-between gap-3 border-b border-sidebar-border px-4 md:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <SidebarTrigger className="-ml-1" />
              <div className="h-4 w-px bg-border" />
              <p className="text-sm font-medium tracking-tight">
                {isMembersPage ? "Members" : "Workspace"}
              </p>
            </div>
            {isMembersPage ? (
              <div className="flex items-center gap-2">
                <div className="relative flex items-center">
                  <span className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-muted-foreground">
                    <RiSearchLine className="size-4" />
                  </span>
                  <Input
                    type="search"
                    value={membersSearchQuery}
                    onChange={(event) => handleMembersSearchChange(event.target.value)}
                    placeholder="Search members"
                    className="h-7 w-44 pl-8 sm:w-56"
                  />
                </div>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => setIsInviteMemberDialogOpen(true)}
                  disabled={isOrganizationPending || !activeOrganization}
                >
                  <RiMailSendLine className="size-4" />
                  <span>Invite</span>
                </Button>
              </div>
            ) : null}
          </div>
        </header>
        <main className="flex-1 p-4 md:p-6">
          <div className="mx-auto w-full max-w-5xl">
            <Outlet />
          </div>
        </main>
      </SidebarInset>

      <Dialog
        open={isInviteMemberDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setInviteMemberEmail("");
            setInviteMemberRole("member");
          }

          setIsInviteMemberDialogOpen(open);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite Member</DialogTitle>
            <DialogDescription>
              Send an invitation to join this organization.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={handleInviteMember}>
            <div className="space-y-2">
              <Label htmlFor="invite-member-email">Email</Label>
              <Input
                id="invite-member-email"
                type="email"
                autoComplete="email"
                value={inviteMemberEmail}
                onChange={(event) => setInviteMemberEmail(event.target.value)}
                placeholder="person@company.com"
                disabled={isInvitingMember}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="invite-member-role">Role</Label>
              <Select
                value={inviteMemberRole}
                onValueChange={(value) => {
                  if (isInviteMemberRole(value)) {
                    setInviteMemberRole(value);
                  }
                }}
              >
                <SelectTrigger id="invite-member-role" className="w-full">
                  <SelectValue placeholder="Select role">
                    {inviteMemberRoleLabel}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent align="start">
                  {inviteMemberRoleOptions.map((roleOption) => (
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
                onClick={closeInviteMemberDialog}
                disabled={isInvitingMember}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isInvitingMember || !activeOrganization}
              >
                {isInvitingMember ? "Sending..." : "Send invite"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isUserDialogOpen}
        onOpenChange={(open) => {
          if (open) {
            setUserName(user?.name ?? "");
            setUserImage(user?.image ?? "");
          }

          setIsUserDialogOpen(open);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Profile Settings</DialogTitle>
            <DialogDescription>
              Update your display name and avatar.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={handleUpdateUser}>
            <div className="space-y-2">
              <Label htmlFor="user-name">Name</Label>
              <Input
                id="user-name"
                value={userName}
                onChange={(event) => setUserName(event.target.value)}
                disabled={isUpdatingUser}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="user-email">Email</Label>
              <Input id="user-email" value={user?.email ?? ""} readOnly disabled />
            </div>
            <div className="space-y-2">
              <Label htmlFor="user-avatar">Avatar</Label>
              <Input
                id="user-avatar"
                type="file"
                accept="image/*"
                disabled={isUpdatingUser}
                onChange={(event) => {
                  void handleUserImageFileChange(event);
                }}
              />
              <div className="flex items-center gap-3 rounded-md border p-2">
                <Avatar>
                  <AvatarImage src={userImage || undefined} />
                  <AvatarFallback>{userInitial}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{userName || userDisplayName}</p>
                  <p className="text-xs text-muted-foreground">
                    PNG, JPG, or WEBP up to 10MB (optimized automatically).
                  </p>
                </div>
                {userImage ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setUserImage("")}
                    disabled={isUpdatingUser}
                  >
                    Remove
                  </Button>
                ) : null}
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setUserName(user?.name ?? "");
                  setUserImage(user?.image ?? "");
                  setIsUserDialogOpen(false);
                }}
                disabled={isUpdatingUser}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isUpdatingUser}>
                {isUpdatingUser ? "Saving..." : "Save changes"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isOrganizationSwitchDialogOpen}
        onOpenChange={setIsOrganizationSwitchDialogOpen}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Switch Organization</DialogTitle>
            <DialogDescription>
              Select one of your organizations.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {organizationsResult.data === undefined ? (
              <p className="text-sm text-muted-foreground">Loading organizations...</p>
            ) : organizations.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                You do not have any organizations yet.
              </p>
            ) : (
              <div className="space-y-2">
                {organizations.map((organization) => (
                  <Button
                    key={organization.id}
                    type="button"
                    variant={
                      organization.id === activeOrganization?.id ? "secondary" : "outline"
                    }
                    className="w-full justify-between"
                    disabled={switchingOrganizationId !== null}
                    onClick={() => void handleSwitchOrganization(organization.id)}
                  >
                    <span className="truncate">{organization.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {organization.id === activeOrganization?.id
                        ? "Active"
                        : switchingOrganizationId === organization.id
                          ? "Switching..."
                          : "Switch"}
                    </span>
                  </Button>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsOrganizationSwitchDialogOpen(false)}
              disabled={switchingOrganizationId !== null}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={openCreateOrganizationDialog}
              disabled={switchingOrganizationId !== null}
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isCreateOrganizationDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setCreateOrganizationName("");
          }

          setIsCreateOrganizationDialogOpen(open);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Organization</DialogTitle>
            <DialogDescription>
              Create a new organization and switch to it.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={handleCreateOrganization}>
            <div className="space-y-2">
              <Label htmlFor="create-organization-name">Name</Label>
              <Input
                id="create-organization-name"
                value={createOrganizationName}
                onChange={(event) => setCreateOrganizationName(event.target.value)}
                disabled={isCreatingOrganization}
                placeholder="Acme Inc"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="create-organization-slug">Slug</Label>
              <Input
                id="create-organization-slug"
                value={createOrganizationSlug}
                readOnly
                disabled
                placeholder="acme-inc"
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setCreateOrganizationName("");
                  setIsCreateOrganizationDialogOpen(false);
                }}
                disabled={isCreatingOrganization}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isCreatingOrganization}>
                {isCreatingOrganization ? "Creating..." : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isOrganizationDialogOpen}
        onOpenChange={(open) => {
          if (open && activeOrganization?.name) {
            setOrganizationName(activeOrganization.name);
            setOrganizationLogo(activeOrganization.logo ?? "");
          } else if (!open) {
            setIsLeaveOrganizationDialogOpen(false);
            setIsDeleteOrganizationDialogOpen(false);
          }

          setIsOrganizationDialogOpen(open);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Organization</DialogTitle>
            <DialogDescription>
              Edit your organization name and review its slug.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={handleUpdateOrganization}>
            <div className="space-y-2">
              <Label htmlFor="organization-name">Name</Label>
              <Input
                id="organization-name"
                value={organizationName}
                onChange={(event) => setOrganizationName(event.target.value)}
                disabled={
                  isUpdatingOrganization ||
                  isLeavingOrganization ||
                  isDeletingOrganization ||
                  isOrganizationPending ||
                  !activeOrganization
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="organization-logo">Logo</Label>
              <Input
                id="organization-logo"
                type="file"
                accept="image/*"
                disabled={
                  isUpdatingOrganization ||
                  isLeavingOrganization ||
                  isDeletingOrganization ||
                  isOrganizationPending ||
                  !activeOrganization
                }
                onChange={(event) => {
                  void handleOrganizationLogoFileChange(event);
                }}
              />
              <div className="flex items-center gap-3 rounded-md border p-2">
                <Avatar className="!rounded-md after:!rounded-md">
                  <AvatarImage src={organizationLogo || undefined} className="!rounded-md" />
                  <AvatarFallback className="!rounded-md">
                    {organizationInitial}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{organizationDisplayName}</p>
                  <p className="text-xs text-muted-foreground">
                    PNG, JPG, or WEBP up to 2MB.
                  </p>
                </div>
                {organizationLogo ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setOrganizationLogo("")}
                    disabled={
                      isUpdatingOrganization ||
                      isLeavingOrganization ||
                      isDeletingOrganization ||
                      isOrganizationPending
                    }
                  >
                    Remove
                  </Button>
                ) : null}
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="organization-slug">Slug</Label>
              <Input
                id="organization-slug"
                value={activeOrganization?.slug || ""}
                readOnly
                disabled
              />
            </div>
            <DialogFooter>
              <div className="flex flex-wrap items-center gap-2 sm:mr-auto">
                {isOwner ? (
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={() => setIsDeleteOrganizationDialogOpen(true)}
                    disabled={
                      isUpdatingOrganization ||
                      isLeavingOrganization ||
                      isDeletingOrganization ||
                      isOrganizationPending ||
                      !activeOrganization
                    }
                  >
                    Delete
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={() => setIsLeaveOrganizationDialogOpen(true)}
                    disabled={
                      isUpdatingOrganization ||
                      isLeavingOrganization ||
                      isDeletingOrganization ||
                      isOrganizationPending ||
                      !activeOrganization
                    }
                  >
                    Leave
                  </Button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    if (activeOrganization?.name) {
                      setOrganizationName(activeOrganization.name);
                      setOrganizationLogo(activeOrganization.logo ?? "");
                    }

                    setIsOrganizationDialogOpen(false);
                  }}
                  disabled={
                    isUpdatingOrganization ||
                    isLeavingOrganization ||
                    isDeletingOrganization ||
                    isOrganizationPending
                  }
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={
                    isUpdatingOrganization ||
                    isLeavingOrganization ||
                    isDeletingOrganization ||
                    isOrganizationPending ||
                    !activeOrganization
                  }
                >
                  {isUpdatingOrganization ? "Saving..." : "Save changes"}
                </Button>
              </div>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={isLeaveOrganizationDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setIsLeaveOrganizationDialogOpen(false);
          } else {
            setIsLeaveOrganizationDialogOpen(true);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave organization?</AlertDialogTitle>
            <AlertDialogDescription>
              {activeOrganization
                ? `You will lose access to ${activeOrganization.name} unless someone invites you again.`
                : "You will lose access to this organization unless someone invites you again."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isLeavingOrganization}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={isLeavingOrganization || isOwner || !activeOrganization}
              onClick={() => void handleLeaveOrganization()}
            >
              {isLeavingOrganization ? "Leaving..." : "Leave"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={isDeleteOrganizationDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setIsDeleteOrganizationDialogOpen(false);
          } else {
            setIsDeleteOrganizationDialogOpen(true);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete organization?</AlertDialogTitle>
            <AlertDialogDescription>
              {activeOrganization
                ? `This permanently deletes ${activeOrganization.name}, including members and invitations.`
                : "This permanently deletes the organization, including members and invitations."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeletingOrganization}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={isDeletingOrganization || !isOwner || !activeOrganization}
              onClick={() => void handleDeleteOrganization()}
            >
              {isDeletingOrganization ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SidebarProvider>
  );
}
