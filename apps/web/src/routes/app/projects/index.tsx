import { api } from "@mvp-template/backend/convex/_generated/api";
import type { Id } from "@mvp-template/backend/convex/_generated/dataModel";
import {
  RiAddLine,
  RiArchiveLine,
  RiCheckLine,
  RiDownloadLine,
  RiEditLine,
  RiMapPinLine,
  RiMoreFill,
  RiSearchLine,
  RiUser3Line,
} from "@remixicon/react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useAction, useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { toast } from "@/components/ui/sonner";

import { ProjectCustomerDialog } from "@/components/customers/project-customer-dialog";
import { ProjectFormFields } from "@/components/projects/project-form-fields";
import {
  ListHeaderActionsSkeleton,
  ProjectsListSkeleton,
} from "@/components/loading/projects-customers-skeletons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { authClient } from "@/lib/auth-client";
import { downloadExportZip } from "@/lib/export-zip";
import { useI18n } from "@/lib/i18n-provider";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/projects/")({
  component: ProjectsRoute,
});

type ProjectStatus = "active" | "done";

type CustomerSummary = {
  _id: Id<"customers">;
  name: string;
  contactName?: string;
  email?: string;
  phone?: string;
};

type ProjectListItem = {
  _id: Id<"projects">;
  customerId?: Id<"customers">;
  customer?: CustomerSummary;
  location?: string;
  name: string;
  status: ProjectStatus;
  updatedAt: number;
  createdAt: number;
  hasNachtrag: boolean;
  hasUnseenNachtrag: boolean;
  hasUnreviewedChanges: boolean;
};

function ProjectsRoute() {
  const { locale, t } = useI18n();
  const navigate = useNavigate({ from: "/app/projects/" });
  const { data: activeOrganization, isPending: isOrganizationPending } =
    authClient.useActiveOrganization();
  const [headerRoot, setHeaderRoot] = useState<HTMLElement | null>(null);
  const [statusFilter, setStatusFilter] = useState<ProjectStatus>("active");
  const [searchQuery, setSearchQuery] = useState("");
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createLocation, setCreateLocation] = useState("");
  const [createCustomerId, setCreateCustomerId] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [editingProject, setEditingProject] = useState<ProjectListItem | null>(null);
  const [editName, setEditName] = useState("");
  const [editLocation, setEditLocation] = useState("");
  const [editCustomerId, setEditCustomerId] = useState("");
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [archivingProject, setArchivingProject] = useState<ProjectListItem | null>(null);
  const [isArchiving, setIsArchiving] = useState(false);
  const [customerProject, setCustomerProject] = useState<ProjectListItem | null>(null);
  const [statusUpdatingProjectId, setStatusUpdatingProjectId] = useState<Id<"projects"> | null>(
    null,
  );
  const projectsQuery = useQuery(api.projects.list, activeOrganization?.id ? {} : "skip");
  const customersQuery = useQuery(api.customers.list, activeOrganization?.id ? {} : "skip");
  const prepareZipManifest = useAction(api.exports.prepareZipManifest);
  const createProject = useMutation(api.projects.create);
  const updateProject = useMutation(api.projects.update);
  const archiveProject = useMutation(api.projects.archive);
  const [selectedProjectIds, setSelectedProjectIds] = useState<Id<"projects">[]>([]);
  const [isExporting, setIsExporting] = useState(false);
  const projects = useMemo(() => (projectsQuery ?? []) as ProjectListItem[], [projectsQuery]);
  const customers = useMemo(
    () => (customersQuery ?? []) as CustomerSummary[],
    [customersQuery],
  );
  const selectedProjectIdSet = useMemo(
    () => new Set(selectedProjectIds.map((projectId) => String(projectId))),
    [selectedProjectIds],
  );
  const filteredProjectsByStatus = useMemo(() => {
    const normalized = searchQuery.trim().toLowerCase();

    return {
      active: projects.filter((project) => {
        if (project.status !== "active") {
          return false;
        }

        return (
          normalized.length === 0 ||
          project.name.toLowerCase().includes(normalized) ||
          project.location?.toLowerCase().includes(normalized)
        );
      }),
      done: projects.filter((project) => {
        if (project.status !== "done") {
          return false;
        }

        return (
          normalized.length === 0 ||
          project.name.toLowerCase().includes(normalized) ||
          project.location?.toLowerCase().includes(normalized)
        );
      }),
    };
  }, [projects, searchQuery]);
  const projectsByStatus = useMemo(
    () => ({
      active: projects.filter((project) => project.status === "active"),
      done: projects.filter((project) => project.status === "done"),
    }),
    [projects],
  );
  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeStyle: "short",
      }),
    [locale],
  );

  useEffect(() => {
    setHeaderRoot(document.getElementById("app-layout-header-actions") as HTMLElement | null);
  }, []);

  const resetCreateForm = () => {
    setCreateName("");
    setCreateLocation("");
    setCreateCustomerId("");
  };

  const handleCreateProject = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsCreating(true);
    try {
      const projectId = await createProject({
        name: createName,
        location: createLocation || undefined,
        customerId: createCustomerId ? (createCustomerId as Id<"customers">) : undefined,
      });
      resetCreateForm();
      setIsCreateDialogOpen(false);
      toast.success(t("app.projects.toasts.created"));
      void navigate({
        to: "/app/projects/$projectId",
        params: { projectId: String(projectId) },
        search: { customerId: undefined },
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("app.projects.toasts.createFailed"));
    } finally {
      setIsCreating(false);
    }
  };

  const handleSaveEdit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editingProject) {
      return;
    }

    setIsSavingEdit(true);
    try {
      await updateProject({
        projectId: editingProject._id,
        name: editName,
        location: editLocation || null,
        customerId: editCustomerId ? (editCustomerId as Id<"customers">) : null,
      });
      setEditingProject(null);
      toast.success(t("app.projects.toasts.updated"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("app.projects.toasts.updateFailed"));
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleArchiveProject = async () => {
    if (!archivingProject) {
      return;
    }

    setIsArchiving(true);
    try {
      await archiveProject({ projectId: archivingProject._id });
      setArchivingProject(null);
      toast.success(t("app.projects.toasts.archived"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("app.projects.toasts.archiveFailed"));
    } finally {
      setIsArchiving(false);
    }
  };

  const handleStatusChange = async (project: ProjectListItem, status: ProjectStatus) => {
    if (project.status === status) {
      return;
    }

    setStatusUpdatingProjectId(project._id);
    try {
      await updateProject({ projectId: project._id, status });
      toast.success(
        status === "done"
          ? t("app.projects.toasts.markedDone")
          : t("app.projects.toasts.reopened"),
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("app.projects.toasts.updateFailed"));
    } finally {
      setStatusUpdatingProjectId(null);
    }
  };

  const handleProjectSelectionChange = (projectId: Id<"projects">, checked: boolean) => {
    setSelectedProjectIds((current) => {
      if (checked) {
        if (current.some((selectedId) => selectedId === projectId)) {
          return current;
        }

        return [...current, projectId];
      }

      return current.filter((selectedId) => selectedId !== projectId);
    });
  };

  const handleExportSelectedProjects = async () => {
    if (selectedProjectIds.length === 0) {
      return;
    }

    setIsExporting(true);
    try {
      const manifest = await prepareZipManifest({
        mode: "projects",
        projectIds: selectedProjectIds,
      });

      if (manifest.roots.length === 0) {
        toast.error(t("app.projects.toasts.exportEmpty"));
        return;
      }

      await downloadExportZip(manifest, "projects", t);
      toast.success(t("app.projects.toasts.exportDownloaded"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("app.projects.toasts.exportFailed"));
    } finally {
      setIsExporting(false);
    }
  };

  if (isOrganizationPending || (activeOrganization?.id && projectsQuery === undefined)) {
    return (
      <>
        {headerRoot ? createPortal(<ListHeaderActionsSkeleton />, headerRoot) : null}
        <ProjectsListSkeleton />
      </>
    );
  }

  if (!activeOrganization) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("app.projects.noActiveOrganizationTitle")}</CardTitle>
          <CardDescription>{t("app.projects.noActiveOrganizationDescription")}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const renderProjectList = (status: ProjectStatus) => {
    const projectsForStatus = projectsByStatus[status];
    const filteredProjectsForStatus = filteredProjectsByStatus[status];

    if (filteredProjectsForStatus.length === 0) {
      return (
        <Card>
          <CardHeader>
            <CardTitle>
              {projectsForStatus.length === 0
                ? t("app.projects.empty.noneTitle")
                : t("app.projects.empty.filteredTitle")}
            </CardTitle>
            <CardDescription>
              {projectsForStatus.length === 0
                ? t("app.projects.empty.noneDescription")
                : t("app.projects.empty.filteredDescription")}
            </CardDescription>
          </CardHeader>
        </Card>
      );
    }

    return (
      <ul className="overflow-hidden rounded-lg border bg-card">
        {filteredProjectsForStatus.map((project) => (
          <li key={project._id} className="border-b border-border last:border-b-0">
            <div
              className={cn(
                "flex items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/30",
                selectedProjectIdSet.has(String(project._id)) && "bg-muted/30",
              )}
            >
              <Checkbox
                checked={selectedProjectIdSet.has(String(project._id))}
                onCheckedChange={(checked) => handleProjectSelectionChange(project._id, checked)}
                aria-label={t("app.projects.card.select", { name: project.name })}
                className="mt-0.5"
              />
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <Link
                    to="/app/projects/$projectId"
                    params={{ projectId: String(project._id) }}
                    search={{ customerId: undefined }}
                    className="min-w-0 truncate font-medium text-sm hover:underline"
                  >
                    {project.name}
                  </Link>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {dateFormatter.format(project.updatedAt)}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {project.location ? (
                    <span className="inline-flex items-center gap-1.5">
                      <RiMapPinLine className="size-3.5" />
                      {project.location}
                    </span>
                  ) : null}
                  {project.customer?.name ? <span>{project.customer.name}</span> : null}
                  {project.hasUnreviewedChanges ? (
                    <Badge variant="secondary">{t("app.projects.card.needsReview")}</Badge>
                  ) : null}
                  {project.hasNachtrag ? (
                    <Badge variant={project.hasUnseenNachtrag ? "destructive" : "outline"}>
                      {t("common.misc.nachtrag")}
                    </Badge>
                  ) : null}
                </div>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 shrink-0"
                      aria-label={t("app.projects.card.actions")}
                    />
                  }
                >
                  <RiMoreFill className="size-4" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuItem
                    onClick={() => {
                      setEditingProject(project);
                      setEditName(project.name);
                      setEditLocation(project.location ?? "");
                      setEditCustomerId(project.customerId ? String(project.customerId) : "");
                    }}
                  >
                    <RiEditLine className="size-4" />
                    {t("app.projects.card.edit")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setCustomerProject(project)}>
                    <RiUser3Line className="size-4" />
                    {t("app.projects.card.customer")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() =>
                      handleStatusChange(
                        project,
                        project.status === "active" ? "done" : "active",
                      )
                    }
                    disabled={statusUpdatingProjectId === project._id}
                  >
                    <RiCheckLine className="size-4" />
                    {project.status === "active"
                      ? t("app.projects.card.markDone")
                      : t("app.projects.card.reopen")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={() => setArchivingProject(project)}
                  >
                    <RiArchiveLine className="size-4" />
                    {t("common.actions.archive")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </li>
        ))}
      </ul>
    );
  };

  return (
    <div className="space-y-6">
      {headerRoot
        ? createPortal(
            <>
              <div className="relative flex items-center">
                <span className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-muted-foreground">
                  <RiSearchLine className="size-4" />
                </span>
                <Input
                  type="search"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder={t("app.projects.searchPlaceholder")}
                  className="h-7 w-40 pl-8 sm:w-56"
                />
              </div>
              <Button size="sm" onClick={() => setIsCreateDialogOpen(true)}>
                <RiAddLine className="size-4" />
                {t("app.projects.newProject")}
              </Button>
            </>,
            headerRoot,
          )
        : null}

      <Tabs
        value={statusFilter}
        onValueChange={(value) => setStatusFilter(value as ProjectStatus)}
        className="space-y-4"
      >
        <section className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <TabsList aria-label={t("app.projects.card.statusAria")}>
            <TabsTrigger value="active">{t("app.projects.card.activeTab")}</TabsTrigger>
            <TabsTrigger value="done">{t("app.projects.card.doneTab")}</TabsTrigger>
          </TabsList>
          {selectedProjectIds.length > 0 ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => void handleExportSelectedProjects()}
              disabled={isExporting}
            >
              {isExporting ? <Spinner className="size-4" /> : <RiDownloadLine className="size-4" />}
              {t("common.actions.export")}
            </Button>
          ) : null}
        </section>

        <TabsContent value="active" className="mt-0">
          {renderProjectList("active")}
        </TabsContent>
        <TabsContent value="done" className="mt-0">
          {renderProjectList("done")}
        </TabsContent>
      </Tabs>

      <Dialog
        open={isCreateDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            resetCreateForm();
          }
          setIsCreateDialogOpen(open);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("app.projects.dialogs.createTitle")}</DialogTitle>
            <DialogDescription>{t("app.projects.dialogs.createDescription")}</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateProject} className="space-y-4">
            <ProjectFormFields
              idPrefix="create"
              name={createName}
              location={createLocation}
              customerId={createCustomerId}
              customers={customers}
              onNameChange={setCreateName}
              onLocationChange={setCreateLocation}
              onCustomerIdChange={setCreateCustomerId}
              disabled={isCreating}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsCreateDialogOpen(false)} disabled={isCreating}>
                {t("common.actions.cancel")}
              </Button>
              <Button type="submit" disabled={isCreating}>
                {t("common.actions.create")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={editingProject !== null}
        onOpenChange={(open) => {
          if (!open) {
            setEditingProject(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("app.projects.dialogs.editTitle")}</DialogTitle>
            <DialogDescription>{t("app.projects.dialogs.editDescription")}</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSaveEdit} className="space-y-4">
            <ProjectFormFields
              idPrefix="edit"
              name={editName}
              location={editLocation}
              customerId={editCustomerId}
              customers={customers}
              onNameChange={setEditName}
              onLocationChange={setEditLocation}
              onCustomerIdChange={setEditCustomerId}
              disabled={isSavingEdit}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditingProject(null)} disabled={isSavingEdit}>
                {t("common.actions.cancel")}
              </Button>
              <Button type="submit" disabled={isSavingEdit}>
                {t("common.actions.save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={archivingProject !== null}
        onOpenChange={(open) => {
          if (!open) {
            setArchivingProject(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("app.projects.dialogs.archiveTitle")}</DialogTitle>
            <DialogDescription>
              {archivingProject
                ? t("app.projects.dialogs.archiveDescriptionNamed", {
                    projectName: archivingProject.name,
                  })
                : t("app.projects.dialogs.archiveDescriptionDefault")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setArchivingProject(null)} disabled={isArchiving}>
              {t("common.actions.cancel")}
            </Button>
            <Button type="button" variant="destructive" onClick={handleArchiveProject} disabled={isArchiving}>
              {t("common.actions.archive")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ProjectCustomerDialog
        open={customerProject !== null}
        project={customerProject}
        onOpenChange={(open) => {
          if (!open) {
            setCustomerProject(null);
          }
        }}
      />
    </div>
  );
}
