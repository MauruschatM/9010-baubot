import {
  createFileRoute,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
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

export const Route = createFileRoute("/(auth)/signup")({
  ssr: false,
  component: SignUpRoute,
});

function SignUpRoute() {
  const search = useRouterState({
    select: (state) => state.location.search,
  });
  const invitationId = useMemo(() => {
    const value = new URLSearchParams(search).get("invitationId");
    return value?.trim() ?? "";
  }, [search]);
  const invitationHref = invitationId
    ? `/invitation?invitationId=${encodeURIComponent(invitationId)}`
    : null;
  const { canRender } = useClientRouteGate("login", {
    authenticatedRedirectTo: invitationHref,
  });

  if (!canRender) {
    return null;
  }

  return <SignUpRouteContent />;
}

function SignUpRouteContent() {
  const { t } = useI18n();
  const navigate = useNavigate({ from: "/signup" });
  const search = useRouterState({
    select: (state) => state.location.search,
  });
  const nameInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const invitationId = useMemo(() => {
    const value = new URLSearchParams(search).get("invitationId");
    return value?.trim() ?? "";
  }, [search]);
  const invitationHref = invitationId
    ? `/invitation?invitationId=${encodeURIComponent(invitationId)}`
    : "";
  const loginHref = invitationId
    ? `/login?invitationId=${encodeURIComponent(invitationId)}`
    : "/login";

  useEffect(() => {
    nameInputRef.current?.focus();
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedName = name.trim();
    const normalizedEmail = email.trim().toLowerCase();

    if (!normalizedName) {
      toast.error(t("auth.signup.toasts.enterName"));
      return;
    }

    if (!normalizedEmail) {
      toast.error(t("auth.signup.toasts.enterEmail"));
      return;
    }

    if (!password) {
      toast.error(t("auth.signup.toasts.enterPassword"));
      return;
    }

    if (password !== confirmPassword) {
      toast.error(t("auth.signup.toasts.passwordsDoNotMatch"));
      return;
    }

    setIsSubmitting(true);
    try {
      const { error } = await authClient.signUp.email({
        name: normalizedName,
        email: normalizedEmail,
        password,
      });

      if (error) {
        toast.error(
          getLocalizedAuthErrorMessage(t, error, "auth.signup.toasts.failedSignUp"),
        );
        return;
      }

      if (invitationHref) {
        window.location.replace(invitationHref);
        return;
      }

      navigate({ to: "/app/projects", replace: true });
    } catch (error) {
      toast.error(t("auth.signup.toasts.failedSignUp"));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{t("auth.signup.title")}</CardTitle>
          <CardDescription>{t("auth.signup.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <Label htmlFor="name">{t("common.labels.name")}</Label>
              <Input
                id="name"
                name="name"
                ref={nameInputRef}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t("auth.signup.namePlaceholder")}
                disabled={isSubmitting}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">{t("common.labels.email")}</Label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder={t("auth.signup.emailPlaceholder")}
                disabled={isSubmitting}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">{t("common.labels.password")}</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={t("auth.signup.passwordPlaceholder")}
                disabled={isSubmitting}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirm-password">
                {t("common.labels.confirmPassword")}
              </Label>
              <Input
                id="confirm-password"
                name="confirm-password"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder={t("auth.signup.confirmPasswordPlaceholder")}
                disabled={isSubmitting}
              />
            </div>

            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? t("common.state.signingUp") : t("auth.signup.submit")}
            </Button>

            <p className="text-center text-sm text-muted-foreground">
              {t("auth.signup.hasAccount")}{" "}
              <a
                href={loginHref}
                className="underline underline-offset-4 hover:text-foreground"
              >
                {t("common.actions.goToLogin")}
              </a>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
