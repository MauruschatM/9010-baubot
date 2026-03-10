import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/lib/i18n-provider";

type CustomerFormFieldsProps = {
  contactName: string;
  customerName: string;
  disabled?: boolean;
  email: string;
  idPrefix: string;
  phone: string;
  onContactNameChange: (value: string) => void;
  onCustomerNameChange: (value: string) => void;
  onEmailChange: (value: string) => void;
  onPhoneChange: (value: string) => void;
};

export function CustomerFormFields({
  contactName,
  customerName,
  disabled,
  email,
  idPrefix,
  phone,
  onContactNameChange,
  onCustomerNameChange,
  onEmailChange,
  onPhoneChange,
}: CustomerFormFieldsProps) {
  const { t } = useI18n();

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-customer-name`}>
          {t("app.customers.form.customerNameLabel")}
        </Label>
        <Input
          id={`${idPrefix}-customer-name`}
          value={customerName}
          onChange={(event) => onCustomerNameChange(event.target.value)}
          disabled={disabled}
          placeholder={t("app.customers.form.customerNamePlaceholder")}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-customer-contact`}>
          {t("app.customers.form.contactPersonLabel")}
        </Label>
        <Input
          id={`${idPrefix}-customer-contact`}
          value={contactName}
          onChange={(event) => onContactNameChange(event.target.value)}
          disabled={disabled}
          placeholder={t("app.customers.form.contactPersonPlaceholder")}
        />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-customer-email`}>{t("common.labels.email")}</Label>
          <Input
            id={`${idPrefix}-customer-email`}
            type="email"
            value={email}
            onChange={(event) => onEmailChange(event.target.value)}
            disabled={disabled}
            placeholder="jane@example.com"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-customer-phone`}>
            {t("app.customers.form.phoneLabel")}
          </Label>
          <Input
            id={`${idPrefix}-customer-phone`}
            value={phone}
            onChange={(event) => onPhoneChange(event.target.value)}
            disabled={disabled}
            placeholder={t("app.customers.form.phonePlaceholder")}
          />
        </div>
      </div>
    </div>
  );
}
