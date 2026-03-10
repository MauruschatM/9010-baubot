import { api } from "@mvp-template/backend/convex/_generated/api";
import type { Id } from "@mvp-template/backend/convex/_generated/dataModel";
import {
  RiArchiveLine,
  RiFolder3Line,
  RiMapPinLine,
  RiRepeatLine,
  RiUser3Line,
} from "@remixicon/react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { useMemo, useState } from "react";
import { toast } from "@/components/ui/sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { authClient } from "@/lib/auth-client";
import { useI18n } from "@/lib/i18n-provider";

export const Route = createFileRoute("/app/archive")({
  component: ArchiveRoute,
});

type ArchivedCustomer = {
  _id: Id<"customers">;
  name: string;
  contactName?: string;
  email?: string;
  phone?: string;
  deletedAt: number;
  linkedProjectCount: number;
};

type ArchivedProject = {
  _id: Id<"projects">;
  name: string;
  location?: string;
  status: "active" | "done";
  deletedAt: number;
  customer?: {
    name: string;
  };
};

function ArchiveRoute() {
  const { locale, t } = useI18n();
  const { data: activeOrganization, isPending } = authClient.useActiveOrganization();
  const archivedCustomersQuery = useQuery(
    api.customers.listArchived,
    activeOrganization?.id ? {} : "skip",
  );
  const archivedProjectsQuery = useQuery(
    api.projects.listArchived,
    activeOrganization?.id ? {} : "skip",
  );
  const restoreCustomer = useMutation(api.customers.restore);
  const restoreProject = useMutation(api.projects.restore);
  const [restoringCustomerId, setRestoringCustomerId] = useState<Id<"customers"> | null>(null);
  const [restoringProjectId, setRestoringProjectId] = useState<Id<"projects"> | null>(null);
  const customers = useMemo(
    () => (archivedCustomersQuery ?? []) as ArchivedCustomer[],
    [archivedCustomersQuery],
  );
  const projects = useMemo(
    () => (archivedProjectsQuery ?? []) as ArchivedProject[],
    [archivedProjectsQuery],
  );
  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeStyle: "short",
      }),
    [locale],
  );

  const handleRestoreCustomer = async (customerId: Id<"customers">) => {
    setRestoringCustomerId(customerId);
    try {
      await restoreCustomer({ customerId });
      toast.success(t("app.archive.toasts.customerRestored"));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("app.archive.toasts.customerRestoreFailed"),
      );
    } finally {
      setRestoringCustomerId(null);
    }
  };

  const handleRestoreProject = async (projectId: Id<"projects">) => {
    setRestoringProjectId(projectId);
    try {
      await restoreProject({ projectId });
      toast.success(t("app.archive.toasts.projectRestored"));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("app.archive.toasts.projectRestoreFailed"),
      );
    } finally {
      setRestoringProjectId(null);
    }
  };

  if (
    isPending ||
    (activeOrganization?.id &&
      (archivedCustomersQuery === undefined || archivedProjectsQuery === undefined))
  ) {
    return <div className="text-sm text-muted-foreground">{t("app.archive.loading")}</div>;
  }

  if (!activeOrganization) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("app.archive.unavailable.title")}</CardTitle>
          <CardDescription>{t("app.archive.unavailable.description")}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border bg-card p-6 shadow-sm">
        <div className="space-y-2">
          <p className="text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">
            {t("app.archive.hero.eyebrow")}
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">{t("app.archive.hero.title")}</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            {t("app.archive.hero.description")}
          </p>
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <RiUser3Line className="size-4 text-muted-foreground" />
          <h2 className="text-lg font-semibold">{t("app.archive.customers.title")}</h2>
        </div>
        {customers.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>{t("app.archive.customers.emptyTitle")}</CardTitle>
              <CardDescription>{t("app.archive.customers.emptyDescription")}</CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {customers.map((customer) => (
              <Card key={customer._id}>
                <CardHeader className="space-y-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-1">
                      <CardTitle className="text-xl">{customer.name}</CardTitle>
                      <CardDescription>
                        {t("app.archive.labels.archivedAt", {
                          date: dateFormatter.format(customer.deletedAt),
                        })}
                      </CardDescription>
                    </div>
                    <Badge variant="outline">
                      {t("app.archive.customers.linkedProjects", {
                        count: customer.linkedProjectCount,
                      })}
                    </Badge>
                  </div>
                  <div className="space-y-1 text-sm text-muted-foreground">
                    {customer.contactName ? <p>{customer.contactName}</p> : null}
                    {customer.email ? <p>{customer.email}</p> : null}
                    {customer.phone ? <p>{customer.phone}</p> : null}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void handleRestoreCustomer(customer._id)}
                    disabled={restoringCustomerId === customer._id}
                  >
                    <RiRepeatLine className="size-4" />
                    {t("common.actions.restore")}
                  </Button>
                </CardHeader>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <RiFolder3Line className="size-4 text-muted-foreground" />
          <h2 className="text-lg font-semibold">{t("app.archive.projects.title")}</h2>
        </div>
        {projects.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>{t("app.archive.projects.emptyTitle")}</CardTitle>
              <CardDescription>{t("app.archive.projects.emptyDescription")}</CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <ul className="overflow-hidden rounded-2xl border bg-card shadow-sm">
            {projects.map((project) => (
              <li key={project._id} className="border-b last:border-b-0">
                <div className="flex items-center gap-4 px-4 py-3">
                  <div className="rounded-xl bg-muted p-2 text-muted-foreground">
                    <RiArchiveLine className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{project.name}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span>
                        {t("app.archive.labels.archivedAt", {
                          date: dateFormatter.format(project.deletedAt),
                        })}
                      </span>
                      {project.location ? (
                        <span className="inline-flex items-center gap-1">
                          <RiMapPinLine className="size-3.5" />
                          {project.location}
                        </span>
                      ) : null}
                      {project.customer?.name ? (
                        <span>
                          {t("app.archive.projects.customer", { name: project.customer.name })}
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Badge variant={project.status === "active" ? "default" : "secondary"}>
                        {project.status === "active"
                          ? t("common.misc.active")
                          : t("common.misc.done")}
                      </Badge>
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void handleRestoreProject(project._id)}
                    disabled={restoringProjectId === project._id}
                  >
                    <RiRepeatLine className="size-4" />
                    {t("common.actions.restore")}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
