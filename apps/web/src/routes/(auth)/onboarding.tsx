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
import { useClientRouteGate } from "@/lib/client-route-gates";

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
      toast.error("Name must be at least 2 characters");
      return;
    }

    setIsSubmitting(true);
    try {
      const { error } = await authClient.updateUser({
        name: trimmedName,
      });

      if (error) {
        toast.error(error.message ?? "Failed to update profile");
        return;
      }
      navigate({ to: "/organization", replace: true });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to update profile";
      toast.error(message);
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
          <CardTitle>Welcome</CardTitle>
          <CardDescription>Set your display name to finish setup.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleFormSubmit}>
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                name="name"
                autoComplete="name"
                ref={nameInputRef}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Your name"
                disabled={isSubmitting}
              />
            </div>

            <Button
              type="submit"
              className="w-full"
              disabled={isSubmitting}
            >
              {isSubmitting ? "Saving..." : "Continue"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
