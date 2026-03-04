import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";

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

export const Route = createFileRoute("/(auth)/onboarding")({
  ssr: false,
  component: OnboardingRoute,
});

function OnboardingRoute() {
  const { canRender } = useClientRouteGate("onboarding");

  if (!canRender) {
    return null;
  }

  return <OnboardingRouteContent />;
}

function OnboardingRouteContent() {
  const { t } = useI18n();
  const navigate = useNavigate({ from: "/onboarding" });
  const nameInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    nameInputRef.current?.focus();
  }, []);

  const handleSubmit = async () => {
    const trimmedName = name.trim();

    if (trimmedName.length < 2) {
      toast.error(t("auth.onboarding.toasts.nameMinLength"));
      return;
    }

    setIsSubmitting(true);
    try {
      const { error } = await authClient.updateUser({
        name: trimmedName,
      });

      if (error) {
        toast.error(
          getLocalizedAuthErrorMessage(
            t,
            error,
            "auth.onboarding.toasts.failedUpdateProfile",
          ),
        );
        return;
      }
      navigate({ to: "/organization", replace: true });
    } catch (error) {
      toast.error(t("auth.onboarding.toasts.failedUpdateProfile"));
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
          <CardTitle>{t("auth.onboarding.title")}</CardTitle>
          <CardDescription>{t("auth.onboarding.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleFormSubmit}>
            <div className="space-y-2">
              <Label htmlFor="name">{t("common.labels.name")}</Label>
              <Input
                id="name"
                name="name"
                autoComplete="name"
                ref={nameInputRef}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t("auth.onboarding.namePlaceholder")}
                disabled={isSubmitting}
              />
            </div>

            <Button
              type="submit"
              className="w-full"
              disabled={isSubmitting}
            >
              {isSubmitting ? t("common.state.saving") : t("common.actions.continue")}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
