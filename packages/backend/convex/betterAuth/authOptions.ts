import { convexAdapter } from "@convex-dev/better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import { organization } from "better-auth/plugins/organization";
import type { BetterAuthOptions } from "better-auth/minimal";

import authConfig from "../auth.config";

// Used for Better Auth table generation and Convex component adapter shape.
export const options = {
  database: convexAdapter({} as any, {} as any),
  rateLimit: {
    storage: "database",
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
    sendResetPassword: async () => {},
  },
  plugins: [
    organization(),
    convex({ authConfig }),
  ],
} satisfies BetterAuthOptions;
