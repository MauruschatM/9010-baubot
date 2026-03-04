import {
  createFileRoute,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
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
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
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
  const { canRender } = useClientRouteGate("login");

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
  const lastAutoSubmittedOtpRef = useRef<string | null>(null);

  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const invitationId = useMemo(() => {
    const value = new URLSearchParams(search).get("invitationId");
    return value?.trim() ?? "";
  }, [search]);

  const focusOtpInput = () => {
    if (typeof document === "undefined") {
      return;
    }

    const otpInput =
      (document.getElementById("otp") as HTMLInputElement | null) ??
      document.querySelector<HTMLInputElement>('input[name="one-time-code"]');

    otpInput?.focus();
  };

  const handleSendOtp = async () => {
    const normalizedEmail = email.trim().toLowerCase();

    if (!normalizedEmail) {
      toast.error(t("auth.login.toasts.enterEmail"));
      return;
    }

    setIsSending(true);
    try {
      const { error } = await authClient.emailOtp.sendVerificationOtp({
        email: normalizedEmail,
        type: "sign-in",
      });

      if (error) {
        toast.error(getLocalizedAuthErrorMessage(t, error, "auth.login.toasts.failedSendCode"));
        return;
      }

      setOtp("");
      lastAutoSubmittedOtpRef.current = null;
      setOtpSent(true);
      focusOtpInput();
      toast.success(t("auth.login.toasts.codeSent"));
    } catch (error) {
      toast.error(t("auth.login.toasts.failedSendCode"));
    } finally {
      setIsSending(false);
    }
  };

  const handleContinue = async (otpValue = otp) => {
    const normalizedEmail = email.trim().toLowerCase();

    if (!normalizedEmail) {
      toast.error(t("auth.login.toasts.enterEmail"));
      return;
    }

    if (otpValue.length !== 6) {
      toast.error(t("auth.login.toasts.enterSixDigitCode"));
      return;
    }

    setIsSubmitting(true);
    try {
      const { error } = await authClient.signIn.emailOtp({
        email: normalizedEmail,
        otp: otpValue,
      });

      if (error) {
        toast.error(getLocalizedAuthErrorMessage(t, error, "auth.login.toasts.invalidCode"));
        return;
      }

      if (invitationId) {
        window.location.replace(
          `/invitation?invitationId=${encodeURIComponent(invitationId)}`,
        );
        return;
      }

      navigate({ to: "/onboarding", replace: true });
    } catch (error) {
      toast.error(t("auth.login.toasts.failedVerifyCode"));
    } finally {
      setIsSubmitting(false);
    }
  };

  useEffect(() => {
    if (otpSent) {
      return;
    }

    emailInputRef.current?.focus();
  }, [otpSent]);

  useEffect(() => {
    if (!otpSent) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      focusOtpInput();
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [otpSent]);

  useEffect(() => {
    if (!otpSent) {
      lastAutoSubmittedOtpRef.current = null;
      return;
    }

    if (otp.length !== 6 || isSending || isSubmitting) {
      return;
    }

    if (lastAutoSubmittedOtpRef.current === otp) {
      return;
    }

    lastAutoSubmittedOtpRef.current = otp;
    void handleContinue(otp);
  }, [otp, otpSent, isSending, isSubmitting]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (otpSent) {
      await handleContinue();
      return;
    }

    await handleSendOtp();
  };

  return (
    <div className="flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{t("auth.login.title")}</CardTitle>
          <CardDescription>
            {t("auth.login.description")}
          </CardDescription>
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
                disabled={isSending || isSubmitting}
              />
            </div>

            {otpSent ? (
              <div className="space-y-2">
                <Label htmlFor="otp">{t("common.labels.verificationCode")}</Label>
                <InputOTP
                  id="otp"
                  name="one-time-code"
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  maxLength={6}
                  value={otp}
                  onChange={setOtp}
                  disabled={isSubmitting}
                >
                  <InputOTPGroup>
                    <InputOTPSlot index={0} />
                    <InputOTPSlot index={1} />
                    <InputOTPSlot index={2} />
                    <InputOTPSlot index={3} />
                    <InputOTPSlot index={4} />
                    <InputOTPSlot index={5} />
                  </InputOTPGroup>
                </InputOTP>
              </div>
            ) : null}

            <div className="space-y-2">
              {!otpSent ? (
                <Button
                  type="submit"
                  className="w-full"
                  disabled={isSending || isSubmitting}
                >
                  {isSending ? t("common.state.sending") : t("common.actions.sendCode")}
                </Button>
              ) : (
                <>
                  <Button
                    type="submit"
                    className="w-full"
                    disabled={isSending || isSubmitting}
                  >
                    {isSubmitting ? t("common.state.verifying") : t("common.actions.continue")}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="w-full"
                    onClick={handleSendOtp}
                    disabled={isSending || isSubmitting}
                  >
                    {isSending ? t("common.state.sending") : t("common.actions.resendCode")}
                  </Button>
                </>
              )}
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
