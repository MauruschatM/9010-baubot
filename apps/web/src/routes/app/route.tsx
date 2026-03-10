import {
  SYSTEM_LOCALE,
  normalizeTranslatedLocale,
  resolveTranslatedLocale,
  type AppLocale,
  type LocalePreference,
  type TranslationKey,
} from "@mvp-template/i18n";
import { api } from "@mvp-template/backend/convex/_generated/api";
import type { Id } from "@mvp-template/backend/convex/_generated/dataModel";
import {
  Link,
  Outlet,
  createFileRoute,
  useRouterState,
  useNavigate,
} from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import {
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import { useTheme } from "next-themes";
import { toast } from "@/components/ui/sonner";
import {
  RiArchiveLine,
  RiArrowLeftLine,
  RiArrowDownSLine,
  RiCheckLine,
  RiComputerLine,
  RiFolder3Line,
  RiGlobalLine,
  RiLogoutBoxRLine,
  RiMailSendLine,
  RiMoonLine,
  RiPaletteLine,
  RiRepeatLine,
  RiSearchLine,
  RiSettings4Line,
  RiSparklingLine,
  RiSunLine,
  RiTeamLine,
  RiUser3Line,
  RiWhatsappLine,
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
  SelectGroup,
  SelectItem,
  SelectLabel,
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
import {
  AgentChatPanel,
  type AgentChatPageContext,
} from "@/components/agent-panel";
import { DetailHeaderTitleSkeleton } from "@/components/loading/projects-customers-skeletons";
import { authClient } from "@/lib/auth-client";
import {
  ensureProviderErrorCoverage,
  getLocalizedAuthErrorMessage,
} from "@/lib/auth-error-i18n";
import { useClientRouteGate } from "@/lib/client-route-gates";
import { useI18n, writeLocaleCookie } from "@/lib/i18n-provider";
import {
  EUROPE_LANGUAGE_LOCALES,
  FREQUENT_LANGUAGE_LOCALES,
  localeOptionFlag,
  localeOptionLabel,
  localeOptionName,
  normalizeSelectableLocale,
} from "@/lib/locale-options";

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

type InviteMemberRole = "owner" | "admin" | "member";

const inviteMemberRoleValues: InviteMemberRole[] = ["member", "admin", "owner"];

type AgentStyleId = "woman" | "man";
type AgentNameLocale = "en" | "de";

type AgentStyleOption = {
  id: AgentStyleId;
  imageSrc: string;
  namePoolByLocale: Record<AgentNameLocale, readonly string[]>;
  labelKey: TranslationKey;
};

const SHARED_AGENT_NAMES_BY_LOCALE: Record<AgentNameLocale, readonly string[]> = {
  en: [
    "Nova",
    "Ari",
    "Noa",
    "Sage",
    "Sky",
    "Robin",
    "Jules",
    "Mika",
    "Alex",
    "Phoenix",
    "Kai",
    "Remy",
    "Quinn",
    "Taylor",
    "River",
    "Emery",
    "Reese",
    "Rowan",
    "Avery",
    "Jordan",
    "Casey",
    "Riley",
    "Parker",
    "Harper",
    "Charlie",
    "Jamie",
    "Morgan",
    "Sam",
  ],
  de: [
    "Nova",
    "Ari",
    "Noa",
    "Mika",
    "Alex",
    "Robin",
    "Jules",
    "Kai",
    "Luca",
    "Nico",
    "Emil",
    "Theo",
    "Mila",
    "Lea",
    "Leni",
    "Lina",
    "Jonas",
    "Felix",
    "Hanna",
    "Clara",
    "Greta",
    "Frieda",
    "Paul",
    "Oskar",
  ],
};

const AGENT_STYLE_OPTIONS: readonly AgentStyleOption[] = [
  {
    id: "woman",
    imageSrc: "/assets/agent/woman-1.png",
    namePoolByLocale: {
      en: [
        "Emma",
        "Olivia",
        "Sophia",
        "Amelia",
        "Isla",
        "Evelyn",
        "Hazel",
        "Charlotte",
        "Mia",
        "Ava",
        "Lena",
        "Nora",
        "Mila",
      ],
      de: [
        "Anna",
        "Maria",
        "Sophie",
        "Lena",
        "Lea",
        "Mila",
        "Emma",
        "Hanna",
        "Clara",
        "Lina",
        "Greta",
        "Frieda",
        "Paula",
        "Johanna",
        "Martha",
      ],
    },
    labelKey: "app.dialogs.aiAgent.styles.woman",
  },
  {
    id: "man",
    imageSrc: "/assets/agent/man-1.png",
    namePoolByLocale: {
      en: [
        "Liam",
        "Noah",
        "Oliver",
        "Elijah",
        "James",
        "Henry",
        "Theodore",
        "Arthur",
        "Leo",
        "Ethan",
        "Mason",
        "Lucas",
        "Finn",
      ],
      de: [
        "Leon",
        "Noah",
        "Elias",
        "Luca",
        "Finn",
        "Paul",
        "Emil",
        "Jonas",
        "Theo",
        "Felix",
        "Oskar",
        "Matteo",
        "Max",
        "Karl",
        "Johann",
      ],
    },
    labelKey: "app.dialogs.aiAgent.styles.man",
  },
] as const;

const DEFAULT_AGENT_STYLE_ID: AgentStyleId = "woman";
const DEFAULT_AGENT_NAME = "Nova";

function toAgentNameLocale(locale: AppLocale): AgentNameLocale {
  return locale === "de" ? "de" : "en";
}

function getAgentStyleOption(styleId: AgentStyleId) {
  return (
    AGENT_STYLE_OPTIONS.find((styleOption) => styleOption.id === styleId) ??
    AGENT_STYLE_OPTIONS[0]
  );
}

function getRandomValue<T>(values: readonly T[]): T {
  const index = Math.floor(Math.random() * values.length);
  return values[index] ?? values[0];
}

function randomizeAgentNameByStyle(styleId: AgentStyleId, locale: AppLocale) {
  const styleOption = getAgentStyleOption(styleId);
  const agentNameLocale = toAgentNameLocale(locale);
  const randomizedPool = [
    ...styleOption.namePoolByLocale[agentNameLocale],
    ...SHARED_AGENT_NAMES_BY_LOCALE[agentNameLocale],
  ];
  return getRandomValue(randomizedPool);
}

function isInviteMemberRole(value: string | null): value is InviteMemberRole {
  if (!value) {
    return false;
  }

  return inviteMemberRoleValues.some((roleOption) => roleOption === value);
}

function normalizeLocalePreference(value: string): LocalePreference | null {
  if (value === SYSTEM_LOCALE) {
    return SYSTEM_LOCALE;
  }

  return normalizeTranslatedLocale(value);
}

function resolveSystemLocale(fallbackLocale: AppLocale): AppLocale {
  if (typeof navigator === "undefined") {
    return resolveTranslatedLocale(fallbackLocale);
  }

  const preferredLocales = [...(navigator.languages ?? []), navigator.language];
  for (const candidate of preferredLocales) {
    const normalized = normalizeTranslatedLocale(candidate);
    if (normalized) {
      return normalized;
    }
  }

  return resolveTranslatedLocale(fallbackLocale);
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
  const { locale, setLocale, t } = useI18n();
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
  const localePreference = useQuery(api.preferences.getMyLocale);
  const setMyLocale = useMutation(api.preferences.setMyLocale);
  const themePreference = useQuery(api.preferences.getMyTheme);
  const setMyTheme = useMutation(api.preferences.setMyTheme);
  const saveOrganizationAgentProfile = useMutation(
    api.organizationAgentProfiles.saveForOrganization,
  );
  const organizationAgentProfile = useQuery(
    api.organizationAgentProfiles.getForOrganization,
    activeOrganization?.id
      ? {
          organizationId: activeOrganization.id,
        }
      : "skip",
  );
  const whatsappSetupInfo = useQuery(api.whatsappData.getConnectionSetupInfo);
  const organizationSettings = useQuery(api.organizationSettings.getForActiveOrganization);
  const saveOrganizationSettings = useMutation(
    api.organizationSettings.saveForActiveOrganization,
  );
  const myWhatsappConnection = useQuery(
    api.whatsappData.getMyConnection,
    activeOrganization?.id
      ? {
          organizationId: activeOrganization.id,
        }
      : "skip",
  );

  const user = useQuery(api.auth.getCurrentUser);
  const [userName, setUserName] = useState("");
  const [userImage, setUserImage] = useState("");
  const [isUserDialogOpen, setIsUserDialogOpen] = useState(false);
  const [isUpdatingUser, setIsUpdatingUser] = useState(false);
  const [organizationName, setOrganizationName] = useState("");
  const [organizationLogo, setOrganizationLogo] = useState("");
  const [companyEmail, setCompanyEmail] = useState("");
  const [companyEmailLocale, setCompanyEmailLocale] = useState<AppLocale>("en");
  const [isOrganizationDialogOpen, setIsOrganizationDialogOpen] = useState(false);
  const [isOrganizationSwitchDialogOpen, setIsOrganizationSwitchDialogOpen] =
    useState(false);
  const [isCreateOrganizationDialogOpen, setIsCreateOrganizationDialogOpen] =
    useState(false);
  const [isAiAgentDialogOpen, setIsAiAgentDialogOpen] = useState(false);
  const [draftAiAgentName, setDraftAiAgentName] = useState("");
  const [draftAiAgentStyleId, setDraftAiAgentStyleId] =
    useState<AgentStyleId>(DEFAULT_AGENT_STYLE_ID);
  const [isSavingAiAgent, setIsSavingAiAgent] = useState(false);
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
  const [isWhatsappConnectionDialogOpen, setIsWhatsappConnectionDialogOpen] =
    useState(false);
  const [isUpdatingLocale, setIsUpdatingLocale] = useState(false);
  const [isUpdatingThemePreference, setIsUpdatingThemePreference] = useState(false);
  const inviteMemberRoleLabel = isInviteMemberRole(inviteMemberRole)
    ? t(`common.roles.${inviteMemberRole}`)
    : t("common.roles.member");
  const [switchingOrganizationId, setSwitchingOrganizationId] = useState<
    string | null
  >(null);
  const [createOrganizationName, setCreateOrganizationName] = useState("");
  const createOrganizationSlug = useMemo(
    () => slugify(createOrganizationName),
    [createOrganizationName],
  );
  const selectedLocale = locale;
  const resolvedLocalePreference =
    localePreference === undefined || localePreference === null
      ? localePreference
      : resolveTranslatedLocale(localePreference);
  const selectedLocalePreference: LocalePreference =
    resolvedLocalePreference === undefined
      ? selectedLocale
      : resolvedLocalePreference ?? SYSTEM_LOCALE;
  const selectedLocaleMenuValue =
    selectedLocalePreference === SYSTEM_LOCALE
      ? SYSTEM_LOCALE
      : (normalizeSelectableLocale(selectedLocalePreference) ?? selectedLocalePreference);
  const selectedCompanyEmailLocale =
    normalizeSelectableLocale(companyEmailLocale) ?? companyEmailLocale;

  useEffect(() => {
    const providerErrorCodes = Object.keys(authClient.$ERROR_CODES ?? {});
    if (providerErrorCodes.length === 0) {
      return;
    }

    ensureProviderErrorCoverage(providerErrorCodes);
  }, []);

  useEffect(() => {
    if (!activeOrganization) {
      return;
    }

    setOrganizationName(activeOrganization.name);
    setOrganizationLogo(activeOrganization.logo ?? "");
    setCompanyEmail(organizationSettings?.companyEmail ?? "");
    setCompanyEmailLocale(resolveTranslatedLocale(organizationSettings?.companyEmailLocale));
  }, [
    activeOrganization?.id,
    activeOrganization?.name,
    activeOrganization?.logo,
    organizationSettings?.companyEmail,
    organizationSettings?.companyEmailLocale,
  ]);

  const handleUpdateOrganization = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmedName = organizationName.trim();
    const normalizedLogo = organizationLogo.trim();
    const currentLogo = activeOrganization?.logo ?? "";
    const normalizedCompanyEmail = companyEmail.trim().toLowerCase();
    const currentCompanyEmail = organizationSettings?.companyEmail ?? "";
    const currentCompanyEmailLocale = resolveTranslatedLocale(
      organizationSettings?.companyEmailLocale,
    );

    if (!activeOrganization?.id) {
      return;
    }

    if (trimmedName.length < 2) {
      toast.error(t("app.toasts.organizationNameMinLength"));
      return;
    }

    if (
      trimmedName === activeOrganization.name &&
      normalizedLogo === currentLogo &&
      normalizedCompanyEmail === currentCompanyEmail &&
      companyEmailLocale === currentCompanyEmailLocale
    ) {
      setIsOrganizationDialogOpen(false);
      return;
    }

    setIsUpdatingOrganization(true);
    try {
      const { error } = await authClient.organization.update({
        organizationId: activeOrganization.id,
        data: {
          name: trimmedName,
          // Better Auth organization update accepts string; empty string clears the logo.
          logo: normalizedLogo || "",
        },
      });

      if (error) {
        toast.error(
          getLocalizedAuthErrorMessage(t, error, "app.toasts.failedUpdateOrganization"),
        );
        return;
      }

      await saveOrganizationSettings({
        companyEmail: normalizedCompanyEmail || null,
        companyEmailLocale,
      });

      toast.success(t("app.toasts.organizationUpdated"));
      setIsOrganizationDialogOpen(false);
    } catch (error) {
      toast.error(t("app.toasts.failedUpdateOrganization"));
    } finally {
      setIsUpdatingOrganization(false);
    }
  };

  const organizationDisplayName =
    activeOrganization?.name || t("common.misc.untitledWorkspace");
  const organizationInitial =
    organizationDisplayName.trim().charAt(0).toUpperCase() || "O";
  const activeAiAgentProfile = organizationAgentProfile;
  const activeAgentStyleOption = getAgentStyleOption(
    activeAiAgentProfile?.styleId ?? DEFAULT_AGENT_STYLE_ID,
  );
  const activeAgentName = activeAiAgentProfile?.name ?? DEFAULT_AGENT_NAME;
  const isOwner = activeMember?.role === "owner";
  const userDisplayName = user?.name?.trim() || t("common.misc.user");
  const userInitial = userDisplayName.charAt(0).toUpperCase() || "U";
  const shouldShowWhatsappPromptCard = Boolean(
    activeOrganization?.id &&
      myWhatsappConnection &&
      myWhatsappConnection.connection === null,
  );
  const isMembersPage = pathname.startsWith("/app/members");
  const isCustomersPage = pathname.startsWith("/app/customers");
  const isArchivePage = pathname.startsWith("/app/archive");
  const isProjectsListPage = pathname === "/app/projects";
  const isProjectDetailPage = /^\/app\/projects\/[^/]+$/.test(pathname);
  const isCustomerDetailPage = /^\/app\/customers\/[^/]+$/.test(pathname);
  const isProjectsPage = isProjectsListPage || isProjectDetailPage;
  const currentProjectId = isProjectDetailPage
    ? pathname.slice("/app/projects/".length)
    : null;
  const currentCustomerId = isCustomerDetailPage
    ? pathname.slice("/app/customers/".length)
    : null;
  const currentProjectHeader = useQuery(
    api.projects.getById,
    isProjectDetailPage && currentProjectId
      ? { projectId: currentProjectId as Id<"projects"> }
      : "skip",
  );
  const currentCustomerHeader = useQuery(
    api.customers.getById,
    isCustomerDetailPage && currentCustomerId
      ? { customerId: currentCustomerId as Id<"customers"> }
      : "skip",
  );
  const isProjectHeaderTitleLoading = currentProjectHeader === undefined;
  const projectHeaderTitle = currentProjectHeader?.name ?? t("app.shell.projects");
  const isCustomerHeaderTitleLoading = currentCustomerHeader === undefined;
  const customerHeaderTitle = currentCustomerHeader?.name ?? t("app.shell.customers");
  const projectBackCustomerId = useMemo(() => {
    if (!isProjectDetailPage) {
      return null;
    }

    const value = new URLSearchParams(locationSearch).get("customerId");
    return value && value.trim().length > 0 ? value : null;
  }, [isProjectDetailPage, locationSearch]);
  const headerTitle = isMembersPage
    ? t("app.shell.members")
    : isProjectsPage
      ? t("app.shell.projects")
    : isCustomersPage
      ? t("app.shell.customers")
      : isArchivePage
        ? t("app.shell.archive")
        : t("app.shell.workspace");
  const selectedTheme =
    theme === "light" || theme === "dark" || theme === "system"
      ? theme
      : "system";
  const selectedThemePreference =
    themePreference === undefined ? selectedTheme : (themePreference ?? "system");
  const membersSearchQuery = useMemo(() => {
    const value = new URLSearchParams(locationSearch).get("search");
    return value ?? "";
  }, [locationSearch]);
  const membersPageSnapshotForAgent = useQuery(
    api.members.getLiveMembersPage,
    isMembersPage && activeOrganization?.id
      ? {
          organizationId: activeOrganization.id,
        }
      : "skip",
  );
  const projectsForAgent = useQuery(
    api.projects.list,
    isProjectsPage && activeOrganization?.id ? {} : "skip",
  );
  const currentProjectForAgent = useQuery(
    api.projects.getById,
    isProjectDetailPage && currentProjectId
      ? {
          projectId: currentProjectId as any,
        }
      : "skip",
  );
  const customersForAgent = useQuery(
    api.customers.list,
    (isCustomersPage || isArchivePage) && activeOrganization?.id ? {} : "skip",
  );
  const archivedCustomersForAgent = useQuery(
    api.customers.listArchived,
    isArchivePage && activeOrganization?.id ? {} : "skip",
  );
  const archivedProjectsForAgent = useQuery(
    api.projects.listArchived,
    isArchivePage && activeOrganization?.id ? {} : "skip",
  );
  const agentPanelPageContext = useMemo<AgentChatPageContext | null>(() => {
    if (!activeOrganization?.id) {
      return null;
    }

    const normalizedSearchQuery = membersSearchQuery.trim();
    const normalizedSearchQueryLower = normalizedSearchQuery.toLowerCase();
    const members = membersPageSnapshotForAgent?.members ?? [];
    const pendingInvitations = (membersPageSnapshotForAgent?.invitations ?? []).filter(
      (invitation) => invitation.status === "pending",
    );
    const filteredMembers = members.filter((member) => {
      if (!normalizedSearchQueryLower) {
        return true;
      }

      return (
        member.displayName.toLowerCase().includes(normalizedSearchQueryLower) ||
        (member.email ?? "").toLowerCase().includes(normalizedSearchQueryLower) ||
        (member.phoneNumberE164 ?? "").toLowerCase().includes(normalizedSearchQueryLower)
      );
    });
    const filteredInvitations = pendingInvitations.filter((invitation) => {
      if (!normalizedSearchQueryLower) {
        return true;
      }

      return invitation.email.toLowerCase().includes(normalizedSearchQueryLower);
    });

    const allProjects = projectsForAgent ?? [];
    const activeProjects = allProjects.filter((project) => project.status === "active");
    const doneProjects = allProjects.filter((project) => project.status === "done");
    const allCustomers = customersForAgent ?? [];
    const archivedCustomers = archivedCustomersForAgent ?? [];
    const archivedProjects = archivedProjectsForAgent ?? [];

    const routeId = isProjectDetailPage
      ? "app.projects.detail"
      : isProjectsPage
        ? "app.projects"
      : isCustomerDetailPage
        ? "app.customers.detail"
      : isCustomersPage
        ? "app.customers"
      : isMembersPage
        ? "app.members"
      : isArchivePage
        ? "app.archive"
      : "app.workspace";

    const title = isProjectDetailPage
      ? currentProjectForAgent?.name ?? "Project detail"
      : isCustomerDetailPage
        ? currentCustomerHeader?.name ?? "Customer detail"
      : headerTitle;

    return {
      routeId,
      routePath: pathname,
      title,
      searchQuery: isMembersPage ? normalizedSearchQuery || null : null,
      members: isMembersPage
        ? {
            totalCount: members.length,
            filteredCount: filteredMembers.length,
            pendingInvitationCount: pendingInvitations.length,
            currentMemberRole: membersPageSnapshotForAgent?.currentMember.role ?? null,
            visibleMembers: filteredMembers.slice(0, 12).map((member) => ({
              name: member.displayName,
              email: member.email ?? null,
              phoneNumberE164: member.phoneNumberE164 ?? null,
              memberType: member.memberType,
              role: member.role,
            })),
            visibleInvitations: filteredInvitations.slice(0, 8).map((invitation) => ({
              email: invitation.email,
              role: invitation.role,
            })),
          }
        : null,
      customers: isCustomersPage
        ? {
            totalCount: allCustomers.length,
            currentCustomer: currentCustomerHeader
              ? {
                  id: String(currentCustomerHeader._id),
                  name: currentCustomerHeader.name,
                  email: currentCustomerHeader.email ?? null,
                  phone: currentCustomerHeader.phone ?? null,
                }
              : null,
            visibleCustomers: allCustomers.slice(0, 12).map((customer) => ({
              id: String(customer._id),
              name: customer.name,
              contactName: customer.contactName ?? null,
              email: customer.email ?? null,
              phone: customer.phone ?? null,
              activeProjectCount: customer.activeProjectCount,
              doneProjectCount: customer.doneProjectCount,
            })),
          }
        : null,
      projects: isProjectsPage
        ? {
            totalCount: allProjects.length,
            activeCount: activeProjects.length,
            doneCount: doneProjects.length,
            currentProject: currentProjectForAgent
              ? {
                  id: String(currentProjectForAgent._id),
                  name: currentProjectForAgent.name,
                  status: currentProjectForAgent.status,
                }
              : null,
            visibleProjects: allProjects.slice(0, 12).map((project) => ({
              id: String(project._id),
              name: project.name,
              status: project.status,
              hasUnreviewedChanges: project.hasUnreviewedChanges,
              hasNachtrag: project.hasNachtrag,
            })),
          }
        : null,
      archive: isArchivePage
        ? {
            archivedCustomerCount: archivedCustomers.length,
            archivedProjectCount: archivedProjects.length,
            visibleArchivedCustomers: archivedCustomers.slice(0, 12).map((customer) => ({
              id: String(customer._id),
              name: customer.name,
              deletedAt: customer.deletedAt,
            })),
            visibleArchivedProjects: archivedProjects.slice(0, 12).map((project) => ({
              id: String(project._id),
              name: project.name,
              status: project.status,
              deletedAt: project.deletedAt,
            })),
          }
        : null,
      shell: {
        organizationName: activeOrganization.name,
        companyEmail: organizationSettings?.companyEmail ?? null,
        companyEmailLocale: organizationSettings?.companyEmailLocale ?? null,
        agentProfileName: activeAiAgentProfile?.name ?? null,
        agentStyleId: activeAiAgentProfile?.styleId ?? null,
        whatsappPhoneNumberE164: whatsappSetupInfo?.phoneNumberE164 ?? null,
        myWhatsAppPhoneNumberE164:
          myWhatsappConnection?.connection?.phoneNumberE164 ?? null,
        myWhatsAppConnected:
          myWhatsappConnection == null
            ? null
            : Boolean(myWhatsappConnection.connection),
      },
    };
  }, [
    activeAiAgentProfile?.name,
    activeAiAgentProfile?.styleId,
    activeOrganization?.id,
    activeOrganization?.name,
    archivedCustomersForAgent,
    archivedProjectsForAgent,
    currentCustomerHeader,
    currentProjectForAgent,
    customersForAgent,
    headerTitle,
    isArchivePage,
    isCustomerDetailPage,
    isCustomersPage,
    isProjectDetailPage,
    isProjectsPage,
    isMembersPage,
    membersPageSnapshotForAgent,
    membersSearchQuery,
    myWhatsappConnection,
    organizationSettings?.companyEmail,
    organizationSettings?.companyEmailLocale,
    pathname,
    projectsForAgent,
    whatsappSetupInfo?.phoneNumberE164,
  ]);

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

  const handleLocaleChange = async (nextLocalePreference: string) => {
    const normalizedPreference = normalizeLocalePreference(nextLocalePreference);
    if (!normalizedPreference) {
      return;
    }

    if (normalizedPreference === selectedLocalePreference) {
      return;
    }

    setIsUpdatingLocale(true);

    try {
      if (normalizedPreference === SYSTEM_LOCALE) {
        const systemLocale = resolveSystemLocale(selectedLocale);
        setLocale(systemLocale);
        writeLocaleCookie(SYSTEM_LOCALE);
        await setMyLocale({ locale: null });
      } else {
        setLocale(normalizedPreference);
        await setMyLocale({
          locale: normalizedPreference,
        });
      }

      toast.success(t("app.toasts.languageUpdated"));
    } catch (error) {
      toast.error(
        getLocalizedAuthErrorMessage(t, error, "app.toasts.languageSaveFailed"),
      );
    } finally {
      setIsUpdatingLocale(false);
    }
  };

  const handleThemeChange = async (nextThemePreference: string) => {
    const normalizedTheme =
      nextThemePreference === "light" ||
      nextThemePreference === "dark" ||
      nextThemePreference === "system"
        ? nextThemePreference
        : null;
    if (!normalizedTheme) {
      return;
    }

    if (normalizedTheme === selectedThemePreference) {
      return;
    }

    setIsUpdatingThemePreference(true);
    setTheme(normalizedTheme);

    try {
      await setMyTheme({
        theme: normalizedTheme === "system" ? null : normalizedTheme,
      });
      toast.success(t("app.toasts.themeUpdated"));
    } catch (error) {
      toast.error(
        getLocalizedAuthErrorMessage(t, error, "app.toasts.themeSaveFailed"),
      );
    } finally {
      setIsUpdatingThemePreference(false);
    }
  };

  useEffect(() => {
    if (resolvedLocalePreference === undefined || isUpdatingLocale) {
      return;
    }

    if (resolvedLocalePreference === null) {
      const systemLocale = resolveSystemLocale(selectedLocale);
      if (selectedLocale !== systemLocale) {
        setLocale(systemLocale);
      }
      writeLocaleCookie(SYSTEM_LOCALE);
      return;
    }

    if (selectedLocale !== resolvedLocalePreference) {
      setLocale(resolvedLocalePreference);
    }
  }, [isUpdatingLocale, resolvedLocalePreference, selectedLocale, setLocale]);

  useEffect(() => {
    if (themePreference === undefined || isUpdatingThemePreference) {
      return;
    }

    const resolvedTheme = themePreference ?? "system";
    if (selectedTheme !== resolvedTheme) {
      setTheme(resolvedTheme);
    }
  }, [isUpdatingThemePreference, selectedTheme, setTheme, themePreference]);

  const openUserSettings = () => {
    setUserName(user?.name ?? "");
    setUserImage(user?.image ?? "");
    setIsUserDialogOpen(true);
  };

  const openWhatsappConnectionDialog = () => {
    if (!activeOrganization?.id) {
      return;
    }
    setIsWhatsappConnectionDialogOpen(true);
  };

  const handleUpdateUser = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmedName = userName.trim();
    const normalizedImage = userImage.trim();
    const currentName = user?.name?.trim() ?? "";
    const currentImage = user?.image ?? "";
    const profileDidChange =
      trimmedName !== currentName || normalizedImage !== currentImage;

    if (trimmedName.length < 2) {
      toast.error(t("app.toasts.userNameMinLength"));
      return;
    }

    if (trimmedName === currentName && normalizedImage === currentImage) {
      setIsUserDialogOpen(false);
      return;
    }

    setIsUpdatingUser(true);
    try {
      if (profileDidChange) {
        const { error } = await authClient.updateUser({
          name: trimmedName,
          image: normalizedImage || null,
        });

        if (error) {
          toast.error(getLocalizedAuthErrorMessage(t, error, "app.toasts.failedUpdateProfile"));
          return;
        }
      }

      toast.success(t("app.toasts.profileUpdated"));
      setIsUserDialogOpen(false);
    } catch (error) {
      toast.error(
        getLocalizedAuthErrorMessage(t, error, "app.toasts.failedUpdateProfile"),
      );
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
      toast.error(t("app.toasts.selectImageFile"));
      event.target.value = "";
      return;
    }

    const maxFileSizeBytes = 10 * 1024 * 1024;
    if (file.size > maxFileSizeBytes) {
      toast.error(t("app.toasts.imageTooLarge"));
      event.target.value = "";
      return;
    }

    try {
      const optimizedImageDataUrl = await convertImageToLogoDataUrl(file);
      setUserImage(optimizedImageDataUrl);
    } catch (error) {
      toast.error(t("app.toasts.failedProcessImage"));
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

  const openArchive = () => {
    setIsOrganizationDialogOpen(false);
    void navigate({ to: "/app/archive" });
  };

  const openAiAgentSettings = () => {
    if (!activeOrganization?.id) {
      return;
    }

    const existingProfile = organizationAgentProfile;
    const styleId = existingProfile?.styleId ?? DEFAULT_AGENT_STYLE_ID;

    setDraftAiAgentStyleId(styleId);
    setDraftAiAgentName(existingProfile?.name ?? DEFAULT_AGENT_NAME);
    setIsAiAgentDialogOpen(true);
  };

  const handleRandomizeAiAgentName = () => {
    setDraftAiAgentName(randomizeAgentNameByStyle(draftAiAgentStyleId, locale));
  };

  const handleSaveAiAgent = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!activeOrganization?.id) {
      toast.error(t("app.toasts.noActiveOrganization"));
      return;
    }

    const trimmedName = draftAiAgentName.trim();
    if (trimmedName.length < 2) {
      toast.error(t("app.toasts.agentNameMinLength"));
      return;
    }

    setIsSavingAiAgent(true);
    try {
      await saveOrganizationAgentProfile({
        organizationId: activeOrganization.id,
        name: trimmedName,
        styleId: draftAiAgentStyleId,
      });

      toast.success(t("app.toasts.agentSetupSaved"));
      setIsAiAgentDialogOpen(false);
    } catch (error) {
      toast.error(t("app.toasts.failedSaveAgentSetup"));
    } finally {
      setIsSavingAiAgent(false);
    }
  };

  const handleOrganizationLogoFileChange = async (
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    if (!file.type.startsWith("image/")) {
      toast.error(t("app.toasts.selectImageFile"));
      event.target.value = "";
      return;
    }

    const maxFileSizeBytes = 10 * 1024 * 1024;
    if (file.size > maxFileSizeBytes) {
      toast.error(t("app.toasts.imageTooLarge"));
      event.target.value = "";
      return;
    }

    try {
      const optimizedImageDataUrl = await convertImageToLogoDataUrl(file);
      setOrganizationLogo(optimizedImageDataUrl);
    } catch (error) {
      toast.error(t("app.toasts.failedProcessImage"));
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
        toast.error(
          getLocalizedAuthErrorMessage(t, error, "app.toasts.failedSwitchOrganization"),
        );
        return;
      }

      toast.success(t("app.toasts.organizationSwitched"));
      setIsOrganizationSwitchDialogOpen(false);
    } catch (error) {
      toast.error(t("app.toasts.failedSwitchOrganization"));
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
      toast.error(t("app.toasts.organizationNameMinLength"));
      return;
    }

    if (!createOrganizationSlug) {
      toast.error(t("app.toasts.invalidOrganizationName"));
      return;
    }

    setIsCreatingOrganization(true);
    try {
      const createResult = await authClient.organization.create({
        name: trimmedName,
        slug: createOrganizationSlug,
      });

      if (createResult.error) {
        toast.error(
          getLocalizedAuthErrorMessage(t, createResult.error, "app.toasts.failedCreateOrganization"),
        );
        return;
      }

      const created = createResult.data;

      if (created?.id) {
        const setActiveResult = await authClient.organization.setActive({
          organizationId: created.id,
        });

        if (setActiveResult.error) {
          toast.error(getLocalizedAuthErrorMessage(t, setActiveResult.error, "app.toasts.createdButSwitchFailed"));
          return;
        }
      }

      toast.success(t("app.toasts.organizationCreated"));
      setIsCreateOrganizationDialogOpen(false);
    } catch (error) {
      toast.error(t("app.toasts.failedCreateOrganization"));
    } finally {
      setIsCreatingOrganization(false);
    }
  };

  const handleLeaveOrganization = async () => {
    if (!activeOrganization?.id) {
      toast.error(t("app.toasts.noActiveOrganization"));
      return;
    }

    if (isOwner) {
      toast.error(t("app.toasts.ownersCannotLeave"));
      return;
    }

    setIsLeavingOrganization(true);
    try {
      const { error } = await authClient.organization.leave({
        organizationId: activeOrganization.id,
      });

      if (error) {
        toast.error(getLocalizedAuthErrorMessage(t, error, "app.toasts.failedLeaveOrganization"));
        return;
      }

      toast.success(t("app.toasts.organizationLeft"));
      setIsLeaveOrganizationDialogOpen(false);
      setIsOrganizationDialogOpen(false);
    } catch (error) {
      toast.error(t("app.toasts.failedLeaveOrganization"));
    } finally {
      setIsLeavingOrganization(false);
    }
  };

  const handleDeleteOrganization = async () => {
    if (!activeOrganization?.id) {
      toast.error(t("app.toasts.noActiveOrganization"));
      return;
    }

    if (!isOwner) {
      toast.error(t("app.toasts.onlyOwnersCanDelete"));
      return;
    }

    setIsDeletingOrganization(true);
    try {
      const { error } = await authClient.organization.delete({
        organizationId: activeOrganization.id,
      });

      if (error) {
        toast.error(getLocalizedAuthErrorMessage(t, error, "app.toasts.failedDeleteOrganization"));
        return;
      }

      toast.success(t("app.toasts.organizationDeleted"));
      setIsDeleteOrganizationDialogOpen(false);
      setIsOrganizationDialogOpen(false);
    } catch (error) {
      toast.error(t("app.toasts.failedDeleteOrganization"));
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
      toast.error(t("app.toasts.noActiveOrganization"));
      return;
    }

    const email = inviteMemberEmail.trim().toLowerCase();

    if (!email) {
      toast.error(t("app.toasts.enterEmailAddress"));
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast.error(t("app.toasts.enterValidEmailAddress"));
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
        toast.error(getLocalizedAuthErrorMessage(t, error, "app.toasts.failedSendInvitation"));
        return;
      }

      toast.success(t("app.toasts.invitationSentTo", { email }));
      closeInviteMemberDialog();
    } catch (error) {
      toast.error(t("app.toasts.failedSendInvitation"));
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
                    className="group/org-menu-trigger"
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
                    <RiArrowDownSLine className="ml-auto size-4 text-sidebar-foreground/70 transition-transform duration-200 ease-out group-data-open/org-menu-trigger:rotate-180 group-data-popup-open/org-menu-trigger:rotate-180" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    className="rounded-xl bg-card px-1.5 pb-1.5 pt-2.5"
                    align="start"
                    side="bottom"
                    sideOffset={10}
                  >
                    <DropdownMenuGroup>
                      <DropdownMenuLabel className="px-2.5">
                        {t("common.misc.organization")}
                      </DropdownMenuLabel>
                      <DropdownMenuItem
                        className="min-h-8 px-2"
                        onClick={openAiAgentSettings}
                        disabled={isOrganizationPending || !activeOrganization}
                      >
                        <RiSparklingLine />
                        <span>{t("app.shell.aiAgentMenuLabel")}</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="min-h-8 px-2"
                        onClick={openOrganizationSettings}
                        disabled={isOrganizationPending || !activeOrganization}
                      >
                        <RiSettings4Line />
                        <span>{t("common.actions.settings")}</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="min-h-8 px-2"
                        onClick={openArchive}
                        disabled={isOrganizationPending || !activeOrganization}
                      >
                        <RiArchiveLine />
                        <span>{t("common.actions.archive")}</span>
                      </DropdownMenuItem>
                      <DropdownMenuSeparator className="my-1" />
                      <DropdownMenuItem
                        className="min-h-8 px-2"
                        onClick={() => setIsOrganizationSwitchDialogOpen(true)}
                      >
                        <RiRepeatLine />
                        <span>{t("common.actions.switch")}</span>
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
                render={<Link to="/app/projects" />}
                isActive={pathname.startsWith("/app/projects")}
                className="h-9 rounded-lg px-2 font-medium data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-foreground"
              >
                <RiFolder3Line className="size-4" />
                <span>{t("app.shell.projects")}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                render={<Link to="/app/customers" />}
                isActive={pathname.startsWith("/app/customers")}
                className="h-9 rounded-lg px-2 font-medium data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-foreground"
              >
                <RiUser3Line className="size-4" />
                <span>{t("app.shell.customers")}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                render={<Link to="/app/members" />}
                isActive={pathname.startsWith("/app/members")}
                className="h-9 rounded-lg px-2 font-medium data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-foreground"
              >
                <RiTeamLine className="size-4" />
                <span>{t("app.shell.members")}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>

          <div className="flex-1" />

          {shouldShowWhatsappPromptCard ? (
            <div className="mx-3 mb-3 rounded-lg border bg-card p-3">
              <div className="space-y-3">
                <div className="flex items-start gap-2">
                  <div className="mt-0.5 rounded-md bg-muted p-1.5 text-muted-foreground">
                    <RiWhatsappLine className="size-4" />
                  </div>
                  <div className="min-w-0 space-y-1">
                    <p className="text-sm font-medium">{t("app.whatsapp.sidebar.title")}</p>
                    <p className="text-xs text-muted-foreground">
                      {t("app.whatsapp.sidebar.description")}
                    </p>
                  </div>
                </div>
                <Button
                  type="button"
                  size="sm"
                  className="w-full"
                  onClick={openWhatsappConnectionDialog}
                  disabled={!activeOrganization?.id}
                >
                  {t("app.whatsapp.actions.openDialog")}
                </Button>
              </div>
            </div>
          ) : null}
        </SidebarContent>

        <SidebarFooter className="gap-0 p-0">
          <SidebarSeparator className="mx-0" />
          <div className="flex h-12 items-center px-3 transition-colors hover:bg-sidebar-accent/60">
            <SidebarMenu className="w-full">
              <SidebarMenuItem>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    className="group/user-menu-trigger"
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
                    <RiArrowDownSLine className="ml-auto size-4 rotate-180 text-sidebar-foreground/70 transition-transform duration-200 ease-out group-data-open/user-menu-trigger:rotate-0 group-data-popup-open/user-menu-trigger:rotate-0" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    className="rounded-xl bg-card px-1.5 pb-1.5 pt-2.5"
                    align="start"
                    side="top"
                    sideOffset={10}
                  >
                    <DropdownMenuGroup>
                      <DropdownMenuLabel className="px-2.5">
                        {t("common.misc.account")}
                      </DropdownMenuLabel>
                      <DropdownMenuItem
                        className="min-h-8 px-2"
                        onClick={openUserSettings}
                        disabled={!user}
                      >
                        <RiSettings4Line />
                        <span>{t("common.actions.settings")}</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="min-h-8 px-2"
                        onClick={openWhatsappConnectionDialog}
                        disabled={!activeOrganization?.id}
                      >
                        <RiWhatsappLine />
                        <span>{t("common.actions.whatsappConnection")}</span>
                      </DropdownMenuItem>
                      <DropdownMenuSub>
                        <DropdownMenuSubTrigger className="min-h-8 px-2">
                          <RiPaletteLine />
                          <span>{t("common.theme.label")}</span>
                        </DropdownMenuSubTrigger>
                        <DropdownMenuSubContent className="w-44">
                          <DropdownMenuRadioGroup
                            value={selectedThemePreference}
                            onValueChange={(value) => {
                              void handleThemeChange(value);
                            }}
                          >
                            <DropdownMenuRadioItem
                              className="min-h-8 pl-2 pr-8"
                              value="system"
                              disabled={isUpdatingThemePreference}
                            >
                              <RiComputerLine />
                              <span>{t("common.theme.system")}</span>
                            </DropdownMenuRadioItem>
                            <DropdownMenuRadioItem
                              className="min-h-8 pl-2 pr-8"
                              value="light"
                              disabled={isUpdatingThemePreference}
                            >
                              <RiSunLine />
                              <span>{t("common.theme.light")}</span>
                            </DropdownMenuRadioItem>
                            <DropdownMenuRadioItem
                              className="min-h-8 pl-2 pr-8"
                              value="dark"
                              disabled={isUpdatingThemePreference}
                            >
                              <RiMoonLine />
                              <span>{t("common.theme.dark")}</span>
                            </DropdownMenuRadioItem>
                          </DropdownMenuRadioGroup>
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>
                      <DropdownMenuSub>
                        <DropdownMenuSubTrigger className="min-h-8 px-2">
                          <RiGlobalLine />
                          <span>{t("common.language.label")}</span>
                        </DropdownMenuSubTrigger>
                        <DropdownMenuSubContent className="max-h-72 w-56 overflow-y-auto rounded-xl bg-card p-1.5">
                          <DropdownMenuRadioGroup
                            value={selectedLocaleMenuValue}
                            onValueChange={(value) => {
                              void handleLocaleChange(value);
                            }}
                          >
                            <DropdownMenuLabel className="px-2.5 pt-1">
                              {t("common.language.system")}
                            </DropdownMenuLabel>
                            <DropdownMenuRadioItem
                              className="min-h-8 pl-2 pr-8"
                              value={SYSTEM_LOCALE}
                              disabled={isUpdatingLocale}
                            >
                              <RiComputerLine />
                              <span>
                                {`${t("common.language.system")} (${localeOptionLabel(
                                  resolveSystemLocale(selectedLocale),
                                )})`}
                              </span>
                            </DropdownMenuRadioItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuLabel className="px-2.5">
                              {t("common.language.frequentlyUsed")}
                            </DropdownMenuLabel>
                            {FREQUENT_LANGUAGE_LOCALES.map((availableLocale) => (
                              <DropdownMenuRadioItem
                                key={availableLocale}
                                className="min-h-8 pl-2 pr-8"
                                value={availableLocale}
                                disabled={isUpdatingLocale}
                              >
                                <span>{localeOptionLabel(availableLocale)}</span>
                              </DropdownMenuRadioItem>
                            ))}
                            <DropdownMenuSeparator />
                            <DropdownMenuLabel className="px-2.5">
                              {t("common.language.europe")}
                            </DropdownMenuLabel>
                            {EUROPE_LANGUAGE_LOCALES.map((availableLocale) => (
                              <DropdownMenuRadioItem
                                key={availableLocale}
                                className="min-h-8 pl-2 pr-8"
                                value={availableLocale}
                                disabled={isUpdatingLocale}
                              >
                                <span>{localeOptionLabel(availableLocale)}</span>
                              </DropdownMenuRadioItem>
                            ))}
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
                      <span>{t("common.actions.signOut")}</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </SidebarMenuItem>
            </SidebarMenu>
          </div>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset className="h-svh overflow-hidden bg-gradient-to-b from-background to-muted/20">
        <header className="sticky top-0 z-20 bg-background/90 backdrop-blur">
          <div className="flex h-12 items-center justify-between gap-3 border-b border-sidebar-border px-4 md:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <SidebarTrigger className="-ml-1" />
              <div className="h-4 w-px bg-border" />
              {isProjectDetailPage ? (
                <div className="flex min-w-0 items-center gap-2">
                  {projectBackCustomerId ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 px-2"
                      render={
                        <Link
                          to="/app/customers/$customerId"
                          params={{ customerId: projectBackCustomerId }}
                        />
                      }
                    >
                      <RiArrowLeftLine className="size-4" />
                      {t("app.projects.detail.back")}
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 px-2"
                      render={<Link to="/app/projects" />}
                    >
                      <RiArrowLeftLine className="size-4" />
                      {t("app.projects.detail.back")}
                    </Button>
                  )}
                  {isProjectHeaderTitleLoading ? (
                    <DetailHeaderTitleSkeleton />
                  ) : (
                    <p className="truncate text-sm font-medium tracking-tight">
                      {projectHeaderTitle}
                    </p>
                  )}
                </div>
              ) : isCustomerDetailPage ? (
                <div className="flex min-w-0 items-center gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 px-2"
                    render={<Link to="/app/customers" />}
                  >
                    <RiArrowLeftLine className="size-4" />
                    {t("app.customers.detail.back")}
                  </Button>
                  {isCustomerHeaderTitleLoading ? (
                    <DetailHeaderTitleSkeleton />
                  ) : (
                    <p className="truncate text-sm font-medium tracking-tight">
                      {customerHeaderTitle}
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-sm font-medium tracking-tight">{headerTitle}</p>
              )}
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
                    placeholder={t("app.shell.searchMembers")}
                    className="h-7 w-44 pl-8 sm:w-56"
                  />
                </div>
                <div
                  id="app-members-header-actions"
                  className="flex items-center gap-2"
                />
                <Button
                  type="button"
                  size="sm"
                  onClick={() => setIsInviteMemberDialogOpen(true)}
                  disabled={isOrganizationPending || !activeOrganization}
                >
                  <RiMailSendLine className="size-4" />
                  <span>{t("common.actions.invite")}</span>
                </Button>
              </div>
            ) : (
              <div id="app-layout-header-actions" className="flex items-center gap-2" />
            )}
          </div>
        </header>
        <main className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 pt-6 md:p-6 md:pt-8">
          <div
            className={[
              "mx-auto w-full",
              isProjectDetailPage ? "max-w-6xl" : "max-w-5xl",
            ].join(" ")}
          >
            <Outlet />
          </div>
        </main>
      </SidebarInset>

      <AgentChatPanel
        organizationId={activeOrganization?.id ?? null}
        agentName={activeAgentName}
        agentAvatarSrc={activeAgentStyleOption.imageSrc}
        onOpenSettings={openAiAgentSettings}
        pageContext={agentPanelPageContext}
      />

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
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("app.dialogs.inviteMember.title")}</DialogTitle>
            <DialogDescription>
              {t("app.dialogs.inviteMember.description")}
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={handleInviteMember}>
            <div className="space-y-2">
              <Label htmlFor="invite-member-email">{t("common.labels.email")}</Label>
              <Input
                id="invite-member-email"
                type="email"
                autoComplete="email"
                value={inviteMemberEmail}
                onChange={(event) => setInviteMemberEmail(event.target.value)}
                placeholder={t("app.dialogs.inviteMember.emailPlaceholder")}
                disabled={isInvitingMember}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="invite-member-role">{t("common.labels.role")}</Label>
              <Select
                value={inviteMemberRole}
                onValueChange={(value) => {
                  if (isInviteMemberRole(value)) {
                    setInviteMemberRole(value);
                  }
                }}
              >
                <SelectTrigger id="invite-member-role" className="w-full">
                  <SelectValue placeholder={t("app.dialogs.inviteMember.selectRole")}>
                    {inviteMemberRoleLabel}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent align="start">
                  {inviteMemberRoleValues.map((roleOption) => (
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
                onClick={closeInviteMemberDialog}
                disabled={isInvitingMember}
              >
                {t("common.actions.cancel")}
              </Button>
              <Button
                type="submit"
                disabled={isInvitingMember || !activeOrganization}
              >
                {isInvitingMember
                  ? t("common.state.sending")
                  : t("common.actions.sendInvite")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isWhatsappConnectionDialogOpen}
        onOpenChange={setIsWhatsappConnectionDialogOpen}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("app.whatsapp.dialog.title")}</DialogTitle>
            <DialogDescription>
              {t("app.whatsapp.dialog.description")}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-[1fr_220px] sm:items-start">
            <div>
              {whatsappSetupInfo?.waLink ? (
                <img
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${encodeURIComponent(whatsappSetupInfo.waLink)}`}
                  alt={t("app.whatsapp.dialog.qrTitle")}
                  className="mx-auto aspect-square w-full max-w-64 rounded-md border bg-white p-2 object-contain"
                />
              ) : (
                <p className="text-xs text-muted-foreground">
                  {t("app.whatsapp.dialog.qrUnavailable")}
                </p>
              )}
            </div>
            <div className="rounded-md border p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                {t("common.labels.name")}
              </p>
              <p className="mt-1 text-sm font-medium">{activeAgentName}</p>
              <p className="mt-3 text-xs uppercase tracking-wide text-muted-foreground">
                {t("app.whatsapp.dialog.agentNumberLabel")}
              </p>
              <p className="mt-1 text-sm font-medium">
                {whatsappSetupInfo?.phoneNumberE164 ?? t("common.misc.unknown")}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsWhatsappConnectionDialogOpen(false)}
            >
              {t("common.actions.cancel")}
            </Button>
            {whatsappSetupInfo?.waLink ? (
              <Button
                type="button"
                onClick={() => {
                  window.open(whatsappSetupInfo.waLink ?? "", "_blank", "noopener,noreferrer");
                }}
              >
                {t("app.whatsapp.actions.openWhatsapp")}
              </Button>
            ) : null}
          </DialogFooter>
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
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("app.dialogs.profile.title")}</DialogTitle>
            <DialogDescription>
              {t("app.dialogs.profile.description")}
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={handleUpdateUser}>
            <div className="space-y-2">
              <Label htmlFor="user-name">{t("common.labels.name")}</Label>
              <Input
                id="user-name"
                value={userName}
                onChange={(event) => setUserName(event.target.value)}
                disabled={isUpdatingUser}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="user-email">{t("common.labels.email")}</Label>
              <Input id="user-email" value={user?.email ?? ""} readOnly disabled />
            </div>
            <div className="space-y-2">
              <Label htmlFor="user-avatar">{t("common.labels.avatar")}</Label>
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
                    {t("app.dialogs.profile.avatarHint")}
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
                    {t("common.actions.remove")}
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
                {t("common.actions.cancel")}
              </Button>
              <Button type="submit" disabled={isUpdatingUser}>
                {isUpdatingUser
                  ? t("common.state.saving")
                  : t("common.actions.saveChanges")}
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
            <DialogTitle>{t("app.dialogs.switchOrganization.title")}</DialogTitle>
            <DialogDescription>
              {t("app.dialogs.switchOrganization.description")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {organizationsResult.data === undefined ? (
              <p className="text-sm text-muted-foreground">
                {t("app.dialogs.switchOrganization.loading")}
              </p>
            ) : organizations.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("app.dialogs.switchOrganization.empty")}
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
                        ? t("common.misc.active")
                        : switchingOrganizationId === organization.id
                          ? t("common.state.switching")
                          : t("common.actions.switch")}
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
              {t("common.actions.cancel")}
            </Button>
            <Button
              type="button"
              onClick={openCreateOrganizationDialog}
              disabled={switchingOrganizationId !== null}
            >
              {t("common.actions.create")}
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
            <DialogTitle>{t("app.dialogs.createOrganization.title")}</DialogTitle>
            <DialogDescription>
              {t("app.dialogs.createOrganization.description")}
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={handleCreateOrganization}>
            <div className="space-y-2">
              <Label htmlFor="create-organization-name">{t("common.labels.name")}</Label>
              <Input
                id="create-organization-name"
                value={createOrganizationName}
                onChange={(event) => setCreateOrganizationName(event.target.value)}
                disabled={isCreatingOrganization}
                placeholder={t("app.dialogs.createOrganization.namePlaceholder")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="create-organization-slug">{t("common.labels.slug")}</Label>
              <Input
                id="create-organization-slug"
                value={createOrganizationSlug}
                readOnly
                disabled
                placeholder={t("app.dialogs.createOrganization.slugPlaceholder")}
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
                {t("common.actions.cancel")}
              </Button>
              <Button type="submit" disabled={isCreatingOrganization}>
                {isCreatingOrganization
                  ? t("common.state.creating")
                  : t("common.actions.create")}
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
            setCompanyEmail(organizationSettings?.companyEmail ?? "");
            setCompanyEmailLocale(resolveTranslatedLocale(organizationSettings?.companyEmailLocale));
          } else if (!open) {
            setIsLeaveOrganizationDialogOpen(false);
            setIsDeleteOrganizationDialogOpen(false);
          }

          setIsOrganizationDialogOpen(open);
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("app.dialogs.organization.title")}</DialogTitle>
            <DialogDescription>
              {t("app.dialogs.organization.description")}
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={handleUpdateOrganization}>
            <div className="space-y-2">
              <Label htmlFor="organization-name">{t("common.labels.name")}</Label>
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
              <Label htmlFor="organization-logo">{t("common.labels.avatar")}</Label>
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
                    {t("app.dialogs.organization.logoHint")}
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
                    {t("common.actions.remove")}
                  </Button>
                ) : null}
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="organization-slug">{t("common.labels.slug")}</Label>
              <Input
                id="organization-slug"
                value={activeOrganization?.slug || ""}
                readOnly
                disabled
              />
            </div>
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_176px] md:items-start">
              <div className="space-y-2">
                <Label htmlFor="organization-company-email">
                  {t("app.dialogs.organization.companyEmailLabel")}
                </Label>
                <Input
                  id="organization-company-email"
                  type="email"
                  value={companyEmail}
                  onChange={(event) => setCompanyEmail(event.target.value)}
                  placeholder={t("app.dialogs.organization.companyEmailPlaceholder")}
                  disabled={
                    isUpdatingOrganization ||
                    isLeavingOrganization ||
                    isDeletingOrganization ||
                    isOrganizationPending ||
                    !activeOrganization
                  }
                />
                <p className="text-xs text-muted-foreground">
                  {t("app.dialogs.organization.companyEmailHint")}
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="organization-company-email-locale">
                  {t("app.dialogs.organization.companyEmailLocaleLabel")}
                </Label>
                <Select
                  value={selectedCompanyEmailLocale}
                  onValueChange={(value) => {
                    const nextLocale = normalizeSelectableLocale(value);
                    if (nextLocale) {
                      setCompanyEmailLocale(nextLocale);
                    }
                  }}
                  disabled={
                    isUpdatingOrganization ||
                    isLeavingOrganization ||
                    isDeletingOrganization ||
                    isOrganizationPending ||
                    !activeOrganization
                  }
                >
                  <SelectTrigger
                    id="organization-company-email-locale"
                    className="w-full min-w-0"
                  >
                    <SelectValue>
                      {(value) => {
                        const normalized = normalizeSelectableLocale(
                          typeof value === "string" ? value : selectedCompanyEmailLocale,
                        );
                        return normalized
                          ? localeOptionLabel(normalized)
                          : localeOptionLabel(selectedCompanyEmailLocale);
                      }}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    <SelectGroup>
                      <SelectLabel>{t("common.language.frequentlyUsed")}</SelectLabel>
                      {FREQUENT_LANGUAGE_LOCALES.map((availableLocale) => (
                        <SelectItem key={availableLocale} value={availableLocale}>
                          <span className="inline-flex min-w-5 justify-center">
                            {localeOptionFlag(availableLocale)}
                          </span>
                          <span>{localeOptionName(availableLocale)}</span>
                        </SelectItem>
                      ))}
                    </SelectGroup>
                    <SelectGroup>
                      <SelectLabel>{t("common.language.europe")}</SelectLabel>
                      {EUROPE_LANGUAGE_LOCALES.map((availableLocale) => (
                        <SelectItem key={availableLocale} value={availableLocale}>
                          <span className="inline-flex min-w-5 justify-center">
                            {localeOptionFlag(availableLocale)}
                          </span>
                          <span>{localeOptionName(availableLocale)}</span>
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
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
                    {t("common.actions.delete")}
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
                    {t("common.actions.leave")}
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
                      setCompanyEmail(organizationSettings?.companyEmail ?? "");
                      setCompanyEmailLocale(
                        resolveTranslatedLocale(organizationSettings?.companyEmailLocale),
                      );
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
                  {t("common.actions.cancel")}
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
                  {isUpdatingOrganization
                    ? t("common.state.saving")
                    : t("common.actions.saveChanges")}
                </Button>
              </div>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={isAiAgentDialogOpen} onOpenChange={setIsAiAgentDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("app.dialogs.aiAgent.title")}</DialogTitle>
            <DialogDescription>
              {t("app.dialogs.aiAgent.description")}
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={handleSaveAiAgent}>
            <div className="space-y-2">
              <Label htmlFor="ai-agent-name">{t("common.labels.name")}</Label>
              <div className="relative">
                <Input
                  id="ai-agent-name"
                  value={draftAiAgentName}
                  onChange={(event) => setDraftAiAgentName(event.target.value)}
                  placeholder={t("app.dialogs.aiAgent.namePlaceholder")}
                  className="pr-9"
                  disabled={!activeOrganization || isSavingAiAgent}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={handleRandomizeAiAgentName}
                  className="absolute top-1/2 right-1 -translate-y-1/2"
                  aria-label={t("common.actions.randomize")}
                  title={t("common.actions.randomize")}
                  disabled={!activeOrganization || isSavingAiAgent}
                >
                  <RiRepeatLine />
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label>{t("app.dialogs.aiAgent.styleLabel")}</Label>
              <div className="space-y-1">
                {AGENT_STYLE_OPTIONS.map((styleOption) => {
                  const isSelected = styleOption.id === draftAiAgentStyleId;

                  return (
                    <button
                      key={styleOption.id}
                      type="button"
                      aria-pressed={isSelected}
                      onClick={() => setDraftAiAgentStyleId(styleOption.id)}
                      className={`flex w-full items-center gap-2 rounded-md px-1 py-1 text-sm text-muted-foreground transition hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
                        isSelected ? "bg-muted/40" : ""
                      }`}
                      disabled={!activeOrganization || isSavingAiAgent}
                    >
                      <img
                        src={styleOption.imageSrc}
                        alt={t(styleOption.labelKey)}
                        className="size-10 rounded-sm object-cover"
                      />
                      <span className="flex-1 text-left text-xs font-medium">
                        {t(styleOption.labelKey)}
                      </span>
                      {isSelected ? <RiCheckLine className="size-4" /> : null}
                    </button>
                  );
                })}
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setIsAiAgentDialogOpen(false);
                }}
                disabled={isSavingAiAgent}
              >
                {t("common.actions.cancel")}
              </Button>
              <Button type="submit" disabled={!activeOrganization || isSavingAiAgent}>
                {isSavingAiAgent
                  ? t("common.state.saving")
                  : t("common.actions.saveChanges")}
              </Button>
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
            <AlertDialogTitle>{t("app.dialogs.leaveOrganization.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {activeOrganization
                ? t("app.dialogs.leaveOrganization.descriptionWithName", {
                    organizationName: activeOrganization.name,
                  })
                : t("app.dialogs.leaveOrganization.descriptionWithoutName")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isLeavingOrganization}>
              {t("common.actions.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={isLeavingOrganization || isOwner || !activeOrganization}
              onClick={() => void handleLeaveOrganization()}
            >
              {isLeavingOrganization ? t("common.state.leaving") : t("common.actions.leave")}
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
            <AlertDialogTitle>{t("app.dialogs.deleteOrganization.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {activeOrganization
                ? t("app.dialogs.deleteOrganization.descriptionWithName", {
                    organizationName: activeOrganization.name,
                  })
                : t("app.dialogs.deleteOrganization.descriptionWithoutName")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeletingOrganization}>
              {t("common.actions.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={isDeletingOrganization || !isOwner || !activeOrganization}
              onClick={() => void handleDeleteOrganization()}
            >
              {isDeletingOrganization ? t("common.state.deleting") : t("common.actions.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SidebarProvider>
  );
}
