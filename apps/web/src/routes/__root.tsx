import type { ConvexQueryClient } from "@convex-dev/react-query";
import type { QueryClient } from "@tanstack/react-query";

import { ConvexBetterAuthProvider } from "@convex-dev/better-auth/react";
import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRouteWithContext,
  redirect,
  useRouteContext,
} from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import { ThemeProvider } from "next-themes";
import { useRef } from "react";

import { Toaster } from "@/components/ui/sonner";
import { authClient } from "@/lib/auth-client";
import { getAuthTokenForRouting } from "@/lib/route-gates";

import appCss from "../index.css?url";

function normalizePathname(pathname: string) {
  if (pathname === "/") {
    return pathname;
  }

  return pathname.replace(/\/+$/, "");
}

export interface RouterAppContext {
  queryClient: QueryClient;
  convexQueryClient: ConvexQueryClient;
}

export const Route = createRootRouteWithContext<RouterAppContext>()({
  head: () => ({
    meta: [
      {
        charSet: "utf-8",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
      {
        title: "My App",
      },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
  }),

  component: RootDocument,
  beforeLoad: async (ctx) => {
    const pathname = normalizePathname(ctx.location.pathname);

    if (!import.meta.env.SSR) {
      return {
        isAuthenticated: false,
        token: null,
      };
    }

    if (pathname.startsWith("/api/auth/")) {
      return {
        isAuthenticated: false,
        token: null,
      };
    }

    const token = await getAuthTokenForRouting();

    if (token) {
      ctx.context.convexQueryClient.serverHttpClient?.setAuth(token);
    }

    const requiresAuth =
      pathname === "/onboarding" ||
      pathname === "/organization" ||
      pathname === "/app" ||
      pathname.startsWith("/app/");

    if (!token && requiresAuth) {
      if (pathname !== "/login") {
        throw redirect({ to: "/login", replace: true });
      }
    }

    return {
      isAuthenticated: !!token,
      token,
    };
  },
});

function RootDocument() {
  const context = useRouteContext({ from: Route.id });
  const initialTokenRef = useRef<string | null>(context.token ?? null);

  if (context.token && initialTokenRef.current !== context.token) {
    initialTokenRef.current = context.token;
  }

  return (
    <ConvexBetterAuthProvider
      client={context.convexQueryClient.convexClient}
      authClient={authClient}
      initialToken={initialTokenRef.current}
    >
      <html lang="en" suppressHydrationWarning>
        <head>
          <HeadContent />
        </head>
        <body>
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
          >
            <Outlet />
            <Toaster richColors />
            <TanStackRouterDevtools position="bottom-left" />
            <Scripts />
          </ThemeProvider>
        </body>
      </html>
    </ConvexBetterAuthProvider>
  );
}
