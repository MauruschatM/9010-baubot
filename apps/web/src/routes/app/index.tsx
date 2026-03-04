import { api } from "@mvp-template/backend/convex/_generated/api";
import {
  RiFlashlightLine,
  RiLock2Line,
  RiPulseLine,
} from "@remixicon/react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "convex/react";

import { useI18n } from "@/lib/i18n-provider";

export const Route = createFileRoute("/app/")({
  component: AppDashboardRoute,
});

function AppDashboardRoute() {
  const { locale, t } = useI18n();
  const privateData = useQuery(api.privateData.get);
  const todayLabel = new Intl.DateTimeFormat(locale, {
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
            {t("app.dashboard.eyebrow")}
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">{t("app.dashboard.title")}</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            {privateData
              ? privateData.isAuthenticated
                ? t("app.dashboard.privateDataAuthenticated")
                : t("app.dashboard.privateDataUnauthenticated")
              : t("app.dashboard.privateLoading")}
          </p>
          <p className="text-xs text-muted-foreground">{todayLabel}</p>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <article className="rounded-xl border bg-card p-4 shadow-sm">
          <div className="mb-3 inline-flex rounded-lg bg-muted p-2">
            <RiLock2Line className="size-4" />
          </div>
          <h2 className="text-sm font-semibold">{t("app.dashboard.accessTitle")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("app.dashboard.accessDescription")}</p>
        </article>
        <article className="rounded-xl border bg-card p-4 shadow-sm">
          <div className="mb-3 inline-flex rounded-lg bg-muted p-2">
            <RiPulseLine className="size-4" />
          </div>
          <h2 className="text-sm font-semibold">{t("app.dashboard.statusTitle")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("app.dashboard.statusDescription")}
          </p>
        </article>
        <article className="rounded-xl border bg-card p-4 shadow-sm">
          <div className="mb-3 inline-flex rounded-lg bg-muted p-2">
            <RiFlashlightLine className="size-4" />
          </div>
          <h2 className="text-sm font-semibold">{t("app.dashboard.nextStepTitle")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("app.dashboard.nextStepDescription")}
          </p>
        </article>
      </section>
    </div>
  );
}
