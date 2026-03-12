import type { Id } from "@mvp-template/backend/convex/_generated/dataModel";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { useI18n } from "@/lib/i18n-provider";

type CustomerOption = {
  _id: Id<"customers">;
  name: string;
  contactName?: string;
};

type ProjectFormFieldsProps = {
  customerId: string;
  customers: CustomerOption[];
  disabled?: boolean;
  idPrefix: string;
  location: string;
  onCustomerIdChange: (value: string) => void;
  onLocationChange: (value: string) => void;
};

function buildCustomerLabel(customer: CustomerOption) {
  if (!customer.contactName) {
    return customer.name;
  }

  return `${customer.name} · ${customer.contactName}`;
}

export function ProjectFormFields({
  customerId,
  customers,
  disabled,
  idPrefix,
  location,
  onCustomerIdChange,
  onLocationChange,
}: ProjectFormFieldsProps) {
  const { t } = useI18n();

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-project-location`}>
          {t("app.projects.form.locationLabel")}
        </Label>
        <Input
          id={`${idPrefix}-project-location`}
          value={location}
          onChange={(event) => onLocationChange(event.target.value)}
          disabled={disabled}
          placeholder={t("app.projects.form.locationPlaceholder")}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-project-customer`}>
          {t("app.projects.form.customerLabel")}
        </Label>
        <NativeSelect
          id={`${idPrefix}-project-customer`}
          className="w-full"
          value={customerId}
          onChange={(event) => onCustomerIdChange(event.target.value)}
          disabled={disabled}
        >
          <NativeSelectOption value="">
            {t("app.projects.form.noCustomerOption")}
          </NativeSelectOption>
          {customers.map((customer) => (
            <NativeSelectOption key={customer._id} value={String(customer._id)}>
              {buildCustomerLabel(customer)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
    </div>
  );
}
