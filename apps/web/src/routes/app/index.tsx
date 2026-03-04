import { api } from "@mvp-template/backend/convex/_generated/api";
import {
  RiFlashlightLine,
  RiLock2Line,
  RiPulseLine,
} from "@remixicon/react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "convex/react";

export const Route = createFileRoute("/app/")({
  component: AppDashboardRoute,
});

function AppDashboardRoute() {
  const privateData = useQuery(api.privateData.get);
  const todayLabel = new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date());

  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-2xl border bg-card p-6 shadow-sm">
        <div className="pointer-events-none absolute -right-14 -top-14 size-40 rounded-full bg-primary/10 blur-3xl" />
        <div className="relative space-y-3">
          <p className="text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">
            Workspace overview
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">Dashboard</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            {privateData?.message ?? "Loading protected dashboard data..."}
          </p>
          <p className="text-xs text-muted-foreground">{todayLabel}</p>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <article className="rounded-xl border bg-card p-4 shadow-sm">
          <div className="mb-3 inline-flex rounded-lg bg-muted p-2">
            <RiLock2Line className="size-4" />
          </div>
          <h2 className="text-sm font-semibold">Access</h2>
          <p className="mt-1 text-sm text-muted-foreground">Private route enabled</p>
        </article>
        <article className="rounded-xl border bg-card p-4 shadow-sm">
          <div className="mb-3 inline-flex rounded-lg bg-muted p-2">
            <RiPulseLine className="size-4" />
          </div>
          <h2 className="text-sm font-semibold">Status</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Session and organization are active
          </p>
        </article>
        <article className="rounded-xl border bg-card p-4 shadow-sm">
          <div className="mb-3 inline-flex rounded-lg bg-muted p-2">
            <RiFlashlightLine className="size-4" />
          </div>
          <h2 className="text-sm font-semibold">Next step</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Invite members to start collaborating
          </p>
        </article>
      </section>
    </div>
  );
}
