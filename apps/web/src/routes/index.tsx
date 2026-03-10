import { Link, createFileRoute } from "@tanstack/react-router";

import { useI18n } from "@/lib/i18n-provider";

export const Route = createFileRoute("/")({
  component: LandingRoute,
});

function LandingRoute() {
  const { t } = useI18n();

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-4xl flex-col justify-center gap-8 px-6 py-16">
      <div className="space-y-3">
        <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          {t("landing.eyebrow")}
        </p>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          {t("landing.title")}
        </h1>
        <p className="max-w-2xl text-base text-muted-foreground sm:text-lg">
          {t("landing.description")}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Link
          to="/login"
          className="inline-flex h-10 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          {t("common.actions.getStarted")}
        </Link>
        <Link
          to="/app/projects"
          className="inline-flex h-10 items-center justify-center rounded-lg border border-border px-4 text-sm font-medium transition-colors hover:bg-muted"
        >
          {t("common.actions.openApp")}
        </Link>
      </div>
    </main>
  );
}
