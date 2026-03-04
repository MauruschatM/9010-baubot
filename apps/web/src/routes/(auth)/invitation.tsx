import {
  createFileRoute,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { authClient } from "@/lib/auth-client";

type InvitationDetails = {
  id: string;
  email: string;
  role: string | string[];
  organizationName?: string;
  inviterEmail?: string;
};

export const Route = createFileRoute("/(auth)/invitation")({
  ssr: false,
  component: InvitationRoute,
});

function InvitationRoute() {
  const navigate = useNavigate({ from: "/invitation" });
  const search = useRouterState({
    select: (state) => state.location.search,
  });
  const invitationId = useMemo(() => {
    const value = new URLSearchParams(search).get("invitationId");
    return value?.trim() ?? "";
  }, [search]);
  const loginHref = invitationId
    ? `/login?invitationId=${encodeURIComponent(invitationId)}`
    : "/login";

  const { data: session, isPending: isSessionPending } = authClient.useSession();
  const [invitation, setInvitation] = useState<InvitationDetails | null>(null);
  const [isLoadingInvitation, setIsLoadingInvitation] = useState(false);
  const [isAcceptingInvitation, setIsAcceptingInvitation] = useState(false);
  const [isRejectingInvitation, setIsRejectingInvitation] = useState(false);

  useEffect(() => {
    if (!session || !invitationId) {
      setInvitation(null);
      return;
    }

    let cancelled = false;

    const loadInvitation = async () => {
      setIsLoadingInvitation(true);
      try {
        const { data, error } = await authClient.organization.getInvitation({
          query: {
            id: invitationId,
          },
        });

        if (cancelled) {
          return;
        }

        if (error) {
          toast.error(error.message ?? "Invitation not found or expired");
          setInvitation(null);
          return;
        }

        setInvitation(data as InvitationDetails);
      } catch (error) {
        if (cancelled) {
          return;
        }

        const message =
          error instanceof Error ? error.message : "Failed to load invitation";
        toast.error(message);
        setInvitation(null);
      } finally {
        if (!cancelled) {
          setIsLoadingInvitation(false);
        }
      }
    };

    void loadInvitation();

    return () => {
      cancelled = true;
    };
  }, [invitationId, session]);

  const handleAcceptInvitation = async () => {
    if (!invitationId) {
      toast.error("Invitation link is missing an invitation ID");
      return;
    }

    setIsAcceptingInvitation(true);
    try {
      const { error } = await authClient.organization.acceptInvitation({
        invitationId,
      });

      if (error) {
        toast.error(error.message ?? "Failed to accept invitation");
        return;
      }

      toast.success("Invitation accepted");
      navigate({ to: "/app", replace: true });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to accept invitation";
      toast.error(message);
    } finally {
      setIsAcceptingInvitation(false);
    }
  };

  const handleRejectInvitation = async () => {
    if (!invitationId) {
      toast.error("Invitation link is missing an invitation ID");
      return;
    }

    setIsRejectingInvitation(true);
    try {
      const { error } = await authClient.organization.rejectInvitation({
        invitationId,
      });

      if (error) {
        toast.error(error.message ?? "Failed to reject invitation");
        return;
      }

      toast.success("Invitation declined");
      navigate({ to: "/app", replace: true });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to reject invitation";
      toast.error(message);
    } finally {
      setIsRejectingInvitation(false);
    }
  };

  if (!invitationId) {
    return (
      <div className="flex min-h-svh items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Invalid Invitation Link</CardTitle>
            <CardDescription>
              This invitation link is missing an invitation ID.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              className="w-full"
              type="button"
              onClick={() => window.location.assign("/login")}
            >
              Go to login
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isSessionPending) {
    return (
      <div className="flex min-h-svh items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Loading Invitation</CardTitle>
            <CardDescription>Checking your session...</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex min-h-svh items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Sign in to Continue</CardTitle>
            <CardDescription>
              Sign in first, then return to this page to accept or decline the
              invitation.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              className="w-full"
              type="button"
              onClick={() => window.location.assign(loginHref)}
            >
              Go to login
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Organization Invitation</CardTitle>
          <CardDescription>
            Review this invitation and choose whether to join.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoadingInvitation ? (
            <p className="text-sm text-muted-foreground">Loading invitation...</p>
          ) : invitation ? (
            <div className="space-y-2 rounded-md border p-3">
              <p className="text-sm">
                <span className="font-medium">Organization:</span>{" "}
                {invitation.organizationName ?? "Unknown"}
              </p>
              <p className="text-sm">
                <span className="font-medium">Role:</span>{" "}
                {Array.isArray(invitation.role)
                  ? invitation.role.join(", ")
                  : invitation.role}
              </p>
              <p className="text-sm">
                <span className="font-medium">Invited email:</span>{" "}
                {invitation.email}
              </p>
              {invitation.inviterEmail ? (
                <p className="text-sm">
                  <span className="font-medium">Invited by:</span>{" "}
                  {invitation.inviterEmail}
                </p>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              This invitation may be invalid, expired, or no longer pending.
            </p>
          )}

          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() => void handleRejectInvitation()}
              disabled={
                isLoadingInvitation ||
                !invitation ||
                isAcceptingInvitation ||
                isRejectingInvitation
              }
            >
              {isRejectingInvitation ? "Declining..." : "Decline"}
            </Button>
            <Button
              type="button"
              className="flex-1"
              onClick={() => void handleAcceptInvitation()}
              disabled={
                isLoadingInvitation ||
                !invitation ||
                isAcceptingInvitation ||
                isRejectingInvitation
              }
            >
              {isAcceptingInvitation ? "Accepting..." : "Accept"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
