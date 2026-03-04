import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/app/organization")({
  beforeLoad: () => {
    throw redirect({ to: "/organization", replace: true });
  },
  component: () => null,
});

