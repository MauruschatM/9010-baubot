import { api } from "@mvp-template/backend/convex/_generated/api";
import type { Id } from "@mvp-template/backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "@/components/ui/sonner";

import { CustomerFormFields } from "@/components/customers/customer-form-fields";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { useI18n } from "@/lib/i18n-provider";

type CustomerSummary = {
  _id: Id<"customers">;
  name: string;
  contactName?: string;
  email?: string;
  phone?: string;
};

type ProjectSummary = {
  _id: Id<"projects">;
  name: string;
  customerId?: Id<"customers">;
  customer?: CustomerSummary;
};

type ProjectCustomerDialogProps = {
  open: boolean;
  project: ProjectSummary | null;
  onOpenChange: (open: boolean) => void;
  onSaved?: (result: { customerId: Id<"customers"> | null; email?: string }) => void;
};

const NO_CUSTOMER_VALUE = "__none__";
const CREATE_CUSTOMER_VALUE = "__new__";

function setFieldsFromCustomer(
  customer: CustomerSummary | undefined,
  setCustomerName: (value: string) => void,
  setContactName: (value: string) => void,
  setEmail: (value: string) => void,
  setPhone: (value: string) => void,
) {
  setCustomerName(customer?.name ?? "");
  setContactName(customer?.contactName ?? "");
  setEmail(customer?.email ?? "");
  setPhone(customer?.phone ?? "");
}

export function ProjectCustomerDialog({
  open,
  project,
  onOpenChange,
  onSaved,
}: ProjectCustomerDialogProps) {
  const { t } = useI18n();
  const customersQuery = useQuery(api.customers.list, open ? {} : "skip");
  const updateCustomer = useMutation(api.customers.update);
  const createCustomer = useMutation(api.customers.create);
  const updateProject = useMutation(api.projects.update);
  const customers = useMemo(
    () => (customersQuery ?? []) as CustomerSummary[],
    [customersQuery],
  );
  const [selectedCustomerValue, setSelectedCustomerValue] = useState(NO_CUSTOMER_VALUE);
  const [customerName, setCustomerName] = useState("");
  const [contactName, setContactName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!(open && project)) {
      return;
    }

    if (project.customer) {
      setSelectedCustomerValue(String(project.customer._id));
      setFieldsFromCustomer(
        project.customer,
        setCustomerName,
        setContactName,
        setEmail,
        setPhone,
      );
      return;
    }

    setSelectedCustomerValue(CREATE_CUSTOMER_VALUE);
    setFieldsFromCustomer(undefined, setCustomerName, setContactName, setEmail, setPhone);
  }, [open, project]);

  const selectedExistingCustomer = useMemo(
    () =>
      customers.find((customer) => String(customer._id) === selectedCustomerValue) ??
      (project?.customer && String(project.customer._id) === selectedCustomerValue
        ? project.customer
        : undefined),
    [customers, project, selectedCustomerValue],
  );

  const handleCustomerSelectionChange = (value: string) => {
    setSelectedCustomerValue(value);

    if (value === NO_CUSTOMER_VALUE || value === CREATE_CUSTOMER_VALUE) {
      setFieldsFromCustomer(undefined, setCustomerName, setContactName, setEmail, setPhone);
      return;
    }

    const customer = customers.find((item) => String(item._id) === value);
    setFieldsFromCustomer(customer, setCustomerName, setContactName, setEmail, setPhone);
  };

  const handleSave = async () => {
    if (!project) {
      return;
    }

    setIsSaving(true);
    try {
      if (selectedCustomerValue === NO_CUSTOMER_VALUE) {
        await updateProject({
          projectId: project._id,
          customerId: null,
        });
        onSaved?.({ customerId: null });
        toast.success(t("app.projects.toasts.customerRemoved"));
        onOpenChange(false);
        return;
      }

      if (selectedCustomerValue === CREATE_CUSTOMER_VALUE) {
        const newCustomerId = await createCustomer({
          name: customerName,
          contactName,
          email,
          phone,
        });
        await updateProject({
          projectId: project._id,
          customerId: newCustomerId,
        });
        onSaved?.({
          customerId: newCustomerId,
          email: email.trim() || undefined,
        });
        toast.success(t("app.projects.toasts.customerCreatedAndLinked"));
        onOpenChange(false);
        return;
      }

      if (!selectedExistingCustomer) {
        toast.error(t("app.projects.toasts.customerSelectionRequired"));
        return;
      }

      await updateCustomer({
        customerId: selectedExistingCustomer._id,
        name: customerName,
        contactName: contactName || null,
        email: email || null,
        phone: phone || null,
      });

      if (project.customerId !== selectedExistingCustomer._id) {
        await updateProject({
          projectId: project._id,
          customerId: selectedExistingCustomer._id,
        });
      }

      onSaved?.({
        customerId: selectedExistingCustomer._id,
        email: email.trim() || undefined,
      });
      toast.success(t("app.customers.toasts.updated"));
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("app.projects.toasts.customerSaveFailed"));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {project?.name
              ? t("app.projects.customerDialog.titleNamed", {
                  projectName: project.name,
                })
              : t("app.projects.customerDialog.titleDefault")}
          </DialogTitle>
          <DialogDescription>{t("app.projects.customerDialog.description")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="project-customer-selection">
              {t("app.projects.customerDialog.recordLabel")}
            </Label>
            <NativeSelect
              id="project-customer-selection"
              className="w-full"
              value={selectedCustomerValue}
              onChange={(event) => handleCustomerSelectionChange(event.target.value)}
              disabled={isSaving}
            >
              <NativeSelectOption value={NO_CUSTOMER_VALUE}>
                {t("app.projects.customerDialog.noCustomerOption")}
              </NativeSelectOption>
              <NativeSelectOption value={CREATE_CUSTOMER_VALUE}>
                {t("app.projects.customerDialog.createNewCustomerOption")}
              </NativeSelectOption>
              {customers.map((customer) => (
                <NativeSelectOption key={customer._id} value={String(customer._id)}>
                  {customer.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>

          {selectedCustomerValue !== NO_CUSTOMER_VALUE ? (
            <CustomerFormFields
              idPrefix="project-customer"
              customerName={customerName}
              contactName={contactName}
              email={email}
              phone={phone}
              onCustomerNameChange={setCustomerName}
              onContactNameChange={setContactName}
              onEmailChange={setEmail}
              onPhoneChange={setPhone}
              disabled={isSaving}
            />
          ) : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            {t("common.actions.cancel")}
          </Button>
          <Button type="button" onClick={() => void handleSave()} disabled={isSaving}>
            {t("common.actions.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
