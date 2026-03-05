import {
  createFileRoute,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "@/components/ui/sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { authClient } from "@/lib/auth-client";
import { getLocalizedAuthErrorMessage } from "@/lib/auth-error-i18n";
import { useI18n } from "@/lib/i18n-provider";

type InvitationDetails = {
  id: string;
  email: string;
  role: string | string[];
  organizationName?: string;
  inviterEmail?: string;
};

type MemberRole = "owner" | "admin" | "member";

function isMemberRole(role: string): role is MemberRole {
  return role === "owner" || role === "admin" || role === "member";
}

function formatInvitationRoleLabel(
  role: string | string[],
  t: (key: string) => string,
) {
  const localizeRole = (value: string) => {
    const normalized = value.trim().toLowerCase();
    if (!isMemberRole(normalized)) {
      return value;
    }

    return t(`common.roles.${normalized}`);
  };

  if (Array.isArray(role)) {
    return role.map((value) => localizeRole(value)).join(", ");
  }

  return localizeRole(role);
}

export const Route = createFileRoute("/(auth)/invitation")({
  ssr: false,
  component: InvitationRoute,
});

function InvitationRoute() {
  const { t } = useI18n();
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
          toast.error(
            getLocalizedAuthErrorMessage(
              t,
              error,
              "auth.invitation.toasts.invitationNotFoundOrExpired",
            ),
          );
          setInvitation(null);
          return;
        }

        setInvitation(data as InvitationDetails);
      } catch (error) {
        if (cancelled) {
          return;
        }

        toast.error(t("auth.invitation.toasts.failedLoadInvitation"));
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
      toast.error(t("auth.invitation.toasts.missingInvitationId"));
      return;
    }

    setIsAcceptingInvitation(true);
    try {
      const { error } = await authClient.organization.acceptInvitation({
        invitationId,
      });

      if (error) {
        toast.error(
          getLocalizedAuthErrorMessage(
            t,
            error,
            "auth.invitation.toasts.failedAcceptInvitation",
          ),
        );
        return;
      }

      toast.success(t("auth.invitation.toasts.invitationAccepted"));
      navigate({ to: "/app", replace: true });
    } catch (error) {
      toast.error(t("auth.invitation.toasts.failedAcceptInvitation"));
    } finally {
      setIsAcceptingInvitation(false);
    }
  };

  const handleRejectInvitation = async () => {
    if (!invitationId) {
      toast.error(t("auth.invitation.toasts.missingInvitationId"));
      return;
    }

    setIsRejectingInvitation(true);
    try {
      const { error } = await authClient.organization.rejectInvitation({
        invitationId,
      });

      if (error) {
        toast.error(
          getLocalizedAuthErrorMessage(
            t,
            error,
            "auth.invitation.toasts.failedRejectInvitation",
          ),
        );
        return;
      }

      toast.success(t("auth.invitation.toasts.invitationDeclined"));
      navigate({ to: "/app", replace: true });
    } catch (error) {
      toast.error(t("auth.invitation.toasts.failedRejectInvitation"));
    } finally {
      setIsRejectingInvitation(false);
    }
  };

  if (!invitationId) {
    return (
      <div className="flex min-h-svh items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>{t("auth.invitation.invalidLinkTitle")}</CardTitle>
            <CardDescription>
              {t("auth.invitation.invalidLinkDescription")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              className="w-full"
              type="button"
              onClick={() => window.location.assign("/login")}
            >
              {t("common.actions.goToLogin")}
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
            <CardTitle>{t("auth.invitation.loadingTitle")}</CardTitle>
            <CardDescription>{t("auth.invitation.loadingDescription")}</CardDescription>
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
            <CardTitle>{t("auth.invitation.signInTitle")}</CardTitle>
            <CardDescription>
              {t("auth.invitation.signInDescription")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              className="w-full"
              type="button"
              onClick={() => window.location.assign(loginHref)}
            >
              {t("common.actions.goToLogin")}
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
          <CardTitle>{t("auth.invitation.title")}</CardTitle>
          <CardDescription>
            {t("auth.invitation.description")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoadingInvitation ? (
            <p className="text-sm text-muted-foreground">
              {t("auth.invitation.loadingInvitation")}
            </p>
          ) : invitation ? (
            <div className="space-y-2 rounded-md border p-3">
              <p className="text-sm">
                <span className="font-medium">{t("common.labels.organization")}:</span>{" "}
                {invitation.organizationName ?? t("common.misc.unknown")}
              </p>
              <p className="text-sm">
                <span className="font-medium">{t("common.labels.role")}:</span>{" "}
                {formatInvitationRoleLabel(invitation.role, t)}
              </p>
              <p className="text-sm">
                <span className="font-medium">{t("common.labels.invitedEmail")}:</span>{" "}
                {invitation.email}
              </p>
              {invitation.inviterEmail ? (
                <p className="text-sm">
                  <span className="font-medium">{t("common.labels.invitedBy")}:</span>{" "}
                  {invitation.inviterEmail}
                </p>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {t("auth.invitation.invitationMayBeInvalid")}
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
              {isRejectingInvitation ? t("common.state.declining") : t("common.actions.decline")}
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
              {isAcceptingInvitation ? t("common.state.accepting") : t("common.actions.accept")}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
