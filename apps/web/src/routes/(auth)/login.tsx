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

export const Route = createFileRoute("/(auth)/login")({
  ssr: false,
  component: LoginRoute,
});

function LoginRoute() {
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

  return <LoginRouteContent />;
}

function LoginRouteContent() {
  const { t } = useI18n();
  const navigate = useNavigate({ from: "/login" });
  const search = useRouterState({
    select: (state) => state.location.search,
  });
  const emailInputRef = useRef<HTMLInputElement>(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const invitationId = useMemo(() => {
    const value = new URLSearchParams(search).get("invitationId");
    return value?.trim() ?? "";
  }, [search]);
  const invitationHref = invitationId
    ? `/invitation?invitationId=${encodeURIComponent(invitationId)}`
    : "";
  const signupHref = invitationId
    ? `/signup?invitationId=${encodeURIComponent(invitationId)}`
    : "/signup";
  const resetPasswordHref = invitationId
    ? `/reset-password?invitationId=${encodeURIComponent(invitationId)}`
    : "/reset-password";

  useEffect(() => {
    emailInputRef.current?.focus();
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();

    if (!normalizedEmail) {
      toast.error(t("auth.login.toasts.enterEmail"));
      return;
    }

    if (!password) {
      toast.error(t("auth.login.toasts.enterPassword"));
      return;
    }

    setIsSubmitting(true);
    try {
      const { error } = await authClient.signIn.email({
        email: normalizedEmail,
        password,
      });

      if (error) {
        toast.error(
          getLocalizedAuthErrorMessage(t, error, "auth.login.toasts.failedSignIn"),
        );
        return;
      }

      if (invitationHref) {
        window.location.replace(invitationHref);
        return;
      }

      navigate({ to: "/app/projects", replace: true });
    } catch (error) {
      toast.error(t("auth.login.toasts.failedSignIn"));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{t("auth.login.title")}</CardTitle>
          <CardDescription>{t("auth.login.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <Label htmlFor="email">{t("common.labels.email")}</Label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                ref={emailInputRef}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder={t("auth.login.emailPlaceholder")}
                disabled={isSubmitting}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">{t("common.labels.password")}</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={t("auth.login.passwordPlaceholder")}
                disabled={isSubmitting}
              />
            </div>

            <div className="flex items-center justify-end">
              <a
                href={resetPasswordHref}
                className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
              >
                {t("auth.login.forgotPassword")}
              </a>
            </div>

            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? t("common.state.signingIn") : t("auth.login.submit")}
            </Button>

            <p className="text-center text-sm text-muted-foreground">
              {t("auth.login.noAccount")}{" "}
              <a
                href={signupHref}
                className="underline underline-offset-4 hover:text-foreground"
              >
                {t("common.actions.createAccount")}
              </a>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
