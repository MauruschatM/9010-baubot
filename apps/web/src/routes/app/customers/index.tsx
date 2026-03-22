import { api } from "@mvp-template/backend/convex/_generated/api";
import type { Id } from "@mvp-template/backend/convex/_generated/dataModel";
import {
  RiAddLine,
  RiArchiveLine,
  RiDownloadLine,
  RiEditLine,
  RiMoreFill,
  RiSearchLine,
} from "@remixicon/react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useAction, useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { toast } from "@/components/ui/sonner";

import { CustomerFormFields } from "@/components/customers/customer-form-fields";
import {
  CustomersListSkeleton,
  ListHeaderActionsSkeleton,
} from "@/components/loading/projects-customers-skeletons";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useCurrentOrganizationState } from "@/lib/current-organization";
import { downloadExportZip } from "@/lib/export-zip";
import { useI18n } from "@/lib/i18n-provider";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/customers/")({
  component: CustomersRoute,
});

type CustomerListItem = {
  _id: Id<"customers">;
  name: string;
  contactName?: string;
  email?: string;
  phone?: string;
  activeProjectCount: number;
  doneProjectCount: number;
  updatedAt: number;
};

function CustomerStatusIndicator({
  active,
  label,
}: {
  active: boolean;
  label: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            tabIndex={0}
            aria-label={label}
            className="inline-flex shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          />
        }
      >
        <span
          aria-hidden="true"
          className={cn(
            "size-2 rounded-full",
            active ? "bg-emerald-500" : "bg-destructive",
          )}
        />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function CustomersRoute() {
  const { locale, t } = useI18n();
  const navigate = useNavigate({ from: "/app/customers/" });
  const { activeOrganization, isPending } = useCurrentOrganizationState();
  const customersQuery = useQuery(api.customers.list, activeOrganization?.id ? {} : "skip");
  const prepareZipManifest = useAction(api.exports.prepareZipManifest);
  const createCustomer = useMutation(api.customers.create);
  const updateCustomer = useMutation(api.customers.update);
  const archiveCustomer = useMutation(api.customers.archive);
  const [headerRoot, setHeaderRoot] = useState<HTMLElement | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<CustomerListItem | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [contactName, setContactName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [archivingCustomer, setArchivingCustomer] = useState<CustomerListItem | null>(null);
  const [isArchiving, setIsArchiving] = useState(false);
  const [selectedCustomerIds, setSelectedCustomerIds] = useState<Id<"customers">[]>([]);
  const [isExporting, setIsExporting] = useState(false);
  const customers = useMemo(
    () => (customersQuery ?? []) as CustomerListItem[],
    [customersQuery],
  );
  const selectedCustomerIdSet = useMemo(
    () => new Set(selectedCustomerIds.map((customerId) => String(customerId))),
    [selectedCustomerIds],
  );
  const filteredCustomers = useMemo(() => {
    const normalized = searchQuery.trim().toLowerCase();

    return customers.filter(
      (customer) =>
        normalized.length === 0 ||
        customer.name.toLowerCase().includes(normalized) ||
        customer.contactName?.toLowerCase().includes(normalized) ||
        customer.email?.toLowerCase().includes(normalized) ||
        customer.phone?.toLowerCase().includes(normalized),
    );
  }, [customers, searchQuery]);
  const activeCustomers = useMemo(
    () => filteredCustomers.filter((customer) => customer.activeProjectCount > 0),
    [filteredCustomers],
  );
  const inactiveCustomers = useMemo(
    () => filteredCustomers.filter((customer) => customer.activeProjectCount === 0),
    [filteredCustomers],
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

  useEffect(() => {
    const availableCustomerIds = new Set(customers.map((customer) => String(customer._id)));

    setSelectedCustomerIds((current) => {
      const next = current.filter((customerId) => availableCustomerIds.has(String(customerId)));

      return next.length === current.length ? current : next;
    });
  }, [customers]);

  const resetForm = () => {
    setCustomerName("");
    setContactName("");
    setEmail("");
    setPhone("");
  };

  const syncCustomerForm = (customer: CustomerListItem | null) => {
    setCustomerName(customer?.name ?? "");
    setContactName(customer?.contactName ?? "");
    setEmail(customer?.email ?? "");
    setPhone(customer?.phone ?? "");
  };

  const handleCreateCustomer = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsCreating(true);
    try {
      const customerId = await createCustomer({
        name: customerName,
        contactName,
        email,
        phone,
      });
      resetForm();
      setIsCreateDialogOpen(false);
      toast.success(t("app.customers.toasts.created"));
      void navigate({
        to: "/app/customers/$customerId",
        params: { customerId: String(customerId) },
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("app.customers.toasts.createFailed"));
    } finally {
      setIsCreating(false);
    }
  };

  const handleSaveCustomer = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editingCustomer) {
      return;
    }

    setIsSavingEdit(true);
    try {
      await updateCustomer({
        customerId: editingCustomer._id,
        name: customerName,
        contactName: contactName || null,
        email: email || null,
        phone: phone || null,
      });
      setEditingCustomer(null);
      resetForm();
      toast.success(t("app.customers.toasts.updated"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("app.customers.toasts.updateFailed"));
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleArchiveCustomer = async () => {
    if (!archivingCustomer) {
      return;
    }

    setIsArchiving(true);
    try {
      await archiveCustomer({ customerId: archivingCustomer._id });
      setArchivingCustomer(null);
      toast.success(t("app.customers.toasts.archived"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("app.customers.toasts.archiveFailed"));
    } finally {
      setIsArchiving(false);
    }
  };

  const handleCustomerSelectionChange = (customerId: Id<"customers">, checked: boolean) => {
    setSelectedCustomerIds((current) => {
      if (checked) {
        if (current.some((selectedId) => selectedId === customerId)) {
          return current;
        }

        return [...current, customerId];
      }

      return current.filter((selectedId) => selectedId !== customerId);
    });
  };

  const handleExportSelectedCustomers = async () => {
    if (selectedCustomerIds.length === 0) {
      return;
    }

    setIsExporting(true);
    try {
      const manifest = await prepareZipManifest({
        mode: "customers",
        customerIds: selectedCustomerIds,
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

  if (isPending || (activeOrganization?.id && customersQuery === undefined)) {
    return (
      <>
        {headerRoot ? createPortal(<ListHeaderActionsSkeleton />, headerRoot) : null}
        <CustomersListSkeleton />
      </>
    );
  }

  if (!activeOrganization) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("app.customers.noActiveOrganizationTitle")}</CardTitle>
          <CardDescription>{t("app.customers.noActiveOrganizationDescription")}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const hasSearchQuery = searchQuery.trim().length > 0;
  const emptyStateTitle = hasSearchQuery
    ? t("app.customers.empty.filteredTitle")
    : t("app.customers.empty.noneTitle");
  const emptyStateDescription = hasSearchQuery
    ? t("app.customers.empty.filteredDescription")
    : t("app.customers.empty.noneDescription");

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
                  placeholder={t("app.customers.searchPlaceholder")}
                  className="h-7 w-40 pl-8 sm:w-56"
                />
              </div>
              <Button size="sm" onClick={() => setIsCreateDialogOpen(true)}>
                <RiAddLine className="size-4" />
                {t("app.customers.newCustomer")}
              </Button>
            </>,
            headerRoot,
          )
        : null}

      {selectedCustomerIds.length > 0 ? (
        <section className="flex justify-end">
          <Button
            size="sm"
            variant="outline"
            onClick={() => void handleExportSelectedCustomers()}
            disabled={isExporting}
          >
            {isExporting ? <Spinner className="size-4" /> : <RiDownloadLine className="size-4" />}
            {t("common.actions.export")}
          </Button>
        </section>
      ) : null}

      {filteredCustomers.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>{emptyStateTitle}</CardTitle>
            <CardDescription>{emptyStateDescription}</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <TooltipProvider>
          <div className="space-y-3">
            {activeCustomers.length > 0 ? (
              <ul className="overflow-hidden rounded-lg border bg-card">
                {activeCustomers.map((customer) => (
                  <li key={customer._id} className="border-b border-border last:border-b-0">
                    <div
                      className={cn(
                        "flex items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/30",
                        selectedCustomerIdSet.has(String(customer._id)) && "bg-muted/30",
                      )}
                    >
                      <Checkbox
                        checked={selectedCustomerIdSet.has(String(customer._id))}
                        onCheckedChange={(checked) =>
                          handleCustomerSelectionChange(customer._id, checked)
                        }
                        aria-label={t("app.customers.card.select", { name: customer.name })}
                        className="mt-0.5"
                      />
                      <div className="min-w-0 flex-1 space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="min-w-0 flex items-center gap-2">
                            <CustomerStatusIndicator
                              active
                              label={t("common.misc.active")}
                            />
                            <Link
                              to="/app/customers/$customerId"
                              params={{ customerId: String(customer._id) }}
                              className="min-w-0 truncate font-medium text-sm hover:underline"
                            >
                              {customer.name}
                            </Link>
                          </div>
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {dateFormatter.format(customer.updatedAt)}
                          </span>
                        </div>
                        {customer.contactName || customer.email || customer.phone ? (
                          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            {customer.contactName ? <span>{customer.contactName}</span> : null}
                            {customer.email ? <span>{customer.email}</span> : null}
                            {customer.phone ? <span>{customer.phone}</span> : null}
                          </div>
                        ) : null}
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8 shrink-0"
                              aria-label={t("app.customers.card.actions")}
                            />
                          }
                        >
                          <RiMoreFill className="size-4" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-56">
                          <DropdownMenuItem
                            onClick={() => {
                              syncCustomerForm(customer);
                              setEditingCustomer(customer);
                            }}
                          >
                            <RiEditLine className="size-4" />
                            {t("app.customers.dialogs.editTitle")}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={() => setArchivingCustomer(customer)}
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
            ) : null}

            {inactiveCustomers.length > 0 ? (
              <section className="space-y-3">
                <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
                  {t("app.customers.card.noActiveProjects")}
                </p>
                <ul className="overflow-hidden rounded-lg border bg-card">
                  {inactiveCustomers.map((customer) => (
                    <li key={customer._id} className="border-b border-border last:border-b-0">
                      <div
                        className={cn(
                          "flex items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/30",
                          selectedCustomerIdSet.has(String(customer._id)) && "bg-muted/30",
                        )}
                      >
                        <Checkbox
                          checked={selectedCustomerIdSet.has(String(customer._id))}
                          onCheckedChange={(checked) =>
                            handleCustomerSelectionChange(customer._id, checked)
                          }
                          aria-label={t("app.customers.card.select", { name: customer.name })}
                          className="mt-0.5"
                        />
                        <div className="min-w-0 flex-1 space-y-2">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="min-w-0 flex items-center gap-2">
                              <CustomerStatusIndicator
                                active={false}
                                label={t("common.misc.inactive")}
                              />
                              <Link
                                to="/app/customers/$customerId"
                                params={{ customerId: String(customer._id) }}
                                className="min-w-0 truncate font-medium text-sm hover:underline"
                              >
                                {customer.name}
                              </Link>
                            </div>
                            <span className="shrink-0 text-xs text-muted-foreground">
                              {dateFormatter.format(customer.updatedAt)}
                            </span>
                          </div>
                          {customer.contactName || customer.email || customer.phone ? (
                            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                              {customer.contactName ? <span>{customer.contactName}</span> : null}
                              {customer.email ? <span>{customer.email}</span> : null}
                              {customer.phone ? <span>{customer.phone}</span> : null}
                            </div>
                          ) : null}
                        </div>
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8 shrink-0"
                                aria-label={t("app.customers.card.actions")}
                              />
                            }
                          >
                            <RiMoreFill className="size-4" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-56">
                            <DropdownMenuItem
                              onClick={() => {
                                syncCustomerForm(customer);
                                setEditingCustomer(customer);
                              }}
                            >
                              <RiEditLine className="size-4" />
                              {t("app.customers.dialogs.editTitle")}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              variant="destructive"
                              onClick={() => setArchivingCustomer(customer)}
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
              </section>
            ) : null}
          </div>
        </TooltipProvider>
      )}

      <Dialog
        open={isCreateDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            resetForm();
          }
          setIsCreateDialogOpen(open);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("app.customers.dialogs.createTitle")}</DialogTitle>
            <DialogDescription>{t("app.customers.dialogs.createDescription")}</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateCustomer} className="space-y-4">
            <CustomerFormFields
              idPrefix="create-customer"
              customerName={customerName}
              contactName={contactName}
              email={email}
              phone={phone}
              onCustomerNameChange={setCustomerName}
              onContactNameChange={setContactName}
              onEmailChange={setEmail}
              onPhoneChange={setPhone}
              disabled={isCreating}
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsCreateDialogOpen(false)}
                disabled={isCreating}
              >
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
        open={editingCustomer !== null}
        onOpenChange={(open) => {
          if (!open) {
            setEditingCustomer(null);
            resetForm();
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("app.customers.dialogs.editTitle")}</DialogTitle>
            <DialogDescription>{t("app.customers.dialogs.editDescription")}</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSaveCustomer} className="space-y-4">
            <CustomerFormFields
              idPrefix="edit-customer"
              customerName={customerName}
              contactName={contactName}
              email={email}
              phone={phone}
              onCustomerNameChange={setCustomerName}
              onContactNameChange={setContactName}
              onEmailChange={setEmail}
              onPhoneChange={setPhone}
              disabled={isSavingEdit}
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setEditingCustomer(null);
                  resetForm();
                }}
                disabled={isSavingEdit}
              >
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
        open={archivingCustomer !== null}
        onOpenChange={(open) => {
          if (!open) {
            setArchivingCustomer(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("app.customers.dialogs.archiveTitle")}</DialogTitle>
            <DialogDescription>
              {archivingCustomer
                ? t("app.customers.dialogs.archiveDescriptionNamed", {
                    customerName: archivingCustomer.name,
                  })
                : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setArchivingCustomer(null)}
              disabled={isArchiving}
            >
              {t("common.actions.cancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleArchiveCustomer}
              disabled={isArchiving}
            >
              {t("common.actions.archive")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
