import { api } from "@mvp-template/backend/convex/_generated/api";
import { useQuery } from "convex/react";

export function useCurrentOrganizationState() {
  const routeGateState = useQuery(api.auth.getRouteGateState);

  return {
    activeMember: routeGateState?.activeMember ?? null,
    activeOrganization: routeGateState?.activeOrganization ?? null,
    isPending: routeGateState === undefined,
    organizations: routeGateState?.organizations ?? [],
    routeGateState,
  };
}
