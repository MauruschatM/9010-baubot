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
} from "@remixicon/react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useAction, useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { toast } from "@/components/ui/sonner";

import { CustomerFormFields } from "@/components/customers/customer-form-fields";
import { ProjectFormFields } from "@/components/projects/project-form-fields";
import {
  CustomerDetailSkeleton,
  DetailHeaderActionsSkeleton,
} from "@/components/loading/projects-customers-skeletons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { authClient } from "@/lib/auth-client";
import { downloadExportZip } from "@/lib/export-zip";
import { useI18n } from "@/lib/i18n-provider";

export const Route = createFileRoute("/app/customers/$customerId")({
  component: CustomerDetailRoute,
});

type CustomerRecord = {
  _id: Id<"customers">;
  name: string;
  contactName?: string;
  email?: string;
  phone?: string;
  activeProjectCount: number;
  doneProjectCount: number;
};

type CustomerSummary = {
  _id: Id<"customers">;
  name: string;
  contactName?: string;
};

type ProjectListItem = {
  _id: Id<"projects">;
  name: string;
  location?: string;
  status: "active" | "done";
  updatedAt: number;
  hasUnreviewedChanges: boolean;
  hasNachtrag: boolean;
  hasUnseenNachtrag: boolean;
};

const minimalListClassName = "overflow-hidden rounded-lg border bg-card";
const minimalRowClassName = "border-b border-border px-4 py-3 last:border-b-0";

function CustomerDetailRoute() {
  const { locale, t } = useI18n();
  const navigate = useNavigate({ from: "/app/customers/$customerId" });
  const { data: activeOrganization, isPending: isOrganizationPending } =
    authClient.useActiveOrganization();
  const { customerId } = Route.useParams();
  const typedCustomerId = customerId as Id<"customers">;
  const customer = useQuery(api.customers.getById, {
    customerId: typedCustomerId,
  }) as CustomerRecord | null | undefined;
  const [statusFilter, setStatusFilter] = useState<"active" | "done">("active");
  const customerProjectsQuery = useQuery(
    api.projects.listByCustomer,
    activeOrganization?.id
      ? {
          customerId: typedCustomerId,
        }
      : "skip",
  );
  const customersQuery = useQuery(api.customers.list, activeOrganization?.id ? {} : "skip");
  const prepareZipManifest = useAction(api.exports.prepareZipManifest);
  const updateCustomer = useMutation(api.customers.update);
  const createProject = useMutation(api.projects.create);
  const updateProject = useMutation(api.projects.update);
  const archiveProject = useMutation(api.projects.archive);
  const archiveCustomer = useMutation(api.customers.archive);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [contactName, setContactName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [isSavingCustomer, setIsSavingCustomer] = useState(false);
  const [isCreateProjectDialogOpen, setIsCreateProjectDialogOpen] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [projectLocation, setProjectLocation] = useState("");
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [editingProject, setEditingProject] = useState<ProjectListItem | null>(null);
  const [editProjectName, setEditProjectName] = useState("");
  const [editProjectLocation, setEditProjectLocation] = useState("");
  const [editProjectCustomerId, setEditProjectCustomerId] = useState("");
  const [isSavingProjectEdit, setIsSavingProjectEdit] = useState(false);
  const [statusUpdatingProjectId, setStatusUpdatingProjectId] = useState<Id<"projects"> | null>(
    null,
  );
  const [archivingProject, setArchivingProject] = useState<ProjectListItem | null>(null);
  const [isArchivingProject, setIsArchivingProject] = useState(false);
  const [isArchiveDialogOpen, setIsArchiveDialogOpen] = useState(false);
  const [isArchivingCustomer, setIsArchivingCustomer] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [headerRoot, setHeaderRoot] = useState<HTMLElement | null>(null);
  const allProjects = useMemo(
    () => (customerProjectsQuery ?? []) as ProjectListItem[],
    [customerProjectsQuery],
  );
  const customers = useMemo(
    () => (customersQuery ?? []) as CustomerSummary[],
    [customersQuery],
  );
  const projects = useMemo(
    () => allProjects.filter((project) => project.status === statusFilter),
    [allProjects, statusFilter],
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

  const syncCustomerForm = (nextCustomer: CustomerRecord | null | undefined) => {
    setCustomerName(nextCustomer?.name ?? "");
    setContactName(nextCustomer?.contactName ?? "");
    setEmail(nextCustomer?.email ?? "");
    setPhone(nextCustomer?.phone ?? "");
  };

  const handleSaveCustomer = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!customer) {
      return;
    }

    setIsSavingCustomer(true);
    try {
      await updateCustomer({
        customerId: customer._id,
        name: customerName,
        contactName: contactName || null,
        email: email || null,
        phone: phone || null,
      });
      setIsEditDialogOpen(false);
      toast.success(t("app.customers.toasts.updated"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("app.customers.toasts.updateFailed"));
    } finally {
      setIsSavingCustomer(false);
    }
  };

  const handleCreateProject = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!customer) {
      return;
    }

    setIsCreatingProject(true);
    try {
      const projectId = await createProject({
        name: projectName,
        location: projectLocation || undefined,
        customerId: customer._id,
      });
      setProjectName("");
      setProjectLocation("");
      setIsCreateProjectDialogOpen(false);
      toast.success(t("app.customers.toasts.projectCreated"));
      void navigate({
        to: "/app/projects/$projectId",
        params: { projectId: String(projectId) },
        search: { customerId: String(customer._id) },
      });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("app.customers.toasts.projectCreateFailed"),
      );
    } finally {
      setIsCreatingProject(false);
    }
  };

  const handleProjectStatusChange = async (
    project: ProjectListItem,
    nextStatus: "active" | "done",
  ) => {
    if (project.status === nextStatus) {
      return;
    }

    setStatusUpdatingProjectId(project._id);
    try {
      await updateProject({ projectId: project._id, status: nextStatus });
      toast.success(
        nextStatus === "done"
          ? t("app.projects.toasts.markedDone")
          : t("app.projects.toasts.reopened"),
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("app.projects.toasts.updateFailed"));
    } finally {
      setStatusUpdatingProjectId(null);
    }
  };

  const handleSaveProjectEdit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editingProject) {
      return;
    }

    setIsSavingProjectEdit(true);
    try {
      await updateProject({
        projectId: editingProject._id,
        name: editProjectName,
        location: editProjectLocation || null,
        customerId: editProjectCustomerId ? (editProjectCustomerId as Id<"customers">) : null,
      });
      setEditingProject(null);
      toast.success(t("app.projects.toasts.updated"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("app.projects.toasts.updateFailed"));
    } finally {
      setIsSavingProjectEdit(false);
    }
  };

  const handleArchiveProject = async () => {
    if (!archivingProject) {
      return;
    }

    setIsArchivingProject(true);
    try {
      await archiveProject({ projectId: archivingProject._id });
      setArchivingProject(null);
      toast.success(t("app.projects.toasts.archived"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("app.projects.toasts.archiveFailed"));
    } finally {
      setIsArchivingProject(false);
    }
  };

  const handleArchiveCustomer = async () => {
    if (!customer) {
      return;
    }

    setIsArchivingCustomer(true);
    try {
      await archiveCustomer({ customerId: customer._id });
      toast.success(t("app.customers.toasts.archived"));
      void navigate({ to: "/app/customers" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("app.customers.toasts.archiveFailed"));
    } finally {
      setIsArchivingCustomer(false);
    }
  };

  const handleExportCustomer = async () => {
    if (!customer) {
      return;
    }

    setIsExporting(true);
    try {
      const manifest = await prepareZipManifest({
        mode: "customers",
        customerIds: [customer._id],
      });

      if (manifest.roots.length === 0) {
        toast.error(t("app.customers.toasts.exportEmpty"));
        return;
      }

      await downloadExportZip(manifest, "customers", t);
      toast.success(t("app.customers.toasts.exportDownloaded"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("app.customers.toasts.exportFailed"));
    } finally {
      setIsExporting(false);
    }
  };

  if (
    customer === undefined ||
    isOrganizationPending ||
    (activeOrganization?.id && customerProjectsQuery === undefined)
  ) {
    return (
      <>
        {headerRoot ? createPortal(<DetailHeaderActionsSkeleton />, headerRoot) : null}
        <CustomerDetailSkeleton />
      </>
    );
  }

  if (!customer) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("app.customers.detail.notFoundTitle")}</CardTitle>
          <CardDescription>{t("app.customers.detail.notFoundDescription")}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {headerRoot
        ? createPortal(
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  syncCustomerForm(customer);
                  setIsEditDialogOpen(true);
                }}
              >
                <RiEditLine className="size-4" />
                {t("common.actions.edit")}
              </Button>
              <Button size="sm" onClick={() => void handleExportCustomer()} disabled={isExporting}>
                {isExporting ? <Spinner className="size-4" /> : <RiDownloadLine className="size-4" />}
                {t("common.actions.export")}
              </Button>
            </>,
            headerRoot,
          )
        : null}

      <section className="space-y-4">
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-lg border bg-card px-5 py-4">
            <div className="space-y-1">
              <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
                {t("app.customers.detail.customerInfoTitle")}
              </p>
              {customer.contactName ? (
                <p className="text-base font-medium leading-snug">{customer.contactName}</p>
              ) : null}
              {customer.email ? (
                <p className="text-sm text-muted-foreground">{customer.email}</p>
              ) : null}
              {customer.phone ? (
                <p className="text-sm text-muted-foreground">{customer.phone}</p>
              ) : null}
              {!customer.contactName && !customer.email && !customer.phone ? (
                <p className="text-base font-medium leading-snug text-muted-foreground">
                  {t("app.customers.detail.noContactDetails")}
                </p>
              ) : null}
            </div>
          </div>
          <div className="rounded-lg border bg-card px-5 py-4">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
                  {t("app.customers.detail.projectGroupingTitle")}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">
                    {t("app.customers.detail.activeProjects", {
                      count: customer.activeProjectCount,
                    })}
                  </Badge>
                  <Badge variant="outline">
                    {t("app.customers.detail.doneProjects", {
                      count: customer.doneProjectCount,
                    })}
                  </Badge>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Tabs
            value={statusFilter}
            onValueChange={(value) => setStatusFilter(value as "active" | "done")}
          >
            <TabsList aria-label={t("app.customers.detail.projectGroupingTitle")}>
              <TabsTrigger value="active">{t("app.customers.detail.activeTab")}</TabsTrigger>
              <TabsTrigger value="done">{t("app.customers.detail.doneTab")}</TabsTrigger>
            </TabsList>
          </Tabs>
          <Button size="sm" onClick={() => setIsCreateProjectDialogOpen(true)}>
            <RiAddLine className="size-4" />
            {t("app.projects.newProject")}
          </Button>
        </div>
      </section>

      {projects.length === 0 ? (
        <div className="rounded-lg border border-dashed px-4 py-5 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">
            {statusFilter === "active"
              ? t("app.customers.detail.emptyActiveTitle")
              : t("app.customers.detail.emptyDoneTitle")}
          </p>
          <p className="mt-1">
            {statusFilter === "active"
              ? t("app.customers.detail.emptyActiveDescription")
              : t("app.customers.detail.emptyDoneDescription")}
          </p>
        </div>
      ) : (
        <ul className={minimalListClassName}>
          {projects.map((project) => (
            <li key={project._id} className={minimalRowClassName}>
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <Link
                      to="/app/projects/$projectId"
                      params={{ projectId: String(project._id) }}
                      search={{ customerId: String(customer._id) }}
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
                    {project.hasUnreviewedChanges ? (
                      <Badge variant="secondary">{t("app.customers.detail.needsReview")}</Badge>
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
                        setEditProjectName(project.name);
                        setEditProjectLocation(project.location ?? "");
                        setEditProjectCustomerId(String(customer._id));
                      }}
                    >
                      <RiEditLine className="size-4" />
                      {t("app.projects.card.edit")}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() =>
                        void handleProjectStatusChange(
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
                      variant="destructive"
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
      )}

      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("app.customers.dialogs.editTitle")}</DialogTitle>
            <DialogDescription>{t("app.customers.dialogs.editDescription")}</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSaveCustomer} className="space-y-4">
            <CustomerFormFields
              idPrefix="customer-detail"
              customerName={customerName}
              contactName={contactName}
              email={email}
              phone={phone}
              onCustomerNameChange={setCustomerName}
              onContactNameChange={setContactName}
              onEmailChange={setEmail}
              onPhoneChange={setPhone}
              disabled={isSavingCustomer}
            />
            <DialogFooter className="sm:justify-between">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setIsEditDialogOpen(false);
                  setIsArchiveDialogOpen(true);
                }}
                disabled={isSavingCustomer}
              >
                {t("common.actions.archive")}
              </Button>
              <div className="flex flex-col-reverse gap-2 sm:flex-row">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsEditDialogOpen(false)}
                  disabled={isSavingCustomer}
                >
                  {t("common.actions.cancel")}
                </Button>
                <Button type="submit" disabled={isSavingCustomer}>
                  {t("common.actions.save")}
                </Button>
              </div>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={isCreateProjectDialogOpen} onOpenChange={setIsCreateProjectDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("app.customers.dialogs.createProjectTitle")}</DialogTitle>
            <DialogDescription>
              {t("app.customers.dialogs.createProjectDescriptionNamed", {
                customerName: customer.name,
              })}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateProject} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="customer-project-name" className="text-sm font-medium">
                {t("app.projects.form.projectNameLabel")}
              </label>
              <Input
                id="customer-project-name"
                value={projectName}
                onChange={(event) => setProjectName(event.target.value)}
                disabled={isCreatingProject}
                placeholder={t("app.projects.form.projectNamePlaceholder")}
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="customer-project-location" className="text-sm font-medium">
                {t("app.projects.form.locationLabel")}
              </label>
              <Input
                id="customer-project-location"
                value={projectLocation}
                onChange={(event) => setProjectLocation(event.target.value)}
                disabled={isCreatingProject}
                placeholder={t("app.projects.form.locationPlaceholder")}
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsCreateProjectDialogOpen(false)}
                disabled={isCreatingProject}
              >
                {t("common.actions.cancel")}
              </Button>
              <Button type="submit" disabled={isCreatingProject}>
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
          <form onSubmit={handleSaveProjectEdit} className="space-y-4">
            <ProjectFormFields
              idPrefix="customer-project-edit"
              name={editProjectName}
              location={editProjectLocation}
              customerId={editProjectCustomerId}
              customers={customers}
              onNameChange={setEditProjectName}
              onLocationChange={setEditProjectLocation}
              onCustomerIdChange={setEditProjectCustomerId}
              disabled={isSavingProjectEdit}
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditingProject(null)}
                disabled={isSavingProjectEdit}
              >
                {t("common.actions.cancel")}
              </Button>
              <Button type="submit" disabled={isSavingProjectEdit}>
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
                : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setArchivingProject(null)}
              disabled={isArchivingProject}
            >
              {t("common.actions.cancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleArchiveProject}
              disabled={isArchivingProject}
            >
              {t("common.actions.archive")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isArchiveDialogOpen} onOpenChange={setIsArchiveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("app.customers.dialogs.archiveTitle")}</DialogTitle>
            <DialogDescription>
              {t("app.customers.dialogs.archiveDescriptionNamed", {
                customerName: customer.name,
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsArchiveDialogOpen(false)}
              disabled={isArchivingCustomer}
            >
              {t("common.actions.cancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleArchiveCustomer}
              disabled={isArchivingCustomer}
            >
              {t("common.actions.archive")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
