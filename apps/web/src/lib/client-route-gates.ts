import { api } from "@mvp-template/backend/convex/_generated/api";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { useEffect, useMemo, useRef } from "react";

import { authClient } from "@/lib/auth-client";

export type RouteGateMode = "app" | "login" | "onboarding" | "organization";

type UseClientRouteGateOptions = {
  authenticatedRedirectTo?: string | null;
};

type ClientRouteGateState = {
  isAuthenticated: boolean;
  hasActiveOrganization: boolean;
  hasName: boolean;
  hasOrganization: boolean;
  organizationCount: number;
  userId: string | null;
};

const DEFAULT_APP_ROUTE = "/app/projects";

function normalizePathname(pathname: string) {
  if (pathname === "/") {
    return pathname;
  }

  return pathname.replace(/\/+$/, "");
}

function getRedirectTarget(
  mode: RouteGateMode,
  gateState: ClientRouteGateState,
): string | null {
  if (mode === "app") {
    if (!gateState.isAuthenticated) {
      return "/login";
    }

    if (!gateState.hasName) {
      return "/onboarding";
    }

    if (!gateState.hasOrganization) {
      return "/organization";
    }

    return null;
  }

  if (mode === "login") {
    if (!gateState.isAuthenticated) {
      return null;
    }

    if (!gateState.hasName) {
      return "/onboarding";
    }

    if (!gateState.hasOrganization) {
      return "/organization";
    }

    return DEFAULT_APP_ROUTE;
  }

  if (mode === "onboarding") {
    if (!gateState.isAuthenticated) {
      return "/login";
    }

    if (gateState.hasName && gateState.hasOrganization) {
      return DEFAULT_APP_ROUTE;
    }

    if (gateState.hasName && !gateState.hasOrganization) {
      return "/organization";
    }

    return null;
  }

  if (!gateState.isAuthenticated) {
    return "/login";
  }

  if (!gateState.hasName) {
    return "/onboarding";
  }

  if (gateState.hasOrganization) {
    return DEFAULT_APP_ROUTE;
  }

  return null;
}

export function useClientRouteGate(
  mode: RouteGateMode,
  options?: UseClientRouteGateOptions,
) {
  const navigate = useNavigate();
  const pathname = useRouterState({
    select: (state) => normalizePathname(state.location.pathname),
  });

  const { data: sessionData, isPending: isSessionPending } = authClient.useSession();
  const gateState = useQuery(api.auth.getRouteGateState);
  const isAuthenticated = Boolean(sessionData);
  const sessionUserId = sessionData?.user.id ?? null;
  const hasResolvedSignedOutSessionRef = useRef(false);
  const isWaitingForConvexSession =
    isAuthenticated &&
    (!gateState?.isAuthenticated || gateState.userId !== sessionUserId);

  useEffect(() => {
    if (isSessionPending) {
      return;
    }

    hasResolvedSignedOutSessionRef.current = !isAuthenticated;
  }, [isAuthenticated, isSessionPending]);

  const normalizedGateState = useMemo(() => {
    if (isWaitingForConvexSession || !(gateState && isAuthenticated)) {
      return null;
    }

    return {
      ...gateState,
      isAuthenticated: true,
    } satisfies ClientRouteGateState;
  }, [gateState, isAuthenticated, isWaitingForConvexSession]);

  const isWaitingForActiveOrganization = Boolean(
    normalizedGateState?.hasOrganization && !normalizedGateState.hasActiveOrganization,
  );

  const redirectTo = useMemo(() => {
    if (isSessionPending || isWaitingForConvexSession || isWaitingForActiveOrganization) {
      return null;
    }

    if (!isAuthenticated) {
      if (mode === "login") {
        return null;
      }

      return "/login";
    }

    if (!normalizedGateState) {
      return null;
    }

    if (options?.authenticatedRedirectTo) {
      return options.authenticatedRedirectTo;
    }

    return getRedirectTarget(mode, normalizedGateState);
  }, [
    isAuthenticated,
    isSessionPending,
    isWaitingForActiveOrganization,
    isWaitingForConvexSession,
    mode,
    normalizedGateState,
    options?.authenticatedRedirectTo,
  ]);

  useEffect(() => {
    if (isSessionPending || !redirectTo) {
      return;
    }

    if (pathname === redirectTo) {
      return;
    }

    void navigate({ to: redirectTo, replace: true });
  }, [isSessionPending, navigate, pathname, redirectTo]);

  const canKeepLoginRouteMounted =
    mode === "login" &&
    isSessionPending &&
    hasResolvedSignedOutSessionRef.current;

  if (isSessionPending) {
    return {
      canRender: canKeepLoginRouteMounted,
    };
  }

  if (!isAuthenticated && mode === "login") {
    return {
      canRender: true,
    };
  }

  if (!isAuthenticated) {
    return {
      canRender: false,
    };
  }

  if (!normalizedGateState) {
    return {
      canRender: false,
    };
  }

  if (isWaitingForActiveOrganization) {
    return {
      canRender: false,
    };
  }

  return {
    canRender: redirectTo === null,
  };
}
