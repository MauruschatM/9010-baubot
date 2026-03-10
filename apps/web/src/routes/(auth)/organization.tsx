import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { toast } from "@/components/ui/sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";
import { getLocalizedAuthErrorMessage } from "@/lib/auth-error-i18n";
import { useClientRouteGate } from "@/lib/client-route-gates";
import { useI18n } from "@/lib/i18n-provider";

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

export const Route = createFileRoute("/(auth)/organization")({
  ssr: false,
  component: OrganizationSetupRoute,
});

function OrganizationSetupRoute() {
  const { canRender } = useClientRouteGate("organization");

  if (!canRender) {
    return null;
  }

  return <OrganizationSetupRouteContent />;
}

function OrganizationSetupRouteContent() {
  const { t } = useI18n();
  const navigate = useNavigate({ from: "/organization" });
  const nameInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const slug = useMemo(() => slugify(name), [name]);

  useEffect(() => {
    nameInputRef.current?.focus();
  }, []);

  const handleSubmit = async () => {
    const trimmedName = name.trim();

    if (trimmedName.length < 2) {
      toast.error(t("auth.organization.toasts.nameMinLength"));
      return;
    }

    if (!slug) {
      toast.error(t("auth.organization.toasts.invalidName"));
      return;
    }

    setIsSubmitting(true);
    try {
      const createResult = await authClient.organization.create({
        name: trimmedName,
        slug,
      });

      if (createResult.error) {
        toast.error(
          getLocalizedAuthErrorMessage(
            t,
            createResult.error,
            "auth.organization.toasts.failedCreate",
          ),
        );
        return;
      }

      const created = createResult.data;

      if (created?.id) {
        const setActiveResult = await authClient.organization.setActive({
          organizationId: created.id,
        });

        if (setActiveResult.error) {
          toast.error(
            getLocalizedAuthErrorMessage(
              t,
              setActiveResult.error,
              "auth.organization.toasts.createdButSetActiveFailed",
            ),
          );
          return;
        }
      }

      toast.success(t("auth.organization.toasts.created"));
      navigate({ to: "/app/projects", replace: true });
    } catch (error) {
      toast.error(t("auth.organization.toasts.failedCreate"));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleFormSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await handleSubmit();
  };

  return (
    <div className="flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{t("auth.organization.title")}</CardTitle>
          <CardDescription>
            {t("auth.organization.description")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleFormSubmit}>
            <div className="space-y-2">
              <Label htmlFor="organization-name">{t("common.labels.name")}</Label>
              <Input
                id="organization-name"
                name="organization"
                autoComplete="organization"
                ref={nameInputRef}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t("auth.organization.namePlaceholder")}
                disabled={isSubmitting}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="organization-slug">{t("common.labels.slug")}</Label>
              <Input
                id="organization-slug"
                name="organization-slug"
                value={slug}
                readOnly
                disabled
                placeholder={t("auth.organization.slugPlaceholder")}
              />
            </div>

            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? t("common.state.creating") : t("common.actions.continue")}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
