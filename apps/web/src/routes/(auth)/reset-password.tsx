import { createFileRoute, useRouterState } from "@tanstack/react-router";
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
import { useI18n } from "@/lib/i18n-provider";

export const Route = createFileRoute("/(auth)/reset-password")({
  ssr: false,
  component: ResetPasswordRoute,
});

function ResetPasswordRoute() {
  const { t } = useI18n();
  const search = useRouterState({
    select: (state) => state.location.search,
  });
  const emailInputRef = useRef<HTMLInputElement>(null);
  const passwordInputRef = useRef<HTMLInputElement>(null);

  const [email, setEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const params = useMemo(() => new URLSearchParams(search), [search]);
  const token = params.get("token")?.trim() ?? "";
  const errorCode = params.get("error")?.trim() ?? "";
  const invitationId = params.get("invitationId")?.trim() ?? "";
  const loginHref = invitationId
    ? `/login?invitationId=${encodeURIComponent(invitationId)}`
    : "/login";
  const hasToken = token.length > 0;

  useEffect(() => {
    if (hasToken) {
      passwordInputRef.current?.focus();
      return;
    }

    emailInputRef.current?.focus();
  }, [hasToken]);

  useEffect(() => {
    if (!errorCode) {
      return;
    }

    toast.error(
      getLocalizedAuthErrorMessage(t, { code: errorCode }, "auth.resetPassword.toasts.invalidLink"),
    );
  }, [errorCode, t]);

  const handleRequestReset = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();

    if (!normalizedEmail) {
      toast.error(t("auth.resetPassword.toasts.enterEmail"));
      return;
    }

    setIsSubmitting(true);
    try {
      const redirectTo = new URL("/reset-password", window.location.origin);
      if (invitationId) {
        redirectTo.searchParams.set("invitationId", invitationId);
      }

      const { error } = await authClient.requestPasswordReset({
        email: normalizedEmail,
        redirectTo: redirectTo.toString(),
      });

      if (error) {
        toast.error(
          getLocalizedAuthErrorMessage(
            t,
            error,
            "auth.resetPassword.toasts.failedSendResetLink",
          ),
        );
        return;
      }

      toast.success(t("auth.resetPassword.toasts.resetLinkSent"));
    } catch (error) {
      toast.error(t("auth.resetPassword.toasts.failedSendResetLink"));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResetPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!newPassword) {
      toast.error(t("auth.resetPassword.toasts.enterNewPassword"));
      return;
    }

    if (newPassword !== confirmPassword) {
      toast.error(t("auth.resetPassword.toasts.passwordsDoNotMatch"));
      return;
    }

    setIsSubmitting(true);
    try {
      const { error } = await authClient.resetPassword({
        token,
        newPassword,
      });

      if (error) {
        toast.error(
          getLocalizedAuthErrorMessage(
            t,
            error,
            "auth.resetPassword.toasts.failedResetPassword",
          ),
        );
        return;
      }

      toast.success(t("auth.resetPassword.toasts.passwordReset"));
      window.location.replace(loginHref);
    } catch (error) {
      toast.error(t("auth.resetPassword.toasts.failedResetPassword"));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>
            {hasToken ? t("auth.resetPassword.setTitle") : t("auth.resetPassword.requestTitle")}
          </CardTitle>
          <CardDescription>
            {hasToken
              ? t("auth.resetPassword.setDescription")
              : t("auth.resetPassword.requestDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {hasToken ? (
            <form className="space-y-4" onSubmit={handleResetPassword}>
              <div className="space-y-2">
                <Label htmlFor="new-password">{t("common.labels.newPassword")}</Label>
                <Input
                  id="new-password"
                  name="new-password"
                  ref={passwordInputRef}
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  placeholder={t("auth.resetPassword.newPasswordPlaceholder")}
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
                  placeholder={t("auth.resetPassword.confirmPasswordPlaceholder")}
                  disabled={isSubmitting}
                />
              </div>

              <Button type="submit" className="w-full" disabled={isSubmitting}>
                {isSubmitting
                  ? t("common.state.saving")
                  : t("auth.resetPassword.resetSubmit")}
              </Button>
            </form>
          ) : (
            <form className="space-y-4" onSubmit={handleRequestReset}>
              <div className="space-y-2">
                <Label htmlFor="email">{t("common.labels.email")}</Label>
                <Input
                  id="email"
                  name="email"
                  ref={emailInputRef}
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder={t("auth.resetPassword.emailPlaceholder")}
                  disabled={isSubmitting}
                />
              </div>

              <Button type="submit" className="w-full" disabled={isSubmitting}>
                {isSubmitting
                  ? t("common.state.sending")
                  : t("common.actions.sendResetLink")}
              </Button>
            </form>
          )}

          <p className="mt-4 text-center text-sm text-muted-foreground">
            <a
              href={loginHref}
              className="underline underline-offset-4 hover:text-foreground"
            >
              {t("common.actions.backToLogin")}
            </a>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
