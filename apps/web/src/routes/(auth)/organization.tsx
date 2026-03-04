import { createFileRoute, useNavigate } from "@tanstack/react-router";
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
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";
import { useClientRouteGate } from "@/lib/client-route-gates";

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
      toast.error("Organization name must be at least 2 characters");
      return;
    }

    if (!slug) {
      toast.error("Enter a valid organization name");
      return;
    }

    setIsSubmitting(true);
    try {
      const createResult = await authClient.organization.create({
        name: trimmedName,
        slug,
      });

      if (createResult.error) {
        toast.error(createResult.error.message ?? "Failed to create organization");
        return;
      }

      const created = createResult.data;

      if (created?.id) {
        const setActiveResult = await authClient.organization.setActive({
          organizationId: created.id,
        });

        if (setActiveResult.error) {
          toast.error(
            setActiveResult.error.message ??
              "Organization created, but setting active failed",
          );
          return;
        }
      }

      toast.success("Organization created");
      navigate({ to: "/app", replace: true });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to create organization";
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
          <CardTitle>Create Organization</CardTitle>
          <CardDescription>
            Enter your organization name to continue.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleFormSubmit}>
            <div className="space-y-2">
              <Label htmlFor="organization-name">Name</Label>
              <Input
                id="organization-name"
                name="organization"
                autoComplete="organization"
                ref={nameInputRef}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Acme Inc"
                disabled={isSubmitting}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="organization-slug">Slug</Label>
              <Input
                id="organization-slug"
                name="organization-slug"
                value={slug}
                readOnly
                disabled
                placeholder="acme-inc"
              />
            </div>

            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? "Creating..." : "Continue"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
