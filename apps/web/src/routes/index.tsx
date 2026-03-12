import {
  RiArrowRightUpLine,
  RiCameraLine,
  RiChat3Line,
  RiFolderChartLine,
  RiTimeLine,
} from "@remixicon/react";
import { Link, createFileRoute } from "@tanstack/react-router";

import { useI18n } from "@/lib/i18n-provider";

export const Route = createFileRoute("/")({
  component: LandingRoute,
});

function LandingRoute() {
  const { t } = useI18n();
  const stats = [
    {
      value: t("landing.stats.intakeValue"),
      label: t("landing.stats.intakeLabel"),
    },
    {
      value: t("landing.stats.structureValue"),
      label: t("landing.stats.structureLabel"),
    },
    {
      value: t("landing.stats.handoffValue"),
      label: t("landing.stats.handoffLabel"),
    },
  ];
  const workflowSteps = [
    {
      title: t("landing.preview.steps.inboxTitle"),
      description: t("landing.preview.steps.inboxDescription"),
    },
    {
      title: t("landing.preview.steps.projectTitle"),
      description: t("landing.preview.steps.projectDescription"),
    },
    {
      title: t("landing.preview.steps.summaryTitle"),
      description: t("landing.preview.steps.summaryDescription"),
    },
  ];
  const features = [
    {
      icon: RiChat3Line,
      title: t("landing.features.captureTitle"),
      description: t("landing.features.captureDescription"),
    },
    {
      icon: RiFolderChartLine,
      title: t("landing.features.organizeTitle"),
      description: t("landing.features.organizeDescription"),
    },
    {
      icon: RiCameraLine,
      title: t("landing.features.shareTitle"),
      description: t("landing.features.shareDescription"),
    },
  ];

  return (
    <main className="relative isolate overflow-hidden">
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top_left,_rgba(240,255,68,0.28),_transparent_34%),radial-gradient(circle_at_85%_22%,_rgba(15,45,71,0.12),_transparent_28%)]" />
      <div className="absolute inset-x-0 top-0 -z-10 h-80 bg-[linear-gradient(180deg,rgba(240,255,68,0.16),transparent)]" />

      <div className="mx-auto flex min-h-svh w-full max-w-6xl flex-col px-6 py-8 sm:py-10 lg:py-14">
        <div className="flex items-center justify-between gap-4">
          <div className="inline-flex items-center gap-3 rounded-full border border-border/70 bg-background/90 px-3 py-2 shadow-sm backdrop-blur">
            <img
              src="/favicon.svg"
              alt=""
              aria-hidden="true"
              className="h-9 w-9 rounded-2xl"
            />
            <div className="min-w-0">
              <p className="text-sm font-semibold tracking-tight">Baubot</p>
              <p className="truncate text-xs text-muted-foreground">
                {t("landing.eyebrow")}
              </p>
            </div>
          </div>

          <Link
            to="/login"
            className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            {t("auth.login.submit")}
          </Link>
        </div>

        <section className="grid flex-1 gap-12 py-12 lg:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)] lg:items-center">
          <div className="space-y-8">
            <div className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/85 px-3 py-1.5 text-sm text-muted-foreground shadow-sm backdrop-blur">
              <RiArrowRightUpLine className="size-4 text-primary" />
              <span>{t("landing.badge")}</span>
            </div>

            <div className="space-y-4">
              <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl lg:text-6xl">
                {t("landing.title")}
              </h1>
              <p className="max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
                {t("landing.description")}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Link
                to="/login"
                className="inline-flex h-11 items-center justify-center rounded-xl bg-primary px-5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                {t("common.actions.getStarted")}
              </Link>
              <Link
                to="/app/projects"
                className="inline-flex h-11 items-center justify-center rounded-xl border border-border bg-background/80 px-5 text-sm font-medium transition-colors hover:bg-muted"
              >
                {t("common.actions.openApp")}
              </Link>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              {stats.map((stat) => (
                <div
                  key={stat.label}
                  className="rounded-3xl border border-border/70 bg-background/80 p-4 shadow-sm backdrop-blur"
                >
                  <p className="text-2xl font-semibold tracking-tight">
                    {stat.value}
                  </p>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    {stat.label}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <aside className="rounded-[2rem] border border-border/70 bg-background/88 p-5 shadow-[0_24px_80px_rgba(15,45,71,0.12)] backdrop-blur sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  {t("landing.preview.badge")}
                </p>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight">
                  {t("landing.preview.title")}
                </h2>
              </div>
              <img
                src="/favicon.svg"
                alt=""
                aria-hidden="true"
                className="h-12 w-12 rounded-3xl"
              />
            </div>

            <p className="mt-4 max-w-md text-sm leading-6 text-muted-foreground">
              {t("landing.preview.description")}
            </p>

            <div className="mt-6 space-y-3">
              {workflowSteps.map((step, index) => (
                <div
                  key={step.title}
                  className="flex gap-4 rounded-2xl border border-border/70 bg-muted/40 p-4"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#f0ff44] text-sm font-semibold text-[#0f2d47]">
                    {index + 1}
                  </div>
                  <div className="space-y-1">
                    <p className="font-medium tracking-tight">{step.title}</p>
                    <p className="text-sm leading-6 text-muted-foreground">
                      {step.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-6 flex items-center gap-3 rounded-2xl bg-[#0f2d47] px-4 py-3 text-sm text-white">
              <RiTimeLine className="size-4 shrink-0 text-[#f0ff44]" />
              <p>{t("landing.preview.footer")}</p>
            </div>
          </aside>
        </section>

        <section className="grid gap-4 border-t border-border/70 pt-8 sm:grid-cols-3">
          {features.map((feature) => {
            const Icon = feature.icon;

            return (
              <article
                key={feature.title}
                className="rounded-[1.75rem] border border-border/70 bg-background/80 p-5 shadow-sm backdrop-blur"
              >
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#f0ff44] text-[#0f2d47]">
                  <Icon className="size-5" />
                </div>
                <h2 className="mt-4 text-lg font-semibold tracking-tight">
                  {feature.title}
                </h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {feature.description}
                </p>
              </article>
            );
          })}
        </section>
      </div>
    </main>
  );
}
