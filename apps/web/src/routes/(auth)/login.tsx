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
import { useClientRouteGate } from "@/lib/client-route-gates";

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
      toast.error("Enter your email address");
      return;
    }

    setIsSending(true);
    try {
      const { error } = await authClient.emailOtp.sendVerificationOtp({
        email: normalizedEmail,
        type: "sign-in",
      });

      if (error) {
        toast.error(error.message ?? "Failed to send code");
        return;
      }

      setOtp("");
      lastAutoSubmittedOtpRef.current = null;
      setOtpSent(true);
      focusOtpInput();
      toast.success("Verification code sent");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to send code";
      toast.error(message);
    } finally {
      setIsSending(false);
    }
  };

  const handleContinue = async (otpValue = otp) => {
    const normalizedEmail = email.trim().toLowerCase();

    if (!normalizedEmail) {
      toast.error("Enter your email address");
      return;
    }

    if (otpValue.length !== 6) {
      toast.error("Enter the 6-digit code");
      return;
    }

    setIsSubmitting(true);
    try {
      const { error } = await authClient.signIn.emailOtp({
        email: normalizedEmail,
        otp: otpValue,
      });

      if (error) {
        toast.error(error.message ?? "Invalid code");
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
      const message =
        error instanceof Error ? error.message : "Failed to verify code";
      toast.error(message);
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
          <CardTitle>Login</CardTitle>
          <CardDescription>
            Use your email and one-time code. New users are created automatically.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                ref={emailInputRef}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                disabled={isSending || isSubmitting}
              />
            </div>

            {otpSent ? (
              <div className="space-y-2">
                <Label htmlFor="otp">Verification code</Label>
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
                  {isSending ? "Sending..." : "Send Code"}
                </Button>
              ) : (
                <>
                  <Button
                    type="submit"
                    className="w-full"
                    disabled={isSending || isSubmitting}
                  >
                    {isSubmitting ? "Verifying..." : "Continue"}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="w-full"
                    onClick={handleSendOtp}
                    disabled={isSending || isSubmitting}
                  >
                    {isSending ? "Sending..." : "Resend Code"}
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
