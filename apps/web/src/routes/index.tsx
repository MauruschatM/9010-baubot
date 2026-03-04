import { Link, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: LandingRoute,
});

function LandingRoute() {
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-4xl flex-col justify-center gap-8 px-6 py-16">
      <div className="space-y-3">
        <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          MVP Template
        </p>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          Build your workspace faster.
        </h1>
        <p className="max-w-2xl text-base text-muted-foreground sm:text-lg">
          Authentication, onboarding, organizations, and the app shell are already wired.
          Start by signing in with OTP.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Link
          to="/login"
          className="inline-flex h-10 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Get started
        </Link>
        <Link
          to="/app"
          className="inline-flex h-10 items-center justify-center rounded-lg border border-border px-4 text-sm font-medium transition-colors hover:bg-muted"
        >
          Open app
        </Link>
      </div>
    </main>
  );
}

